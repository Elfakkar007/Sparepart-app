"use server";

import { prisma } from "@/lib/prisma";
import type { Line, SparepartLineStock } from "@/generated/prisma/client";
import { auth } from "@/auth";
import { isUniqueConstraintError, toFriendlyError, normalizeText } from "./_shared";
import type { ActionResult } from "./_shared";

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

/**
 * Sentinel error untuk memicu rollback prisma.$transaction ketika stok
 * akan jadi minus. Dilempar DI DALAM transaction, ditangkap lagi di
 * catch luar untuk dikonversi jadi ActionResult yang ramah.
 */
class InsufficientStockError extends Error {
    constructor() {
        super("Stok tidak boleh minus");
        this.name = "InsufficientStockError";
    }
}

export async function recordStockMovement(
    input: RecordStockMovementInput
): Promise<ActionResult<RecordStockMovementResult>> {
    const session = await auth();
    if (!session?.user?.id) {
        return { success: false, message: "Anda harus login" };
    }
    const userId = session.user.id;

    const { sparepartId, line, tipe, jumlah, referensi } = input;

    // --- Validasi yang tidak butuh akses database, dicek DI LUAR
    //     transaction supaya input yang sudah pasti gagal tidak sampai
    //     membuka koneksi transaksi. ---

    const keteranganValid = normalizeText(input.keterangan ?? "");
    if (tipe === "KOREKSI" && !keteranganValid) {
        return {
            success: false,
            message: "Keterangan wajib diisi untuk koreksi stok",
        };
    }

    if (tipe === "MASUK" && jumlah <= 0) {
        return { success: false, message: "Jumlah restock harus lebih dari 0" };
    }

    // Untuk MASUK delta selalu positif (sudah divalidasi jumlah > 0 di atas,
    // Math.abs() cuma jaga-jaga). Untuk KOREKSI delta dipakai apa adanya
    // (boleh negatif).
    const delta = tipe === "MASUK" ? Math.abs(jumlah) : jumlah;

    try {
        const result = await prisma.$transaction(async (tx) => {
            // Cari baris SparepartLineStock untuk (sparepartId, line).
            // Kalau belum ada, buat baru dengan jumlah & minStok = 0.
            let lineStock = await tx.sparepartLineStock.findUnique({
                where: { sparepartId_line: { sparepartId, line } },
            });

            if (!lineStock) {
                lineStock = await tx.sparepartLineStock.create({
                    data: { sparepartId, line, jumlah: 0, minStok: 0 },
                });
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
                    keterangan: keteranganValid ?? undefined,
                    userId,
                },
            });

            return {
                newJumlahLine: updatedLineStock.jumlah,
                newTotalStok,
                lineStock: updatedLineStock,
            };
        });

        return { success: true, data: result };
    } catch (error) {
        if (error instanceof InsufficientStockError) {
            return { success: false, message: error.message };
        }

        // Race condition: dua request nyaris bersamaan sama-sama tidak
        // menemukan baris (findUnique kosong) lalu sama-sama coba create
        // baris SparepartLineStock untuk (sparepartId, line) yang sama —
        // salah satunya kena unique constraint @@unique([sparepartId, line]).
        if (isUniqueConstraintError(error)) {
            return {
                success: false,
                message:
                    "Data stok line ini sedang diproses permintaan lain, silakan coba lagi",
            };
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
        const lineStock = await prisma.sparepartLineStock.upsert({
            where: { sparepartId_line: { sparepartId, line } },
            update: { minStok },
            create: { sparepartId, line, minStok, jumlah: 0 },
        });

        return {
            success: true,
            data: {
                sparepartId: lineStock.sparepartId,
                line: lineStock.line,
                minStok: lineStock.minStok,
                lineStock,
            },
        };
    } catch (error) {
        return toFriendlyError(error, "Gagal memperbarui minimal stok");
    }
}