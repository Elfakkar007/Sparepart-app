"use server";

import { prisma } from "@/lib/prisma";
import type { Line, SparepartLineStock } from "@/generated/prisma/client";
import { auth } from "@/auth";
import { isUniqueConstraintError, toFriendlyError, normalizeText } from "./_shared";
import type { ActionResult, TxClient } from "./_shared";
// Class error di-import dari stock-errors.ts (file BUKAN "use server"),
// bukan didefinisikan di sini — file "use server" cuma boleh export
// async function, lihat komentar lengkap di stock-errors.ts.
import { InsufficientStockError, LineStockRaceError } from "./stock-errors";

// ==========================================================
// RECORD STOCK MOVEMENT
//
// Fungsi terpusat untuk mencatat pergerakan stok: dipakai baik untuk
// restock (MASUK) maupun koreksi stok opname (KOREKSI). Perubahan pada
// baris SparepartLineStock, total Sparepart.stok, dan log StockMovement
// dilakukan dalam SATU prisma.$transaction supaya ketiganya selalu
// konsisten (semua berhasil atau semua batal).
//
// User yang login diambil di SINI lewat auth() (server-side session),
// BUKAN dikirim manual oleh caller — caller (client component) tidak
// pernah tahu/mengirim userId.
// ==========================================================

export type RecordStockMovementInput = {
    sparepartId: string;
    line: Line;
    tipe: "MASUK" | "KOREKSI";
    /** Delta perubahan. MASUK harus > 0. KOREKSI boleh positif atau negatif. */
    jumlah: number;
    referensi?: string;
    /** Wajib diisi kalau tipe = "KOREKSI". */
    keterangan?: string;
};

export type RecordStockMovementResult = {
    newJumlahLine: number;
    newTotalStok: number;
    /**
     * Baris SparepartLineStock lengkap setelah update — dipakai UI (mis.
     * grid) untuk sinkronisasi state tanpa reload, termasuk kasus baris
     * ini baru dibuat (belum ada sebelumnya) dan lastOpnameDate yang ikut
     * berubah otomatis saat tipe = KOREKSI.
     */
    lineStock: SparepartLineStock;
};

export type RecordStockMovementCoreInput = {
    sparepartId: string;
    line: Line;
    tipe: "MASUK" | "KOREKSI";
    /** Delta FINAL (tanda sudah benar, MASUK selalu positif) — bukan raw
     *  input dari user. Validasi "jumlah > 0 utk MASUK" dan "keterangan
     *  wajib utk KOREKSI" jadi tanggung jawab pemanggil, SEBELUM membuka
     *  transaction (lihat recordStockMovement di bawah). */
    jumlah: number;
    referensi?: string;
    /** Sudah dinormalisasi/divalidasi oleh caller. */
    keterangan?: string;
};

/**
 * Core logic pencatatan stock movement, dijalankan DI DALAM transaction
 * yang di-pass oleh caller (`tx`). Dipakai baik oleh recordStockMovement
 * (yang buka transaction sendiri) maupun submitSmartForm di sparepart.ts
 * (yang menggabungkan pembuatan Sparepart baru + beberapa pergerakan
 * stok dalam SATU transaction).
 */
export async function recordStockMovementCore(
    tx: TxClient,
    userId: string,
    input: RecordStockMovementCoreInput
): Promise<RecordStockMovementResult> {
    const { sparepartId, line, tipe, jumlah: delta, referensi, keterangan } = input;

    // Cari baris SparepartLineStock untuk (sparepartId, line).
    // Kalau belum ada, buat baru dengan jumlah & minStok = 0.
    let lineStock = await tx.sparepartLineStock.findUnique({
        where: { sparepartId_line: { sparepartId, line } },
    });

    if (!lineStock) {
        try {
            lineStock = await tx.sparepartLineStock.create({
                data: { sparepartId, line, jumlah: 0, minStok: 0 },
            });
        } catch (error) {
            if (isUniqueConstraintError(error)) {
                throw new LineStockRaceError();
            }
            throw error;
        }
    }

    // Hitung jumlah baru, pastikan tidak minus.
    const newJumlahLine = lineStock.jumlah + delta;
    if (newJumlahLine < 0) {
        // Melempar error di sini membatalkan SELURUH transaction ini,
        // termasuk create baris baru di atas kalau memang baru dibuat.
        throw new InsufficientStockError();
    }

    // Update baris line stock. lastOpnameDate hanya disentuh kalau
    // ini koreksi (dianggap sebagai kegiatan stok opname).
    const updatedLineStock = await tx.sparepartLineStock.update({
        where: { id: lineStock.id },
        data: {
            jumlah: newJumlahLine,
            ...(tipe === "KOREKSI" ? { lastOpnameDate: new Date() } : {}),
        },
    });

    // Hitung ulang total stok Sparepart dari SEMUA baris line miliknya
    // (bukan cuma nambah/kurang delta ke Sparepart.stok), supaya tetap
    // konsisten walau ada baris line lain yang sempat out-of-sync.
    // Aggregate ini jalan dalam transaction yang sama sehingga sudah
    // melihat hasil update baris di atas.
    const aggregate = await tx.sparepartLineStock.aggregate({
        where: { sparepartId },
        _sum: { jumlah: true },
    });
    const newTotalStok = aggregate._sum.jumlah ?? 0;

    await tx.sparepart.update({
        where: { id: sparepartId },
        data: { stok: newTotalStok },
    });

    // Catat pergerakan stok. `jumlah` yang disimpan = delta (bisa
    // negatif untuk koreksi turun), BUKAN jumlah akhir setelah update.
    await tx.stockMovement.create({
        data: {
            sparepartId,
            line,
            tipe,
            sumber: tipe === "MASUK" ? "ADMIN_MASUK" : "ADMIN_KOREKSI",
            jumlah: delta,
            referensi: referensi?.trim() || undefined,
            keterangan: keterangan ?? undefined,
            userId,
        },
    });

    return {
        newJumlahLine: updatedLineStock.jumlah,
        newTotalStok,
        lineStock: updatedLineStock,
    };
}

export async function recordStockMovement(
    input: RecordStockMovementInput
): Promise<ActionResult<RecordStockMovementResult>> {
    const session = await auth();
    if (!session?.user?.id) {
        return { success: false, message: "Anda harus login" };
    }
    const userId = session.user.id;

    // --- Validasi yang tidak butuh akses database, dicek DI LUAR
    //     transaction supaya input yang sudah pasti gagal tidak sampai
    //     membuka koneksi transaksi. ---

    const keteranganValid = normalizeText(input.keterangan ?? "");
    if (input.tipe === "KOREKSI" && !keteranganValid) {
        return {
            success: false,
            message: "Keterangan wajib diisi untuk koreksi stok",
        };
    }

    if (input.tipe === "MASUK" && input.jumlah <= 0) {
        return { success: false, message: "Jumlah restock harus lebih dari 0" };
    }

    // Untuk MASUK delta selalu positif (sudah divalidasi jumlah > 0 di atas,
    // Math.abs() cuma jaga-jaga). Untuk KOREKSI delta dipakai apa adanya
    // (boleh negatif).
    const delta = input.tipe === "MASUK" ? Math.abs(input.jumlah) : input.jumlah;

    try {
        const result = await prisma.$transaction((tx) =>
            recordStockMovementCore(tx, userId, {
                sparepartId: input.sparepartId,
                line: input.line,
                tipe: input.tipe,
                jumlah: delta,
                referensi: input.referensi,
                keterangan: keteranganValid ?? undefined,
            })
        );

        return { success: true, data: result };
    } catch (error) {
        if (error instanceof InsufficientStockError) {
            return { success: false, message: error.message };
        }

        // Race condition: dua request nyaris bersamaan sama-sama tidak
        // menemukan baris lalu sama-sama coba create baris
        // SparepartLineStock untuk (sparepartId, line) yang sama.
        if (error instanceof LineStockRaceError) {
            return { success: false, message: error.message };
        }

        return toFriendlyError(error, "Gagal mencatat pergerakan stok");
    }
}

// ==========================================================
// UPDATE LINE MIN STOK
//
// Set/update ambang minStok untuk satu line tertentu. Ini murni setting,
// BUKAN pergerakan fisik stok — sengaja TIDAK membuat StockMovement dan
// TIDAK butuh database transaction (cuma satu write, upsert). Tetap
// mewajibkan login lewat auth() sebelum memproses apapun.
// ==========================================================

export type UpdateLineMinStokResult = {
    sparepartId: string;
    line: Line;
    minStok: number;
    /** Baris lengkap — dipakai UI grid untuk sinkronisasi state tanpa reload. */
    lineStock: SparepartLineStock;
};

/**
 * Core logic update minStok, menerima `tx` supaya bisa jadi bagian dari
 * transaction yang lebih besar (dipakai submitSmartForm di sparepart.ts).
 */
export async function updateLineMinStokCore(
    tx: TxClient,
    sparepartId: string,
    line: Line,
    minStok: number
): Promise<UpdateLineMinStokResult> {
    const lineStock = await tx.sparepartLineStock.upsert({
        where: { sparepartId_line: { sparepartId, line } },
        update: { minStok },
        create: { sparepartId, line, minStok, jumlah: 0 },
    });

    return {
        sparepartId: lineStock.sparepartId,
        line: lineStock.line,
        minStok: lineStock.minStok,
        lineStock,
    };
}

export async function updateLineMinStok(
    sparepartId: string,
    line: Line,
    minStok: number
): Promise<ActionResult<UpdateLineMinStokResult>> {
    const session = await auth();
    if (!session?.user?.id) {
        return { success: false, message: "Anda harus login" };
    }

    if (minStok < 0) {
        return { success: false, message: "Minimal stok tidak boleh negatif" };
    }

    try {
        const data = await updateLineMinStokCore(prisma, sparepartId, line, minStok);
        return { success: true, data };
    } catch (error) {
        return toFriendlyError(error, "Gagal memperbarui minimal stok");
    }

}
export type UpdateLineKeteranganResult = {
    sparepartId: string;
    line: Line;
    keterangan: string;
    /** Baris lengkap — dipakai UI grid untuk sinkronisasi state tanpa reload. */
    lineStock: SparepartLineStock;
};

/**
 * Core logic update keterangan, menerima `tx` supaya konsisten dengan
 * Core function lain (bisa dipakai dalam transaction gabungan kalau
 * suatu saat dibutuhkan).
 */
export async function updateLineKeteranganCore(
    tx: TxClient,
    sparepartId: string,
    line: Line,
    keterangan: string
): Promise<UpdateLineKeteranganResult> {
    // String kosong = hapus catatan → disimpan sebagai null, bukan "".
    const keteranganValue = keterangan.trim() || null;

    const lineStock = await tx.sparepartLineStock.upsert({
        where: { sparepartId_line: { sparepartId, line } },
        update: { keterangan: keteranganValue },
        create: { sparepartId, line, keterangan: keteranganValue, jumlah: 0, minStok: 0 },
    });

    return {
        sparepartId: lineStock.sparepartId,
        line: lineStock.line,
        keterangan: lineStock.keterangan ?? "",
        lineStock,
    };
}

export async function updateLineKeterangan(
    sparepartId: string,
    line: Line,
    keterangan: string
): Promise<ActionResult<UpdateLineKeteranganResult>> {
    const session = await auth();
    if (!session?.user?.id) {
        return { success: false, message: "Anda harus login" };
    }

    try {
        const data = await updateLineKeteranganCore(prisma, sparepartId, line, keterangan);
        return { success: true, data };
    } catch (error) {
        return toFriendlyError(error, "Gagal memperbarui keterangan line");
    }
}