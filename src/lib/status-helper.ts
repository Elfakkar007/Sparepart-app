import type { Line } from "@/generated/prisma/client";

// Urutan tampilan/pengurutan line saat status "Restock ..." dirangkai,
// SENGAJA tidak mengandalkan urutan array `lineStocks` dari database.
const LINE_ORDER: Line[] = ["LINE_1", "LINE_2", "LINE_3", "LINE_4", "GENERAL"];

// Label singkat per line untuk pesan "Restock ...".
const LINE_LABEL: Record<Line, string> = {
    LINE_1: "L1",
    LINE_2: "L2",
    LINE_3: "L3",
    LINE_4: "L4",
    GENERAL: "General",
};

/**
 * Hitung status stok sebuah sparepart dari baris stok per line-nya.
 * Fungsi murni: tidak akses database, tidak ada side effect.
 *
 * Contoh:
 *
 *   computeSparepartStatus([])
 *   → "Belum Ada Stok"
 *
 *   computeSparepartStatus([
 *       { line: "LINE_1", jumlah: 10, minStok: 5 },
 *       { line: "LINE_2", jumlah: 8, minStok: 3 },
 *   ])
 *   → "Cukup"
 *
 *   computeSparepartStatus([
 *       { line: "LINE_1", jumlah: 2, minStok: 5 },
 *       { line: "LINE_2", jumlah: 1, minStok: 3 },
 *   ])
 *   → "Restock Total"   (semua baris kurang)
 *
 *   computeSparepartStatus([
 *       { line: "LINE_1", jumlah: 10, minStok: 5 },
 *       { line: "LINE_2", jumlah: 1, minStok: 3 },
 *       { line: "LINE_3", jumlah: 0, minStok: 2 },
 *   ])
 *   → "Restock L2, L3"   (sebagian kurang, urut sesuai LINE_ORDER)
 *
 *   computeSparepartStatus([
 *       { line: "LINE_1", jumlah: 10, minStok: 5 },
 *       { line: "GENERAL", jumlah: 0, minStok: 5 },
 *   ])
 *   → "Restock General"
 */
export function computeSparepartStatus(
    lineStocks: { line: Line; jumlah: number; minStok: number }[]
): string {
    if (lineStocks.length === 0) {
        return "Belum Ada Stok";
    }

    const kurang = lineStocks.filter((ls) => ls.jumlah < ls.minStok);

    if (kurang.length === 0) {
        return "Cukup";
    }

    if (kurang.length === lineStocks.length) {
        return "Restock Total";
    }

    // Sebagian kurang: petakan ke label singkat, urutkan sesuai LINE_ORDER
    // (bukan urutan asal `lineStocks`), lalu gabung dengan koma.
    const kurangLines = new Set(kurang.map((ls) => ls.line));
    const labels = LINE_ORDER.filter((line) => kurangLines.has(line)).map(
        (line) => LINE_LABEL[line]
    );

    return `Restock ${labels.join(", ")}`;
}