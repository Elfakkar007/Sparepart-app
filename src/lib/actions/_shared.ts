import { Prisma } from "@/generated/prisma/client";

// ==========================================================
// Tipe hasil generik dipakai semua Server Action (master-data.ts,
// sparepart.ts, dst). Kalau gagal, `data` tidak ada — cukup pesan
// yang ramah untuk UI.
// ==========================================================
export type ActionResult<T> =
    | { success: true; data: T }
    | { success: false; message: string };

// Kode error Prisma untuk pelanggaran unique constraint
const PRISMA_UNIQUE_CONSTRAINT_CODE = "P2002";

/**
 * Cek apakah error yang dilempar Prisma adalah pelanggaran
 * unique constraint (P2002), mis. nama/itemCode yang sudah ada.
 */
export function isUniqueConstraintError(error: unknown): boolean {
    return (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PRISMA_UNIQUE_CONSTRAINT_CODE
    );
}

/**
 * Bungkus error tak terduga jadi pesan aman untuk ditampilkan ke user,
 * tanpa membocorkan detail error internal (stack trace, dll).
 *
 * `uniqueMessage` opsional:
 * - Diisi (dipakai master-data.ts) → kalau error-nya ternyata pelanggaran
 *   unique constraint, pesan inilah yang dikembalikan.
 * - Tidak diisi (dipakai sparepart.ts) → unique constraint tidak dibedakan
 *   di sini; langsung log + pakai fallbackMessage. Ini karena sparepart.ts
 *   menangani kasus unique constraint secara manual di pemanggilnya sendiri
 *   (butuh pesan yang beda: "Item Code sudah terdaftar").
 */
export function toFriendlyError(
    error: unknown,
    fallbackMessage: string,
    uniqueMessage?: string
): ActionResult<never> {
    if (uniqueMessage && isUniqueConstraintError(error)) {
        return { success: false, message: uniqueMessage };
    }
    console.error(error); // log detail asli di server untuk debugging
    return { success: false, message: fallbackMessage };
}

/**
 * Validasi sederhana: teks tidak boleh kosong / hanya spasi.
 * Mengembalikan teks yang sudah di-trim, atau null kalau tidak valid.
 */
export function normalizeText(value: string): string | null {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

// ==========================================================
// Dukungan untuk operasi lintas-file dalam SATU prisma.$transaction
// (dipakai submitSmartForm di sparepart.ts, yang menggabungkan
// pembuatan Sparepart dengan pencatatan stock movement yang logic-nya
// tinggal di stock-movement.ts).
// ==========================================================

/**
 * Tipe client Prisma di dalam callback `prisma.$transaction(async (tx) =>
 * ...)`. Fungsi "Core" (createSparepartCore, recordStockMovementCore,
 * updateLineMinStokCore) menerima `tx` ini sebagai parameter alih-alih
 * memakai `prisma` global, supaya bisa dipanggil berkali-kali dalam SATU
 * transaction yang sama dari fungsi lain — atomic, bisa di-rollback
 * bersama. Fungsi publik yang cuma butuh 1 operasi tunggal (createSparepart,
 * updateLineMinStok) tetap boleh memanggil Core-nya dengan `prisma` biasa —
 * PrismaClient valid dipakai di mana pun TxClient diharapkan.
 */
export type TxClient = Prisma.TransactionClient;

/**
 * Error validasi yang dilempar DI DALAM sebuah prisma.$transaction
 * (bukan di-return sebagai ActionResult langsung), supaya transaction
 * ikut ter-rollback kalau validasi gagal di tengah proses multi-langkah.
 * Ditangkap lagi oleh pemanggil paling luar dan dikonversi jadi
 * ActionResult lewat `error.message`. Untuk validasi biasa yang TIDAK
 * butuh DB dan terjadi SEBELUM transaction dibuka, tetap pakai pola lama:
 * return ActionResult langsung.
 */
export class ActionValidationError extends Error { }