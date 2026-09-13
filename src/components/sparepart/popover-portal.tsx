"use client";

import { useEffect, useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

type AnchorRect = { top: number; right: number };

/**
 * Hitung posisi viewport (top & right, dalam px) dari elemen anchor
 * (tombol pemicu popup), untuk dipakai bareng <PopoverPortal> dengan
 * `position: fixed`.
 *
 * KENAPA INI PERLU (bukan cuma `absolute` di wrapper `relative` biasa):
 * toolbar SparepartGrid punya `overflow-x-auto` + tinggi tetap
 * (h-[62px]). Sesuai CSS Overflow Level 3 spec, begitu satu axis
 * overflow diset selain `visible`, axis satunya (overflow-y, default
 * `visible`) otomatis DIPAKSA jadi `auto` juga — TIDAK BISA dibatalkan
 * walau ditulis eksplisit `overflow-y-visible` (lihat catatan yang
 * sama persis di sparepart-grid.tsx soal sticky thead). Akibatnya
 * toolbar itu diam-diam jadi scroll container vertikal terkunci 62px,
 * dan popup yang `position:absolute` di dalamnya bakal KEPOTONG +
 * muncul scrollbar aneh begitu tingginya lewat 62px.
 *
 * Solusinya bukan main-main overflow lagi (nggak akan pernah nembus),
 * tapi keluarkan popup dari DOM tree toolbar sama sekali lewat Portal,
 * lalu posisikan manual pakai rect tombolnya.
 */
export function useAnchorRect(
    anchorRef: RefObject<HTMLElement | null>,
    isOpen: boolean,
    gap = 8
): AnchorRect | null {
    const [rect, setRect] = useState<AnchorRect | null>(null);

    useLayoutEffect(() => {
        if (!isOpen) {
            setRect(null);
            return;
        }

        function update() {
            const el = anchorRef.current;
            if (!el) return;
            const box = el.getBoundingClientRect();
            // right dihitung dari tepi kanan viewport supaya popup tetap
            // rata-kanan ke tombolnya, sama seperti perilaku `right-0`
            // yang lama — tanpa perlu tahu lebar popup di muka.
            setRect({ top: box.bottom + gap, right: window.innerWidth - box.right });
        }

        update();
        // capture: true supaya ikut ke-trigger oleh scroll di container
        // manapun (bukan cuma window), termasuk toolbar itu sendiri
        // selagi masih dalam mode overflow-x-auto.
        window.addEventListener("scroll", update, true);
        window.addEventListener("resize", update);
        return () => {
            window.removeEventListener("scroll", update, true);
            window.removeEventListener("resize", update);
        };
    }, [anchorRef, isOpen, gap]);

    return rect;
}

/**
 * Render children ke document.body. Popup yang lewat sini bukan lagi
 * descendant toolbar (atau container manapun di halaman), jadi tidak
 * mungkin kepotong overflow ancestor apa pun, dan z-index-nya juga
 * lepas dari stacking context ancestor (mis. `sticky` di toolbar).
 */
export function PopoverPortal({ children }: { children: ReactNode }) {
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    if (!mounted) return null;
    return createPortal(children, document.body);
}