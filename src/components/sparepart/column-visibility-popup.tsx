"use client";

import { useEffect, type RefObject } from "react";
import { LINES } from "./line-config";
import { PopoverPortal, useAnchorRect } from "./popover-portal";

/**
 * Kolom STATIS (bukan bagian grup Line) yang bisa disembunyikan lewat
 * popup ini — Nomor/Item Code/Item SENGAJA TIDAK masuk daftar ini karena
 * ketiganya kolom sticky-kiri yang jadi identitas baris, tidak masuk akal
 * untuk disembunyikan.
 *
 * Diekspor supaya SparepartGrid bisa memakai `key` yang SAMA PERSIS saat
 * membangun Set "semua kolom" untuk tombol Reset — satu sumber kebenaran,
 * menghindari typo string literal yang tersebar di 2 file.
 */
export const STATIC_COLUMNS = [
    { key: "kategori", label: "Kategori" },
    { key: "satuan", label: "Satuan" },
    { key: "total", label: "Total" },
] as const;

export type StaticColumnKey = (typeof STATIC_COLUMNS)[number]["key"];

export type ColumnVisibilityPopupProps = {
    isOpen: boolean;
    onClose: () => void;
    /** Ref ke tombol mata pemicu popup — dipakai untuk menghitung posisi
     *  (lihat useAnchorRect di popover-portal.tsx), bukan lagi untuk
     *  wrapper `relative` seperti sebelumnya. */
    anchorRef: RefObject<HTMLElement | null>;
    /** Set berisi identifier KOLOM yang sedang disembunyikan — isinya
     *  campuran 2 jenis key: Line key (mis. "LINE_1", dari LINES di
     *  line-config.ts) untuk grup kolom per Line, DAN StaticColumnKey
     *  ("kategori" | "satuan" | "total") untuk kolom statis. Kosong =
     *  semua kolom tampil. */
    hiddenColumns: Set<string>;
    /** Dipanggil saat satu checkbox kolom diklik (Line ATAU statis) —
     *  parent yang mengubah Set-nya. */
    onToggleColumn: (key: string) => void;
    /** Tombol "Pilih Semua" — tampilkan SEMUA kolom (hiddenColumns dikosongkan). */
    onSelectAll: () => void;
    /** Tombol "Reset" — sembunyikan SEMUA kolom yang bisa disembunyikan,
     *  kebalikan dari onSelectAll. Dipisah dari onSelectAll (bukan
     *  "kembalikan ke default semua tampil") supaya dua tombol ini
     *  benar-benar dua aksi berbeda, bukan duplikat — titik awal buat
     *  user yang cuma mau nyalain 1-2 kolom tertentu tanpa uncheck
     *  satu-satu. */
    onReset: () => void;
};

/**
 * Popup KECIL untuk toggle tampil/sembunyi KOLOM di SparepartGrid (dibuka
 * lewat tombol ikon mata di toolbar, sebelah tombol Filter) — TERPISAH
 * TOTAL dari FilterPopup (filter-popup.tsx).
 *
 * GANTI NAMA dari LineVisibilityPopup (line-visibility-popup.tsx):
 * dulu HANYA bisa menyembunyikan grup kolom Line (L1-L4/General).
 * SEKARANG juga bisa menyembunyikan kolom statis: Kategori, Satuan, Total.
 * Nama & state ikut digeneralisasi: `hiddenLines: Set<Line>` menjadi
 * `hiddenColumns: Set<string>`, `onToggleLine` menjadi `onToggleColumn`.
 *
 * BEDA UTAMA dari FilterPopup:
 * - TIDAK ada state "draft" + tombol "Terapkan": checkbox di sini
 *   langsung memanggil onToggleColumn tiap diklik, jadi efeknya ke tabel
 *   REAL-TIME tanpa perlu konfirmasi apa pun. Tombol Pilih
 *   Semua/Reset di bawah juga langsung berefek, tidak ada draft.
 * - HANYA memengaruhi KOLOM mana yang dirender (5 sub-kolom Stok/Min/
 *   Opname/Status/Keterangan per grup Line, atau kolom Kategori/Satuan/
 *   Total) — SAMA SEKALI TIDAK memengaruhi baris/part mana yang
 *   ditampilkan di tabel. Filter "Line" yang MENYARING BARIS ada di
 *   FilterPopup (filter-popup.tsx), state-nya lewat SparepartFilters.line
 *   — TIDAK ADA HUBUNGANNYA dengan hiddenColumns di popup ini.
 * - Semua kolom tercentang (tampil) secara default; uncheck berarti
 *   "sembunyikan kolom ini". State hiddenColumns dipegang di
 *   SparepartGrid, bukan di sini, supaya tetap ada meski popup ditutup.
 *
 * LAYOUT: checkbox Kategori/Satuan/L1-L4/General/Total ditaruh dalam grid
 * flex-wrap (w-64, PINDAH BARIS OTOMATIS jadi beberapa baris — 8 checkbox
 * TIDAK dipaksa muat 1 baris seperti versi lama yang cuma 5 checkbox Line,
 * lihat catatan lebar di className dialog di bawah) — urutannya SENGAJA
 * mengikuti urutan tampil kolom asli di tabel (Kategori, Satuan, lalu
 * tiap grup Line, lalu Total) supaya gampang dipadankan user dengan
 * posisi kolomnya di tabel. Baris tombol Pilih Semua/Reset ditaruh di
 * bawahnya, dipisah garis.
 *
 * POSISI: di-render lewat <PopoverPortal> ke document.body dengan
 * `position: fixed` dari rect tombolnya (lihat popover-portal.tsx) —
 * BUKAN `position: absolute` di dalam wrapper `relative` toolbar lagi.
 * Ini WAJIB karena toolbar SparepartGrid punya `overflow-x-auto` +
 * tinggi tetap (h-[62px]), yang lewat CSS Overflow spec otomatis
 * memaksa overflow-y jadi `auto` juga dan MEMOTONG popup manapun yang
 * lebih tinggi dari 62px kalau dia masih jadi descendant toolbar itu.
 */
export function ColumnVisibilityPopup({
    isOpen,
    onClose,
    anchorRef,
    hiddenColumns,
    onToggleColumn,
    onSelectAll,
    onReset,
}: ColumnVisibilityPopupProps) {
    useEffect(() => {
        if (!isOpen) return;
        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") onClose();
        }
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [isOpen, onClose]);

    const rect = useAnchorRect(anchorRef, isOpen);

    // Nunggu rect ada sebelum render supaya popup tidak sempat "kedip"
    // di posisi (0,0) pada frame pertama sebelum getBoundingClientRect
    // sempat jalan.
    if (!isOpen || !rect) return null;

    return (
        <PopoverPortal>
            {/* Overlay transparan penangkap klik-di-luar, pola & alasan z-40
                PERSIS sama seperti di FilterPopup (lihat komentar di sana) —
                harus di atas thead sticky SparepartGrid supaya klik di area
                header tabel tetap tertangkap sebagai "klik di luar popup".
                Karena sekarang di-portal ke body, z-40 ini otomatis lepas
                dari stacking context toolbar/tabel manapun. */}
            <div className="fixed inset-0 z-40" onClick={onClose} />
            <div
                role="dialog"
                aria-label="Tampilkan atau sembunyikan kolom"
                style={{ top: rect.top, right: rect.right }}
                // fixed (bukan absolute) + top/right dari rect tombol —
                // POLA SAMA seperti FilterPopup: sisi KANAN popup di-anchor
                // ke sisi kanan tombolnya, jadi makin lebar popup-nya, makin
                // jauh sisi KIRI-nya melebar ke kiri.
                //
                // w-64 (BUKAN lagi shrink-to-fit seperti sebelumnya): dulu
                // popup ini cuma berisi 5 checkbox Line (L1-L4/General) jadi
                // dibiarkan shrink-to-fit selalu pas & ringkas. Sekarang ada
                // 8 checkbox (+Kategori/Satuan/Total), kalau tetap
                // shrink-to-fit semuanya numpuk jadi SATU baris sangat
                // panjang — sisi kirinya jadi menjorok sangat jauh dari
                // tombolnya (persis keluhan "kepencet ke kiri"). Lebar tetap
                // w-64 memaksa checkbox flex-wrap ke beberapa baris,
                // sekaligus otomatis membuat popup lebih dekat ke tombol
                // (karena sisi kanan tetap di tempat yang sama, cuma sisi
                // kiri yang berhenti lebih awal).
                className="fixed z-50 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-ink/20 bg-surface p-3 shadow-lg"
                onClick={(event) => event.stopPropagation()}
            >
                <p className="mb-2 font-sans text-xs font-semibold text-subtle">
                    Tampilkan Kolom
                </p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    {/* Kategori & Satuan ditaruh PALING AWAL — urutannya
                        mengikuti posisi kolom aslinya di tabel (sebelum
                        grup Line). */}
                    <label
                        key="kategori"
                        className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap font-sans text-sm text-ink"
                    >
                        <input
                            type="checkbox"
                            checked={!hiddenColumns.has("kategori")}
                            onChange={() => onToggleColumn("kategori")}
                            className="h-4 w-4 rounded border-ink/30 accent-primary"
                        />
                        Kategori
                    </label>
                    <label
                        key="satuan"
                        className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap font-sans text-sm text-ink"
                    >
                        <input
                            type="checkbox"
                            checked={!hiddenColumns.has("satuan")}
                            onChange={() => onToggleColumn("satuan")}
                            className="h-4 w-4 rounded border-ink/30 accent-primary"
                        />
                        Satuan
                    </label>

                    {LINES.map((line) => (
                        <label
                            key={line.key}
                            className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap font-sans text-sm text-ink"
                        >
                            <input
                                type="checkbox"
                                checked={!hiddenColumns.has(line.key)}
                                onChange={() => onToggleColumn(line.key)}
                                className="h-4 w-4 rounded border-ink/30 accent-primary"
                            />
                            {line.label}
                        </label>
                    ))}

                    {/* Total ditaruh PALING AKHIR — kolom paling kanan di tabel. */}
                    <label
                        key="total"
                        className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap font-sans text-sm text-ink"
                    >
                        <input
                            type="checkbox"
                            checked={!hiddenColumns.has("total")}
                            onChange={() => onToggleColumn("total")}
                            className="h-4 w-4 rounded border-ink/30 accent-primary"
                        />
                        Total
                    </label>
                </div>

                {/* Reset kiri, Pilih Semua kanan — pola tombolnya SAMA
                    seperti bar Reset/Terapkan di FilterPopup, supaya dua
                    popup ini terasa konsisten walau perilakunya beda
                    (di sini langsung real-time, tidak ada draft). */}
                <div className="mt-3 flex items-center justify-between gap-2 border-t border-ink/10 pt-3">
                    <button
                        type="button"
                        onClick={onReset}
                        className="rounded-md border border-ink/20 px-3 py-1.5 font-sans text-sm text-ink hover:bg-app-bg"
                    >
                        Reset
                    </button>
                    <button
                        type="button"
                        onClick={onSelectAll}
                        className="rounded-md bg-primary px-3 py-1.5 font-sans text-sm font-medium text-white hover:bg-primary/90"
                    >
                        Pilih Semua
                    </button>
                </div>
            </div>
        </PopoverPortal>
    );
}