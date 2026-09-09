"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { Filter, Check, X, Loader2 } from "lucide-react";
import { updateSparepartField, type getSparepartList } from "@/lib/actions/sparepart";
import { recordStockMovement, updateLineMinStok } from "@/lib/actions/stock-movement";
import type { Line } from "@/generated/prisma/client";
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
};

// Lebar eksplisit untuk 2 kolom sticky, dipakai juga untuk menghitung
// offset `left` kolom kedua supaya persis menempel di kolom pertama.
const ITEM_CODE_WIDTH = 150;
const PART_WIDTH = 220;

function formatTanggalOpname(date: Date | null): string {
    if (!date) return "-";
    const d = new Date(date);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yy = String(d.getFullYear()).slice(-2);
    return `${dd}/${mm}/${yy}`;
}

// Ambil nilai unik & non-kosong dari suatu daftar field, diurutkan alfabet.
// Dipakai untuk mengisi opsi checkbox Kategori/Satuan/Lokasi Rak di popup
// filter secara DINAMIS dari data, bukan hardcode.
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

// Tombol transparan pembungkus tampilan normal sel yang bisa diedit —
// cuma penanda visual (hover + tooltip) + pemicu masuk mode edit.
function EditTrigger({ children, align = "left", onClick }: EditTriggerProps) {
    const alignClass =
        align === "center" ? "text-center" : align === "right" ? "text-right" : "text-left";
    return (
        <button
            type="button"
            onClick={onClick}
            title="Klik untuk edit"
            className={`-mx-1 -my-0.5 block w-full rounded px-1 py-0.5 ${alignClass} hover:bg-ink/5 focus:outline-none focus:ring-1 focus:ring-primary/30`}
        >
            {children}
        </button>
    );
}

type InlineEditShellProps = {
    initialValue: string;
    inputType?: "text" | "number";
    /** Label kecil di atas input, mis. "Selisih (+/-)" untuk koreksi stok. */
    label?: string;
    placeholder?: string;
    /** Dipanggil saat Batal, Escape, blur ke luar sel, ATAU setelah Simpan sukses. */
    onClose: () => void;
    onSubmit: (value: string) => Promise<InlineEditSubmitResult>;
};

// Shell umum untuk semua mode edit inline: input di dalam sel + tombol
// Simpan (check hijau)/Batal (X abu-abu) menempel di kanan input, Enter =
// simpan, Escape = batal, klik di luar (blur) = batal, error tampil kecil
// di bawah input tanpa menutup mode edit.
function InlineEditShell({
    initialValue,
    inputType = "text",
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
            // "cancelled" — mis. window.prompt() alasan koreksi dibatalkan/
            // dikosongkan. Diam-diam batal, sel tetap dalam mode edit,
            // tidak ada pesan error.
            setIsSaving(false);
        }
    }

    return (
        <div
            className="relative flex w-full items-center gap-1"
            onBlur={(event) => {
                const next = event.relatedTarget;
                if (!(next instanceof Node) || !event.currentTarget.contains(next)) {
                    onClose();
                }
            }}
        >
            <div className="flex w-full min-w-0 flex-col">
                {label && (
                    <span className="mb-0.5 font-sans text-[10px] leading-none text-muted">
                        {label}
                    </span>
                )}
                <input
                    type={inputType}
                    autoFocus
                    value={draft}
                    placeholder={placeholder}
                    disabled={isSaving}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Enter") {
                            event.preventDefault();
                            handleSave();
                        } else if (event.key === "Escape") {
                            event.preventDefault();
                            onClose();
                        }
                    }}
                    className="w-full min-w-0 rounded border border-ink/20 bg-app-bg px-1.5 py-0.5 font-sans text-sm text-ink focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:opacity-60"
                />
            </div>

            <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                aria-label="Simpan"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-status-safe hover:bg-status-safe/10 disabled:opacity-60"
            >
                {isSaving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                    <Check className="h-3.5 w-3.5" />
                )}
            </button>
            <button
                type="button"
                onClick={onClose}
                disabled={isSaving}
                aria-label="Batal"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted hover:bg-ink/5 disabled:opacity-60"
            >
                <X className="h-3.5 w-3.5" />
            </button>

            {error && (
                <span className="absolute left-0 top-full z-20 mt-0.5 whitespace-nowrap font-sans text-[11px] text-status-danger">
                    {error}
                </span>
            )}
        </div>
    );
}

export function SparepartGrid({ initialData, fetchError }: SparepartGridProps) {
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

    // Opsi checkbox Kategori/Satuan/Lokasi Rak diturunkan dinamis dari
    // data, jadi otomatis ikut bertambah kalau ada kategori/satuan/
    // lokasi rak baru tanpa perlu ubah kode di sini.
    const kategoriOptions = useMemo(
        () => uniqueSorted(data.map((s) => s.kategori.nama)),
        [data]
    );
    const satuanOptions = useMemo(
        () => uniqueSorted(data.map((s) => s.satuan.nama)),
        [data]
    );
    const lokasiRakOptions = useMemo(
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

    function mergeSparepartTextField(
        sparepartId: string,
        field: "namaPart" | "spesifikasi" | "keterangan",
        value: string | null
    ) {
        setData((prev) =>
            prev.map((sp) => {
                if (sp.id !== sparepartId) return sp;
                if (field === "namaPart") return { ...sp, namaPart: value ?? "" };
                if (field === "spesifikasi") return { ...sp, spesifikasi: value };
                return { ...sp, keterangan: value };
            })
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
    //     InlineEditShell, hasilnya menentukan shell tetap terbuka
    //     (error/cancelled) atau tertutup (success). ---

    async function submitTextField(
        sparepartId: string,
        field: "namaPart" | "spesifikasi" | "keterangan",
        value: string
    ): Promise<InlineEditSubmitResult> {
        const result = await updateSparepartField(sparepartId, field, value);
        if (!result.success) {
            return { status: "error", message: result.message };
        }
        mergeSparepartTextField(sparepartId, field, result.data[field]);
        return { status: "success" };
    }

    async function submitStokField(
        sparepartId: string,
        line: Line,
        value: string
    ): Promise<InlineEditSubmitResult> {
        const trimmed = value.trim();
        const delta = Number(trimmed);
        if (trimmed === "" || Number.isNaN(delta)) {
            return { status: "error", message: "Masukkan angka selisih yang valid" };
        }

        // KOREKSI wajib ada keterangan — minta alasan lewat prompt sederhana
        // SETELAH validasi angka, SEBELUM benar-benar submit ke server.
        const alasan = window.prompt("Alasan koreksi stok (wajib diisi):");
        if (alasan === null) {
            return { status: "cancelled" };
        }
        const alasanTrimmed = alasan.trim();
        if (!alasanTrimmed) {
            return { status: "cancelled" };
        }

        const result = await recordStockMovement({
            sparepartId,
            line,
            tipe: "KOREKSI",
            jumlah: delta,
            keterangan: alasanTrimmed,
        });

        if (!result.success) {
            return { status: "error", message: result.message };
        }

        mergeLineStock(sparepartId, result.data.lineStock, result.data.newTotalStok);
        return { status: "success" };
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
                        kategoriOptions={kategoriOptions}
                        satuanOptions={satuanOptions}
                        lokasiRakOptions={lokasiRakOptions}
                    />
                </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-ink/20">
                <table className="w-full min-w-[1400px] border-separate border-spacing-0 text-sm">
                    <thead>
                        <tr>
                            {/* Item Code: sticky, kolom pertama */}
                            <th
                                rowSpan={3}
                                style={{ width: ITEM_CODE_WIDTH, minWidth: ITEM_CODE_WIDTH }}
                                className={`${thBase} sticky left-0 z-10 text-center`}
                            >
                                Item Code
                            </th>
                            {/* Part: sticky, kolom kedua, nempel persis di kanan Item Code */}
                            <th
                                rowSpan={3}
                                style={{
                                    width: PART_WIDTH,
                                    minWidth: PART_WIDTH,
                                    left: ITEM_CODE_WIDTH,
                                }}
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

                                const namaPartCellId = `namaPart:${sparepart.id}`;
                                const spesifikasiCellId = `spesifikasi:${sparepart.id}`;
                                const keteranganCellId = `keterangan:${sparepart.id}`;

                                return (
                                    <tr key={sparepart.id} className={rowBg}>
                                        {/* Item Code: sticky + font-mono + bg eksplisit
                                            supaya tidak transparan saat scroll horizontal.
                                            TIDAK bisa diedit inline (di luar scope). */}
                                        <td
                                            style={{ width: ITEM_CODE_WIDTH, minWidth: ITEM_CODE_WIDTH }}
                                            className={`${tdBase} ${rowBg} sticky left-0 z-10 text-center font-mono`}
                                        >
                                            {sparepart.itemCode}
                                        </td>
                                        {/* Part (namaPart): sticky, bg eksplisit sama seperti
                                            Item Code, BISA diedit inline. */}
                                        <td
                                            style={{
                                                width: PART_WIDTH,
                                                minWidth: PART_WIDTH,
                                                left: ITEM_CODE_WIDTH,
                                            }}
                                            className={`${tdBase} ${rowBg} sticky z-10 text-center`}
                                        >
                                            {editingCellId === namaPartCellId ? (
                                                <InlineEditShell
                                                    initialValue={sparepart.namaPart}
                                                    onClose={() => setEditingCellId(null)}
                                                    onSubmit={(value) =>
                                                        submitTextField(sparepart.id, "namaPart", value)
                                                    }
                                                />
                                            ) : (
                                                <EditTrigger
                                                    align="center"
                                                    onClick={() => setEditingCellId(namaPartCellId)}
                                                >
                                                    {sparepart.namaPart}
                                                </EditTrigger>
                                            )}
                                        </td>
                                        {/* Kategori: TIDAK bisa diedit inline (di luar scope). */}
                                        <td className={tdBase}>{sparepart.kategori.nama}</td>
                                        {/* Spek (spesifikasi): BISA diedit inline. */}
                                        <td className={tdBase}>
                                            {editingCellId === spesifikasiCellId ? (
                                                <InlineEditShell
                                                    initialValue={sparepart.spesifikasi ?? ""}
                                                    onClose={() => setEditingCellId(null)}
                                                    onSubmit={(value) =>
                                                        submitTextField(sparepart.id, "spesifikasi", value)
                                                    }
                                                />
                                            ) : (
                                                <EditTrigger
                                                    onClick={() => setEditingCellId(spesifikasiCellId)}
                                                >
                                                    {sparepart.spesifikasi ?? "-"}
                                                </EditTrigger>
                                            )}
                                        </td>
                                        {/* Satuan & Lokasi Rak: TIDAK bisa diedit inline (di luar scope). */}
                                        <td className={tdBase}>{sparepart.satuan.nama}</td>
                                        <td className={tdBase}>{sparepart.lokasiRak?.nama ?? "-"}</td>
                                        {visibleLines.map((line) => {
                                            const lineStock = sparepart.lineStocks.find(
                                                (ls) => ls.line === line.key
                                            );
                                            const stokCellId = `stok:${sparepart.id}:${line.key}`;
                                            const minCellId = `min:${sparepart.id}:${line.key}`;

                                            return (
                                                <Fragment key={line.key}>
                                                    {/* Stok: BISA diedit inline (delta koreksi). */}
                                                    <td className={`${tdBase} text-right`}>
                                                        {editingCellId === stokCellId ? (
                                                            <InlineEditShell
                                                                initialValue=""
                                                                inputType="number"
                                                                label="Selisih (+/-)"
                                                                placeholder="mis. -3"
                                                                onClose={() => setEditingCellId(null)}
                                                                onSubmit={(value) =>
                                                                    submitStokField(sparepart.id, line.key, value)
                                                                }
                                                            />
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
                                                    <td className={`${tdBase} text-center`}>
                                                        {lineStock
                                                            ? formatTanggalOpname(lineStock.lastOpnameDate)
                                                            : "-"}
                                                    </td>
                                                    {/* Min: BISA diedit inline. */}
                                                    <td className={`${tdBase} text-right`}>
                                                        {editingCellId === minCellId ? (
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
                                        {/* Status: TIDAK bisa diedit inline (di luar scope, dihitung otomatis). */}
                                        <td className={`${tdBase} text-center`}>
                                            <StatusBadge status={status} />
                                        </td>
                                        {/* Keterangan: BISA diedit inline. */}
                                        <td className={tdBase}>
                                            {editingCellId === keteranganCellId ? (
                                                <InlineEditShell
                                                    initialValue={sparepart.keterangan ?? ""}
                                                    onClose={() => setEditingCellId(null)}
                                                    onSubmit={(value) =>
                                                        submitTextField(sparepart.id, "keterangan", value)
                                                    }
                                                />
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