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