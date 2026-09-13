"use client";

import {
    useEffect,
    useRef,
    useState,
    type KeyboardEvent as ReactKeyboardEvent,
    type MouseEvent as ReactMouseEvent,
    type RefObject,
} from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { LINES } from "./line-config";
import { PopoverPortal, useAnchorRect } from "./popover-portal";

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

// CATATAN: field "line" DIKEMBALIKAN ke filter ini — dulu sempat dihapus
// karena kontrol tampil/sembunyi kolom per Line (sekarang ColumnVisibilityPopup
// di column-visibility-popup.tsx) dianggap cukup. Sekarang keduanya hidup
// berdampingan tapi untuk TUJUAN BERBEDA: filter "line" di sini MENYARING
// BARIS (hanya tampilkan part yang punya data lineStock di Line yang
// dicentang — lihat filteredData di sparepart-grid.tsx), sedangkan
// ColumnVisibilityPopup HANYA menyembunyikan KOLOM tanpa menyaring baris
// sama sekali. Nilai yang disimpan adalah Line KEY (mis. "LINE_1"), BUKAN
// label tampilan ("L1") — lihat `getLabel` di MultiSelectCombobox untuk
// bagaimana key ini ditampilkan sebagai label yang lebih ramah.
export type SparepartFilters = {
    kategori: string[];
    satuan: string[];
    status: StatusFilterValue[];
    line: string[];
};

export const EMPTY_FILTERS: SparepartFilters = {
    kategori: [],
    satuan: [],
    status: [],
    line: [],
};

/** Total opsi aktif di semua kategori, dipakai untuk badge angka di tombol Filter. */
export function countActiveFilters(filters: SparepartFilters): number {
    return (
        filters.kategori.length +
        filters.satuan.length +
        filters.status.length +
        filters.line.length
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

// ==========================================================
// MULTI-SELECT COMBOBOX — pengganti AccordionSection + FilterCheckbox lama.
//
// KENAPA DIGANTI: opsi Kategori/Lokasi Rak bisa tumbuh sampai ratusan baris.
// Deretan checkbox flat (versi lama) jadi sangat panjang, berantakan, dan
// tidak scalable. Combobox ini menyembunyikan semua opsi di balik dropdown
// yang bisa disaring lewat pencarian, jadi trigger-nya tetap ringkas berapa
// pun jumlah opsinya — dan yang dipilih ditampilkan sebagai chip di trigger.
//
// TIDAK memakai library luar (Radix UI/Headless UI/react-select) — murni
// React state + Tailwind, sesuai constraint proyek ini.
//
// Generic <T extends string> supaya bisa dipakai untuk kolom string biasa
// (Kategori/Satuan/Lokasi Rak) MAUPUN union literal seperti
// StatusFilterValue tanpa perlu type-cast di pemanggilnya.
// ==========================================================

/** Estimasi tinggi panel dropdown (px), dipakai heuristik buka ke atas/bawah. */
const DROPDOWN_ESTIMATED_HEIGHT = 280;

function MultiSelectCombobox<T extends string>({
    label,
    placeholder,
    options,
    selected,
    onChange,
    getLabel,
}: {
    label: string;
    placeholder: string;
    options: T[];
    selected: T[];
    onChange: (next: T[]) => void;
    /**
     * Opsional: transformasi value jadi label tampilan, dipakai saat value
     * yang disimpan (mis. Line key "LINE_1") berbeda dari label yang enak
     * dibaca user ("L1"). Default: tampilkan value apa adanya (Kategori/
     * Satuan/Lokasi Rak/Status semuanya value == label, jadi tidak perlu
     * pasang prop ini).
     */
    getLabel?: (value: T) => string;
}) {
    const displayLabel = getLabel ?? ((value: T) => value);
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState("");
    // true = dropdown dibuka ke ATAS trigger (bottom-full) alih-alih ke bawah
    // (top-full) — lihat handleOpen().
    const [openUpward, setOpenUpward] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    const isDisabled = options.length === 0;

    // Tutup dropdown kalau user klik di luar wrapper combobox ini (trigger +
    // panel dropdown jadi satu containing block lewat `relative` di wrapper).
    // Pakai "mousedown", bukan "click", supaya kelar SEBELUM click lain
    // (mis. klik trigger combobox lain di sebelahnya) diproses.
    useEffect(() => {
        if (!isOpen) return;
        function handlePointerDown(event: MouseEvent) {
            if (
                wrapperRef.current &&
                !wrapperRef.current.contains(event.target as Node)
            ) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handlePointerDown);
        return () => document.removeEventListener("mousedown", handlePointerDown);
    }, [isOpen]);

    // Reset kotak pencarian & auto-fokus input tiap dropdown dibuka.
    useEffect(() => {
        if (isOpen) {
            setQuery("");
            requestAnimationFrame(() => searchInputRef.current?.focus());
        }
    }, [isOpen]);

    function handleOpen() {
        if (isDisabled) return;
        if (!isOpen && wrapperRef.current) {
            // Heuristik arah buka: kalau ruang KE BAWAH trigger (relatif viewport)
            // lebih sempit dari estimasi tinggi dropdown DAN ruang ke atas lebih
            // luas, buka ke atas. ini pelengkap dari max-h + overflow-y-auto di
            // panel opsi (lihat di bawah) yang membatasi tinggi dropdown itu
            // sendiri — dua-duanya dipakai bareng supaya dropdown sekecil apapun
            // sisa ruang di dalam popup (yang overflow-y-auto) tetap kebaca utuh
            // tanpa perlu ubah struktur scroll popup/portal.
            const rect = wrapperRef.current.getBoundingClientRect();
            const spaceBelow = window.innerHeight - rect.bottom;
            const spaceAbove = rect.top;
            setOpenUpward(
                spaceBelow < DROPDOWN_ESTIMATED_HEIGHT && spaceAbove > spaceBelow
            );
        }
        setIsOpen((prev) => !prev);
    }

    // Trigger BUKAN elemen <button> (lihat komentar di JSX-nya di bawah),
    // jadi Enter/Space untuk membuka combobox lewat keyboard harus ditangani
    // manual di sini — browser tidak otomatis memicu "click" untuk div biasa
    // seperti pada elemen <button> asli.
    function handleTriggerKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
        if (isDisabled) return;
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handleOpen();
        }
    }

    function handleToggleOption(option: T) {
        onChange(toggleValue(selected, option));
    }

    function handleRemoveChip(
        event: ReactMouseEvent<HTMLButtonElement>,
        option: T
    ) {
        event.stopPropagation(); // jangan sampai ikut men-toggle buka/tutup trigger
        onChange(selected.filter((item) => item !== option));
    }

    const filteredOptions = query.trim()
        ? options.filter((opt) =>
            displayLabel(opt).toLowerCase().includes(query.trim().toLowerCase())
        )
        : options;

    return (
        <div className="flex flex-col gap-1">
            <span className="flex items-center font-sans text-xs font-semibold text-subtle">
                {label}
                {selected.length > 0 && (
                    <span className="ml-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 font-sans text-[10px] font-semibold text-white">
                        {selected.length}
                    </span>
                )}
            </span>

            {/* wrapper `relative`: containing block untuk panel dropdown
                `absolute` di bawah/atasnya — SESUAI PERMINTAAN, posisi dropdown
                dihitung relatif terhadap wrapper combobox ini sendiri (bukan
                fixed/portal terpisah), karena seluruh FilterPopup sudah
                di-portal + fixed lewat PopoverPortal punya, tidak perlu lapisan
                positioning kedua. */}
            <div ref={wrapperRef} className="relative">
                {/* Trigger SENGAJA <div role="button">, BUKAN <button> asli —
                    chip "x" di dalamnya (baris di bawah) juga elemen <button>,
                    dan HTML tidak mengizinkan <button> jadi descendant dari
                    <button> lain (persis error hydration "In HTML, <button>
                    cannot be a descendant of <button>" yang muncul di console
                    sebelum perbaikan ini). tabIndex + onKeyDown di bawah
                    menjaga supaya tetap bisa dibuka lewat keyboard (Enter/Space)
                    walau bukan elemen <button> sungguhan. */}
                <div
                    role="button"
                    tabIndex={isDisabled ? -1 : 0}
                    onClick={handleOpen}
                    onKeyDown={handleTriggerKeyDown}
                    aria-expanded={isOpen}
                    aria-haspopup="listbox"
                    aria-disabled={isDisabled}
                    className={`flex min-h-[38px] w-full flex-wrap items-center gap-1 rounded-md border px-2 py-1.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/50 ${isDisabled
                        ? "cursor-not-allowed border-ink/10 bg-app-bg"
                        : "cursor-text border-ink/20 bg-surface hover:border-ink/30"
                        } ${isOpen ? "border-primary ring-1 ring-primary" : ""}`}
                >
                    {selected.length === 0 ? (
                        <span className="font-sans text-sm text-muted">
                            {isDisabled ? "Belum ada data" : placeholder}
                        </span>
                    ) : (
                        selected.map((value) => (
                            <span
                                key={value}
                                className="flex items-center gap-1 rounded-full bg-primary/10 py-0.5 pl-2 pr-1 font-sans text-xs text-primary"
                            >
                                {displayLabel(value)}
                                <button
                                    type="button"
                                    onClick={(event) => handleRemoveChip(event, value)}
                                    aria-label={`Hapus ${displayLabel(value)}`}
                                    className="rounded-full p-0.5 hover:bg-primary/20"
                                >
                                    <X className="h-3 w-3" />
                                </button>
                            </span>
                        ))
                    )}
                    <ChevronDown
                        className={`ml-auto h-4 w-4 shrink-0 text-subtle transition-transform duration-150 ${isOpen ? "rotate-180" : ""
                            }`}
                    />
                </div>

                {isOpen && !isDisabled && (
                    <div
                        role="listbox"
                        aria-label={label}
                        // z-[60]: SENGAJA di atas dialog FilterPopup (z-50) supaya
                        // dropdown combobox ini tidak ketiban combobox lain atau
                        // sticky footer Reset/Terapkan di bawahnya.
                        // `absolute` (bukan fixed) relatif ke wrapper di atas,
                        // dengan arah top-full/bottom-full mengikuti openUpward.
                        className={`absolute left-0 z-[60] w-full overflow-hidden rounded-md border border-ink/20 bg-surface shadow-lg ${openUpward ? "bottom-full mb-1" : "top-full mt-1"
                            }`}
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="border-b border-ink/10 p-1.5">
                            <input
                                ref={searchInputRef}
                                type="text"
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                                placeholder={`Cari ${label.toLowerCase()}...`}
                                className="w-full rounded border border-ink/15 px-2 py-1 font-sans text-sm text-ink outline-none focus:border-primary"
                            />
                        </div>
                        {/* max-h + overflow-y-auto: BATASI tinggi panel opsi sendiri
                            (independen dari openUpward) supaya dropdown tidak pernah
                            lebih tinggi dari ini — mengurangi risiko kepotong overflow
                            dialog FilterPopup (yang overflow-y-auto) walau heuristik
                            openUpward di atas meleset. */}
                        <div className="max-h-56 overflow-y-auto p-1">
                            {filteredOptions.length === 0 ? (
                                <p className="px-2 py-1.5 font-sans text-xs text-muted">
                                    Tidak ada hasil
                                </p>
                            ) : (
                                filteredOptions.map((option) => {
                                    const isChecked = selected.includes(option);
                                    return (
                                        <button
                                            key={option}
                                            type="button"
                                            role="option"
                                            aria-selected={isChecked}
                                            onClick={() => handleToggleOption(option)}
                                            className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left font-sans text-sm text-ink hover:bg-app-bg"
                                        >
                                            <span className="truncate">{displayLabel(option)}</span>
                                            {isChecked && (
                                                <Check className="h-4 w-4 shrink-0 text-primary" />
                                            )}
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

type FilterPopupProps = {
    isOpen: boolean;
    onClose: () => void;
    /** Ref ke tombol Filter pemicu popup — dipakai untuk menghitung
     *  posisi lewat useAnchorRect (lihat popover-portal.tsx), bukan
     *  lagi lewat wrapper `relative` seperti sebelumnya. */
    anchorRef: RefObject<HTMLElement | null>;
    appliedFilters: SparepartFilters;
    onApply: (filters: SparepartFilters) => void;
    kategoriOptions: string[];
    satuanOptions: string[];
};

/**
 * Popup filter untuk SparepartGrid. Implementasinya dropdown manual
 * (di-portal ke document.body lewat PopoverPortal, posisi fixed dihitung
 * dari useAnchorRect), bukan <dialog>, supaya tidak perlu urus styling
 * ::backdrop dan showModal()/close() lewat ref — paling sederhana untuk
 * kasus ini.
 *
 * LAYOUT: tumpukan vertikal ringkas (w-72 tetap, BUKAN grid melebar
 * 1/2/3 kolom seperti versi checkbox lama — lihat komentar LEBAR di
 * className dialog di bawah). Tiap kategori filter (Kategori/Satuan/
 * Line/Status) sekarang jadi MultiSelectCombobox sendiri-sendiri —
 * searchable, opsi terpilih tampil sebagai chip di trigger — MENGGANTIKAN
 * accordion + checkbox flat versi lama (lihat MultiSelectCombobox di atas
 * untuk alasan penggantiannya: opsi Kategori bisa ratusan baris, checkbox
 * flat tidak scalable).
 *
 * CATATAN: section "Lokasi Rak" SENGAJA DIHAPUS dari popup ini (field
 * lokasiRakId di Sparepart & tabel LokasiRak tetap ada di database,
 * hanya disembunyikan dari UI ini karena rencana pemakaiannya berubah
 * jadi per-line, bukan per-part).
 *
 * CATATAN: section "Line" DIKEMBALIKAN ke popup ini sebagai MultiSelectCombobox
 * sendiri, TERPISAH TOTAL dari tombol mata (ColumnVisibilityPopup di
 * column-visibility-popup.tsx). Keduanya sama-sama soal Line tapi beda
 * tujuan — jangan tertukar:
 * - Combobox "Line" DI SINI: menyaring BARIS (hanya part yang punya
 *   lineStock di Line terpilih yang tampil), state-nya lewat
 *   SparepartFilters.line, disimpan sebagai Line KEY (mis. "LINE_1").
 * - Tombol mata (ColumnVisibilityPopup): HANYA menyembunyikan/menampilkan
 *   KOLOM di tabel, sama sekali tidak menyaring baris, state-nya terpisah
 *   (hiddenColumns) TIDAK lewat SparepartFilters ini.
 *
 * Opsi yang dipilih di sini disimpan sebagai "draft" dulu, baru benar-benar
 * memengaruhi tabel setelah tombol "Terapkan" ditekan. Supaya draft yang
 * belum diterapkan tidak nyangkut ke sesi buka-popup berikutnya, draft
 * disinkronkan ulang ke filter yang sedang aktif tiap popup dibuka.
 */
export function FilterPopup({
    isOpen,
    onClose,
    anchorRef,
    appliedFilters,
    onApply,
    kategoriOptions,
    satuanOptions,
}: FilterPopupProps) {
    const [draft, setDraft] = useState<SparepartFilters>(appliedFilters);
    const rect = useAnchorRect(anchorRef, isOpen);

    useEffect(() => {
        if (isOpen) {
            setDraft(appliedFilters);
        }
    }, [isOpen, appliedFilters]);

    useEffect(() => {
        if (!isOpen) return;
        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") onClose();
        }
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen || !rect) return null;

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
        <PopoverPortal>
            {/* Overlay transparan cuma buat menangkap klik di luar popup untuk
                menutupnya — sengaja tanpa warna supaya tidak menggelapkan halaman.
                z-40 supaya overlay ini juga di atas thead sticky SparepartGrid —
                kalau overlay lebih rendah dari thead, klik di area header tabel
                tidak akan tertangkap sebagai "klik di luar popup" dan popup
                tidak akan tertutup. Karena sekarang di-portal ke body, z-index
                ini otomatis lepas dari stacking context toolbar/tabel manapun. */}
            <div className="fixed inset-0 z-40" onClick={onClose} />
            <div
                role="dialog"
                aria-label="Filter sparepart"
                // POSISI: fixed + top/right dari rect tombol Filter (lihat
                // useAnchorRect di popover-portal.tsx), BUKAN absolute di
                // dalam wrapper `relative` toolbar lagi — toolbar SparepartGrid
                // punya overflow-x-auto + tinggi tetap (h-[62px]) yang lewat
                // CSS Overflow spec otomatis memaksa overflow-y jadi `auto`
                // juga dan MEMOTONG popup manapun yang lebih tinggi dari 62px
                // kalau dia masih jadi descendant toolbar itu.
                //
                // z-50: SENGAJA jelas lebih tinggi dari z-index thead sticky
                // manapun di SparepartGrid supaya popup ini SELALU tampil utuh
                // di atas header, tidak pernah ketiban/ketutup sebagian saat
                // popup dibuka dalam keadaan tabel sudah discroll.
                //
                // LEBAR: fixed w-72 (BUKAN w-[92vw] + max-w-3xl melebar
                // seperti versi checkbox lama). Popup ini di-anchor dari
                // SISI KANAN (style `right` di atas mengikuti tepi kanan
                // tombol Filter, bukan tepi kiri), jadi makin lebar popup-nya,
                // makin jauh sisi KIRI-nya melebar ke kiri menjauhi tombol —
                // itu sebabnya versi lama yang lebar (sampai 768px, dirancang
                // untuk grid 3 kolom checkbox) terlihat "kekiri banget".
                // Sekarang combobox cuma 1 baris trigger yang compact, jadi
                // popup tidak perlu lebar-lebar lagi dan otomatis nempel pas
                // di bawah tombolnya. max-w-[calc(100vw-1.5rem)] cuma jaga-jaga
                // di layar sangat sempit (< ~320px) supaya tidak overflow.
                style={{ top: rect.top, right: rect.right }}
                className="fixed z-50 max-h-[75vh] w-72 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-lg border border-ink/20 bg-surface shadow-lg"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex flex-col gap-3 p-4 pb-2">
                    <MultiSelectCombobox
                        label="Kategori"
                        placeholder="Pilih Kategori..."
                        options={kategoriOptions}
                        selected={draft.kategori}
                        onChange={(next) =>
                            setDraft((d) => ({ ...d, kategori: next }))
                        }
                    />

                    <MultiSelectCombobox
                        label="Satuan"
                        placeholder="Pilih Satuan..."
                        options={satuanOptions}
                        selected={draft.satuan}
                        onChange={(next) => setDraft((d) => ({ ...d, satuan: next }))}
                    />

                    <MultiSelectCombobox
                        label="Line"
                        placeholder="Pilih Line..."
                        options={LINES.map((line) => line.key)}
                        selected={draft.line}
                        onChange={(next) => setDraft((d) => ({ ...d, line: next }))}
                        getLabel={(key) =>
                            LINES.find((line) => line.key === key)?.label ?? key
                        }
                    />

                    <MultiSelectCombobox<StatusFilterValue>
                        label="Status"
                        placeholder="Pilih Status..."
                        options={STATUS_OPTIONS}
                        selected={draft.status}
                        onChange={(next) => setDraft((d) => ({ ...d, status: next }))}
                    />
                </div>

                {/* Sticky di bagian bawah AREA SCROLL popup (bukan viewport halaman) —
                    posisinya relatif terhadap div pembungkus di atas yang punya
                    overflow-y-auto, jadi tombol ini selalu kelihatan tanpa perlu
                    scroll opsi sampai mentok. bg-surface wajib solid supaya
                    combobox yang lewat di baliknya tidak tembus pandang. */}
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
        </PopoverPortal>
    );
}