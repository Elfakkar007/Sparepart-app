"use server";

import { prisma } from "@/lib/prisma";
import type { Line, Prisma, Sparepart } from "@/generated/prisma/client";
import { auth } from "@/auth";
import {
    ActionValidationError,
    isUniqueConstraintError,
    normalizeText,
    toFriendlyError,
} from "./_shared";
import type { ActionResult, TxClient } from "./_shared";
import {
    recordStockMovementCore,
    updateLineMinStokCore,
} from "./stock-movement";
// Dipakai importSparepartExcel: cari master data yang sudah ada
// (case-insensitive) dan otomatis buat baru kalau belum ada, supaya user
// tidak perlu bolak-balik bikin master data manual sebelum import.
import {
    getKategoriList,
    getSatuanList,
    getLokasiRakList,
    addKategori,
    addSatuan,
    addLokasiRak,
} from "./master-data";
// Class error di-import terpisah dari stock-errors.ts (BUKAN dari
// stock-movement.ts) — stock-movement.ts berstatus "use server" dan
// tidak lagi re-export class apa pun, lihat komentar di stock-errors.ts.
import { InsufficientStockError, LineStockRaceError } from "./stock-errors";

// ==========================================================
// Include relasi yang dipakai bersama oleh getSparepartList dan
// getSparepartByItemCode, supaya bentuk data yang dikembalikan konsisten.
// Pakai `satisfies` supaya tetap type-safe tanpa perlu anotasi manual.
// ==========================================================
const sparepartInclude = {
    kategori: true,
    satuan: true,
    lokasiRak: true,
    lineStocks: true,
} satisfies Prisma.SparepartInclude;

// Tipe Sparepart lengkap dengan relasinya, diturunkan otomatis dari
// `sparepartInclude` di atas lewat Prisma.SparepartGetPayload.
type SparepartWithRelations = Prisma.SparepartGetPayload<{
    include: typeof sparepartInclude;
}>;

// ==========================================================
// GET LIST
//
// `sortBy` opsional — kalau tidak diisi, default "terlama" (createdAt
// asc): part yang paling lama dibuat tampil paling atas, part baru
// nambah ke BAWAH, sesuai kebiasaan daftar yang bertambah ke bawah.
// Pemetaan tiap opsi ke Prisma orderBy dipusatkan di SORT_ORDER_BY
// supaya gampang ditambah opsi baru tanpa menyentuh isi fungsi.
// ==========================================================

export type SparepartSortBy = "nama_asc" | "nama_desc" | "terbaru" | "terlama";

const SORT_ORDER_BY: Record<
    SparepartSortBy,
    Prisma.SparepartOrderByWithRelationInput
> = {
    nama_asc: { namaPart: "asc" }, // perilaku lama (sebelum ada opsi sort)
    nama_desc: { namaPart: "desc" },
    terbaru: { createdAt: "desc" },
    terlama: { createdAt: "asc" },
};

export async function getSparepartList(
    sortBy: SparepartSortBy = "terlama"
): Promise<ActionResult<SparepartWithRelations[]>> {
    try {
        const data = await prisma.sparepart.findMany({
            include: sparepartInclude,
            orderBy: SORT_ORDER_BY[sortBy],
        });
        return { success: true, data };
    } catch (error) {
        return toFriendlyError(error, "Gagal mengambil daftar sparepart");
    }
}

// ==========================================================
// GET BY ITEM CODE (exact match)
// ==========================================================

export async function getSparepartByItemCode(
    itemCode: string
): Promise<ActionResult<SparepartWithRelations | null>> {
    try {
        const data = await prisma.sparepart.findUnique({
            where: { itemCode: itemCode.trim() },
            include: sparepartInclude,
        });
        // PENTING: `data` bernilai null kalau tidak ketemu, dan itu BUKAN
        // error — smart form memakai hasil null ini untuk memutuskan apakah
        // user sedang input part baru atau restock part yang sudah ada.
        return { success: true, data };
    } catch (error) {
        return toFriendlyError(
            error,
            "Gagal mencari sparepart berdasarkan item code"
        );
    }
}

// ==========================================================
// CREATE
// ==========================================================

type CreateSparepartInput = {
    itemCode: string;
    namaPart: string;
    spesifikasi?: string;
    keterangan?: string;
    kategoriId: string;
    satuanId: string;
    lokasiRakId?: string;
};

/**
 * Core logic pembuatan Sparepart, menerima `tx` dari pemanggil supaya
 * bisa jadi bagian dari transaction yang lebih besar (dipakai
 * submitSmartForm di bawah). Melempar ActionValidationError kalau
 * validasi gagal (bukan return ActionResult langsung), supaya
 * transaction luar tahu harus rollback.
 */
async function createSparepartCore(
    tx: TxClient,
    input: CreateSparepartInput
): Promise<Sparepart> {
    const itemCode = normalizeText(input.itemCode);
    if (!itemCode) {
        throw new ActionValidationError("Item Code tidak boleh kosong");
    }

    const namaPart = normalizeText(input.namaPart);
    if (!namaPart) {
        throw new ActionValidationError("Nama Part tidak boleh kosong");
    }

    return tx.sparepart.create({
        data: {
            itemCode,
            namaPart,
            spesifikasi: input.spesifikasi?.trim() || undefined,
            keterangan: input.keterangan?.trim() || undefined,
            kategoriId: input.kategoriId,
            satuanId: input.satuanId,
            lokasiRakId: input.lokasiRakId || undefined,
            // `stok` sengaja dibiarkan default (0) dan belum ada baris
            // SparepartLineStock — part boleh dibuat dulu tanpa stok per line,
            // baris stok per line baru dibuat lewat alur stock-in/opname
            // terpisah (atau langsung lewat submitSmartForm kalau user
            // sekalian isi stok awal).
        },
    });
}

export async function createSparepart(
    input: CreateSparepartInput
): Promise<ActionResult<Sparepart>> {
    try {
        const data = await createSparepartCore(prisma, input);
        return { success: true, data };
    } catch (error) {
        if (error instanceof ActionValidationError) {
            return { success: false, message: error.message };
        }
        if (isUniqueConstraintError(error)) {
            return { success: false, message: "Item Code sudah terdaftar" };
        }
        return toFriendlyError(error, "Gagal menambahkan sparepart");
    }
}

// ==========================================================
// SUBMIT SMART FORM
//
// Fungsi TERPUSAT dipakai smart form: satu form, dua kemungkinan alur,
// ditentukan otomatis dari itemCode:
//   - Item Code BELUM ada → buat Sparepart baru + (opsional) stok awal
//     per line.
//   - Item Code SUDAH ada → restock: field master (namaPart, kategoriId,
//     dst) DIABAIKAN meskipun dikirim — kolom master di-lock di form —
//     hanya tambahan stok per line yang diproses.
//
// SELURUH proses (cek itemCode, create Sparepart, tiap pergerakan stok,
// tiap update minStok) jalan dalam SATU prisma.$transaction: kalau ada
// langkah manapun gagal (validasi, unique constraint, stok minus, dll),
// semua di-rollback — tidak ada Sparepart baru "nyangkut" tanpa stok
// yang seharusnya ikut dicatat, dan tidak ada stok yang tercatat
// sebagian.
//
// Untuk itu, logic pembuatan Sparepart (createSparepartCore di atas) dan
// pencatatan stock movement / minStok (recordStockMovementCore,
// updateLineMinStokCore — dari stock-movement.ts) sengaja dalam bentuk
// "Core" yang menerima `tx` dari SINI, BUKAN dipanggil lewat
// createSparepart/recordStockMovement/updateLineMinStok biasa — ketiga
// fungsi itu masing-masing membuka prisma.$transaction sendiri, jadi
// kalau dipanggil langsung dari sini hasilnya jadi transaction TERPISAH
// dan tidak atomic.
// ==========================================================

export type SubmitSmartFormInput = {
    itemCode: string;
    // Field master, HANYA divalidasi & dipakai kalau part BELUM ada:
    namaPart?: string;
    spesifikasi?: string;
    keterangan?: string;
    kategoriId?: string;
    satuanId?: string;
    lokasiRakId?: string;
    // Stok per line — dipakai baik sebagai stok awal (part baru) MAUPUN
    // tambahan stok (restock). Baris dengan jumlah <= 0 diabaikan
    // sepenuhnya, termasuk minStok di baris itu.
    lineStocks: { line: Line; jumlah: number; minStok?: number }[];
};

export type SubmitSmartFormResult = {
    mode: "PART_BARU" | "RESTOCK";
    sparepart: Sparepart;
};

export async function submitSmartForm(
    input: SubmitSmartFormInput
): Promise<ActionResult<SubmitSmartFormResult>> {
    const session = await auth();
    if (!session?.user?.id) {
        return { success: false, message: "Anda harus login" };
    }
    const userId = session.user.id;

    const itemCode = normalizeText(input.itemCode);
    if (!itemCode) {
        return { success: false, message: "Item Code tidak boleh kosong" };
    }

    // Hanya baris dengan jumlah > 0 yang diproses sebagai pergerakan stok
    // MASUK — baris dengan jumlah 0/kosong dianggap tidak disentuh user.
    const lineStocksToApply = input.lineStocks.filter((ls) => ls.jumlah > 0);

    // Validasi minStok yang tidak butuh DB, dicek di luar transaction
    // (sama seperti pola updateLineMinStok).
    for (const ls of lineStocksToApply) {
        if (ls.minStok !== undefined && ls.minStok < 0) {
            return { success: false, message: "Minimal stok tidak boleh negatif" };
        }
    }

    try {
        const result = await prisma.$transaction(async (tx) => {
            const existing = await tx.sparepart.findUnique({
                where: { itemCode },
            });
            const mode: SubmitSmartFormResult["mode"] = existing
                ? "RESTOCK"
                : "PART_BARU";

            let sparepartId: string;

            if (!existing) {
                // ---------- PART BARU ----------
                const namaPart = normalizeText(input.namaPart ?? "");
                const { kategoriId, satuanId, lokasiRakId, spesifikasi, keterangan } =
                    input;

                if (!namaPart || !kategoriId || !satuanId) {
                    throw new ActionValidationError("Data part baru belum lengkap");
                }

                const created = await createSparepartCore(tx, {
                    itemCode,
                    namaPart,
                    spesifikasi,
                    keterangan,
                    kategoriId,
                    satuanId,
                    lokasiRakId,
                });
                sparepartId = created.id;
            } else {
                // ---------- RESTOCK ----------
                // Field master (namaPart, kategoriId, dst) SENGAJA
                // diabaikan meskipun dikirim dari client — kolom master
                // di-lock di smart form untuk part yang sudah ada, tidak
                // diubah lewat alur restock ini.
                if (lineStocksToApply.length === 0) {
                    throw new ActionValidationError("Isi minimal 1 jumlah restock");
                }
                sparepartId = existing.id;
            }

            for (const ls of lineStocksToApply) {
                await recordStockMovementCore(tx, userId, {
                    sparepartId,
                    line: ls.line,
                    tipe: "MASUK",
                    jumlah: Math.abs(ls.jumlah),
                    referensi: mode === "PART_BARU" ? "Stok awal" : undefined,
                });

                if (ls.minStok !== undefined) {
                    await updateLineMinStokCore(tx, sparepartId, ls.line, ls.minStok);
                }
            }

            // Ambil ulang state Sparepart terbaru — `stok` sudah ikut
            // ter-update oleh recordStockMovementCore di atas untuk
            // setiap line yang diproses.
            const sparepart = await tx.sparepart.findUniqueOrThrow({
                where: { id: sparepartId },
            });

            return { mode, sparepart };
        });

        return { success: true, data: result };
    } catch (error) {
        if (error instanceof ActionValidationError) {
            return { success: false, message: error.message };
        }
        if (error instanceof InsufficientStockError) {
            return { success: false, message: error.message };
        }
        if (error instanceof LineStockRaceError) {
            return { success: false, message: error.message };
        }
        if (isUniqueConstraintError(error)) {
            // Satu-satunya unique constraint yang tersisa di jalur ini
            // (race condition line stock sudah ditangani terpisah lewat
            // LineStockRaceError di atas) adalah itemCode Sparepart.
            return { success: false, message: "Item Code sudah terdaftar" };
        }
        return toFriendlyError(error, "Gagal menyimpan data smart form");
    }
}

// ==========================================================
// IMPORT EXCEL (bulk)
//
// Dipakai import-excel-modal.tsx (Step 8a) setelah user memetakan kolom
// Excel ke field sistem di CLIENT — modal itu hanya mengirim array of
// object mentah (MappedRow), belum divalidasi/dicocokkan ke id master
// data sama sekali. Fungsi ini yang mengerjakan semuanya per baris:
//
//   1. Skip baris tanpa itemCode (dianggap baris kosong/pemisah).
//   2. Cocokkan kategoriNama/satuanNama/lokasiRakNama ke master data yang
//      SUDAH ADA (case-insensitive); kalau belum ada, buat otomatis.
//   3. Susun lineStocks dari kolom jumlahLineX/minStokLineX/jumlahGeneral/
//      minStokGeneral yang terisi.
//   4. Delegasikan create/restock-nya ke submitSmartForm (fungsi yang
//      SAMA dipakai smart form manual) — supaya semua aturan bisnis
//      (deteksi PART_BARU vs RESTOCK, transaction atomic per baris, dll)
//      konsisten persis dengan alur input manual, tidak diduplikasi di
//      sini.
//
// PENTING — SATU baris gagal TIDAK menggagalkan baris lain: setiap baris
// dibungkus try/catch sendiri di dalam loop, hasilnya (sukses/gagal)
// dicatat ke array `hasil` lalu lanjut ke baris berikutnya. Karena itu
// action ini SELALU mengembalikan success:true selama looping-nya
// sendiri tidak crash (mis. gagal memuat master data di awal) — gagal
// per-baris itu bagian normal dari hasil, bukan kegagalan action.
// ==========================================================

// Bentuk 1 baris hasil mapping kolom Excel dari import-excel-modal.tsx
// (client). Sengaja didefinisikan ulang di sini (bukan import dari file
// "use client" itu) supaya file server ini tidak bergantung pada modul
// client — persis alasan stock-errors.ts dipisah dari stock-movement.ts.
// Bentuknya harus tetap sinkron dengan `SystemFieldKey` di
// import-excel-modal.tsx kalau field sistem baru ditambah di sana.
export type ImportSparepartRow = Partial<{
    itemCode: string | number;
    namaPart: string | number;
    spesifikasi: string | number;
    keterangan: string | number;
    kategoriNama: string | number;
    satuanNama: string | number;
    lokasiRakNama: string | number;
    jumlahLine1: string | number;
    minStokLine1: string | number;
    jumlahLine2: string | number;
    minStokLine2: string | number;
    jumlahLine3: string | number;
    minStokLine3: string | number;
    jumlahLine4: string | number;
    minStokLine4: string | number;
    jumlahGeneral: string | number;
    minStokGeneral: string | number;
}>;

export type ImportSparepartRowResult = {
    /** Nomor baris ASLI di file Excel (baris 1 = header, jadi data mulai 2). */
    row: number;
    itemCode: string;
    status: "SUKSES" | "GAGAL";
    /** Cuma terisi kalau status SUKSES. */
    mode?: "PART_BARU" | "RESTOCK";
    /** Cuma terisi kalau status GAGAL — alasan kegagalan baris ini. */
    pesan?: string;
};

export type ImportSparepartExcelResult = {
    hasil: ImportSparepartRowResult[];
    totalSukses: number;
    totalGagal: number;
};

/**
 * Ambil angka valid dari nilai mentah kolom Excel (bisa string atau
 * number tergantung apakah field-nya numeric di buildMappedData sisi
 * client). Kosong/tidak berupa angka -> undefined, DIBEDAKAN dari 0.
 */
function toFiniteNumber(value: string | number | undefined): number | undefined {
    if (value === undefined || value === "") return undefined;
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Susun payload lineStocks satu baris Excel dari kolom
 * jumlahLineX/minStokLineX/jumlahGeneral/minStokGeneral — persis pola
 * buildLineStocksPayload di smart-form-modal.tsx (Step 7b): baris line
 * dengan jumlah kosong ATAU <= 0 DILEWATI sepenuhnya, termasuk
 * minStok-nya.
 */
function buildLineStocksFromRow(
    row: ImportSparepartRow
): SubmitSmartFormInput["lineStocks"] {
    const pairs: { line: Line; jumlah?: string | number; minStok?: string | number }[] = [
        { line: "LINE_1", jumlah: row.jumlahLine1, minStok: row.minStokLine1 },
        { line: "LINE_2", jumlah: row.jumlahLine2, minStok: row.minStokLine2 },
        { line: "LINE_3", jumlah: row.jumlahLine3, minStok: row.minStokLine3 },
        { line: "LINE_4", jumlah: row.jumlahLine4, minStok: row.minStokLine4 },
        { line: "GENERAL", jumlah: row.jumlahGeneral, minStok: row.minStokGeneral },
    ];

    const lineStocks: SubmitSmartFormInput["lineStocks"] = [];
    for (const pair of pairs) {
        const jumlah = toFiniteNumber(pair.jumlah);
        if (jumlah === undefined || jumlah <= 0) continue;

        lineStocks.push({
            line: pair.line,
            jumlah,
            minStok: toFiniteNumber(pair.minStok),
        });
    }
    return lineStocks;
}

/**
 * Cari id master data (Kategori/Satuan/LokasiRak) dari namanya,
 * case-insensitive, lewat `cache` yang sudah di-preload SEKALI di awal
 * importSparepartExcel (bukan query ulang tiap baris). Kalau nama belum
 * ada di cache, buat baru lewat `addFn` (addKategori/addSatuan/
 * addLokasiRak) lalu simpan hasilnya ke cache supaya baris-baris
 * berikutnya dalam import yang sama, yang menyebut nama sama, memakai
 * id yang sama alih-alih mencoba membuat duplikat.
 *
 * `namaMentah` undefined/kosong -> dianggap "tidak diisi user", bukan
 * error: mengembalikan objek kosong, biar submitSmartForm sendiri yang
 * menentukan apakah field ini wajib (part baru) atau boleh kosong
 * (restock).
 */
async function resolveOrCreateMasterId(
    namaMentah: string | number | undefined,
    cache: Map<string, string>,
    addFn: (nama: string) => Promise<ActionResult<{ id: string }>>
): Promise<{ id?: string; error?: string }> {
    if (namaMentah === undefined) return {};
    const nama = normalizeText(String(namaMentah));
    if (!nama) return {};

    const key = nama.toLowerCase();
    const cachedId = cache.get(key);
    if (cachedId) return { id: cachedId };

    const created = await addFn(nama);
    if (!created.success) {
        return { error: created.message };
    }
    cache.set(key, created.data.id);
    return { id: created.data.id };
}

export async function importSparepartExcel(
    rows: ImportSparepartRow[]
): Promise<ActionResult<ImportSparepartExcelResult>> {
    // Muat SEMUA master data SEKALI di awal (bukan per baris), dipakai
    // sebagai cache case-insensitive nama -> id. Kalau salah satu gagal
    // dimuat, seluruh proses belum sempat memproses satu baris pun —
    // ini kegagalan action itu sendiri, BUKAN kegagalan per-baris.
    const [kategoriResult, satuanResult, lokasiRakResult] = await Promise.all([
        getKategoriList(),
        getSatuanList(),
        getLokasiRakList(),
    ]);

    if (!kategoriResult.success) {
        return { success: false, message: kategoriResult.message };
    }
    if (!satuanResult.success) {
        return { success: false, message: satuanResult.message };
    }
    if (!lokasiRakResult.success) {
        return { success: false, message: lokasiRakResult.message };
    }

    const kategoriCache = new Map(
        kategoriResult.data.map((k) => [k.nama.trim().toLowerCase(), k.id])
    );
    const satuanCache = new Map(
        satuanResult.data.map((s) => [s.nama.trim().toLowerCase(), s.id])
    );
    const lokasiRakCache = new Map(
        lokasiRakResult.data.map((l) => [l.nama.trim().toLowerCase(), l.id])
    );

    const hasil: ImportSparepartRowResult[] = [];

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        // Baris 1 di file Excel = header, jadi data baris pertama = 2.
        const excelRow = i + 2;

        const itemCode = normalizeText(String(row.itemCode ?? ""));
        if (!itemCode) {
            // Baris kosong/pemisah — dilewati diam-diam, TIDAK dihitung gagal.
            continue;
        }

        try {
            const kategori = await resolveOrCreateMasterId(
                row.kategoriNama,
                kategoriCache,
                addKategori
            );
            if (kategori.error) {
                hasil.push({
                    row: excelRow,
                    itemCode,
                    status: "GAGAL",
                    pesan: `Gagal membuat kategori baru: ${kategori.error}`,
                });
                continue;
            }

            const satuan = await resolveOrCreateMasterId(
                row.satuanNama,
                satuanCache,
                addSatuan
            );
            if (satuan.error) {
                hasil.push({
                    row: excelRow,
                    itemCode,
                    status: "GAGAL",
                    pesan: `Gagal membuat satuan baru: ${satuan.error}`,
                });
                continue;
            }

            const lokasiRak = await resolveOrCreateMasterId(
                row.lokasiRakNama,
                lokasiRakCache,
                addLokasiRak
            );
            if (lokasiRak.error) {
                hasil.push({
                    row: excelRow,
                    itemCode,
                    status: "GAGAL",
                    pesan: `Gagal membuat lokasi rak baru: ${lokasiRak.error}`,
                });
                continue;
            }

            const submitInput: SubmitSmartFormInput = {
                itemCode,
                namaPart: row.namaPart !== undefined ? String(row.namaPart) : undefined,
                spesifikasi:
                    row.spesifikasi !== undefined ? String(row.spesifikasi) : undefined,
                keterangan:
                    row.keterangan !== undefined ? String(row.keterangan) : undefined,
                kategoriId: kategori.id,
                satuanId: satuan.id,
                lokasiRakId: lokasiRak.id,
                lineStocks: buildLineStocksFromRow(row),
            };

            // submitSmartForm sendiri yang menentukan PART_BARU vs RESTOCK
            // (dari ada/tidaknya itemCode) dan menjalankan semuanya dalam
            // SATU transaction atomic — sama persis seperti alur manual.
            const result = await submitSmartForm(submitInput);

            if (result.success) {
                hasil.push({
                    row: excelRow,
                    itemCode,
                    status: "SUKSES",
                    mode: result.data.mode,
                });
            } else {
                hasil.push({
                    row: excelRow,
                    itemCode,
                    status: "GAGAL",
                    pesan: result.message,
                });
            }
        } catch (error) {
            // Jaga-jaga: error tak terduga di satu baris TIDAK boleh
            // menghentikan baris lain — dicatat sebagai gagal untuk baris
            // ini saja, loop lanjut seperti biasa.
            console.error(
                `[importSparepartExcel] baris ${excelRow} error tak terduga:`,
                error
            );
            hasil.push({
                row: excelRow,
                itemCode,
                status: "GAGAL",
                pesan: "Terjadi kesalahan tak terduga saat memproses baris ini",
            });
        }
    }

    const totalSukses = hasil.filter((h) => h.status === "SUKSES").length;
    const totalGagal = hasil.filter((h) => h.status === "GAGAL").length;

    return {
        success: true,
        data: { hasil, totalSukses, totalGagal },
    };
}

// ==========================================================
// UPDATE SINGLE FIELD (dipakai inline edit di grid)
//
// Update HANYA 1 field master (namaPart, spesifikasi, atau keterangan)
// lewat prisma.sparepart.update. Field lain (itemCode, kategoriId,
// satuanId, lokasiRakId, dst) sengaja TIDAK ikut disentuh sama sekali —
// makanya `data` dibangun manual per-field, bukan spread dari input bebas.
// ==========================================================

export type UpdateSparepartFieldName = "namaPart" | "spesifikasi" | "keterangan";

export async function updateSparepartField(
    sparepartId: string,
    field: UpdateSparepartFieldName,
    value: string
): Promise<ActionResult<SparepartWithRelations>> {
    let data: Prisma.SparepartUpdateInput;

    if (field === "namaPart") {
        const namaPart = normalizeText(value);
        if (!namaPart) {
            return { success: false, message: "Nama part tidak boleh kosong" };
        }
        data = { namaPart };
    } else if (field === "spesifikasi") {
        // spesifikasi & keterangan nullable di schema — string kosong/hanya
        // spasi disimpan sebagai null, bukan string kosong.
        data = { spesifikasi: value.trim() || null };
    } else {
        data = { keterangan: value.trim() || null };
    }

    try {
        const updated = await prisma.sparepart.update({
            where: { id: sparepartId },
            data,
            include: sparepartInclude,
        });
        return { success: true, data: updated };
    } catch (error) {
        return toFriendlyError(error, "Gagal memperbarui data sparepart");
    }
}

// ==========================================================
// UPDATE RELASI (kategoriId / satuanId / lokasiRakId)
//
// Dipakai inline-edit sel Kategori, Satuan, Lokasi Rak. Hanya menerima
// field yang benar-benar berupa foreign key di tabel Sparepart —
// field teks bebas (namaPart, dst) ditangani updateSparepartField.
// lokasiRakId boleh null karena field ini opsional; kategoriId dan
// satuanId wajib diisi (ditolak di sini kalau null).
// ==========================================================

export type UpdateSparepartRelationField = "kategoriId" | "satuanId" | "lokasiRakId";

export async function updateSparepartRelation(
    sparepartId: string,
    field: UpdateSparepartRelationField,
    value: string | null
): Promise<ActionResult<SparepartWithRelations>> {
    if ((field === "kategoriId" || field === "satuanId") && !value) {
        return { success: false, message: "Field ini tidak boleh kosong" };
    }

    let data: Prisma.SparepartUpdateInput;
    if (field === "kategoriId") {
        data = { kategori: { connect: { id: value! } } };
    } else if (field === "satuanId") {
        data = { satuan: { connect: { id: value! } } };
    } else {
        // lokasiRakId — null = hapus relasi (disconnect)
        data = value
            ? { lokasiRak: { connect: { id: value } } }
            : { lokasiRak: { disconnect: true } };
    }

    try {
        const updated = await prisma.sparepart.update({
            where: { id: sparepartId },
            data,
            include: sparepartInclude,
        });
        return { success: true, data: updated };
    } catch (error) {
        return toFriendlyError(error, "Gagal memperbarui data sparepart");
    }
}

// ==========================================================
// DELETE (bulk, dipakai checkbox select + tombol Hapus di grid)
//
// Untuk SETIAP id: hapus dulu baris anak yang mereferensikan
// sparepartId ini (StockMovement, SparepartLineStock), baru hapus
// baris Sparepart-nya sendiri — urutan ini WAJIB karena foreign key
// constraint, sama seperti pola yang dipakai di
// src/scripts/cleanup-test-data.ts. Seluruh proses (semua id)
// dibungkus dalam SATU transaction supaya atomic: kalau salah satu id
// gagal dihapus (mis. sudah tidak ada / constraint lain), semua
// perubahan di-rollback dan tidak ada part yang setengah terhapus.
// ==========================================================

export async function deleteSpareparts(
    ids: string[]
): Promise<ActionResult<{ deletedCount: number }>> {
    if (ids.length === 0) {
        return { success: false, message: "Tidak ada part yang dipilih" };
    }

    try {
        const deletedCount = await prisma.$transaction(async (tx) => {
            let count = 0;
            for (const id of ids) {
                await tx.stockMovement.deleteMany({ where: { sparepartId: id } });
                await tx.sparepartLineStock.deleteMany({ where: { sparepartId: id } });
                await tx.sparepart.delete({ where: { id } });
                count += 1;
            }
            return count;
        });

        return { success: true, data: { deletedCount } };
    } catch (error) {
        return toFriendlyError(error, "Gagal menghapus sparepart yang dipilih");
    }
}