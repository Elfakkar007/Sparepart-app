/**
 * Script sekali pakai untuk membersihkan data yang dibuat oleh
 * src/scripts/test-modul1.ts.
 *
 * INI BUKAN Server Action — dijalankan langsung dari terminal lewat
 * Node/tsx, BUKAN dipanggil dari browser/request Next.js.
 *
 * Yang dibersihkan (kalau ada):
 *   1. Sparepart itemCode "TEST-001", beserta StockMovement &
 *      SparepartLineStock yang terkait — dihapus dulu sebelum
 *      Sparepart-nya sendiri, karena foreign key.
 *   2. Kategori "Bearing Test", Satuan "pcs", LokasiRak "Rak A1" — TAPI
 *      masing-masing HANYA dihapus kalau sudah tidak dipakai Sparepart
 *      lain, supaya tidak ikut menghapus master data yang masih dipakai
 *      part lain di luar data tes.
 */

import { prisma } from "@/lib/prisma";

type SummaryItem = {
    label: string;
    status: "DIHAPUS" | "DILEWATI";
    alasan?: string;
};

// Bentuk minimum yang dibutuhkan dari Kategori/Satuan/LokasiRak untuk
// helper cleanupIfUnused di bawah — tidak peduli field lain di modelnya.
type CleanupTarget = {
    id: string;
    nama: string;
};

/**
 * Helper generik: cari 1 master-data by nama, cek dulu apakah masih
 * dipakai Sparepart lain (lewat countUsage), baru hapus kalau aman.
 * Semua hasil (dihapus/dilewati + alasan) didorong ke `summary`.
 */
async function cleanupIfUnused(params: {
    label: string;
    find: () => Promise<CleanupTarget | null>;
    countUsage: (id: string) => Promise<number>;
    remove: (id: string) => Promise<unknown>;
    summary: SummaryItem[];
}) {
    const { label, find, countUsage, remove, summary } = params;

    const target = await find();
    if (!target) {
        console.log(`${label} tidak ditemukan, lewati`);
        summary.push({ label, status: "DILEWATI", alasan: "tidak ditemukan" });
        return;
    }

    const usageCount = await countUsage(target.id);
    if (usageCount > 0) {
        console.log(`${label} masih dipakai ${usageCount} sparepart lain, dilewati`);
        summary.push({
            label,
            status: "DILEWATI",
            alasan: `masih dipakai ${usageCount} sparepart lain`,
        });
        return;
    }

    await remove(target.id);
    console.log(`${label} (id: ${target.id}) dihapus`);
    summary.push({ label, status: "DIHAPUS" });
}

async function main() {
    console.log("=== MULAI CLEANUP DATA TES ===\n");

    const summary: SummaryItem[] = [];

    // ------------------------------------------------------------------
    // 1. Sparepart TEST-001 + StockMovement & SparepartLineStock terkait
    // ------------------------------------------------------------------
    const sparepart = await prisma.sparepart.findUnique({
        where: { itemCode: "TEST-001" },
    });

    if (!sparepart) {
        console.log("Sparepart TEST-001 tidak ditemukan, lewati\n");
        summary.push({
            label: "Sparepart TEST-001",
            status: "DILEWATI",
            alasan: "tidak ditemukan",
        });
    } else {
        // Hapus dalam SATU transaction. Urutan penting karena foreign key:
        // StockMovement & SparepartLineStock (child) harus hilang duluan
        // sebelum Sparepart (parent) boleh dihapus.
        const { movementCount, lineStockCount } = await prisma.$transaction(async (tx) => {
            const deletedMovements = await tx.stockMovement.deleteMany({
                where: { sparepartId: sparepart.id },
            });
            const deletedLineStocks = await tx.sparepartLineStock.deleteMany({
                where: { sparepartId: sparepart.id },
            });
            await tx.sparepart.delete({ where: { id: sparepart.id } });

            return {
                movementCount: deletedMovements.count,
                lineStockCount: deletedLineStocks.count,
            };
        });

        console.log(`[STEP 1] StockMovement dihapus: ${movementCount} baris`);
        console.log(`[STEP 1] SparepartLineStock dihapus: ${lineStockCount} baris`);
        console.log(`[STEP 1] Sparepart TEST-001 (id: ${sparepart.id}) dihapus\n`);

        summary.push({
            label: `StockMovement milik TEST-001 (${movementCount} baris)`,
            status: "DIHAPUS",
        });
        summary.push({
            label: `SparepartLineStock milik TEST-001 (${lineStockCount} baris)`,
            status: "DIHAPUS",
        });
        summary.push({ label: "Sparepart TEST-001", status: "DIHAPUS" });
    }

    // ------------------------------------------------------------------
    // 2. Kategori "Bearing Test", Satuan "pcs", LokasiRak "Rak A1" —
    //    hanya dihapus kalau sudah tidak dipakai Sparepart lain. Karena
    //    Sparepart TEST-001 sudah dihapus di STEP 1 (kalau ada), hitungan
    //    usageCount di sini otomatis TIDAK menghitung TEST-001 lagi.
    // ------------------------------------------------------------------
    await cleanupIfUnused({
        label: 'Kategori "Bearing Test"',
        find: () => prisma.kategori.findUnique({ where: { nama: "Bearing Test" } }),
        countUsage: (id) => prisma.sparepart.count({ where: { kategoriId: id } }),
        remove: (id) => prisma.kategori.delete({ where: { id } }),
        summary,
    });

    await cleanupIfUnused({
        label: 'Satuan "pcs"',
        find: () => prisma.satuan.findUnique({ where: { nama: "pcs" } }),
        countUsage: (id) => prisma.sparepart.count({ where: { satuanId: id } }),
        remove: (id) => prisma.satuan.delete({ where: { id } }),
        summary,
    });

    await cleanupIfUnused({
        label: 'LokasiRak "Rak A1"',
        find: () => prisma.lokasiRak.findUnique({ where: { nama: "Rak A1" } }),
        countUsage: (id) => prisma.sparepart.count({ where: { lokasiRakId: id } }),
        remove: (id) => prisma.lokasiRak.delete({ where: { id } }),
        summary,
    });

    // ------------------------------------------------------------------
    // 3. Ringkasan akhir
    // ------------------------------------------------------------------
    console.log("\n=== RINGKASAN CLEANUP ===");
    for (const item of summary) {
        const alasan = item.alasan ? ` (${item.alasan})` : "";
        console.log(`- [${item.status}] ${item.label}${alasan}`);
    }
}

main()
    .catch((error) => {
        console.error("\n[SCRIPT ERROR]", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });