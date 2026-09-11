"use server";

import { prisma } from "@/lib/prisma";
import type { Kategori, LokasiRak, Satuan } from "@/generated/prisma/client";
import { toFriendlyError, normalizeText as normalizeNama } from "./_shared";
import type { ActionResult } from "./_shared";

// Pesan unique constraint untuk entitas master data (Kategori, LokasiRak,
// Satuan) — semuanya punya field `nama` yang unik. Nilai ini sama persis
// dengan pesan hardcoded sebelum refactor, cuma sekarang di-pass ke
// toFriendlyError() dari _shared.ts.
const NAMA_SUDAH_TERDAFTAR = "Nama sudah terdaftar";

// ==========================================================
// KATEGORI
// ==========================================================

export async function getKategoriList(): Promise<ActionResult<Kategori[]>> {
    try {
        const data = await prisma.kategori.findMany({
            orderBy: { nama: "asc" },
        });
        return { success: true, data };
    } catch (error) {
        return toFriendlyError(
            error,
            "Gagal mengambil daftar kategori",
            NAMA_SUDAH_TERDAFTAR
        );
    }
}

export async function addKategori(
    nama: string
): Promise<ActionResult<Kategori>> {
    const namaValid = normalizeNama(nama);
    if (!namaValid) {
        return { success: false, message: "Nama tidak boleh kosong" };
    }

    try {
        const data = await prisma.kategori.create({
            data: { nama: namaValid },
        });
        return { success: true, data };
    } catch (error) {
        return toFriendlyError(
            error,
            "Gagal menambahkan kategori",
            NAMA_SUDAH_TERDAFTAR
        );
    }
}

export async function updateKategori(
    id: string,
    namaBaru: string
): Promise<ActionResult<Kategori>> {
    const namaValid = normalizeNama(namaBaru);
    if (!namaValid) {
        return { success: false, message: "Nama tidak boleh kosong" };
    }

    try {
        const data = await prisma.kategori.update({
            where: { id },
            data: { nama: namaValid },
        });
        return { success: true, data };
    } catch (error) {
        return toFriendlyError(
            error,
            "Gagal memperbarui kategori",
            NAMA_SUDAH_TERDAFTAR
        );
    }
}

export async function deleteKategori(
    id: string
): Promise<ActionResult<{ deletedId: string }>> {
    try {
        // Cek dulu apakah kategori ini masih dipakai Sparepart lain
        // sebelum dihapus — pola sama seperti cleanupIfUnused() di
        // cleanup-test-data.ts.
        const usageCount = await prisma.sparepart.count({
            where: { kategoriId: id },
        });

        if (usageCount > 0) {
            return {
                success: false,
                message: `Masih dipakai oleh ${usageCount} part, tidak bisa dihapus`,
            };
        }

        await prisma.kategori.delete({ where: { id } });
        return { success: true, data: { deletedId: id } };
    } catch (error) {
        return toFriendlyError(error, "Gagal menghapus kategori");
    }
}

// ==========================================================
// LOKASI RAK
// ==========================================================

export async function getLokasiRakList(): Promise<ActionResult<LokasiRak[]>> {
    try {
        const data = await prisma.lokasiRak.findMany({
            orderBy: { nama: "asc" },
        });
        return { success: true, data };
    } catch (error) {
        return toFriendlyError(
            error,
            "Gagal mengambil daftar lokasi rak",
            NAMA_SUDAH_TERDAFTAR
        );
    }
}

export async function addLokasiRak(
    nama: string
): Promise<ActionResult<LokasiRak>> {
    const namaValid = normalizeNama(nama);
    if (!namaValid) {
        return { success: false, message: "Nama tidak boleh kosong" };
    }

    try {
        const data = await prisma.lokasiRak.create({
            data: { nama: namaValid },
        });
        return { success: true, data };
    } catch (error) {
        return toFriendlyError(
            error,
            "Gagal menambahkan lokasi rak",
            NAMA_SUDAH_TERDAFTAR
        );
    }
}

export async function updateLokasiRak(
    id: string,
    namaBaru: string
): Promise<ActionResult<LokasiRak>> {
    const namaValid = normalizeNama(namaBaru);
    if (!namaValid) {
        return { success: false, message: "Nama tidak boleh kosong" };
    }

    try {
        const data = await prisma.lokasiRak.update({
            where: { id },
            data: { nama: namaValid },
        });
        return { success: true, data };
    } catch (error) {
        return toFriendlyError(
            error,
            "Gagal memperbarui lokasi rak",
            NAMA_SUDAH_TERDAFTAR
        );
    }
}

export async function deleteLokasiRak(
    id: string
): Promise<ActionResult<{ deletedId: string }>> {
    try {
        // lokasiRakId opsional di Sparepart, tapi pengecekan usage-nya
        // tetap sama: hitung Sparepart yang field ini-nya = id target.
        const usageCount = await prisma.sparepart.count({
            where: { lokasiRakId: id },
        });

        if (usageCount > 0) {
            return {
                success: false,
                message: `Masih dipakai oleh ${usageCount} part, tidak bisa dihapus`,
            };
        }

        await prisma.lokasiRak.delete({ where: { id } });
        return { success: true, data: { deletedId: id } };
    } catch (error) {
        return toFriendlyError(error, "Gagal menghapus lokasi rak");
    }
}

// ==========================================================
// SATUAN
// ==========================================================

export async function getSatuanList(): Promise<ActionResult<Satuan[]>> {
    try {
        const data = await prisma.satuan.findMany({
            orderBy: { nama: "asc" },
        });
        return { success: true, data };
    } catch (error) {
        return toFriendlyError(
            error,
            "Gagal mengambil daftar satuan",
            NAMA_SUDAH_TERDAFTAR
        );
    }
}

export async function addSatuan(
    nama: string
): Promise<ActionResult<Satuan>> {
    const namaValid = normalizeNama(nama);
    if (!namaValid) {
        return { success: false, message: "Nama tidak boleh kosong" };
    }

    try {
        const data = await prisma.satuan.create({
            data: { nama: namaValid },
        });
        return { success: true, data };
    } catch (error) {
        return toFriendlyError(
            error,
            "Gagal menambahkan satuan",
            NAMA_SUDAH_TERDAFTAR
        );
    }
}

export async function updateSatuan(
    id: string,
    namaBaru: string
): Promise<ActionResult<Satuan>> {
    const namaValid = normalizeNama(namaBaru);
    if (!namaValid) {
        return { success: false, message: "Nama tidak boleh kosong" };
    }

    try {
        const data = await prisma.satuan.update({
            where: { id },
            data: { nama: namaValid },
        });
        return { success: true, data };
    } catch (error) {
        return toFriendlyError(
            error,
            "Gagal memperbarui satuan",
            NAMA_SUDAH_TERDAFTAR
        );
    }
}

export async function deleteSatuan(
    id: string
): Promise<ActionResult<{ deletedId: string }>> {
    try {
        const usageCount = await prisma.sparepart.count({
            where: { satuanId: id },
        });

        if (usageCount > 0) {
            return {
                success: false,
                message: `Masih dipakai oleh ${usageCount} part, tidak bisa dihapus`,
            };
        }

        await prisma.satuan.delete({ where: { id } });
        return { success: true, data: { deletedId: id } };
    } catch (error) {
        return toFriendlyError(error, "Gagal menghapus satuan");
    }
}