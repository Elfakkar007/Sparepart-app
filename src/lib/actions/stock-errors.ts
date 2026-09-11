// ==========================================================
// Sentinel error classes untuk alur stock movement.
//
// SENGAJA dipisah dari stock-movement.ts (yang berstatus "use server")
// karena Next.js melarang file "use server" meng-export apa pun selain
// async function — class (atau value lain) yang di-export langsung dari
// file itu bikin build error: "Only async functions are allowed to be
// exported in a 'use server' file."
//
// File ini murni definisi class biasa, TIDAK ada "use server" di atasnya,
// jadi aman di-import & di-export dari mana saja (server actions,
// core function lain, maupun client component yang cuma butuh
// `instanceof` check).
// ==========================================================

/**
 * Dilempar DI DALAM prisma.$transaction ketika suatu pergerakan stok
 * akan membuat jumlah pada satu line jadi minus — memicu rollback
 * transaction tersebut. Ditangkap lagi di catch luar (recordStockMovement,
 * submitSmartForm) untuk dikonversi jadi ActionResult yang ramah.
 */
export class InsufficientStockError extends Error {
    constructor() {
        super("Stok tidak boleh minus");
        this.name = "InsufficientStockError";
    }
}

/**
 * Sentinel error khusus untuk race condition pada baris
 * SparepartLineStock: dua request nyaris bersamaan sama-sama tidak
 * menemukan baris (sparepartId, line) lalu sama-sama coba membuatnya —
 * salah satu kena unique constraint @@unique([sparepartId, line]).
 *
 * Dipisah dari unique-constraint check generik (bukan cuma
 * isUniqueConstraintError() di catch luar) supaya pemanggil yang
 * menggabungkan operasi ini dengan operasi LAIN dalam satu transaction
 * (mis. submitSmartForm di sparepart.ts, yang juga bisa kena unique
 * constraint itemCode Sparepart) tetap bisa membedakan kedua kasus itu
 * dan mengembalikan pesan yang tepat untuk masing-masing.
 */
export class LineStockRaceError extends Error {
    constructor() {
        super(
            "Data stok line ini sedang diproses permintaan lain, silakan coba lagi"
        );
        this.name = "LineStockRaceError";
    }
}