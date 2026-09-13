/**
 * Tipe status stok untuk satu line:
 * - "Cukup"   : jika stok di atas atau sama dengan minimum (jumlah >= minStok)
 * - "Restock" : jika stok kurang dari minimum (jumlah < minStok)
 */
export type LineStatus = "Cukup" | "Restock";

/**
 * Hitung status stok per line:
 * jika stok di atas atau sama dengan minimum maka "Cukup", jika kurang maka "Restock".
 */
export function computeLineStatus(
    jumlah: number,
    minStok: number
): LineStatus {
    return jumlah >= minStok ? "Cukup" : "Restock";
}

/**
 * Hitung status agregat stok sparepart (dipakai untuk filter status di grid):
 * - "Belum Ada Stok" : belum ada data line stock
 * - "Restock"        : jika ada minimal 1 line yang stoknya kurang dari minStok
 * - "Cukup"          : jika semua line stoknya mencukupi
 */
export function computeSparepartStatus(
    lineStocks: { jumlah: number; minStok: number }[]
): string {
    if (lineStocks.length === 0) {
        return "Belum Ada Stok";
    }

    const hasKurang = lineStocks.some((ls) => ls.jumlah < ls.minStok);
    return hasKurang ? "Restock" : "Cukup";
}