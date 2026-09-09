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