"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { Line } from "@/generated/prisma/client";
import { LINES } from "./line-config";

// Nilai filter Status di popup. "Restock" sengaja jadi SATU opsi gabungan
// yang mencakup semua status yang diawali "Restock " dari
// computeSparepartStatus() — baik "Restock Total" maupun kombinasi line
// seperti "Restock L1, L2" — bukan opsi terpisah per kombinasi line.
export type StatusFilterValue = "Cukup" | "Restock" | "Belum Ada Stok";

const STATUS_OPTIONS: StatusFilterValue[] = [
    "Cukup",
    "Restock",
    "Belum Ada Stok",
];

export type SparepartFilters = {
    line: Line[];
    kategori: string[];
    satuan: string[];
    lokasiRak: string[];
    status: StatusFilterValue[];
};

export const EMPTY_FILTERS: SparepartFilters = {
    line: [],
    kategori: [],
    satuan: [],
    lokasiRak: [],
    status: [],
};

/** Total checkbox yang aktif di semua kategori, dipakai untuk badge angka di tombol Filter. */
export function countActiveFilters(filters: SparepartFilters): number {
    return (
        filters.line.length +
        filters.kategori.length +
        filters.satuan.length +
        filters.lokasiRak.length +
        filters.status.length
    );
}

/**
 * Cocokkan hasil computeSparepartStatus() dengan satu opsi filter Status.
 * "Restock" mencocokkan semua status yang diawali "Restock" (Restock Total,
 * Restock L1, Restock L2, L3, dst) — lihat komentar StatusFilterValue di atas.
 */
export function matchesStatusFilter(
    status: string,
    selected: StatusFilterValue
): boolean {
    if (selected === "Restock") return status.startsWith("Restock");
    return status === selected;
}

function toggleValue<T>(list: T[], value: T): T[] {
    return list.includes(value)
        ? list.filter((item) => item !== value)
        : [...list, value];
}

function FilterSection({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div className="border-b border-ink/10 pb-3 last:border-b-0 last:pb-0">
            <p className="mb-2 font-sans text-xs font-semibold text-subtle">{title}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-2">{children}</div>
        </div>
    );
}

function FilterCheckbox({
    label,
    checked,
    onChange,
}: {
    label: string;
    checked: boolean;
    onChange: () => void;
}) {
    return (
        <label className="flex cursor-pointer items-center gap-1.5 font-sans text-sm text-ink">
            <input
                type="checkbox"
                checked={checked}
                onChange={onChange}
                className="h-4 w-4 rounded border-ink/30 accent-primary"
            />
            {label}
        </label>
    );
}

type FilterPopupProps = {
    isOpen: boolean;
    onClose: () => void;
    appliedFilters: SparepartFilters;
    onApply: (filters: SparepartFilters) => void;
    kategoriOptions: string[];
    satuanOptions: string[];
    lokasiRakOptions: string[];
};

/**
 * Popup filter untuk SparepartGrid. Implementasinya dropdown manual
 * (state show/hide + posisi absolute di dalam wrapper `relative` milik
 * pemanggil), bukan <dialog>, supaya tidak perlu urus styling ::backdrop
 * dan showModal()/close() lewat ref — paling sederhana untuk kasus ini.
 *
 * Checkbox yang dicentang di sini disimpan sebagai "draft" dulu, baru
 * benar-benar memengaruhi tabel setelah tombol "Terapkan" ditekan. Supaya
 * draft yang belum diterapkan tidak nyangkut ke sesi buka-popup berikutnya,
 * draft disinkronkan ulang ke filter yang sedang aktif tiap popup dibuka.
 */
export function FilterPopup({
    isOpen,
    onClose,
    appliedFilters,
    onApply,
    kategoriOptions,
    satuanOptions,
    lokasiRakOptions,
}: FilterPopupProps) {
    const [draft, setDraft] = useState<SparepartFilters>(appliedFilters);

    useEffect(() => {
        if (isOpen) setDraft(appliedFilters);
    }, [isOpen, appliedFilters]);

    useEffect(() => {
        if (!isOpen) return;
        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") onClose();
        }
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    function handleApply() {
        onApply(draft);
        onClose();
    }

    function handleReset() {
        setDraft(EMPTY_FILTERS);
        onApply(EMPTY_FILTERS);
        onClose();
    }

    return (
        <>
            {/* Overlay transparan cuma buat menangkap klik di luar popup untuk
                menutupnya — sengaja tanpa warna supaya tidak menggelapkan halaman. */}
            <div className="fixed inset-0 z-20" onClick={onClose} />
            <div
                role="dialog"
                aria-label="Filter sparepart"
                className="absolute right-0 top-full z-30 mt-2 max-h-[70vh] w-72 overflow-y-auto rounded-lg border border-ink/20 bg-surface shadow-lg sm:w-80"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex flex-col gap-4 p-4 pb-2">
                    <FilterSection title="Line">
                        {LINES.map((line) => (
                            <FilterCheckbox
                                key={line.key}
                                label={line.label}
                                checked={draft.line.includes(line.key)}
                                onChange={() =>
                                    setDraft((d) => ({ ...d, line: toggleValue(d.line, line.key) }))
                                }
                            />
                        ))}
                    </FilterSection>

                    <FilterSection title="Kategori">
                        {kategoriOptions.length === 0 ? (
                            <p className="font-sans text-xs text-muted">Belum ada data</p>
                        ) : (
                            kategoriOptions.map((opt) => (
                                <FilterCheckbox
                                    key={opt}
                                    label={opt}
                                    checked={draft.kategori.includes(opt)}
                                    onChange={() =>
                                        setDraft((d) => ({
                                            ...d,
                                            kategori: toggleValue(d.kategori, opt),
                                        }))
                                    }
                                />
                            ))
                        )}
                    </FilterSection>

                    <FilterSection title="Satuan">
                        {satuanOptions.length === 0 ? (
                            <p className="font-sans text-xs text-muted">Belum ada data</p>
                        ) : (
                            satuanOptions.map((opt) => (
                                <FilterCheckbox
                                    key={opt}
                                    label={opt}
                                    checked={draft.satuan.includes(opt)}
                                    onChange={() =>
                                        setDraft((d) => ({
                                            ...d,
                                            satuan: toggleValue(d.satuan, opt),
                                        }))
                                    }
                                />
                            ))
                        )}
                    </FilterSection>

                    <FilterSection title="Lokasi Rak">
                        {lokasiRakOptions.length === 0 ? (
                            <p className="font-sans text-xs text-muted">Belum ada data</p>
                        ) : (
                            lokasiRakOptions.map((opt) => (
                                <FilterCheckbox
                                    key={opt}
                                    label={opt}
                                    checked={draft.lokasiRak.includes(opt)}
                                    onChange={() =>
                                        setDraft((d) => ({
                                            ...d,
                                            lokasiRak: toggleValue(d.lokasiRak, opt),
                                        }))
                                    }
                                />
                            ))
                        )}
                    </FilterSection>

                    <FilterSection title="Status">
                        {STATUS_OPTIONS.map((opt) => (
                            <FilterCheckbox
                                key={opt}
                                label={opt}
                                checked={draft.status.includes(opt)}
                                onChange={() =>
                                    setDraft((d) => ({ ...d, status: toggleValue(d.status, opt) }))
                                }
                            />
                        ))}
                    </FilterSection>
                </div>

                {/* Sticky di bagian bawah AREA SCROLL popup (bukan viewport halaman) —
                    posisinya relatif terhadap div pembungkus di atas yang punya
                    overflow-y-auto, jadi tombol ini selalu kelihatan tanpa perlu
                    scroll checkbox sampai mentok. bg-surface wajib solid supaya
                    checkbox yang lewat di baliknya tidak tembus pandang. */}
                <div className="sticky bottom-0 flex justify-between gap-2 border-t border-ink/10 bg-surface p-4">
                    <button
                        type="button"
                        onClick={handleReset}
                        className="rounded-md border border-ink/20 px-3 py-1.5 font-sans text-sm text-ink hover:bg-app-bg"
                    >
                        Reset
                    </button>
                    <button
                        type="button"
                        onClick={handleApply}
                        className="rounded-md bg-primary px-3 py-1.5 font-sans text-sm font-medium text-white hover:bg-primary/90"
                    >
                        Terapkan
                    </button>
                </div>
            </div>
        </>
    );
}