"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { Filter, Check, X, Loader2 } from "lucide-react";
import {
    updateSparepartField,
    updateSparepartRelation,
    type getSparepartList,
} from "@/lib/actions/sparepart";
import { recordStockMovement, updateLineMinStok } from "@/lib/actions/stock-movement";
import type { Kategori, Line, LokasiRak, Satuan } from "@/generated/prisma/client";
import { computeSparepartStatus } from "@/lib/status-helper";
import { StatusBadge } from "@/components/ui/status-badge";
import { LINES } from "./line-config";
import {
    EMPTY_FILTERS,
    FilterPopup,
    countActiveFilters,
    matchesStatusFilter,
    type SparepartFilters,
} from "./filter-popup";

// Tipe data diturunkan langsung dari return type getSparepartList, jadi
// selalu sinkron dengan Server Action tanpa perlu duplikat definisi tipe
// atau export tipe baru dari sparepart.ts.
type SparepartListResult = Awaited<ReturnType<typeof getSparepartList>>;
type SparepartWithRelations = Extract<
    SparepartListResult,
    { success: true }
>["data"][number];

type SparepartGridProps = {
    initialData: SparepartWithRelations[];
    // Pesan error dari Server Action kalau fetch di page.tsx gagal.
    // undefined kalau fetch sukses.
    fetchError?: string;
    // Opsi dropdown untuk edit inline relasi — dikirim dari page.tsx
    // supaya tidak perlu fetch ulang di client.
    kategoriOptions: Kategori[];
    satuanOptions: Satuan[];
    lokasiRakOptions: LokasiRak[];
};

// ==========================================================
// LEBAR KOLOM (px) — dipusatkan di sini supaya mudah disesuaikan.
// Dipakai oleh <colgroup> untuk memaksa table-layout: fixed,
// sehingga lebar kolom tidak dipengaruhi panjang konten sel.
// ==========================================================
const ITEM_CODE_WIDTH = 150; // sticky kolom-1
const PART_WIDTH = 220;      // sticky kolom-2
const KATEGORI_WIDTH = 120;
const SPEK_WIDTH = 220;
const SATUAN_WIDTH = 90;
const LOKASI_RAK_WIDTH = 130;
const STOK_COL_WIDTH = 72;   // sub-kolom Stok per line
const OPNAME_COL_WIDTH = 88; // sub-kolom Opname per line
const MIN_COL_WIDTH = 65;    // sub-kolom Min per line
const STATUS_WIDTH = 110;
const KETERANGAN_WIDTH = 175;

// Lebar total untuk 1 line (3 sub-kolom).
const LINE_COL_WIDTH = STOK_COL_WIDTH + OPNAME_COL_WIDTH + MIN_COL_WIDTH;

function formatTanggalOpname(date: Date | null): string {
    if (!date) return "-";
    const d = new Date(date);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yy = String(d.getFullYear()).slice(-2);
    return `${dd}/${mm}/${yy}`;
}

// Ambil nilai unik & non-kosong dari suatu daftar field, diurutkan alfabet.
function uniqueSorted(values: (string | null | undefined)[]): string[] {
    const set = new Set(values.filter((v): v is string => Boolean(v)));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
}

// Kelas dasar sel header & data. Border pakai ink dengan opacity rendah
// supaya tipis, bukan hitam pekat. Sengaja cuma border-b + border-r (bukan
// `border` di keempat sisi + border-collapse) karena border-collapse punya
// bug rendering di kolom position:sticky — garis batas kolom sticky suka
// hilang/ketutup background-nya sendiri saat di-scroll. Border-separate +
// border-b/border-r per sel jauh lebih stabil untuk tabel dengan sticky
// column; garis kiri & atas tabel sudah ditutup oleh border si wrapper.
const thBase =
    "border-b border-r border-ink/20 bg-surface px-3 py-2 align-middle font-sans font-semibold text-ink";
const tdBase =
    "border-b border-r border-ink/20 px-3 py-2 font-sans font-normal text-ink";

// ==========================================================
// EDIT INLINE — komponen & tipe pendukung
//
// Ditaruh di module scope (BUKAN di dalam SparepartGrid) supaya React
// tidak menganggapnya tipe komponen baru tiap kali SparepartGrid
// re-render (mis. tiap kali ketik di search box) — kalau didefinisikan
// di dalam, semua sel edit akan remount & kehilangan fokus/state tiap
// re-render induknya.
//
// DESAIN FLOATING PANEL:
// Edit panel dirender sebagai `position: absolute` dari dalam td yang
// punya `position: relative`. Panel mengambang DI ATAS baris tabel —
// lebar kolom tidak berubah saat mode edit aktif.
// Tombol Simpan/Batal berada di bawah input (bukan sejajar), supaya
// kolom sempit pun tetap nyaman dipakai.
// ==========================================================

type InlineEditSubmitResult =
    | { status: "success" }
    | { status: "error"; message: string }
    | { status: "cancelled" };

type EditTriggerProps = {
    children: React.ReactNode;
    align?: "left" | "center" | "right";
    onClick: () => void;
};

// Tombol transparan pembungkus tampilan normal sel yang bisa diedit.
// `overflow-hidden` + inner `truncate` memastikan teks panjang tidak
// melebarkan kolom — terpotong dengan ellipsis di batas lebar kolom.
function EditTrigger({ children, align = "left", onClick }: EditTriggerProps) {
    const alignClass =
        align === "center" ? "text-center" : align === "right" ? "text-right" : "text-left";
    return (
        <button
            type="button"
            onClick={onClick}
            title="Klik untuk edit"
            className={`-mx-1 -my-0.5 block w-full overflow-hidden rounded px-1 py-0.5 ${alignClass} hover:bg-ink/5 focus:outline-none focus:ring-1 focus:ring-primary/30`}
        >
            <span className="block truncate">{children}</span>
        </button>
    );
}

type InlineEditShellProps = {
    initialValue: string;
    inputType?: "text" | "number";
    /**
     * Kalau true, gunakan <textarea> (mis. Spesifikasi) supaya teks
     * panjang bisa diedit dengan nyaman. Enter saja tidak simpan —
     * harus klik Simpan atau tekan Ctrl+Enter.
     */
    useTextarea?: boolean;
    /** Label kecil di atas input, mis. "Selisih (+/-)" untuk koreksi stok. */
    label?: string;
    placeholder?: string;
    /** Dipanggil saat Batal, Escape, blur ke luar panel, atau setelah simpan sukses. */
    onClose: () => void;
    onSubmit: (value: string) => Promise<InlineEditSubmitResult>;
};

// Panel edit mengambang — diposisikan absolut dari sudut kiri-atas td
// (td harus punya `position: relative`). Tombol Simpan & Batal ada di
// bawah input, bukan sejajar, supaya kolom sempit tetap rapi.
// `tabIndex={-1}` pada panel memastikan klik pada area kosong panel
// tidak menutupnya (relatedTarget = panel itu sendiri, masih "di dalam").
function InlineEditShell({
    initialValue,
    inputType = "text",
    useTextarea = false,
    label,
    placeholder,
    onClose,
    onSubmit,
}: InlineEditShellProps) {
    const [draft, setDraft] = useState(initialValue);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleSave() {
        if (isSaving) return;
        setIsSaving(true);
        setError(null);

        const result = await onSubmit(draft);

        if (result.status === "success") {
            setIsSaving(false);
            onClose();
        } else if (result.status === "error") {
            setIsSaving(false);
            setError(result.message);
        } else {
            // "cancelled" — mis. window.prompt() alasan koreksi dibatalkan.
            // Diam-diam batal, panel tetap terbuka, tidak ada pesan error.
            setIsSaving(false);
        }
    }

    return (
        <div
            // tabIndex={-1} supaya klik area kosong panel tidak trigger blur
            // keluar → relatedTarget = div ini sendiri → masih "di dalam".
            tabIndex={-1}
            className="absolute left-0 top-0 z-50 w-max min-w-[190px] max-w-[300px] rounded-lg border border-primary/30 bg-surface p-2.5 shadow-xl ring-1 ring-primary/10 focus:outline-none"
            onBlur={(event) => {
                const related = event.relatedTarget;
                if (
                    !(related instanceof Node) ||
                    !event.currentTarget.contains(related)
                ) {
                    onClose();
                }
            }}
        >
            {label && (
                <span className="mb-1 block font-sans text-[10px] font-semibold uppercase tracking-wide text-primary/70">
                    {label}
                </span>
            )}
            {useTextarea ? (
                <textarea
                    autoFocus
                    rows={3}
                    value={draft}
                    placeholder={placeholder}
                    disabled={isSaving}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                        // Escape = batal. Ctrl/Cmd+Enter = simpan.
                        // Enter biasa = newline di textarea (tidak simpan).
                        if (e.key === "Escape") { e.preventDefault(); onClose(); }
                        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                            e.preventDefault();
                            handleSave();
                        }
                    }}
                    className="w-full resize-y rounded border border-ink/20 bg-app-bg px-2 py-1 font-sans text-sm text-ink focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:opacity-60"
                />
            ) : (
                <input
                    autoFocus
                    type={inputType}
                    value={draft}
                    placeholder={placeholder}
                    disabled={isSaving}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); handleSave(); }
                        if (e.key === "Escape") { e.preventDefault(); onClose(); }
                    }}
                    className="w-full rounded border border-ink/20 bg-app-bg px-2 py-1 font-sans text-sm text-ink focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:opacity-60"
                />
            )}

            {error && (
                <p className="mt-1 font-sans text-[11px] text-status-danger">{error}</p>
            )}

            <div className="mt-2 flex justify-end gap-1.5">
                <button
                    type="button"
                    onClick={onClose}
                    disabled={isSaving}
                    className="flex items-center gap-1 rounded px-2 py-0.5 font-sans text-xs text-muted hover:bg-ink/5 disabled:opacity-60"
                >
                    <X className="h-3 w-3" />
                    Batal
                </button>
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={isSaving}
                    className="flex items-center gap-1 rounded bg-primary/10 px-2 py-0.5 font-sans text-xs font-medium text-primary hover:bg-primary/20 disabled:opacity-60"
                >
                    {isSaving ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                        <Check className="h-3 w-3" />
                    )}
                    Simpan
                </button>
            </div>
        </div>
    );
}

// Shell khusus untuk Edit Stok (Koreksi). Menggantikan window.prompt()
// supaya tidak trigger onBlur yang menutup panel secara paksa.
//
// UX: input NUMBER berisi nilai stok saat ini (bukan delta kosong) —
// user langsung mengedit ke angka final yang diinginkan. Delta ke server
// baru dihitung saat Simpan: (nilai baru) - (currentValue, yaitu nilai
// stok sebelum sel ini dibuka untuk diedit). onSubmit tetap menerima
// delta (string) supaya sisi caller (submitStokField -> recordStockMovement)
// tidak perlu berubah sama sekali — fungsi itu memang kontraknya delta.
type InlineStockEditShellProps = {
    /** Nilai stok saat ini untuk line ini, dipakai untuk prefill input & basis hitung delta. */
    currentValue: number;
    onClose: () => void;
    onSubmit: (delta: string, keterangan: string) => Promise<InlineEditSubmitResult>;
};

function InlineStockEditShell({ currentValue, onClose, onSubmit }: InlineStockEditShellProps) {
    const [draft, setDraft] = useState(String(currentValue));
    const [keterangan, setKeterangan] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleSave() {
        if (isSaving) return;

        const trimmed = draft.trim();
        const newValue = Number(trimmed);
        if (trimmed === "" || Number.isNaN(newValue)) {
            setError("Masukkan angka yang valid");
            return;
        }

        const delta = newValue - currentValue;

        // User tidak benar-benar mengubah angkanya — tidak perlu panggil
        // Server Action sama sekali, cukup anggap tidak ada perubahan dan
        // tutup mode edit. Alasan koreksi juga tidak perlu divalidasi di
        // sini karena tidak ada apa pun yang dikirim ke server.
        if (delta === 0) {
            onClose();
            return;
        }

        if (!keterangan.trim()) {
            setError("Alasan wajib diisi");
            return;
        }

        setIsSaving(true);
        setError(null);

        const result = await onSubmit(String(delta), keterangan);

        if (result.status === "success") {
            setIsSaving(false);
            onClose();
        } else if (result.status === "error") {
            setIsSaving(false);
            setError(result.message);
        } else {
            setIsSaving(false);
        }
    }

    return (
        <div
            tabIndex={-1}
            className="absolute left-0 top-0 z-50 w-max min-w-[220px] max-w-[300px] rounded-lg border border-primary/30 bg-surface p-2.5 shadow-xl ring-1 ring-primary/10 focus:outline-none"
            onBlur={(event) => {
                const related = event.relatedTarget;
                if (
                    !(related instanceof Node) ||
                    !event.currentTarget.contains(related)
                ) {
                    onClose();
                }
            }}
        >
            <input
                autoFocus
                type="number"
                value={draft}
                disabled={isSaving}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); handleSave(); }
                    if (e.key === "Escape") { e.preventDefault(); onClose(); }
                }}
                className="mb-2 w-full rounded border border-ink/20 bg-app-bg px-2 py-1 font-sans text-sm text-ink focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:opacity-60"
            />

            <span className="mb-1 block font-sans text-[10px] font-semibold uppercase tracking-wide text-primary/70">
                Alasan Koreksi
            </span>
            <textarea
                rows={2}
                value={keterangan}
                placeholder="Alasan wajib diisi..."
                disabled={isSaving}
                onChange={(e) => setKeterangan(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Escape") { e.preventDefault(); onClose(); }
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        handleSave();
                    }
                }}
                className="w-full resize-y rounded border border-ink/20 bg-app-bg px-2 py-1 font-sans text-sm text-ink focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:opacity-60"
            />

            {error && (
                <p className="mt-1 font-sans text-[11px] text-status-danger">{error}</p>
            )}

            <div className="mt-2 flex justify-end gap-1.5">
                <button
                    type="button"
                    onClick={onClose}
                    disabled={isSaving}
                    className="flex items-center gap-1 rounded px-2 py-0.5 font-sans text-xs text-muted hover:bg-ink/5 disabled:opacity-60"
                >
                    <X className="h-3 w-3" />
                    Batal
                </button>
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={isSaving}
                    className="flex items-center gap-1 rounded bg-primary/10 px-2 py-0.5 font-sans text-xs font-medium text-primary hover:bg-primary/20 disabled:opacity-60"
                >
                    {isSaving ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                        <Check className="h-3 w-3" />
                    )}
                    Simpan
                </button>
            </div>
        </div>
    );
}

// Shell khusus untuk edit inline berupa <select> (dropdown) — dipakai untuk
// Kategori, Satuan, dan Lokasi Rak. Pola Simpan/Batal identik dengan
// InlineEditShell supaya tampilan konsisten.
type SelectOption = { value: string | null; label: string };
type InlineSelectShellProps = {
    initialValue: string | null;
    options: SelectOption[];
    onClose: () => void;
    onSubmit: (value: string | null) => Promise<InlineEditSubmitResult>;
};

function InlineSelectShell({
    initialValue,
    options,
    onClose,
    onSubmit,
}: InlineSelectShellProps) {
    // Sentinel string untuk opsi "null" di dalam <select> (value harus string).
    const NULL_SENTINEL = "__NULL__";

    const [draft, setDraft] = useState<string>(initialValue ?? NULL_SENTINEL);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleSave() {
        if (isSaving) return;
        setIsSaving(true);
        setError(null);

        const value = draft === NULL_SENTINEL ? null : draft;
        const result = await onSubmit(value);

        if (result.status === "success") {
            setIsSaving(false);
            onClose();
        } else if (result.status === "error") {
            setIsSaving(false);
            setError(result.message);
        } else {
            setIsSaving(false);
        }
    }

    return (
        <div
            tabIndex={-1}
            className="absolute left-0 top-0 z-50 w-max min-w-[190px] max-w-[280px] rounded-lg border border-primary/30 bg-surface p-2.5 shadow-xl ring-1 ring-primary/10 focus:outline-none"
            onBlur={(event) => {
                const related = event.relatedTarget;
                if (
                    !(related instanceof Node) ||
                    !event.currentTarget.contains(related)
                ) {
                    onClose();
                }
            }}
        >
            <select
                autoFocus
                value={draft}
                disabled={isSaving}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Escape") { e.preventDefault(); onClose(); }
                }}
                className="w-full rounded border border-ink/20 bg-app-bg px-2 py-1 font-sans text-sm text-ink focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:opacity-60"
            >
                {options.map((opt) => (
                    <option key={opt.value ?? NULL_SENTINEL} value={opt.value ?? NULL_SENTINEL}>
                        {opt.label}
                    </option>
                ))}
            </select>

            {error && (
                <p className="mt-1 font-sans text-[11px] text-status-danger">{error}</p>
            )}

            <div className="mt-2 flex justify-end gap-1.5">
                <button
                    type="button"
                    onClick={onClose}
                    disabled={isSaving}
                    className="flex items-center gap-1 rounded px-2 py-0.5 font-sans text-xs text-muted hover:bg-ink/5 disabled:opacity-60"
                >
                    <X className="h-3 w-3" />
                    Batal
                </button>
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={isSaving}
                    className="flex items-center gap-1 rounded bg-primary/10 px-2 py-0.5 font-sans text-xs font-medium text-primary hover:bg-primary/20 disabled:opacity-60"
                >
                    {isSaving ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                        <Check className="h-3 w-3" />
                    )}
                    Simpan
                </button>
            </div>
        </div>
    );
}

export function SparepartGrid({
    initialData,
    fetchError,
    kategoriOptions,
    satuanOptions,
    lokasiRakOptions,
}: SparepartGridProps) {
    // Salinan lokal initialData — di-mutasi optimis setelah edit inline
    // berhasil, supaya tampilan tabel ter-update tanpa reload halaman.
    // Di-resync kalau initialData dari parent berubah (mis. setelah
    // router.refresh() di tempat lain).
    const [data, setData] = useState(initialData);
    useEffect(() => {
        setData(initialData);
    }, [initialData]);

    const [searchQuery, setSearchQuery] = useState("");
    const [appliedFilters, setAppliedFilters] = useState<SparepartFilters>(EMPTY_FILTERS);
    const [isFilterOpen, setIsFilterOpen] = useState(false);

    // ID sel yang sedang dalam mode edit, format `${jenis}:${sparepartId}`
    // atau `${jenis}:${sparepartId}:${line}` untuk kolom per-line. Cuma
    // ada 1 nilai (bukan Set) — makanya otomatis cuma 1 sel yang bisa
    // edit dalam satu waktu: begitu sel lain diklik, nilai ini diganti
    // dan sel lama otomatis kembali ke mode tampilan biasa.
    const [editingCellId, setEditingCellId] = useState<string | null>(null);

    // Opsi checkbox filter Kategori/Satuan/Lokasi Rak — diturunkan dinamis
    // dari data yang sudah ada, bukan dari props dropdown.
    const filterKategoriOptions = useMemo(
        () => uniqueSorted(data.map((s) => s.kategori.nama)),
        [data]
    );
    const filterSatuanOptions = useMemo(
        () => uniqueSorted(data.map((s) => s.satuan.nama)),
        [data]
    );
    const filterLokasiRakOptions = useMemo(
        () => uniqueSorted(data.map((s) => s.lokasiRak?.nama)),
        [data]
    );

    // Filter (search + checkbox) di-memoize supaya tidak menyaring ulang
    // seluruh array tiap kali komponen re-render karena alasan lain
    // (mis. state buka/tutup popup yang tidak berhubungan dengan data).
    //
    // Aturan gabungan: search DAN tiap kategori filter yang aktif digabung
    // dengan AND (makin banyak kondisi aktif, makin sempit hasilnya). Di
    // DALAM satu kategori filter (mis. Line: L1 + L2 dicentang bareng),
    // gabungannya OR. Kalau tidak ada filter dicentang sama sekali, kategori
    // itu tidak membatasi apa-apa (lolos semua, sesuai search saja).
    const filteredData = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();

        return data.filter((sparepart) => {
            if (query) {
                const haystack = [
                    sparepart.itemCode,
                    sparepart.namaPart,
                    sparepart.spesifikasi ?? "",
                ];
                const matchesSearch = haystack.some((field) =>
                    field.toLowerCase().includes(query)
                );
                if (!matchesSearch) return false;
            }

            if (appliedFilters.line.length > 0) {
                const hasSelectedLine = sparepart.lineStocks.some((ls) =>
                    appliedFilters.line.includes(ls.line)
                );
                if (!hasSelectedLine) return false;
            }

            if (
                appliedFilters.kategori.length > 0 &&
                !appliedFilters.kategori.includes(sparepart.kategori.nama)
            ) {
                return false;
            }

            if (
                appliedFilters.satuan.length > 0 &&
                !appliedFilters.satuan.includes(sparepart.satuan.nama)
            ) {
                return false;
            }

            if (appliedFilters.lokasiRak.length > 0) {
                const namaLokasi = sparepart.lokasiRak?.nama;
                if (!namaLokasi || !appliedFilters.lokasiRak.includes(namaLokasi)) {
                    return false;
                }
            }

            if (appliedFilters.status.length > 0) {
                const status = computeSparepartStatus(sparepart.lineStocks);
                const matchesStatus = appliedFilters.status.some((selected) =>
                    matchesStatusFilter(status, selected)
                );
                if (!matchesStatus) return false;
            }

            return true;
        });
    }, [data, searchQuery, appliedFilters]);

    // Kalau filter Line aktif (ada yang dicentang), kolom grup "Stok" cuma
    // menampilkan sub-kolom line yang dicentang itu. Kolom lain (Item Code
    // s/d Lokasi Rak, Status, Keterangan) selalu tampil apapun filternya.
    const visibleLines =
        appliedFilters.line.length > 0
            ? LINES.filter((line) => appliedFilters.line.includes(line.key))
            : LINES;

    // Lebar total tabel — dihitung dinamis supaya scrollable container
    // tahu berapa panjang tabel sebenarnya (berubah saat filter Line aktif).
    const tableWidth =
        ITEM_CODE_WIDTH +
        PART_WIDTH +
        KATEGORI_WIDTH +
        SPEK_WIDTH +
        SATUAN_WIDTH +
        LOKASI_RAK_WIDTH +
        visibleLines.length * LINE_COL_WIDTH +
        STATUS_WIDTH +
        KETERANGAN_WIDTH;

    // 6 kolom biasa (Item Code, Part, Kategori, Spek, Satuan, Lokasi Rak)
    // + (jumlah line yang tampil x 3 sub-kolom) + Status + Keterangan
    const totalColumns = 6 + visibleLines.length * 3 + 2;

    const activeFilterCount = countActiveFilters(appliedFilters);
    const isFilterActive = activeFilterCount > 0;
    const isSearchActive = searchQuery.trim().length > 0;
    const emptyMessage =
        isSearchActive || isFilterActive
            ? "Tidak ada part yang cocok dengan pencarian/filter"
            : "Belum ada data sparepart";

    // --- Merge hasil edit ke state lokal tanpa refetch/reload ---
    //
    // Semua handler menerima SparepartWithRelations lengkap dari server
    // dan menggantikan baris lama di array state — ini satu-satunya sumber
    // kebenaran setelah edit. Tidak ada merge field per field supaya
    // relasi (kategori.nama, satuan.nama, lokasiRak.nama) ikut ter-update.

    function mergeSparepartRow(updated: SparepartWithRelations) {
        setData((prev) =>
            prev.map((sp) => (sp.id === updated.id ? updated : sp))
        );
    }

    function mergeLineStock(
        sparepartId: string,
        updatedLineStock: SparepartWithRelations["lineStocks"][number],
        newTotalStok?: number
    ) {
        setData((prev) =>
            prev.map((sp) => {
                if (sp.id !== sparepartId) return sp;
                const exists = sp.lineStocks.some((ls) => ls.line === updatedLineStock.line);
                const lineStocks = exists
                    ? sp.lineStocks.map((ls) =>
                        ls.line === updatedLineStock.line ? updatedLineStock : ls
                    )
                    : [...sp.lineStocks, updatedLineStock];
                return {
                    ...sp,
                    lineStocks,
                    ...(newTotalStok !== undefined ? { stok: newTotalStok } : {}),
                };
            })
        );
    }

    // --- Handler submit tiap jenis sel edit — dipanggil dari onSubmit
    //     InlineEditShell/InlineSelectShell, hasilnya menentukan panel
    //     tetap terbuka (error/cancelled) atau tertutup (success). ---

    async function submitTextField(
        sparepartId: string,
        field: "namaPart" | "spesifikasi" | "keterangan",
        value: string
    ): Promise<InlineEditSubmitResult> {
        const result = await updateSparepartField(sparepartId, field, value);
        if (!result.success) {
            return { status: "error", message: result.message };
        }
        // result.data adalah SparepartWithRelations lengkap — ganti seluruh baris.
        mergeSparepartRow(result.data);
        return { status: "success" };
    }

    async function submitRelationField(
        sparepartId: string,
        field: "kategoriId" | "satuanId" | "lokasiRakId",
        value: string | null
    ): Promise<InlineEditSubmitResult> {
        const result = await updateSparepartRelation(sparepartId, field, value);
        if (!result.success) {
            return { status: "error", message: result.message };
        }
        mergeSparepartRow(result.data);
        return { status: "success" };
    }

    async function submitStokField(
        sparepartId: string,
        line: Line,
        value: string,
        keterangan: string
    ): Promise<InlineEditSubmitResult> {
        const trimmed = value.trim();
        const delta = Number(trimmed);
        if (trimmed === "" || Number.isNaN(delta)) {
            return { status: "error", message: "Masukkan angka selisih yang valid" };
        }

        const alasanTrimmed = keterangan.trim();
        if (!alasanTrimmed) {
            return { status: "error", message: "Alasan wajib diisi" };
        }

        try {
            const result = await recordStockMovement({
                sparepartId,
                line,
                tipe: "KOREKSI",
                jumlah: delta,
                keterangan: alasanTrimmed,
            });

            // DEBUG SEMENTARA — log response mentah dari Server Action supaya
            // kegagalan yang selama ini "diam-diam" (tidak sampai ke UI)
            // kelihatan di browser console. Hapus console.error ini setelah
            // root cause dikonfirmasi tuntas.
            console.error("[submitStokField] response:", result);

            if (!result.success) {
                return { status: "error", message: result.message };
            }

            // Gunakan lineStock dari response untuk update state — ini yang
            // berisi nilai jumlah & lastOpnameDate terbaru dari database.
            // Dicocokkan berdasarkan sparepartId (baris mana di tabel) DAN
            // line (sub-kolom mana di dalam baris itu) lewat mergeLineStock.
            mergeLineStock(sparepartId, result.data.lineStock, result.data.newTotalStok);
            return { status: "success" };
        } catch (error) {
            // recordStockMovement pada dasarnya sudah membungkus errornya
            // sendiri jadi { success: false, message }, TAPI kalau ada yang
            // gagal DI LUAR jangkauan try/catch internalnya (mis. sesi auth
            // bermasalah, error jaringan, atau exception lain yang benar-benar
            // di-throw, bukan di-return) — sebelumnya di sini tidak ada
            // try/catch sama sekali. Promise yang reject itu akan lolos ke
            // handleSave() di InlineStockEditShell tanpa pernah ditangkap,
            // tombol Simpan macet di status loading, dan tabel tidak pernah
            // ter-update. Itu skenario yang paling cocok dengan bug "gagal
            // diam-diam" ini — try/catch di bawah memastikan exception jenis
            // apa pun tetap berakhir sebagai pesan error yang terlihat user.
            console.error("[submitStokField] unexpected error:", error);
            return {
                status: "error",
                message: "Terjadi kesalahan tak terduga saat menyimpan stok. Coba lagi.",
            };
        }
    }

    async function submitMinField(
        sparepartId: string,
        line: Line,
        value: string
    ): Promise<InlineEditSubmitResult> {
        const trimmed = value.trim();
        const parsed = Number(trimmed);
        if (trimmed === "" || Number.isNaN(parsed)) {
            return { status: "error", message: "Masukkan angka yang valid" };
        }

        const result = await updateLineMinStok(sparepartId, line, parsed);
        if (!result.success) {
            return { status: "error", message: result.message };
        }

        mergeLineStock(sparepartId, result.data.lineStock);
        return { status: "success" };
    }

    // --- Siapkan opsi select untuk edit relasi ---

    const selectKategoriOptions: SelectOption[] = kategoriOptions.map((k) => ({
        value: k.id,
        label: k.nama,
    }));

    const selectSatuanOptions: SelectOption[] = satuanOptions.map((s) => ({
        value: s.id,
        label: s.nama,
    }));

    const selectLokasiRakOptions: SelectOption[] = [
        { value: null, label: "— Tidak ada —" },
        ...lokasiRakOptions.map((l) => ({ value: l.id, label: l.nama })),
    ];

    return (
        <div className="min-h-screen bg-app-bg p-6">
            <h1 className="mb-4 font-sans text-xl font-semibold text-ink">
                Daftar Sparepart
            </h1>

            {fetchError && (
                <p className="mb-4 rounded border border-status-danger/30 bg-status-danger/10 px-4 py-2 font-sans text-sm text-status-danger">
                    {fetchError}
                </p>
            )}

            <div className="mb-4 flex items-center gap-2">
                <input
                    type="text"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Cari item code, nama part, atau spesifikasi..."
                    className="w-full max-w-md flex-1 rounded-md border border-ink/20 bg-surface px-3 py-2 font-sans text-sm text-ink placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
                />

                <div className="relative shrink-0">
                    <button
                        type="button"
                        onClick={() => setIsFilterOpen((open) => !open)}
                        aria-expanded={isFilterOpen}
                        aria-haspopup="dialog"
                        className="relative flex items-center gap-1.5 rounded-md border border-ink/20 bg-surface px-3 py-2 font-sans text-sm text-ink hover:bg-app-bg"
                    >
                        <Filter className="h-4 w-4" />
                        Filter
                        {activeFilterCount > 0 && (
                            <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary font-sans text-[10px] font-semibold text-white">
                                {activeFilterCount}
                            </span>
                        )}
                    </button>

                    <FilterPopup
                        isOpen={isFilterOpen}
                        onClose={() => setIsFilterOpen(false)}
                        appliedFilters={appliedFilters}
                        onApply={setAppliedFilters}
                        kategoriOptions={filterKategoriOptions}
                        satuanOptions={filterSatuanOptions}
                        lokasiRakOptions={filterLokasiRakOptions}
                    />
                </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-ink/20">
                {/*
                    table-fixed + colgroup: kolom punya lebar tetap, konten yang
                    terlalu panjang terpotong (ellipsis) tanpa melebarkan kolom.
                    Lebar tabel dihitung dinamis dari jumlah visibleLines supaya
                    tidak ada kolom yang hilang atau kekecilan saat filter Line aktif.
                */}
                <table
                    className="w-full border-separate border-spacing-0 text-sm [table-layout:fixed]"
                    style={{ minWidth: tableWidth }}
                >
                    <colgroup>
                        <col style={{ width: ITEM_CODE_WIDTH }} />
                        <col style={{ width: PART_WIDTH }} />
                        <col style={{ width: KATEGORI_WIDTH }} />
                        <col style={{ width: SPEK_WIDTH }} />
                        <col style={{ width: SATUAN_WIDTH }} />
                        <col style={{ width: LOKASI_RAK_WIDTH }} />
                        {visibleLines.map((line) => (
                            <Fragment key={line.key}>
                                <col style={{ width: STOK_COL_WIDTH }} />
                                <col style={{ width: OPNAME_COL_WIDTH }} />
                                <col style={{ width: MIN_COL_WIDTH }} />
                            </Fragment>
                        ))}
                        <col style={{ width: STATUS_WIDTH }} />
                        <col style={{ width: KETERANGAN_WIDTH }} />
                    </colgroup>

                    <thead>
                        <tr>
                            {/* Item Code: sticky, kolom pertama */}
                            <th
                                rowSpan={3}
                                className={`${thBase} sticky left-0 z-10 text-center`}
                            >
                                Item Code
                            </th>
                            {/* Part: sticky, kolom kedua, nempel persis di kanan Item Code */}
                            <th
                                rowSpan={3}
                                style={{ left: ITEM_CODE_WIDTH }}
                                className={`${thBase} sticky z-10 text-center`}
                            >
                                Part
                            </th>
                            <th rowSpan={3} className={`${thBase} text-left`}>
                                Kategori
                            </th>
                            <th rowSpan={3} className={`${thBase} text-left`}>
                                Spek
                            </th>
                            <th rowSpan={3} className={`${thBase} text-left`}>
                                Satuan
                            </th>
                            <th rowSpan={3} className={`${thBase} text-left`}>
                                Lokasi Rak
                            </th>
                            <th
                                colSpan={visibleLines.length * 3}
                                className={`${thBase} text-center`}
                            >
                                Stok
                            </th>
                            <th rowSpan={3} className={`${thBase} text-center`}>
                                Status
                            </th>
                            <th rowSpan={3} className={`${thBase} text-left`}>
                                Keterangan
                            </th>
                        </tr>
                        <tr>
                            {visibleLines.map((line) => (
                                <th key={line.key} colSpan={3} className={`${thBase} text-center`}>
                                    {line.label}
                                </th>
                            ))}
                        </tr>
                        <tr>
                            {visibleLines.map((line) => (
                                <Fragment key={line.key}>
                                    <th className={`${thBase} text-right`}>Stok</th>
                                    <th className={`${thBase} text-center`}>Opname</th>
                                    <th className={`${thBase} text-right`}>Min</th>
                                </Fragment>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {filteredData.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={totalColumns}
                                    className="border border-ink/20 px-4 py-10 text-center font-sans text-muted"
                                >
                                    {emptyMessage}
                                </td>
                            </tr>
                        ) : (
                            filteredData.map((sparepart, idx) => {
                                const status = computeSparepartStatus(sparepart.lineStocks);
                                // Zebra stripe: baris genap = app-bg, baris ganjil = surface.
                                const rowBg = idx % 2 === 0 ? "bg-app-bg" : "bg-surface";

                                // ID sel edit — format konsisten supaya mudah dibandingkan.
                                const namaPartCellId = `namaPart:${sparepart.id}`;
                                const spesifikasiCellId = `spesifikasi:${sparepart.id}`;
                                const keteranganCellId = `keterangan:${sparepart.id}`;
                                const kategoriCellId = `kategori:${sparepart.id}`;
                                const satuanCellId = `satuan:${sparepart.id}`;
                                const lokasiRakCellId = `lokasiRak:${sparepart.id}`;

                                const isEditingRow = editingCellId?.includes(`:${sparepart.id}`);
                                const stickyZIndex = isEditingRow ? "z-40" : "z-10";

                                return (
                                    <tr key={sparepart.id} className={rowBg}>
                                        {/* Item Code: sticky + font-mono + bg eksplisit
                                            supaya tidak transparan saat scroll horizontal.
                                            TIDAK bisa diedit inline (di luar scope). */}
                                        <td
                                            className={`${tdBase} ${rowBg} sticky left-0 ${stickyZIndex} overflow-hidden text-center font-mono`}
                                        >
                                            <span className="block truncate">{sparepart.itemCode}</span>
                                        </td>

                                        {/* Part (namaPart): sticky, BISA diedit inline.
                                            td punya `relative` sebagai anchor floating panel. */}
                                        <td
                                            style={{ left: ITEM_CODE_WIDTH }}
                                            className={`${tdBase} ${rowBg} relative sticky ${stickyZIndex} text-center`}
                                        >
                                            {editingCellId === namaPartCellId ? (
                                                <>
                                                    {/* Placeholder invisible supaya baris tidak collapse */}
                                                    <span className="invisible select-none" aria-hidden>
                                                        {sparepart.namaPart || "·"}
                                                    </span>
                                                    <InlineEditShell
                                                        initialValue={sparepart.namaPart}
                                                        onClose={() => setEditingCellId(null)}
                                                        onSubmit={(value) =>
                                                            submitTextField(sparepart.id, "namaPart", value)
                                                        }
                                                    />
                                                </>
                                            ) : (
                                                <EditTrigger
                                                    align="center"
                                                    onClick={() => setEditingCellId(namaPartCellId)}
                                                >
                                                    {sparepart.namaPart}
                                                </EditTrigger>
                                            )}
                                        </td>

                                        {/* Kategori: BISA diedit inline (dropdown). */}
                                        <td className={`${tdBase} relative`}>
                                            {editingCellId === kategoriCellId ? (
                                                <>
                                                    <span className="invisible select-none" aria-hidden>
                                                        {sparepart.kategori.nama || "·"}
                                                    </span>
                                                    <InlineSelectShell
                                                        initialValue={sparepart.kategoriId}
                                                        options={selectKategoriOptions}
                                                        onClose={() => setEditingCellId(null)}
                                                        onSubmit={(value) =>
                                                            submitRelationField(sparepart.id, "kategoriId", value)
                                                        }
                                                    />
                                                </>
                                            ) : (
                                                <EditTrigger
                                                    onClick={() => setEditingCellId(kategoriCellId)}
                                                >
                                                    {sparepart.kategori.nama}
                                                </EditTrigger>
                                            )}
                                        </td>

                                        {/* Spek (spesifikasi): BISA diedit inline.
                                            Pakai textarea supaya teks panjang nyaman diedit. */}
                                        <td className={`${tdBase} relative`}>
                                            {editingCellId === spesifikasiCellId ? (
                                                <>
                                                    <span className="invisible select-none" aria-hidden>
                                                        {sparepart.spesifikasi || "·"}
                                                    </span>
                                                    <InlineEditShell
                                                        initialValue={sparepart.spesifikasi ?? ""}
                                                        useTextarea
                                                        placeholder="Ketik spesifikasi… (Ctrl+Enter untuk simpan)"
                                                        onClose={() => setEditingCellId(null)}
                                                        onSubmit={(value) =>
                                                            submitTextField(sparepart.id, "spesifikasi", value)
                                                        }
                                                    />
                                                </>
                                            ) : (
                                                <EditTrigger
                                                    onClick={() => setEditingCellId(spesifikasiCellId)}
                                                >
                                                    {sparepart.spesifikasi ?? "-"}
                                                </EditTrigger>
                                            )}
                                        </td>

                                        {/* Satuan: BISA diedit inline (dropdown). */}
                                        <td className={`${tdBase} relative`}>
                                            {editingCellId === satuanCellId ? (
                                                <>
                                                    <span className="invisible select-none" aria-hidden>
                                                        {sparepart.satuan.nama || "·"}
                                                    </span>
                                                    <InlineSelectShell
                                                        initialValue={sparepart.satuanId}
                                                        options={selectSatuanOptions}
                                                        onClose={() => setEditingCellId(null)}
                                                        onSubmit={(value) =>
                                                            submitRelationField(sparepart.id, "satuanId", value)
                                                        }
                                                    />
                                                </>
                                            ) : (
                                                <EditTrigger
                                                    onClick={() => setEditingCellId(satuanCellId)}
                                                >
                                                    {sparepart.satuan.nama}
                                                </EditTrigger>
                                            )}
                                        </td>

                                        {/* Lokasi Rak: BISA diedit inline (dropdown, nullable). */}
                                        <td className={`${tdBase} relative`}>
                                            {editingCellId === lokasiRakCellId ? (
                                                <>
                                                    <span className="invisible select-none" aria-hidden>
                                                        {sparepart.lokasiRak?.nama ?? "-"}
                                                    </span>
                                                    <InlineSelectShell
                                                        initialValue={sparepart.lokasiRakId ?? null}
                                                        options={selectLokasiRakOptions}
                                                        onClose={() => setEditingCellId(null)}
                                                        onSubmit={(value) =>
                                                            submitRelationField(sparepart.id, "lokasiRakId", value)
                                                        }
                                                    />
                                                </>
                                            ) : (
                                                <EditTrigger
                                                    onClick={() => setEditingCellId(lokasiRakCellId)}
                                                >
                                                    {sparepart.lokasiRak?.nama ?? "-"}
                                                </EditTrigger>
                                            )}
                                        </td>

                                        {visibleLines.map((line) => {
                                            const lineStock = sparepart.lineStocks.find(
                                                (ls) => ls.line === line.key
                                            );
                                            const stokCellId = `stok:${sparepart.id}:${line.key}`;
                                            const minCellId = `min:${sparepart.id}:${line.key}`;

                                            return (
                                                <Fragment key={line.key}>
                                                    {/* Stok: BISA diedit inline — input diisi nilai stok saat ini,
                                                        delta ke server dihitung otomatis saat Simpan (lihat
                                                        InlineStockEditShell). */}
                                                    <td className={`${tdBase} relative text-right`}>
                                                        {editingCellId === stokCellId ? (
                                                            <>
                                                                <span className="invisible select-none" aria-hidden>
                                                                    {lineStock ? lineStock.jumlah : "-"}
                                                                </span>
                                                                <InlineStockEditShell
                                                                    currentValue={lineStock ? lineStock.jumlah : 0}
                                                                    onClose={() => setEditingCellId(null)}
                                                                    onSubmit={(delta, keterangan) =>
                                                                        submitStokField(sparepart.id, line.key, delta, keterangan)
                                                                    }
                                                                />
                                                            </>
                                                        ) : (
                                                            <EditTrigger
                                                                align="right"
                                                                onClick={() => setEditingCellId(stokCellId)}
                                                            >
                                                                {lineStock ? lineStock.jumlah : "-"}
                                                            </EditTrigger>
                                                        )}
                                                    </td>
                                                    {/* Opname: TIDAK bisa diedit manual (otomatis dari sistem). */}
                                                    <td className={`${tdBase} overflow-hidden text-center`}>
                                                        <span className="block truncate">
                                                            {lineStock
                                                                ? formatTanggalOpname(lineStock.lastOpnameDate)
                                                                : "-"}
                                                        </span>
                                                    </td>
                                                    {/* Min: BISA diedit inline. */}
                                                    <td className={`${tdBase} relative text-right`}>
                                                        {editingCellId === minCellId ? (
                                                            <>
                                                                <span className="invisible select-none" aria-hidden>
                                                                    {lineStock ? lineStock.minStok : "-"}
                                                                </span>
                                                                <InlineEditShell
                                                                    initialValue={String(
                                                                        lineStock ? lineStock.minStok : 0
                                                                    )}
                                                                    inputType="number"
                                                                    onClose={() => setEditingCellId(null)}
                                                                    onSubmit={(value) =>
                                                                        submitMinField(sparepart.id, line.key, value)
                                                                    }
                                                                />
                                                            </>
                                                        ) : (
                                                            <EditTrigger
                                                                align="right"
                                                                onClick={() => setEditingCellId(minCellId)}
                                                            >
                                                                {lineStock ? lineStock.minStok : "-"}
                                                            </EditTrigger>
                                                        )}
                                                    </td>
                                                </Fragment>
                                            );
                                        })}

                                        {/* Status: TIDAK bisa diedit inline (dihitung otomatis). */}
                                        <td className={`${tdBase} text-center`}>
                                            <StatusBadge status={status} />
                                        </td>

                                        {/* Keterangan: BISA diedit inline. */}
                                        <td className={`${tdBase} relative`}>
                                            {editingCellId === keteranganCellId ? (
                                                <>
                                                    <span className="invisible select-none" aria-hidden>
                                                        {sparepart.keterangan ?? "-"}
                                                    </span>
                                                    <InlineEditShell
                                                        initialValue={sparepart.keterangan ?? ""}
                                                        onClose={() => setEditingCellId(null)}
                                                        onSubmit={(value) =>
                                                            submitTextField(sparepart.id, "keterangan", value)
                                                        }
                                                    />
                                                </>
                                            ) : (
                                                <EditTrigger
                                                    onClick={() => setEditingCellId(keteranganCellId)}
                                                >
                                                    {sparepart.keterangan ?? "-"}
                                                </EditTrigger>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}