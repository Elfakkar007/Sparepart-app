"use server";

import { prisma } from "@/lib/prisma";
import type { Prisma, Sparepart } from "@/generated/prisma/client";
import { isUniqueConstraintError, toFriendlyError, normalizeText } from "./_shared";
import type { ActionResult } from "./_shared";

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
// ==========================================================

export async function getSparepartList(): Promise<
    ActionResult<SparepartWithRelations[]>
> {
    try {
        const data = await prisma.sparepart.findMany({
            include: sparepartInclude,
            orderBy: { namaPart: "asc" },
        });
        return { success: true, data };
    } catch(error) {
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

export async function createSparepart(
    input: CreateSparepartInput
): Promise<ActionResult<Sparepart>> {
    const itemCode = normalizeText(input.itemCode);
    if (!itemCode) {
        return { success: false, message: "Item Code tidak boleh kosong" };
    }

    const namaPart = normalizeText(input.namaPart);
    if (!namaPart) {
        return { success: false, message: "Nama Part tidak boleh kosong" };
    }

    try {
        const data = await prisma.sparepart.create({
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
                // baris stok per line baru dibuat lewat alur stock-in/opname terpisah.
            },
        });
        return { success: true, data };
    } catch (error) {
        if (isUniqueConstraintError(error)) {
            return { success: false, message: "Item Code sudah terdaftar" };
        }
        return toFriendlyError(error, "Gagal menambahkan sparepart");
    }
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