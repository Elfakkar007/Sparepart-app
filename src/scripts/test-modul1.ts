/**
 * Script tes manual untuk Modul 1: master data (Kategori/Satuan/LokasiRak),
 * Sparepart, Stock Movement, dan status helper.
 *
 * INI BUKAN Server Action — dijalankan langsung dari terminal lewat
 * Node/tsx, BUKAN dipanggil dari browser/request Next.js.
 *
 * PENTING — script ini mengasumsikan database development/testing yang
 * BERSIH dari data berikut. Kalau sudah pernah dijalankan sebelumnya dan
 * mau dijalankan ulang, hapus dulu manual (lewat Prisma Studio / SQL):
 *   - Kategori "Bearing Test"
 *   - Satuan "pcs"
 *   - LokasiRak "Rak A1"
 *   - Sparepart dengan itemCode "TEST-001"
 * Kalau tidak dihapus, TES 1 & TES 2 akan gagal karena unique constraint
 * (nama/itemCode sudah terdaftar), dan tes-tes berikutnya yang butuh id
 * dari situ akan ikut gagal berantai.
 *
 * Script ini juga butuh minimal 1 baris di tabel User (dipakai sebagai
 * `userId` pengirim StockMovement) — diambil otomatis lewat
 * prisma.user.findFirst(), TIDAK membuat user baru.
 */

import { prisma } from "@/lib/prisma";
import { addKategori, addSatuan, addLokasiRak } from "@/lib/actions/master-data";
import { createSparepart, getSparepartByItemCode } from "@/lib/actions/sparepart";
import { recordStockMovement, updateLineMinStok } from "@/lib/actions/stock-movement";
import { computeSparepartStatus } from "@/lib/status-helper";

async function main() {
    console.log("=== MULAI TES MODUL 1 ===\n");

    const testUser = await prisma.user.findFirst();
    if (!testUser) {
        throw new Error(
            "Tidak ada baris di tabel User. Buat minimal 1 user dulu (lewat seed/register) sebelum menjalankan script ini."
        );
    }
    console.log(`(pakai userId: ${testUser.id})\n`);

    // ------------------------------------------------------------------
    // TES 1: Buat Kategori, Satuan, LokasiRak baru
    // ------------------------------------------------------------------
    const kategoriResult = await addKategori("Bearing Test");
    console.log("[TES 1] addKategori:", kategoriResult);

    const satuanResult = await addSatuan("pcs");
    console.log("[TES 1] addSatuan:", satuanResult);

    const lokasiRakResult = await addLokasiRak("Rak A1");
    console.log("[TES 1] addLokasiRak:", lokasiRakResult);

    if (!kategoriResult.success || !satuanResult.success || !lokasiRakResult.success) {
        throw new Error("TES 1 gagal — hentikan script, TES berikutnya butuh id dari sini.");
    }
    console.log();

    // ------------------------------------------------------------------
    // TES 2: Buat Sparepart baru pakai ketiga id dari TES 1
    // ------------------------------------------------------------------
    const sparepartResult = await createSparepart({
        itemCode: "TEST-001",
        namaPart: "Bearing Test 6205",
        kategoriId: kategoriResult.data.id,
        satuanId: satuanResult.data.id,
        lokasiRakId: lokasiRakResult.data.id,
    });
    console.log("[TES 2] createSparepart:", sparepartResult);

    if (!sparepartResult.success) {
        throw new Error("TES 2 gagal — hentikan script, TES berikutnya butuh sparepartId dari sini.");
    }
    console.log(`[TES 2] stok awal: ${sparepartResult.data.stok} (harus 0)\n`);

    const sparepartId = sparepartResult.data.id;

    // ------------------------------------------------------------------
    // TES 3: Buat Sparepart lagi dengan itemCode yang SAMA → harus gagal
    // ------------------------------------------------------------------
    const duplikatResult = await createSparepart({
        itemCode: "TEST-001",
        namaPart: "Bearing Test 6205 (duplikat)",
        kategoriId: kategoriResult.data.id,
        satuanId: satuanResult.data.id,
        lokasiRakId: lokasiRakResult.data.id,
    });
    console.log("[TES 3] createSparepart (duplikat itemCode):", duplikatResult);
    console.log(
        `[TES 3] sesuai harapan? ${!duplikatResult.success && duplikatResult.message === "Item Code sudah terdaftar"
        }\n`
    );

    // ------------------------------------------------------------------
    // TES 4: Restock LINE_1 sejumlah 10 (MASUK)
    // ------------------------------------------------------------------
    const restock1 = await recordStockMovement({
        sparepartId,
        line: "LINE_1",
        tipe: "MASUK",
        jumlah: 10,
        userId: testUser.id,
    });
    console.log("[TES 4] recordStockMovement MASUK LINE_1 +10:", restock1);
    if (restock1.success) {
        console.log(
            `[TES 4] newJumlahLine: ${restock1.data.newJumlahLine} (harus 10), newTotalStok: ${restock1.data.newTotalStok} (harus 10)\n`
        );
    }

    // ------------------------------------------------------------------
    // TES 5: Restock LINE_2 sejumlah 5 (MASUK)
    // ------------------------------------------------------------------
    const restock2 = await recordStockMovement({
        sparepartId,
        line: "LINE_2",
        tipe: "MASUK",
        jumlah: 5,
        userId: testUser.id,
    });
    console.log("[TES 5] recordStockMovement MASUK LINE_2 +5:", restock2);
    if (restock2.success) {
        console.log(
            `[TES 5] newJumlahLine: ${restock2.data.newJumlahLine} (harus 5), newTotalStok: ${restock2.data.newTotalStok} (harus 15)\n`
        );
    }

    // ------------------------------------------------------------------
    // TES 6: Set minStok LINE_1 = 20, lalu cek computeSparepartStatus
    // ------------------------------------------------------------------
    const minStokResult = await updateLineMinStok(sparepartId, "LINE_1", 20);
    console.log("[TES 6] updateLineMinStok LINE_1 = 20:", minStokResult);

    const sparepartUlang = await getSparepartByItemCode("TEST-001");
    console.log("[TES 6] getSparepartByItemCode TEST-001:", sparepartUlang);

    if (sparepartUlang.success && sparepartUlang.data) {
        const status = computeSparepartStatus(sparepartUlang.data.lineStocks);
        console.log(`[TES 6] status: "${status}" (harus "Restock L1")\n`);
    }

    // ------------------------------------------------------------------
    // TES 7: recordStockMovement KOREKSI tanpa keterangan → harus gagal
    // ------------------------------------------------------------------
    const koreksiTanpaKeterangan = await recordStockMovement({
        sparepartId,
        line: "LINE_1",
        tipe: "KOREKSI",
        jumlah: -3,
        userId: testUser.id,
        // keterangan sengaja tidak diisi
    });
    console.log("[TES 7] recordStockMovement KOREKSI tanpa keterangan:", koreksiTanpaKeterangan);
    console.log(
        `[TES 7] sesuai harapan? ${!koreksiTanpaKeterangan.success &&
        koreksiTanpaKeterangan.message === "Keterangan wajib diisi untuk koreksi stok"
        }\n`
    );

    // ------------------------------------------------------------------
    // TES 8: recordStockMovement KOREKSI LINE_1 -3 dengan keterangan diisi
    // ------------------------------------------------------------------
    const koreksi = await recordStockMovement({
        sparepartId,
        line: "LINE_1",
        tipe: "KOREKSI",
        jumlah: -3,
        keterangan: "Stock opname - selisih fisik",
        userId: testUser.id,
    });
    console.log("[TES 8] recordStockMovement KOREKSI LINE_1 -3:", koreksi);
    if (koreksi.success) {
        console.log(`[TES 8] newJumlahLine: ${koreksi.data.newJumlahLine} (harus 7)`);
    }

    const lineStockLine1 = await prisma.sparepartLineStock.findUnique({
        where: { sparepartId_line: { sparepartId, line: "LINE_1" } },
    });
    console.log(
        `[TES 8] lastOpnameDate LINE_1 dari database: ${lineStockLine1?.lastOpnameDate} (harus baru saja / tidak null)\n`
    );

    console.log("SEMUA TES SELESAI DIJALANKAN — cek manual hasil di atas satu-satu");
}

main()
    .catch((error) => {
        console.error("\n[SCRIPT ERROR]", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });