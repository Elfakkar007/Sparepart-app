"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
    Filter,
    Eye,
    Check,
    X,
    Loader2,
    Trash2,
    Plus,
    ArrowDownToLine,
    ArrowUpFromLine,
} from "lucide-react";
// ExcelJS — dipakai untuk generate file .xlsx export SEPENUHNYA di client
// (tidak lewat Server Action), karena data yang diexport (hasil search +
// filter aktif, LINTAS SEMUA HALAMAN pagination) sudah ada di memory
// browser lewat `sortedData`. BUKAN pakai SheetJS (`xlsx`) lagi — versi
// community SheetJS tidak bisa styling sel (fill warna, border custom),
// sedangkan header export sekarang butuh cell merge 2-baris + warna per
// grup Line + border tebal antar grup, yang cuma bisa lewat ExcelJS.
// ExcelJS tidak punya helper `writeFile` otomatis seperti SheetJS, jadi
// downloadnya dipicu manual lewat Blob + <a download> di bawah.
import ExcelJS from "exceljs";
import {
    deleteSpareparts,
    updateSparepartField,
    updateSparepartRelation,
    type getSparepartList,
    type SparepartSortBy,
} from "@/lib/actions/sparepart";
import {
    recordStockMovement,
    updateLineMinStok,
    updateLineKeterangan,
} from "@/lib/actions/stock-movement";
import type { Kategori, Line, LokasiRak, Satuan } from "@/generated/prisma/client";
import { computeSparepartStatus, computeLineStatus } from "@/lib/status-helper";
import { StatusBadge } from "@/components/ui/status-badge";
import { LINES } from "./line-config";
import { ColumnVisibilityPopup, STATIC_COLUMNS } from "./column-visibility-popup";
import { SmartFormModal } from "./smart-form-modal";
import { ImportExcelModal } from "./import-excel-modal";
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
//
// Struktur kolom: Nomor, Item Code, Item, Kategori, Satuan, lalu 5
// grup kolom per Line (masing-masing 5 sub-kolom: Stok, Min, Opname,
// Status, Keterangan), lalu Total. Kolom Spek & Lokasi Rak SENGAJA
// tidak lagi punya lebar/kolom di sini — field-nya tetap ada di
// database, cuma tidak ditampilkan di grid ini.
// ==========================================================
const CHECKBOX_WIDTH = 48;   // sticky kolom-0 (checkbox select baris)
const NOMOR_WIDTH = 56;      // sticky kolom-1 — nomor urut tampilan, bukan data
const ITEM_CODE_WIDTH = 150; // sticky kolom-2
const ITEM_WIDTH = 220;      // sticky kolom-3
const KATEGORI_WIDTH = 120;
const SATUAN_WIDTH = 90;
const STOK_COL_WIDTH = 72;        // sub-kolom Stok per line
const MIN_COL_WIDTH = 65;         // sub-kolom Min per line
const OPNAME_COL_WIDTH = 88;      // sub-kolom Opname per line
const LINE_STATUS_WIDTH = 96;     // sub-kolom Status per line ("Cukup"/"Restock")
const LINE_KETERANGAN_WIDTH = 170; // sub-kolom Keterangan per line
const TOTAL_WIDTH = 90;           // kolom Total (Sparepart.stok) paling kanan

// Lebar total untuk 1 grup Line (5 sub-kolom).
const LINE_COL_WIDTH =
    STOK_COL_WIDTH + MIN_COL_WIDTH + OPNAME_COL_WIDTH + LINE_STATUS_WIDTH + LINE_KETERANGAN_WIDTH;

// Tinggi (px) baris pertama header (baris grup Line) — dipakai sebagai
// nilai `top` sticky untuk baris kedua header (Stok/Min/Opname/Status/
// Keterangan), supaya baris kedua nempel PERSIS di bawah baris pertama,
// bukan numpuk di atasnya. Dihitung dari kelas yang dipakai thBase/
// thBaseNoBg & <table className="... text-sm">: line-height text-sm
// (1.25rem = 20px) + py-2 (0.5rem atas + 0.5rem bawah = 16px) + border-b
// (1px) = 37px. Nilai ini FIXED oleh utility class, bukan hasil ukur
// font, jadi aman dipakai sebagai konstanta (tidak bergantung metrik
// font aktual) selama header tetap 1 baris teks (tidak wrap).
const HEADER_ROW_HEIGHT = 37;

// Tinggi (px) toolbar filter/search di atas tabel.
// Digunakan sebagai nilai `top` untuk baris pertama tabel.
const TOOLBAR_HEIGHT = 62;

// Posisi `left` (px) tiap kolom sticky — dihitung dari kolom-kolom
// sticky sebelumnya, supaya kalau lebar salah satu berubah, kolom
// sticky di kanannya otomatis ikut bergeser tanpa perlu diutak-atik manual.
const NOMOR_LEFT = CHECKBOX_WIDTH;
const ITEM_CODE_LEFT = CHECKBOX_WIDTH + NOMOR_WIDTH;
const ITEM_LEFT = CHECKBOX_WIDTH + NOMOR_WIDTH + ITEM_CODE_WIDTH;

// `emptyValue` dibuat parameter (bukan di-hardcode "-") supaya fungsi yang
// sama bisa dipakai baik untuk tampilan grid ("-" saat belum pernah opname)
// maupun untuk export Excel (spesifikasi minta sel kosong "", bukan "-",
// saat belum pernah opname) — tanpa duplikasi logic format tanggal.
function formatTanggalOpname(date: Date | null, emptyValue: string = "-"): string {
    if (!date) return emptyValue;
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

// Opsi dropdown "Urutkan:" di toolbar — value cocok dengan SparepartSortBy
// dari sparepart.ts supaya tetap 1 sumber kebenaran. Urutan array ini
// menentukan urutan tampil di <select>, "Terlama" ditaruh pertama karena
// itu default-nya.
const SORT_OPTIONS: { value: SparepartSortBy; label: string }[] = [
    { value: "terlama", label: "Terlama" },
    { value: "terbaru", label: "Terbaru" },
    { value: "nama_asc", label: "Nama (A-Z)" },
    { value: "nama_desc", label: "Nama (Z-A)" },
];

// Kelas dasar sel header & data. Border pakai ink dengan opacity rendah
// supaya tipis, bukan hitam pekat. Sengaja cuma border-b + border-r (bukan
// `border` di keempat sisi + border-collapse) karena border-collapse punya
// bug rendering di kolom position:sticky — garis batas kolom sticky suka
// hilang/ketutup background-nya sendiri saat di-scroll. Border-separate +
// border-b/border-r per sel jauh lebih stabil untuk tabel dengan sticky
// column; garis kiri & atas tabel sudah ditutup oleh border si wrapper.
// thBaseNoBg dipisah dari thBase supaya header grup per-Line bisa pasang
// warna tint sendiri (bg-line1/10 dst) tanpa "rebutan" specificity dengan
// bg-surface — dua utility class background dengan specificity yang sama
// menang berdasarkan urutan di stylesheet hasil build, BUKAN urutan di
// className, jadi lebih aman kalau cuma salah satu yang pernah dipasang
// per elemen.
// [will-change:transform] SENGAJA dipasang permanen (bukan cuma saat sticky
// aktif) di SEMUA sel header, termasuk yang sudah "position: sticky" (kolom
// kiri) maupun yang murni "position: static" (Kategori, Satuan, Stok/Min/
// Opname/Status/Keterangan tiap Line, Total). Ini supaya browser menyiapkan
// compositing layer-nya LEBIH AWAL (saat mount), bukan baru dipromosikan
// mendadak pas JS pertama kali pasang `transform` inline (lihat
// syncTheadPosition). Promosi layer mendadak itu penyebab paling umum
// background dengan fungsi kompleks (color-mix()) sempat gagal ke-paint
// dengan benar pada frame pertama transform diterapkan — tampak sebagai
// header "sticky tapi tembus pandang".
// `relative` SENGAJA ditambahkan permanen di sini (bukan cuma dipasang
// lewat cell.style.position saat syncTheadPosition aktif) — alasan
// PERSIS sama dengan kenapa [will-change:transform] permanen: browser
// MENGABAIKAN `z-index` pada elemen dengan `position: static` (aturan
// dasar CSS, z-index cuma berlaku untuk "positioned element"). Sebelum
// baris ini ditambahkan, cell.style.zIndex = "30" yang dipasang
// syncTheadPosition() untuk SEMUA <th> selain 4 kolom sticky-kiri
// (Checkbox/No/Item Code/Item, yang sudah punya class `sticky` = betulan
// "positioned") TIDAK PERNAH benar-benar berefek pada th Kategori/Satuan/
// grup Line/Stok/Min/Opname/Status/Keterangan — karena th-th itu masih
// `position: static` walau sudah diberi `transform: translateY(...)`.
// Akibatnya th-th tsb kalah tumpuk (stacking) melawan <tbody> yang urutan
// DOM-nya SETELAH <thead>: baris data yang lewat di baliknya jadi
// "menembus"/menimpa header (persis keluhan "kolom hancur saat sticky" —
// sebagian kelihatan transparan tertimpa rowBg tipis, sebagian malah
// hilang total tertimpa rowBg solid). `relative` (tanpa offset apa pun)
// TIDAK mengubah layout sama sekali — cuma menjadikan elemen ini
// "positioned" supaya z-index-nya dihormati, konsisten dengan pola
// `position: relative` yang sudah dipakai di <td> lain untuk floating
// edit panel (lihat komentar InlineEditShell di atas).
const thBaseNoBg =
    "relative border-b border-r border-ink/20 px-3 py-2 align-middle font-sans font-semibold text-ink [will-change:transform]";
const thBase = `${thBaseNoBg} bg-surface`;
const tdBase =
    "border-b border-r border-ink/20 px-3 py-2 font-sans font-normal text-ink";

// Variant thBaseNoBg/tdBase KHUSUS kolom Keterangan (kolom PALING KANAN
// tiap grup Line) — border kanan lebih TEBAL (border-r-2) & lebih GELAP
// (ink/30, dibanding ink/20 sel biasa) supaya batas antar grup Line (atau
// ke kolom Total) kelihatan jelas. Dipakai di 3 tempat per grup Line:
// header baris-1 (th colSpan=5, karena lebar kolomnya berhenti di titik
// yang sama persis dengan Keterangan), header baris-2 "Keterangan", dan
// td data "Keterangan" — supaya garis batasnya menyambung utuh dari atas
// sampai bawah tabel, bukan cuma tebal di satu baris lalu tipis lagi.
//
// SENGAJA jadi konstanta terpisah (bukan thBaseNoBg/tdBase + tambahan
// class border-r-2), karena border-r & border-r-2 (atau ink/20 & ink/30)
// sama-sama utility 1-class dengan specificity yang sama — dua class
// begini yang "rebutan" properti sama menang berdasarkan urutan di
// stylesheet hasil build, BUKAN urutan penulisan di className (persis
// masalah yang sama seperti komentar thBaseNoBg/thBase di atas).
// `relative` ditambahkan dengan alasan IDENTIK seperti di thBaseNoBg di
// atas — th ini dipakai untuk header grup "L1"/"L2" (colSpan=5) dan
// header "Keterangan", dua-duanya juga kena z-index dari syncTheadPosition
// tapi tanpa `relative` z-index itu diabaikan browser.
const thBaseNoBgLineGroupEnd =
    "relative border-b border-r-2 border-ink/30 px-3 py-2 align-middle font-sans font-semibold text-ink [will-change:transform]";
const tdBaseLineGroupEnd =
    "border-b border-r-2 border-ink/30 px-3 py-2 font-sans font-normal text-ink";

// Tint background header per grup kolom Line — SOLID (fully opaque),
// dihitung lewat color-mix() (10% warna line token di globals.css, 90%
// bg-surface) alih-alih modifier opacity Tailwind (bg-line1/10 dst).
//
// Alasan TIDAK pakai bg-line1/10: modifier "/10" itu menghasilkan warna
// dengan alpha channel 10% — background-nya SECARA TEKNIS "ada", tapi
// tembus pandang 90%. Karena header ini sticky (top-0), saat baris tabel
// discroll ke atas dan lewat di baliknya, 90% transparansi itu bikin
// warna & teks baris yang lewat kelihatan "menembus" sel header — persis
// keluhan "sel Line transparan saat scroll" di BUG 2. color-mix() di sini
// mencampur dua warna solid jadi SATU warna solid baru (tanpa alpha),
// jadi tint pucatnya tetap kelihatan sama tapi sekarang benar-benar
// opaque, konsisten dengan pola bg-surface/rowBg eksplisit yang sudah
// dipakai di kolom sticky Item Code/Item.
const LINE_HEADER_BG: Record<Line, string> = {
    LINE_1: "bg-[color-mix(in_oklab,var(--color-line1)_10%,var(--color-surface))]",
    LINE_2: "bg-[color-mix(in_oklab,var(--color-line2)_10%,var(--color-surface))]",
    LINE_3: "bg-[color-mix(in_oklab,var(--color-line3)_10%,var(--color-surface))]",
    LINE_4: "bg-[color-mix(in_oklab,var(--color-line4)_10%,var(--color-surface))]",
    GENERAL: "bg-[color-mix(in_oklab,var(--color-line-general)_10%,var(--color-surface))]",
};

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

        try {
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
        } catch (error) {
            // Jaring pengaman kalau onSubmit (submitTextField / submitRelationField /
            // submitMinField) melempar exception asli, bukan cuma mengembalikan
            // { status: "error" } — tanpa ini, promise yang reject lolos begitu
            // saja dan tombol Simpan macet loading permanen tanpa pesan ke user.
            // Kelas masalah yang sama seperti yang sudah ditangani di
            // submitStokField (lihat komentar di sana).
            console.error("[InlineEditShell] unexpected error saat submit:", error);
            setIsSaving(false);
            setError("Terjadi kesalahan tak terduga saat menyimpan. Coba lagi.");
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

        try {
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
        } catch (error) {
            // Jaring pengaman kalau onSubmit (submitRelationField) melempar
            // exception asli, bukan cuma mengembalikan { status: "error" } —
            // kelas masalah yang sama seperti yang sudah ditangani di
            // submitStokField (lihat komentar di sana).
            console.error("[InlineSelectShell] unexpected error saat submit:", error);
            setIsSaving(false);
            setError("Terjadi kesalahan tak terduga saat menyimpan. Coba lagi.");
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

// Modal konfirmasi hapus massal — custom (bukan window.confirm bawaan
// browser), dipakai saat tombol "Hapus" di toolbar seleksi diklik.
// Ditaruh di module scope (bukan di dalam SparepartGrid) supaya konsisten
// dengan pola shell edit inline lainnya di atas.
//
// Overlay penuh + panel di tengah (bukan floating panel anchored seperti
// FilterPopup/InlineEditShell) karena ini aksi destruktif yang butuh
// perhatian penuh user — tapi tetap pakai token visual yang sama: rounded-lg,
// border-ink/20, bg-surface, shadow-xl, ring-primary/10.
type DeleteConfirmModalProps = {
    count: number;
    isDeleting: boolean;
    error: string | null;
    onCancel: () => void;
    onConfirm: () => void;
};

function DeleteConfirmModal({
    count,
    isDeleting,
    error,
    onCancel,
    onConfirm,
}: DeleteConfirmModalProps) {
    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
            onMouseDown={(event) => {
                // Klik di backdrop (bukan di panel-nya) = batal. Diabaikan
                // kalau sedang proses hapus supaya tidak ke-cancel di
                // tengah request yang masih berjalan.
                if (event.target === event.currentTarget && !isDeleting) {
                    onCancel();
                }
            }}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="delete-confirm-title"
                className="w-full max-w-sm rounded-lg border border-ink/20 bg-surface p-4 shadow-xl ring-1 ring-primary/10"
            >
                <h2
                    id="delete-confirm-title"
                    className="font-sans text-sm font-semibold text-ink"
                >
                    Hapus {count} part?
                </h2>
                <p className="mt-1.5 font-sans text-sm text-muted">
                    Yakin ingin menghapus {count} part? Aksi ini tidak bisa dibatalkan.
                </p>

                {error && (
                    <p className="mt-3 rounded border border-status-danger/30 bg-status-danger/10 px-2.5 py-1.5 font-sans text-xs text-status-danger">
                        {error}
                    </p>
                )}

                <div className="mt-4 flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={onCancel}
                        disabled={isDeleting}
                        className="rounded px-3 py-1.5 font-sans text-sm text-muted hover:bg-ink/5 disabled:opacity-60"
                    >
                        Batal
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        disabled={isDeleting}
                        className="flex items-center gap-1.5 rounded bg-status-danger px-3 py-1.5 font-sans text-sm font-medium text-white hover:bg-status-danger/90 disabled:opacity-60"
                    >
                        {isDeleting ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                        )}
                        Hapus
                    </button>
                </div>
            </div>
        </div>
    );
}

// Catatan: prop `lokasiRakOptions` TIDAK di-destructure di sini karena
// kolom Lokasi Rak sudah tidak ditampilkan/diedit di grid ini (lihat
// TUGAS BAGIAN B). Tetap dipertahankan di SparepartGridProps di atas
// supaya page.tsx yang masih mengirim prop ini tidak perlu diubah.
export function SparepartGrid({
    initialData,
    fetchError,
    kategoriOptions,
    satuanOptions,
}: SparepartGridProps) {
    const router = useRouter();

    // Salinan lokal initialData — di-mutasi optimis setelah edit inline
    // berhasil, supaya tampilan tabel ter-update tanpa reload halaman.
    // Di-resync kalau initialData dari parent berubah (mis. setelah
    // router.refresh() di tempat lain — termasuk setelah submit smart
    // form sukses, lihat handleSmartFormSuccess di bawah).
    const [data, setData] = useState(initialData);
    useEffect(() => {
        setData(initialData);
    }, [initialData]);

    // === Sticky header via JS translateY ===
    // CSS `position: sticky` tidak bisa bekerja di arah vertikal jika
    // elemen berada di dalam container dengan `overflow-x: auto`, karena
    // browser menghitung ulang `overflow-y: clip` menjadi `hidden`
    // (CSS Overflow Level 3 spec), sehingga container menjadi scroll
    // container dan sticky hanya berlaku di DALAMNYA — bukan viewport.
    //
    // Solusi: kita pantau scroll window, hitung seberapa jauh wrapper
    // tabel sudah melewati batas atas viewport (di bawah toolbar sticky),
    // lalu terapkan `transform: translateY(offset)` ke <thead> supaya
    // secara visual nempel di bawah toolbar.
    const tableWrapperRef = useRef<HTMLDivElement>(null);
    const theadRef = useRef<HTMLTableSectionElement>(null);
    // Cache warna background tiap sel header — dihitung sekali saat
    // pertama kali memasuki mode translated, disimpan supaya tidak
    // perlu memanggil getComputedStyle (mahal) di setiap frame scroll.
    const bgCacheRef = useRef<Map<Element, string>>(new Map());
    const isTranslatedRef = useRef(false);

    // Isi ulang cache warna background utk SEMUA sel header yang ADA
    // SEKARANG di DOM. Dipanggil di luar siklus scroll (saat mount & saat
    // struktur kolom Line berubah) supaya cache tidak pernah "bolong" utk
    // sel yang baru muncul. BUG LAMA: cache cuma diisi sekali, tepat saat
    // transisi normal→translated pertama kali terjadi — kalau ADA sel
    // header yang belum ada di DOM saat itu (atau instance <th>-nya diganti
    // React karena jumlah/urutan kolom Line berubah lewat filter), sel itu
    // tidak akan pernah punya entri di cache. Efeknya: `.get(cell) || ""`
    // jatuh ke string kosong → `backgroundColor` inline dihapus total →
    // sel kelihatan "sticky tapi tembus pandang" karena baris data di
    // baliknya keliatan menembus.
    const primeBackgroundCache = useCallback(() => {
        const thead = theadRef.current;
        if (!thead) return;
        thead.querySelectorAll<HTMLTableCellElement>("th").forEach((cell) => {
            bgCacheRef.current.set(cell, getComputedStyle(cell).backgroundColor);
        });
    }, []);

    const syncTheadPosition = useCallback(() => {
        const wrapper = tableWrapperRef.current;
        const thead = theadRef.current;
        if (!wrapper || !thead) return;

        const wrapperRect = wrapper.getBoundingClientRect();
        const stickyTop = TOOLBAR_HEIGHT;

        const cells = thead.querySelectorAll<HTMLTableCellElement>("th");

        if (wrapperRect.top < stickyTop) {
            const offset = stickyTop - wrapperRect.top;
            const maxOffset = wrapper.scrollHeight - thead.offsetHeight;
            const clampedOffset = Math.min(offset, Math.max(0, maxOffset));

            // Cache computed background-color tiap sel SEKALI saat transisi
            // "normal → translated" (fast path, hindari getComputedStyle di
            // tiap frame scroll). Diperlukan karena saat sel di-transform,
            // browser membuat compositing layer baru — pada beberapa engine,
            // class-based background (bg-surface, color-mix()) bisa tidak
            // ter-paint dengan benar di layer tersebut. Dengan meng-copy
            // computed color ke inline style, background dijamin opaque.
            if (!isTranslatedRef.current) {
                primeBackgroundCache();
                isTranslatedRef.current = true;
            }

            cells.forEach((cell) => {
                cell.style.transform = `translateY(${clampedOffset}px)`;
                // BUG BARU (regresi dari fix `relative` sebelumnya): sebelum
                // ini SEMUA <th> — baik 4 kolom "pojok" (Checkbox/No/Item
                // Code/Item, sticky KIRI+ATAS) maupun header yang cuma
                // sticky ATAS (Kategori, Satuan, grup Line, Stok/Min/dst,
                // Total) — disamakan z-index-nya jadi "30". Selama header
                // non-pojok itu MASIH `position: static`, itu tidak masalah
                // (browser mengabaikan z-index-nya, pojok tetap menang
                // karena statusnya "positioned"). Begitu kita kasih
                // `relative` permanen ke header non-pojok (supaya z-index
                // dari script ini akhirnya BERLAKU dan header itu tidak lagi
                // tembus/ketiban baris tbody), efek sampingnya: header
                // non-pojok itu jadi SAMA-SAMA z-index 30 dengan header
                // pojok. Kalau z-index SAMA, urutan tumpuk ditentukan oleh
                // urutan DOM — dan karena Kategori/Satuan/grup Line ada
                // SETELAH Checkbox/No/Item Code/Item di DOM, merekalah yang
                // menang dan MENIMPA kolom pojok setiap kali digeser
                // horizontal sampai melewati posisi kolom pojok — persis
                // keluhan "kolom yang seharusnya masuk malah menimpa" saat
                // mode sticky (di mode normal tidak kelihatan karena z-index
                // dikembalikan ke "" / auto saat tidak translated, lihat
                // cabang else di bawah).
                //
                // PERBAIKAN: beri kolom pojok z-index LEBIH TINGGI (30) dari
                // header non-pojok (20) — SESUAI hierarki yang sudah
                // didokumentasikan di komentar <thead> (z-30 pojok, z-20
                // header sticky-atas-saja, z-10 sel data sticky-kiri di
                // tbody) tapi belum benar-benar diterapkan di sini. Dengan
                // nilai z-index yang BEDA, menang-kalahnya ditentukan oleh
                // ANGKA (30 > 20), bukan lagi oleh urutan DOM — jadi kolom
                // pojok konsisten selalu di atas, persis seperti perilaku
                // "masuk ke bawah" yang sudah benar di mode normal.
                // `cell.classList.contains("sticky")` dipakai sebagai
                // penanda "ini kolom pojok" karena cuma 4 <th> itu yang
                // punya class Tailwind `sticky` (position: sticky, untuk
                // stickiness KIRI) — thBase/thBaseNoBg/thBaseNoBgLineGroupEnd
                // yang dipakai header lain tidak pernah punya class ini.
                cell.style.zIndex = cell.classList.contains("sticky") ? "30" : "20";
                // PERBAIKAN: kalau cache MELESET (mis. sel ini instance baru
                // yang belum sempat ter-cache), JANGAN jatuh ke "" (yang
                // menghapus background & bikin transparan) — hitung ulang
                // on-the-spot lalu simpan, supaya sel ini tetap opaque dan
                // cache langsung terisi untuk frame berikutnya.
                let bg = bgCacheRef.current.get(cell);
                if (!bg) {
                    bg = getComputedStyle(cell).backgroundColor;
                    bgCacheRef.current.set(cell, bg);
                }
                cell.style.backgroundColor = bg;
            });
        } else if (isTranslatedRef.current) {
            // Transisi "translated → normal" — bersihkan inline styles.
            cells.forEach((cell) => {
                cell.style.transform = "";
                cell.style.zIndex = "";
                cell.style.backgroundColor = "";
            });
            isTranslatedRef.current = false;
        }
    }, [primeBackgroundCache]);

    useEffect(() => {
        window.addEventListener("scroll", syncTheadPosition, { passive: true });
        // Panggil sekali untuk set posisi awal jika halaman sudah di-scroll
        // sebelum komponen mount (mis. navigasi back).
        syncTheadPosition();
        return () => window.removeEventListener("scroll", syncTheadPosition);
    }, [syncTheadPosition]);

    // CATATAN: ada satu useEffect lagi di bawah (setelah `visibleLines`
    // didefinisikan) yang re-prime cache & re-sync tiap kali SET KOLOM
    // yang dirender berubah (tombol mata diklik, lihat hiddenColumns di
    // bawah) — sengaja tidak ditaruh di sini karena `visibleLines` belum
    // ada di scope titik ini.

    const [searchQuery, setSearchQuery] = useState("");
    const [appliedFilters, setAppliedFilters] = useState<SparepartFilters>(EMPTY_FILTERS);
    const [isFilterOpen, setIsFilterOpen] = useState(false);
    // Ref ke tombol Filter — dipakai FilterPopup (lewat anchorRef) untuk
    // menghitung posisi popup setelah di-portal ke document.body. Lihat
    // popover-portal.tsx untuk alasan kenapa popup ini tidak lagi
    // `absolute` di dalam wrapper toolbar.
    const filterButtonRef = useRef<HTMLButtonElement>(null);

    // Set identifier KOLOM yang sedang disembunyikan lewat tombol mata
    // (lihat ColumnVisibilityPopup) — TERPISAH TOTAL dari
    // appliedFilters/FilterPopup. Isinya campuran 2 jenis key: Line key
    // (mis. "LINE_1") untuk grup kolom per Line, dan StaticColumnKey
    // ("kategori" | "satuan" | "total") untuk kolom statis — lihat
    // STATIC_COLUMNS di column-visibility-popup.tsx. Kosong (Set kosong)
    // = semua kolom tampil, ini default saat pertama mount. State ini
    // HANYA dipakai untuk menentukan kolom apa yang dirender di tabel,
    // TIDAK PERNAH dipakai untuk menyaring baris di filteredData — beda
    // dari filter Line di FilterPopup (appliedFilters.line) yang MEMANG
    // menyaring baris (lihat catatan di filter-popup.tsx &
    // column-visibility-popup.tsx).
    const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
    const [isColumnVisibilityOpen, setIsColumnVisibilityOpen] = useState(false);
    // Ref ke tombol mata — sama alasannya dengan filterButtonRef di atas.
    const columnVisibilityButtonRef = useRef<HTMLButtonElement>(null);

    // Urutan tampil grid — murni state client, TIDAK memicu fetch ulang ke
    // server. Default "terlama" mengikuti default baru getSparepartList di
    // server (dipakai saat load awal); di sini cuma dipakai untuk sort
    // ULANG data yang sudah ada di memory saat user ganti pilihan.
    const [sortBy, setSortBy] = useState<SparepartSortBy>("terlama");

    // Modal "+ Tambah / Restock" (smart form) — dipasang/dilepas dari DOM
    // tiap buka/tutup (bukan cuma disembunyikan), supaya SmartFormModal
    // selalu fetch ulang data master & mulai dari state kosong tiap dibuka.
    const [isSmartFormOpen, setIsSmartFormOpen] = useState(false);

    // Modal "Import Excel" — sama seperti smart form, dipasang/dilepas
    // dari DOM tiap buka/tutup supaya ImportExcelModal selalu mulai dari
    // tahap "upload" & state kosong tiap dibuka ulang.
    const [isImportExcelOpen, setIsImportExcelOpen] = useState(false);

    // ID sel yang sedang dalam mode edit, format `${jenis}:${sparepartId}`
    // atau `${jenis}:${sparepartId}:${line}` untuk kolom per-line. Cuma
    // ada 1 nilai (bukan Set) — makanya otomatis cuma 1 sel yang bisa
    // edit dalam satu waktu: begitu sel lain diklik, nilai ini diganti
    // dan sel lama otomatis kembali ke mode tampilan biasa.
    const [editingCellId, setEditingCellId] = useState<string | null>(null);

    // ID sparepart yang tercentang lewat checkbox select di grid — dipakai
    // untuk aksi hapus massal. Set, bukan array, supaya cek "apakah id ini
    // tercentang" (dipanggil tiap render tiap baris) O(1).
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);

    // Opsi checkbox filter Kategori/Satuan — diturunkan dinamis dari data
    // yang sudah ada, bukan dari props dropdown.
    const filterKategoriOptions = useMemo(
        () => uniqueSorted(data.map((s) => s.kategori.nama)),
        [data]
    );
    const filterSatuanOptions = useMemo(
        () => uniqueSorted(data.map((s) => s.satuan.nama)),
        [data]
    );

    // Filter (search + checkbox) di-memoize supaya tidak menyaring ulang
    // seluruh array tiap kali komponen re-render karena alasan lain
    // (mis. state buka/tutup popup yang tidak berhubungan dengan data).
    //
    // Aturan gabungan: search DAN tiap kategori filter yang aktif digabung
    // dengan AND (makin banyak kondisi aktif, makin sempit hasilnya). Di
    // DALAM satu kategori filter (mis. Kategori: "Bearing" + "Belt" dicentang
    // bareng), gabungannya OR. Kalau tidak ada filter dicentang sama sekali,
    // kategori itu tidak membatasi apa-apa (lolos semua, sesuai search saja).
    //
    // CATATAN: filter Line DIKEMBALIKAN di sini (appliedFilters.line) — lihat
    // filter-popup.tsx. Ini TERPISAH TOTAL dari tombol mata (hiddenColumns)
    // yang HANYA menyembunyikan kolom dan SENGAJA tidak ikut menyaring baris
    // sama sekali.
    //
    // BUG FIX status per-Line: sebelumnya filter Status SELALU membaca
    // computeSparepartStatus() (status AGREGAT semua Line barang itu) —
    // akibatnya part yang "Cukup" di Line yang dicari tetap muncul kalau
    // dia "Restock" di Line lain manapun. Sekarang, KALAU filter Line juga
    // aktif, status yang dicocokkan adalah status SPESIFIK di Line yang
    // dicentang saja (computeLineStatus per lineStock yang match), BUKAN
    // status global. Kalau filter Line TIDAK aktif, perilakunya tetap
    // seperti sebelumnya (pakai status agregat).
    const filteredData = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        const selectedLines = appliedFilters.line;
        const isLineFilterActive = selectedLines.length > 0;

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

            if (isLineFilterActive) {
                // Barang harus punya data lineStock untuk SALAH SATU Line
                // yang dicentang — bukan sekadar "line-nya ada di daftar
                // Line", tapi harus benar-benar punya record lineStock.
                const matchingLineStocks = sparepart.lineStocks.filter((ls) =>
                    selectedLines.includes(ls.line)
                );
                if (matchingLineStocks.length === 0) return false;

                if (appliedFilters.status.length > 0) {
                    // BUG FIX: cocokkan status HANYA dari lineStock di Line
                    // yang dicentang (computeLineStatus per baris), BUKAN
                    // status agregat computeSparepartStatus.
                    const matchesStatus = matchingLineStocks.some((ls) => {
                        const lineStatus = computeLineStatus(ls.jumlah, ls.minStok);
                        return appliedFilters.status.some((selected) =>
                            matchesStatusFilter(lineStatus, selected)
                        );
                    });
                    if (!matchesStatus) return false;
                }
            } else if (appliedFilters.status.length > 0) {
                // Filter Line TIDAK aktif — perilaku lama tetap dipakai:
                // status AGREGAT semua Line barang ini.
                const status = computeSparepartStatus(sparepart.lineStocks);
                const matchesStatus = appliedFilters.status.some((selected) =>
                    matchesStatusFilter(status, selected)
                );
                if (!matchesStatus) return false;
            }

            return true;
        });
    }, [data, searchQuery, appliedFilters]);

    // Sort DI CLIENT dari filteredData (search/filter dulu, baru sort hasil
    // yang ketampil) — data lengkap sudah ada di memory (`data`), jadi
    // ganti pilihan sort tidak perlu fetch ulang ke server, langsung instan.
    // `[...filteredData]` supaya .sort() (in-place) tidak memutasi array
    // hasil useMemo filteredData.
    const sortedData = useMemo(() => {
        const arr = [...filteredData];
        switch (sortBy) {
            case "nama_asc":
                arr.sort((a, b) => a.namaPart.localeCompare(b.namaPart));
                break;
            case "nama_desc":
                arr.sort((a, b) => b.namaPart.localeCompare(a.namaPart));
                break;
            case "terbaru":
                arr.sort(
                    (a, b) =>
                        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
                );
                break;
            case "terlama":
            default:
                arr.sort(
                    (a, b) =>
                        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
                );
                break;
        }
        return arr;
    }, [filteredData, sortBy]);

    // ==========================================================
    // PAGINASI — client-side, dari sortedData (hasil filter+sort).
    // ==========================================================

    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(50);

    // Reset ke halaman 1 tiap kali search/filter/sort berubah, supaya
    // user tidak "nyasar" di halaman yang isinya sudah beda dari yang
    // terakhir dia lihat.
    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery, appliedFilters, sortBy]);

    const totalPages = Math.max(1, Math.ceil(sortedData.length / pageSize));

    // Kalau currentPage kebetulan lebih besar dari totalPages yang
    // tersedia SEKARANG (mis. setelah hapus massal mengecilkan jumlah
    // baris tanpa search/filter/sort ikut berubah), pakai halaman valid
    // terakhir untuk render & kontrol navigasi. Dihitung langsung tiap
    // render (bukan lewat effect tambahan) supaya tidak ada frame di
    // mana tabel sempat coba render halaman kosong.
    const safeCurrentPage = Math.min(currentPage, totalPages);

    const pageStartIndex = (safeCurrentPage - 1) * pageSize;
    const pagedData = useMemo(
        () => sortedData.slice(pageStartIndex, pageStartIndex + pageSize),
        [sortedData, pageStartIndex, pageSize]
    );

    // Kolom grup per-Line yang dirender di tabel — dikontrol MURNI oleh
    // tombol mata (hiddenColumns, lihat ColumnVisibilityPopup), BUKAN oleh
    // FilterPopup. Baris mana yang tampil TIDAK terpengaruh sama sekali
    // oleh state ini (lihat catatan di filteredData & di
    // column-visibility-popup.tsx) — cuma menentukan kolom mana yang
    // dirender di sini.
    const visibleLines = LINES.filter((line) => !hiddenColumns.has(line.key));

    // Sama seperti visibleLines di atas, tapi untuk 3 kolom STATIS
    // (Kategori/Satuan/Total) — masing-masing dicek terpisah supaya
    // <colgroup>/<thead>/<tbody> bisa merender/melewati elemennya
    // per-kolom (lihat LANGKAH 3 & catatan "JANGAN merusak struktur tabel"
    // di setiap situs render kolom-kolom ini).
    const showKategori = !hiddenColumns.has("kategori");
    const showSatuan = !hiddenColumns.has("satuan");
    const showTotal = !hiddenColumns.has("total");

    // Isi ulang cache warna background & re-sync posisi header tiap kali
    // SET KOLOM yang dirender berubah (tombol mata dicentang/dilepas) —
    // lihat catatan di primeBackgroundCache. Tanpa ini, kalau user ganti
    // visibilitas kolom saat header SUDAH dalam mode sticky (translated),
    // <th> yang instance-nya berubah karena kolom baru muncul/hilang
    // tidak akan punya entri cache sampai (kalau ada) transisi
    // normal→sticky berikutnya terjadi — sampai saat itu sel tsb akan
    // tembus pandang saat sticky. showKategori/showSatuan/showTotal
    // ditambahkan ke dependency array dengan alasan PERSIS sama seperti
    // visibleLines.length — toggle salah satunya juga mengubah instance
    // <th> yang ada di DOM.
    useEffect(() => {
        primeBackgroundCache();
        syncTheadPosition();
    }, [
        visibleLines.length,
        showKategori,
        showSatuan,
        showTotal,
        primeBackgroundCache,
        syncTheadPosition,
    ]);

    // Lebar total tabel — dihitung dinamis supaya scrollable container
    // tahu berapa panjang tabel sebenarnya (berubah saat kolom Line atau
    // kolom statis Kategori/Satuan/Total disembunyikan/ditampilkan lewat
    // tombol mata).
    const tableWidth =
        CHECKBOX_WIDTH +
        NOMOR_WIDTH +
        ITEM_CODE_WIDTH +
        ITEM_WIDTH +
        (showKategori ? KATEGORI_WIDTH : 0) +
        (showSatuan ? SATUAN_WIDTH : 0) +
        visibleLines.length * LINE_COL_WIDTH +
        (showTotal ? TOTAL_WIDTH : 0);

    // Checkbox + 3 kolom sticky yang SELALU tampil (Nomor, Item Code,
    // Item) + Kategori/Satuan/Total kalau tidak disembunyikan + (jumlah
    // line yang tampil x 5 sub-kolom: Stok, Min, Opname, Status,
    // Keterangan).
    const totalColumns =
        1 +
        3 +
        (showKategori ? 1 : 0) +
        (showSatuan ? 1 : 0) +
        visibleLines.length * 5 +
        (showTotal ? 1 : 0);

    // Select-all merujuk HANYA ke baris yang sedang terlihat (hasil
    // search/filter, urutan tampil ikut sortedData) — bukan ke seluruh
    // data mentah.
    const visibleIds = sortedData.map((sp) => sp.id);
    const isAllVisibleSelected =
        visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));

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

    // --- Selection (checkbox) & hapus massal ---

    function toggleSelectOne(id: string) {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }

    // Centang/lepas HANYA baris yang sedang terlihat (visibleIds) — id yang
    // sebelumnya tercentang tapi sekarang tersembunyi karena search/filter
    // dibiarkan apa adanya, tidak disentuh oleh select-all.
    function toggleSelectAllVisible() {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (isAllVisibleSelected) {
                visibleIds.forEach((id) => next.delete(id));
            } else {
                visibleIds.forEach((id) => next.add(id));
            }
            return next;
        });
    }

    function openDeleteModal() {
        setDeleteError(null);
        setIsDeleteModalOpen(true);
    }

    function closeDeleteModal() {
        if (isDeleting) return; // jangan biarkan batal di tengah proses hapus
        setIsDeleteModalOpen(false);
        setDeleteError(null);
    }

    async function handleConfirmDelete() {
        if (isDeleting) return;
        setIsDeleting(true);
        setDeleteError(null);

        try {
            const idsToDelete = Array.from(selectedIds);
            const result = await deleteSpareparts(idsToDelete);

            if (!result.success) {
                setIsDeleting(false);
                setDeleteError(result.message);
                return; // modal tetap terbuka, pesan error tampil di dalamnya
            }

            // Hapus baris-baris terkait dari state lokal tanpa reload,
            // reset seleksi, lalu tutup modal.
            const deletedIds = new Set(idsToDelete);
            setData((prev) => prev.filter((sp) => !deletedIds.has(sp.id)));
            setSelectedIds(new Set());
            setIsDeleting(false);
            setIsDeleteModalOpen(false);
        } catch (error) {
            // Jaring pengaman untuk exception tak terduga di luar
            // { success: false } — kelas masalah yang sama seperti yang
            // sudah ditangani di submitStokField (lihat komentar di sana).
            console.error("[handleConfirmDelete] unexpected error:", error);
            setIsDeleting(false);
            setDeleteError("Terjadi kesalahan tak terduga saat menghapus. Coba lagi.");
        }
    }

    // --- Smart form ("+ Tambah / Restock") ---
    //
    // Beda dengan edit inline (yang merge hasil ke state lokal secara
    // optimis), submit smart form bisa membuat Sparepart BARU sekaligus
    // baris SparepartLineStock baru — supaya bentuk data yang masuk ke
    // `data` selalu konsisten dengan shape SparepartWithRelations (include
    // kategori/satuan/lokasiRak/lineStocks lengkap), paling aman minta
    // Server Component (page.tsx) fetch ulang lewat router.refresh(),
    // bukan menyusun sendiri objek barunya di client. useEffect yang
    // mendengarkan `initialData` di atas otomatis men-sinkronkan `data`
    // begitu props baru itu masuk.
    function handleSmartFormSuccess() {
        setIsSmartFormOpen(false);
        router.refresh();
    }

    // --- Import Excel (bulk) ---
    //
    // Sama seperti smart form: modal Import Excel sendiri tidak tahu
    // apa-apa soal grid, cuma panggil onSuccess setelah user menekan
    // "Tutup" di tahap hasil (bukan langsung setelah importSparepartExcel
    // selesai, supaya user sempat baca ringkasan sukses/gagalnya dulu).
    // router.refresh() di sini sudah cukup untuk menampilkan SEMUA baris
    // yang berhasil diimpor — tidak perlu menyusun sendiri baris mana
    // yang baru/berubah di client.
    function handleImportExcelSuccess() {
        setIsImportExcelOpen(false);
        router.refresh();
    }

    // --- Export Excel ---
    //
    // REVISI: export ikuti FILTER (search + checkbox aktif), BUKAN toggle
    // visibility (hiddenColumns/tombol mata) — 2 hal ini sengaja terpisah:
    //   - Baris  : diambil dari `sortedData`, yaitu HASIL AKHIR
    //              search + filter + sort, LINTAS SEMUA HALAMAN pagination
    //              (bukan `pagedData` yang cuma 1 halaman aktif).
    //   - Kolom  : SELALU LENGKAP, pakai `LINES` (5 Line tetap, dari
    //              line-config.ts) — BUKAN `visibleLines` (yang sudah
    //              disaring hiddenColumns). Status toggle mata di layar
    //              tidak mempengaruhi kolom apa yang ikut ter-export.
    //
    // Dibangun sebagai array-of-arrays (AOA) lewat `XLSX.utils.aoa_to_sheet`
    // (bukan `json_to_sheet` dari array objek) supaya urutan kolom 100%
    // eksplisit sesuai header yang ditulis manual, dan tetap menghasilkan
    // sheet dengan baris header yang benar walau `sortedData` sedang kosong
    // (hasil search/filter tidak match apa pun).
    async function handleExport() {
        // === 1. Susun model kolom ===
        //
        // Export dibagi 3 "segmen" kolom, kiri ke kanan:
        //   - leadingCols  : No, Item Code, Item, [Kategori], [Satuan] —
        //                    masing-masing 1 kolom, merge VERTIKAL row 1-2.
        //   - lineGroups   : 1 entri per Line, masing-masing 5 sub-kolom
        //                    (Stok/Min/Opname/Status/Keterangan).
        //   - trailingCols : [Total] — merge vertikal row 1-2 juga.
        //
        // Grup kolom Line yang di-export HARUS mengikuti toggle mata,
        // persis seperti showKategori/showSatuan/showTotal di atas —
        // makanya sumbernya `visibleLines` (sudah difilter dari
        // `hiddenColumns` di baris ~1183), BUKAN `LINES` mentah dari
        // line-config.ts. `lineGroupRanges`, border grup (groupSeparatorCols),
        // header row 1/2, isi baris data, dan auto-width kolom di bawah
        // semuanya diturunkan dari `lineGroups` ini, jadi satu baris ini
        // adalah satu-satunya sumber kebenaran untuk "line mana yang
        // ikut export" — jangan balikin ke `LINES` lagi.
        type LeadingCol = {
            key: "no" | "itemCode" | "item" | "kategori" | "satuan";
            label: string;
            widthPx: number;
            align: "left" | "center" | "right";
        };
        type TrailingCol = {
            key: "total";
            label: string;
            widthPx: number;
            align: "left" | "center" | "right";
        };

        const leadingCols: LeadingCol[] = [
            { key: "no", label: "No", widthPx: NOMOR_WIDTH, align: "center" },
            { key: "itemCode", label: "Item Code", widthPx: ITEM_CODE_WIDTH, align: "left" },
            { key: "item", label: "Item", widthPx: ITEM_WIDTH, align: "left" },
        ];
        if (showKategori) {
            leadingCols.push({ key: "kategori", label: "Kategori", widthPx: KATEGORI_WIDTH, align: "left" });
        }
        if (showSatuan) {
            leadingCols.push({ key: "satuan", label: "Satuan", widthPx: SATUAN_WIDTH, align: "left" });
        }

        const lineGroups = visibleLines;

        const trailingCols: TrailingCol[] = [];
        if (showTotal) {
            trailingCols.push({ key: "total", label: "Total", widthPx: TOTAL_WIDTH, align: "right" });
        }

        // Sub-kolom yang berulang di tiap grup Line, dengan lebar & alignment
        // masing-masing (dipakai untuk row header ke-2 & untuk isi data).
        const SUB_COLS: { key: "stok" | "min" | "opname" | "status" | "keterangan"; label: string; widthPx: number; align: "left" | "center" | "right" }[] = [
            { key: "stok", label: "Stok", widthPx: STOK_COL_WIDTH, align: "right" },
            { key: "min", label: "Min", widthPx: MIN_COL_WIDTH, align: "right" },
            { key: "opname", label: "Opname", widthPx: OPNAME_COL_WIDTH, align: "center" },
            { key: "status", label: "Status", widthPx: LINE_STATUS_WIDTH, align: "center" },
            { key: "keterangan", label: "Keterangan", widthPx: LINE_KETERANGAN_WIDTH, align: "left" },
        ];

        // Konversi lebar px (dipakai <colgroup> di web) ke satuan lebar
        // kolom ExcelJS (kira-kira lebar 1 karakter "0" di font default,
        // ±7px) — supaya proporsi lebar kolom export mirip tabel di web.
        const pxToExcelWidth = (px: number) => Math.max(8, Math.round(px / 7));

        // === 2. Warna tint per grup Line (row 1 = shade lebih gelap,
        //     row 2 = shade lebih terang) — urutan biru/ungu/pink/indigo/abu
        //     mengikuti urutan LINE_1..LINE_4/GENERAL di line-config.ts. ===
        const LINE_GROUP_COLORS: Record<Line, { header: string; sub: string }> = {
            LINE_1: { header: "FFDBEAFE", sub: "FFEFF6FF" }, // biru
            LINE_2: { header: "FFE9D5FF", sub: "FFF5F0FF" }, // ungu
            LINE_3: { header: "FFFCE7F3", sub: "FFFDF2F8" }, // pink
            LINE_4: { header: "FFE0E7FF", sub: "FFEEF2FF" }, // indigo
            GENERAL: { header: "FFE5E7EB", sub: "FFF3F4F6" }, // abu-abu
        };

        // Warna badge Status per baris data — hijau utk "Cukup", merah utk
        // "Kurang", supaya konsisten dengan StatusBadge yang tampil di grid.
        const STATUS_COLORS: Record<"Cukup" | "Kurang", { fill: string; font: string }> = {
            Cukup: { fill: "FFDCFCE7", font: "FF166534" },
            Kurang: { fill: "FFFEE2E2", font: "FF991B1B" },
        };

        const BORDER_COLOR = "FF9CA3AF"; // abu netral, dipakai border tipis & tebal
        const THIN_BORDER: Partial<ExcelJS.Border> = { style: "thin", color: { argb: BORDER_COLOR } };
        const MEDIUM_BORDER: Partial<ExcelJS.Border> = { style: "medium", color: { argb: BORDER_COLOR } };

        // === 3. Hitung index kolom (1-based, sesuai konvensi ExcelJS) ===
        //
        // colCursor berjalan dari kiri ke kanan; groupSeparatorCols menandai
        // kolom PALING KANAN tiap grup Line (sub-kolom Keterangan) supaya
        // border kanannya dibuat "medium", bukan "thin" — dipakai di SEMUA
        // baris (header row 1, row 2, dan setiap baris data).
        let colCursor = 1;
        const leadingColStart = colCursor;
        colCursor += leadingCols.length;

        const lineGroupRanges: { line: (typeof lineGroups)[number]; start: number; end: number }[] = [];
        for (const line of lineGroups) {
            const start = colCursor;
            const end = start + SUB_COLS.length - 1;
            lineGroupRanges.push({ line, start, end });
            colCursor = end + 1;
        }

        const trailingColStart = colCursor;
        colCursor += trailingCols.length;

        const totalCols = colCursor - 1;
        const groupSeparatorCols = new Set(lineGroupRanges.map((g) => g.end));

        // === 4. Buat workbook & worksheet ===
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet("Sparepart");

        // Baris 1-2 dipakai header (2 baris), data mulai baris 3.
        const headerRow1 = worksheet.getRow(1);
        const headerRow2 = worksheet.getRow(2);

        // Helper set border 1 sel: kanan "medium" kalau kolom ini penutup
        // grup Line, selain itu "thin" di keempat sisi.
        function applyCellBorder(cell: ExcelJS.Cell, colIndex: number) {
            cell.border = {
                top: THIN_BORDER,
                left: THIN_BORDER,
                bottom: THIN_BORDER,
                right: groupSeparatorCols.has(colIndex) ? MEDIUM_BORDER : THIN_BORDER,
            };
        }

        // --- 4a. Kolom leading (No/Item Code/Item/Kategori/Satuan) ---
        // Merge vertikal row 1-2 supaya sejajar dengan grup Line (2 baris).
        leadingCols.forEach((col, i) => {
            const colIndex = leadingColStart + i;
            worksheet.mergeCells(1, colIndex, 2, colIndex);
            const cell = headerRow1.getCell(colIndex);
            cell.value = col.label;
            cell.font = { bold: true };
            cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
            applyCellBorder(cell, colIndex);
            // Sel bawahan hasil merge juga perlu border sendiri (lihat
            // catatan di applyCellBorder) supaya border row 2-nya konsisten.
            applyCellBorder(headerRow2.getCell(colIndex), colIndex);
        });

        // --- 4b. Grup Line: row 1 merge horizontal 5 kolom + label line,
        //     row 2 diisi Stok/Min/Opname/Status/Keterangan ---
        for (const { line, start, end } of lineGroupRanges) {
            const colors = LINE_GROUP_COLORS[line.key];

            worksheet.mergeCells(1, start, 1, end);
            const groupCell = headerRow1.getCell(start);
            groupCell.value = line.label;
            groupCell.font = { bold: true };
            groupCell.alignment = { vertical: "middle", horizontal: "center" };
            groupCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors.header } };

            // Semua sel yang ikut ter-merge di row 1 harus dapat fill +
            // border yang sama (lihat catatan border di bawah handleExport).
            for (let c = start; c <= end; c++) {
                const cell = headerRow1.getCell(c);
                cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors.header } };
                applyCellBorder(cell, c);
            }

            // Row 2: Stok/Min/Opname/Status/Keterangan, shade lebih terang.
            SUB_COLS.forEach((sub, i) => {
                const c = start + i;
                const cell = headerRow2.getCell(c);
                cell.value = sub.label;
                cell.font = { bold: true };
                cell.alignment = { vertical: "middle", horizontal: "center" };
                cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors.sub } };
                applyCellBorder(cell, c);
            });
        }

        // --- 4c. Kolom trailing (Total) — merge vertikal row 1-2 ---
        trailingCols.forEach((col, i) => {
            const colIndex = trailingColStart + i;
            worksheet.mergeCells(1, colIndex, 2, colIndex);
            const cell = headerRow1.getCell(colIndex);
            cell.value = col.label;
            cell.font = { bold: true };
            cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
            applyCellBorder(cell, colIndex);
            applyCellBorder(headerRow2.getCell(colIndex), colIndex);
        });

        headerRow1.height = 20;
        headerRow2.height = 20;

        // === 5. Baris data, mulai row 3 ===
        //
        // maxContentWidth dipakai untuk auto-width kolom di langkah 6 —
        // dimulai dari lebar header, lalu diperbesar kalau ada isi data
        // yang lebih panjang dari header-nya.
        const maxContentWidth = new Map<number, number>();
        function trackWidth(colIndex: number, text: string) {
            const current = maxContentWidth.get(colIndex) ?? 0;
            maxContentWidth.set(colIndex, Math.max(current, text.length));
        }
        // Inisialisasi dari label header supaya kolom tidak lebih sempit
        // dari headernya sendiri.
        leadingCols.forEach((col, i) => trackWidth(leadingColStart + i, col.label));
        for (const { start } of lineGroupRanges) {
            SUB_COLS.forEach((sub, i) => trackWidth(start + i, sub.label));
        }
        trailingCols.forEach((col, i) => trackWidth(trailingColStart + i, col.label));

        sortedData.forEach((sparepart, index) => {
            const excelRowIndex = index + 3; // data mulai row 3
            const row = worksheet.getRow(excelRowIndex);

            function writeCell(colIndex: number, value: string | number, align: "left" | "center" | "right") {
                const cell = row.getCell(colIndex);
                cell.value = value;
                cell.alignment = { vertical: "middle", horizontal: align };
                applyCellBorder(cell, colIndex);
                trackWidth(colIndex, String(value));
            }

            // -- Leading cols --
            leadingCols.forEach((col, i) => {
                const colIndex = leadingColStart + i;
                let value: string | number;
                switch (col.key) {
                    case "no":
                        value = index + 1;
                        break;
                    case "itemCode":
                        value = sparepart.itemCode;
                        break;
                    case "item":
                        value = sparepart.namaPart;
                        break;
                    case "kategori":
                        value = sparepart.kategori.nama;
                        break;
                    case "satuan":
                        value = sparepart.satuan.nama;
                        break;
                }
                writeCell(colIndex, value, col.align);
            });

            // -- Grup Line --
            for (const { line, start } of lineGroupRanges) {
                const lineStock = sparepart.lineStocks.find((ls) => ls.line === line.key);
                const jumlah = lineStock ? lineStock.jumlah : 0;
                const minStok = lineStock ? lineStock.minStok : 0;
                // NOTE: aturan "Kurang" di sini pakai perbandingan langsung
                // jumlah vs minStok line ini (jumlah < minStok = "Kurang"),
                // SATU LOGIC dengan yang dipakai computeLineStatus untuk
                // StatusBadge di grid. Kalau ambang computeLineStatus di
                // lib/status-helper.ts ternyata berbeda (mis. ada buffer /
                // status ketiga selain cukup-kurang), sesuaikan baris di
                // bawah ini supaya label export tetap konsisten dengan
                // badge yang tampil di layar.
                const status: "Cukup" | "Kurang" = jumlah < minStok ? "Kurang" : "Cukup";

                writeCell(start, jumlah, "right");
                writeCell(start + 1, minStok, "right");
                writeCell(
                    start + 2,
                    // "" (bukan "-") saat belum pernah opname, sesuai spek export.
                    formatTanggalOpname(lineStock ? lineStock.lastOpnameDate : null, ""),
                    "center"
                );

                const statusColIndex = start + 3;
                const statusCell = row.getCell(statusColIndex);
                statusCell.value = status;
                statusCell.alignment = { vertical: "middle", horizontal: "center" };
                statusCell.font = { bold: true, color: { argb: STATUS_COLORS[status].font } };
                statusCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: STATUS_COLORS[status].fill } };
                applyCellBorder(statusCell, statusColIndex);
                trackWidth(statusColIndex, status);

                writeCell(start + 4, lineStock?.keterangan ?? "", "left");
            }

            // -- Total --
            trailingCols.forEach((col, i) => {
                writeCell(trailingColStart + i, sparepart.stok, col.align);
            });
        });

        // === 6. Auto-width kolom, berdasarkan konten terpanjang (header +
        //     data), dengan lebar minimum dari LEBAR_PX (langkah 1) supaya
        //     tidak lebih sempit dari proporsi tampilan web. ===
        const widthPxByCol = new Map<number, number>();
        leadingCols.forEach((col, i) => widthPxByCol.set(leadingColStart + i, col.widthPx));
        for (const { start } of lineGroupRanges) {
            SUB_COLS.forEach((sub, i) => widthPxByCol.set(start + i, sub.widthPx));
        }
        trailingCols.forEach((col, i) => widthPxByCol.set(trailingColStart + i, col.widthPx));

        for (let c = 1; c <= totalCols; c++) {
            const minWidth = pxToExcelWidth(widthPxByCol.get(c) ?? 80);
            const contentWidth = (maxContentWidth.get(c) ?? 0) + 2; // padding
            worksheet.getColumn(c).width = Math.max(minWidth, contentWidth);
        }

        // Freeze 2 baris header supaya tetap kelihatan saat scroll, mirip
        // sticky header di tampilan web.
        worksheet.views = [{ state: "frozen", ySplit: 2 }];

        // === 7. Trigger download ===
        //
        // ExcelJS tidak punya writeFile bawaan untuk browser (beda dari
        // SheetJS) — buffer hasil generate dibungkus Blob lalu dipicu lewat
        // <a download> sementara.
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        const url = URL.createObjectURL(blob);

        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, "0");
        const dd = String(now.getDate()).padStart(2, "0");

        const link = document.createElement("a");
        link.href = url;
        link.download = `sparepart-export-${yyyy}${mm}${dd}.xlsx`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
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

    async function submitLineKeteranganField(
        sparepartId: string,
        line: Line,
        value: string
    ): Promise<InlineEditSubmitResult> {
        try {
            const result = await updateLineKeterangan(sparepartId, line, value);
            if (!result.success) {
                return { status: "error", message: result.message };
            }

            mergeLineStock(sparepartId, result.data.lineStock);
            return { status: "success" };
        } catch (error) {
            // Jaring pengaman yang sama seperti submitStokField/submitStokField-adjacent
            // handler lain — updateLineKeterangan pada dasarnya sudah membungkus
            // errornya sendiri jadi { success: false, message }, tapi exception
            // tak terduga di luar itu (mis. sesi auth bermasalah, error jaringan)
            // tetap perlu ditangkap supaya tombol Simpan tidak macet loading.
            console.error("[submitLineKeteranganField] unexpected error:", error);
            return {
                status: "error",
                message: "Terjadi kesalahan tak terduga saat menyimpan keterangan. Coba lagi.",
            };
        }
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

            <div className="sticky top-0 z-40 -mx-6 mb-4 flex h-[62px] items-center gap-2 bg-app-bg px-6 shadow-sm overflow-x-auto">
                <input
                    type="text"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Cari item code, nama part, atau spesifikasi..."
                    className="w-full max-w-md flex-1 rounded-md border border-ink/20 bg-surface px-3 py-2 font-sans text-sm text-ink placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
                />

                <div className="shrink-0">
                    <button
                        ref={filterButtonRef}
                        type="button"
                        onClick={() => setIsFilterOpen((open) => !open)}
                        aria-expanded={isFilterOpen}
                        aria-haspopup="dialog"
                        title="Filter"
                        aria-label="Filter"
                        className="relative flex items-center gap-1.5 rounded-md border border-ink/20 bg-surface px-3 py-2 font-sans text-sm text-ink hover:bg-app-bg"
                    >
                        <Filter className="h-4 w-4" />
                        {activeFilterCount > 0 && (
                            <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary font-sans text-[10px] font-semibold text-white">
                                {activeFilterCount}
                            </span>
                        )}
                    </button>

                    {/* anchorRef, bukan lagi wrapper `relative` — FilterPopup
                        sekarang di-portal ke document.body dan menghitung
                        posisinya sendiri dari rect tombol ini (lihat
                        popover-portal.tsx & catatan di filter-popup.tsx). */}
                    <FilterPopup
                        isOpen={isFilterOpen}
                        onClose={() => setIsFilterOpen(false)}
                        anchorRef={filterButtonRef}
                        appliedFilters={appliedFilters}
                        onApply={setAppliedFilters}
                        kategoriOptions={filterKategoriOptions}
                        satuanOptions={filterSatuanOptions}
                    />
                </div>

                {/* Tombol mata — TERPISAH dari Filter, cuma toggle kolom
                    mana yang dirender (lihat hiddenColumns & catatan di
                    ColumnVisibilityPopup), sama sekali tidak menyaring
                    baris. Bisa menyembunyikan grup kolom Line MAUPUN kolom
                    statis Kategori/Satuan/Total. Sengaja ditaruh sebagai
                    tombol sendiri di sebelah Filter (bukan di dalam
                    FilterPopup) supaya user tidak salah kira ini bagian
                    dari filter. */}
                <div className="shrink-0">
                    <button
                        ref={columnVisibilityButtonRef}
                        type="button"
                        onClick={() => setIsColumnVisibilityOpen((open) => !open)}
                        aria-expanded={isColumnVisibilityOpen}
                        aria-haspopup="dialog"
                        title="Tampilkan/sembunyikan kolom"
                        aria-label="Tampilkan/sembunyikan kolom"
                        className="relative flex items-center gap-1.5 rounded-md border border-ink/20 bg-surface px-3 py-2 font-sans text-sm text-ink hover:bg-app-bg"
                    >
                        <Eye className="h-4 w-4" />
                        {hiddenColumns.size > 0 && (
                            <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary font-sans text-[10px] font-semibold text-white">
                                {hiddenColumns.size}
                            </span>
                        )}
                    </button>

                    {/* anchorRef, bukan lagi wrapper `relative` — sama
                        alasannya dengan FilterPopup di atas. */}
                    <ColumnVisibilityPopup
                        isOpen={isColumnVisibilityOpen}
                        onClose={() => setIsColumnVisibilityOpen(false)}
                        anchorRef={columnVisibilityButtonRef}
                        hiddenColumns={hiddenColumns}
                        onSelectAll={() => setHiddenColumns(new Set())}
                        onReset={() =>
                            setHiddenColumns(
                                new Set<string>([
                                    ...LINES.map((line) => line.key),
                                    ...STATIC_COLUMNS.map((col) => col.key),
                                ])
                            )
                        }
                        onToggleColumn={(key) =>
                            setHiddenColumns((prev) => {
                                const next = new Set(prev);
                                if (next.has(key)) {
                                    next.delete(key);
                                } else {
                                    next.add(key);
                                }
                                return next;
                            })
                        }
                    />
                </div>

                {/* Urutkan — sort ULANG di client dari data yang sudah ada
                    di memory (lihat sortedData), tidak fetch ulang ke
                    server, jadi ganti pilihan langsung instan. Label
                    visual "Urutkan:" sengaja dihilangkan (dropdown-nya
                    sendiri sudah cukup jelas), tapi aria-label tetap
                    dipasang di <select> supaya pengguna screen reader
                    tetap tahu fungsi dropdown ini. */}
                <div className="flex shrink-0 items-center gap-1.5">
                    <select
                        id="sparepart-sort"
                        aria-label="Urutkan data"
                        value={sortBy}
                        onChange={(event) =>
                            setSortBy(event.target.value as SparepartSortBy)
                        }
                        className="rounded-md border border-ink/20 bg-surface px-2.5 py-2 font-sans text-sm text-ink focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
                    >
                        {SORT_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Jumlah baris per halaman — ganti pageSize selalu reset
                    currentPage ke 1, supaya tidak berakhir di halaman yang
                    sudah di luar jangkauan untuk pageSize barunya. */}
                <div className="flex shrink-0 items-center gap-1.5">
                    <select
                        id="sparepart-page-size"
                        aria-label="Jumlah baris per halaman"
                        value={pageSize}
                        onChange={(event) => {
                            setPageSize(Number(event.target.value));
                            setCurrentPage(1);
                        }}
                        className="rounded-md border border-ink/20 bg-surface px-2.5 py-2 font-sans text-sm text-ink focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
                    >
                        <option value={25}>25 / halaman</option>
                        <option value={50}>50 / halaman</option>
                        <option value={100}>100 / halaman</option>
                    </select>
                </div>

                {/* Toolbar seleksi — hanya muncul kalau minimal 1 baris
                    tercentang, ditaruh di baris yang sama dengan search
                    box & tombol Filter. */}
                {selectedIds.size > 0 && (
                    <div className="flex shrink-0 items-center gap-2 rounded-md border border-status-danger/30 bg-status-danger/5 px-3 py-2">
                        <span className="font-sans text-sm text-ink">
                            {selectedIds.size} part dipilih
                        </span>
                        <button
                            type="button"
                            onClick={openDeleteModal}
                            className="flex items-center gap-1.5 rounded-md bg-status-danger px-3 py-1.5 font-sans text-sm font-medium text-white hover:bg-status-danger/90"
                        >
                            <Trash2 className="h-4 w-4" />
                            Hapus
                        </button>
                    </div>
                )}

                {/* "Import Excel" + "Export Excel" (keduanya icon-only,
                    outline/secondary) + "+ Tambah / Restock" (primary) —
                    selalu paling kanan toolbar, dikelompokkan dalam 1 div
                    ber-`ml-auto` supaya tetap menempel kanan sebagai satu
                    grup, baik saat toolbar seleksi di atas muncul maupun
                    tidak. Import & Export icon-only (bukan teks+ikon lagi)
                    supaya toolbar lebih ringkas — title (+ aria-label) tetap
                    dipasang di masing-masing supaya fungsinya tetap jelas
                    lewat tooltip/native title & tetap accessible untuk
                    screen reader walau tanpa label teks yang tampil. Export
                    klik langsung panggil handleExport, TANPA modal
                    konfirmasi (beda dari Import yang buka ImportExcelModal
                    dulu, karena Import butuh tahap upload file & preview
                    hasil parse sebelum submit ke server). */}
                <div className="ml-auto flex shrink-0 items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setIsImportExcelOpen(true)}
                        title="Import Excel"
                        aria-label="Import Excel"
                        className="flex items-center justify-center rounded-md border border-primary p-2 text-primary hover:bg-primary/5"
                    >
                        <ArrowDownToLine className="h-4 w-4" />
                    </button>
                    <button
                        type="button"
                        onClick={handleExport}
                        title="Export Excel"
                        aria-label="Export Excel"
                        className="flex items-center justify-center rounded-md border border-primary p-2 text-primary hover:bg-primary/5"
                    >
                        <ArrowUpFromLine className="h-4 w-4" />
                    </button>
                    <button
                        type="button"
                        onClick={() => setIsSmartFormOpen(true)}
                        className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 font-sans text-sm font-medium text-white hover:bg-primary/90"
                    >
                        <Plus className="h-4 w-4" />
                        Tambah / Restock
                    </button>
                </div>
            </div>

            <div
                ref={tableWrapperRef}
                className="overflow-x-auto overflow-y-clip rounded-lg border border-ink/20"
            >
                <table
                    className="w-full border-separate border-spacing-0 text-sm [table-layout:fixed]"
                    style={{ minWidth: tableWidth }}
                >
                    <colgroup>
                        <col style={{ width: CHECKBOX_WIDTH }} />
                        <col style={{ width: NOMOR_WIDTH }} />
                        <col style={{ width: ITEM_CODE_WIDTH }} />
                        <col style={{ width: ITEM_WIDTH }} />
                        {showKategori && <col style={{ width: KATEGORI_WIDTH }} />}
                        {showSatuan && <col style={{ width: SATUAN_WIDTH }} />}
                        {visibleLines.map((line) => (
                            <Fragment key={line.key}>
                                <col style={{ width: STOK_COL_WIDTH }} />
                                <col style={{ width: MIN_COL_WIDTH }} />
                                <col style={{ width: OPNAME_COL_WIDTH }} />
                                <col style={{ width: LINE_STATUS_WIDTH }} />
                                <col style={{ width: LINE_KETERANGAN_WIDTH }} />
                            </Fragment>
                        ))}
                        {showTotal && <col style={{ width: TOTAL_WIDTH }} />}
                    </colgroup>

                    <thead ref={theadRef}>
                        {/*
                            STICKY HEADER — 3 tingkat z-index supaya urutan
                            tumpuk benar saat scroll 2 arah sekaligus:
                              - z-30 "pojok" (sticky KIRI + ATAS sekaligus):
                                Checkbox/Nomor/Item Code/Item di baris ini.
                                Ini yang PALING TINGGI — kalau tidak, saat
                                scroll horizontal, header kolom lain (Kategori
                                dst, sticky atas doang) akan lewat DI ATAS
                                pojok ini karena urutan DOM-nya belakangan.
                              - z-20 header sticky ATAS SAJA (Kategori, Satuan,
                                grup Line baris-1, Stok/Min/dst baris-2, Total).
                                Lebih tinggi dari z-10 sel data sticky KIRI di
                                tbody (lihat stickyZIndex di bawah) supaya baris
                                data yang discroll ke atas tidak pernah nutupin
                                header, walau DOM tbody ada SETELAH thead.
                              - Baris header ke-2 (Stok/Min/Opname/Status/
                                Keterangan) sticky-nya bukan top-0, tapi
                                top: HEADER_ROW_HEIGHT — supaya nempel PAS di
                                bawah baris-1 (grup Line), bukan numpuk di atasnya.

                            CATATAN (PERUBAHAN 3): "sticky top-0" di sini
                            sekarang nempel ke VIEWPORT BROWSER, bukan lagi ke
                            div pembungkus tabel — karena div itu sudah tidak
                            punya overflow-y sendiri (lihat komentar di div
                            pembungkus). Search bar/toolbar/judul di atas
                            tabel akan ikut scroll keluar layar; hanya baris
                            header kolom tabel yang tetap kelihatan.
                        */}
                        <tr>
                            {/* Checkbox select-all: sticky KIRI + ATAS (pojok).
                                Centang semua baris yang SEDANG TERLIHAT
                                (sortedData), bukan semua data mentah. */}
                            <th
                                rowSpan={2}
                                className={`${thBase} sticky left-0 z-30 text-center`}
                                style={{ top: 0 }}
                            >
                                <input
                                    type="checkbox"
                                    aria-label="Pilih semua part yang tampil"
                                    checked={isAllVisibleSelected}
                                    onChange={toggleSelectAllVisible}
                                    className="h-4 w-4 rounded border-ink/30 accent-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
                                />
                            </th>
                            <th
                                rowSpan={2}
                                style={{ left: NOMOR_LEFT, top: 0 }}
                                className={`${thBase} sticky z-30 text-center`}
                            >
                                No
                            </th>
                            <th
                                rowSpan={2}
                                style={{ left: ITEM_CODE_LEFT, top: 0 }}
                                className={`${thBase} sticky z-30 text-center`}
                            >
                                Item Code
                            </th>
                            <th
                                rowSpan={2}
                                style={{ left: ITEM_LEFT, top: 0 }}
                                className={`${thBase} sticky z-30 text-center`}
                            >
                                Item
                            </th>
                            {showKategori && (
                                <th
                                    rowSpan={2}
                                    className={`${thBase} text-left`}
                                >
                                    Kategori
                                </th>
                            )}
                            {showSatuan && (
                                <th
                                    rowSpan={2}
                                    className={`${thBase} text-left`}
                                >
                                    Satuan
                                </th>
                            )}
                            {visibleLines.map((line) => (
                                <th
                                    key={line.key}
                                    colSpan={5}
                                    className={`${thBaseNoBgLineGroupEnd} ${LINE_HEADER_BG[line.key]} text-center`}
                                >
                                    {line.label}
                                </th>
                            ))}
                            {showTotal && (
                                <th
                                    rowSpan={2}
                                    className={`${thBase} text-center`}
                                >
                                    Total
                                </th>
                            )}
                        </tr>
                        <tr>
                            {visibleLines.map((line) => (
                                <Fragment key={line.key}>
                                    <th
                                        className={`${thBaseNoBg} ${LINE_HEADER_BG[line.key]} text-right`}
                                    >
                                        Stok
                                    </th>
                                    <th
                                        className={`${thBaseNoBg} ${LINE_HEADER_BG[line.key]} text-right`}
                                    >
                                        Min
                                    </th>
                                    <th
                                        className={`${thBaseNoBg} ${LINE_HEADER_BG[line.key]} text-center`}
                                    >
                                        Opname
                                    </th>
                                    <th
                                        className={`${thBaseNoBg} ${LINE_HEADER_BG[line.key]} text-center`}
                                    >
                                        Status
                                    </th>
                                    <th
                                        className={`${thBaseNoBgLineGroupEnd} ${LINE_HEADER_BG[line.key]} text-left`}
                                    >
                                        Keterangan
                                    </th>
                                </Fragment>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {sortedData.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={totalColumns}
                                    className="border border-ink/20 px-4 py-10 text-center font-sans text-muted"
                                >
                                    {emptyMessage}
                                </td>
                            </tr>
                        ) : (
                            pagedData.map((sparepart, localIdx) => {
                                // idx = indeks GLOBAL di sortedData (bukan cuma di
                                // halaman ini) — supaya kolom Nomor melanjutkan
                                // urutan lintas halaman (mis. halaman 2 dgn
                                // pageSize 50 mulai dari 51), bukan reset ke 1.
                                const idx = pageStartIndex + localIdx;

                                // Zebra stripe: baris genap = app-bg, baris ganjil = surface.
                                const rowBg = idx % 2 === 0 ? "bg-app-bg" : "bg-surface";

                                // ID sel edit — format konsisten supaya mudah dibandingkan.
                                const namaPartCellId = `namaPart:${sparepart.id}`;
                                const kategoriCellId = `kategori:${sparepart.id}`;
                                const satuanCellId = `satuan:${sparepart.id}`;

                                const isEditingRow = editingCellId?.includes(`:${sparepart.id}`);
                                // z-10 sengaja LEBIH RENDAH dari thead sticky (z-20/z-30,
                                // lihat komentar di <thead>) supaya kolom sticky-kiri di
                                // sini tidak pernah menutupi header saat baris discroll
                                // ke atas. z-40 (mode edit) sengaja tetap paling tinggi di
                                // antara sel body supaya panel edit mengambang (z-50) tidak
                                // ketutup kolom sticky tetangganya.
                                const stickyZIndex = isEditingRow ? "z-40" : "z-10";

                                return (
                                    <tr key={sparepart.id} className={rowBg}>
                                        {/* Checkbox select baris: sticky, kolom paling kiri.
                                            TIDAK bisa diedit inline — cuma toggle seleksi. */}
                                        <td
                                            className={`${tdBase} ${rowBg} sticky left-0 ${stickyZIndex} text-center`}
                                        >
                                            <input
                                                type="checkbox"
                                                aria-label={`Pilih ${sparepart.namaPart}`}
                                                checked={selectedIds.has(sparepart.id)}
                                                onChange={() => toggleSelectOne(sparepart.id)}
                                                className="h-4 w-4 rounded border-ink/30 accent-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
                                            />
                                        </td>

                                        {/* Nomor: sticky, TIDAK bisa diedit & tidak ikut
                                            sorting/filtering apapun — murni nomor urut
                                            tampilan dari posisi baris ini di sortedData,
                                            jadi otomatis reset dari 1 tiap kali sort/filter
                                            berubah. */}
                                        <td
                                            style={{ left: NOMOR_LEFT }}
                                            className={`${tdBase} ${rowBg} sticky ${stickyZIndex} text-center`}
                                        >
                                            {idx + 1}
                                        </td>

                                        {/* Item Code: sticky + font-mono + bg eksplisit
                                            supaya tidak transparan saat scroll horizontal.
                                            TIDAK bisa diedit inline (di luar scope). */}
                                        <td
                                            style={{ left: ITEM_CODE_LEFT }}
                                            className={`${tdBase} ${rowBg} sticky ${stickyZIndex} overflow-hidden text-center font-mono`}
                                        >
                                            <span className="block truncate">{sparepart.itemCode}</span>
                                        </td>

                                        {/* Item (namaPart): sticky, BISA diedit inline.
                                            td punya `relative` sebagai anchor floating panel. */}
                                        <td
                                            style={{ left: ITEM_LEFT }}
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
                                        {showKategori && (
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
                                        )}

                                        {/* Satuan: BISA diedit inline (dropdown). */}
                                        {showSatuan && (
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
                                        )}

                                        {visibleLines.map((line) => {
                                            const lineStock = sparepart.lineStocks.find(
                                                (ls) => ls.line === line.key
                                            );
                                            const jumlah = lineStock ? lineStock.jumlah : 0;
                                            const minStok = lineStock ? lineStock.minStok : 0;
                                            const lineStatus = computeLineStatus(jumlah, minStok);

                                            const stokCellId = `stok:${sparepart.id}:${line.key}`;
                                            const minCellId = `min:${sparepart.id}:${line.key}`;
                                            const keteranganLineCellId = `keteranganLine:${sparepart.id}:${line.key}`;

                                            return (
                                                <Fragment key={line.key}>
                                                    {/* Stok: BISA diedit inline — input diisi nilai stok saat ini,
                                                        delta ke server dihitung otomatis saat Simpan (lihat
                                                        InlineStockEditShell).
                                                        ${rowBg} eksplisit (BUG 2): tdBase sendiri transparan,
                                                        jadi sel ini WAJIB bg eksplisit sesuai zebra-stripe
                                                        baris, sama seperti pola yang sudah dipakai di kolom
                                                        sticky Item Code/Item — supaya tidak ada apa pun yang
                                                        tembus pandang di baliknya saat scroll. */}
                                                    <td className={`${tdBase} ${rowBg} relative text-right`}>
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
                                                    {/* Min: BISA diedit inline. ${rowBg} eksplisit — lihat
                                                        catatan BUG 2 di sel Stok di atas. */}
                                                    <td className={`${tdBase} ${rowBg} relative text-right`}>
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
                                                    {/* Opname: TIDAK bisa diedit manual (otomatis dari sistem).
                                                        ${rowBg} eksplisit — lihat catatan BUG 2 di sel Stok. */}
                                                    <td className={`${tdBase} ${rowBg} overflow-hidden text-center`}>
                                                        <span className="block truncate">
                                                            {lineStock
                                                                ? formatTanggalOpname(lineStock.lastOpnameDate)
                                                                : "-"}
                                                        </span>
                                                    </td>
                                                    {/* Status: TIDAK bisa diedit inline — dihitung otomatis
                                                        per line dari jumlah vs minStok line ini saja (BEDA
                                                        dari status agregat computeSparepartStatus yang
                                                        dipakai untuk filter). ${rowBg} eksplisit — lihat
                                                        catatan BUG 2 di sel Stok. */}
                                                    <td className={`${tdBase} ${rowBg} overflow-hidden text-center`}>
                                                        <span className="inline-block whitespace-nowrap">
                                                            <StatusBadge status={lineStatus} />
                                                        </span>
                                                    </td>
                                                    {/* Keterangan (per line): BARU, BISA diedit inline.
                                                        ${rowBg} eksplisit — lihat catatan BUG 2 di sel Stok.
                                                        tdBaseLineGroupEnd (bukan tdBase): ini kolom PALING
                                                        KANAN grup Line, border kanan lebih tebal & gelap
                                                        supaya batas antar grup Line/ke kolom Total kelihatan
                                                        jelas (PERUBAHAN 4). */}
                                                    <td className={`${tdBaseLineGroupEnd} ${rowBg} relative`}>
                                                        {editingCellId === keteranganLineCellId ? (
                                                            <>
                                                                <span className="invisible select-none" aria-hidden>
                                                                    {lineStock?.keterangan ?? "-"}
                                                                </span>
                                                                <InlineEditShell
                                                                    initialValue={lineStock?.keterangan ?? ""}
                                                                    onClose={() => setEditingCellId(null)}
                                                                    onSubmit={(value) =>
                                                                        submitLineKeteranganField(sparepart.id, line.key, value)
                                                                    }
                                                                />
                                                            </>
                                                        ) : (
                                                            <EditTrigger
                                                                onClick={() => setEditingCellId(keteranganLineCellId)}
                                                            >
                                                                {lineStock?.keterangan ?? "-"}
                                                            </EditTrigger>
                                                        )}
                                                    </td>
                                                </Fragment>
                                            );
                                        })}

                                        {/* Total: TIDAK bisa diedit — murni hasil kalkulasi
                                            (Sparepart.stok, dijaga konsisten oleh
                                            recordStockMovementCore setiap kali ada pergerakan
                                            stok pada line manapun). */}
                                        {showTotal && (
                                            <td className={`${tdBase} text-center`}>{sparepart.stok}</td>
                                        )}
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>

            {/* Kontrol navigasi halaman — cuma tampil kalau ada data hasil
                search/filter (kalau kosong, pesan emptyMessage di dalam
                tabel sudah cukup, tidak perlu kontrol halaman di bawahnya). */}
            {sortedData.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <p className="font-sans text-sm text-muted">
                        Menampilkan {pageStartIndex + 1}–
                        {Math.min(pageStartIndex + pageSize, sortedData.length)} dari{" "}
                        {sortedData.length} part
                    </p>
                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={() => setCurrentPage(Math.max(1, safeCurrentPage - 1))}
                            disabled={safeCurrentPage <= 1}
                            className="rounded-md border border-ink/20 bg-surface px-3 py-1.5 font-sans text-sm text-ink hover:bg-app-bg disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            &lt; Sebelumnya
                        </button>
                        <span className="font-sans text-sm text-ink">
                            Halaman {safeCurrentPage} dari {totalPages}
                        </span>
                        <button
                            type="button"
                            onClick={() =>
                                setCurrentPage(Math.min(totalPages, safeCurrentPage + 1))
                            }
                            disabled={safeCurrentPage >= totalPages}
                            className="rounded-md border border-ink/20 bg-surface px-3 py-1.5 font-sans text-sm text-ink hover:bg-app-bg disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            Selanjutnya &gt;
                        </button>
                    </div>
                </div>
            )}

            {isDeleteModalOpen && (
                <DeleteConfirmModal
                    count={selectedIds.size}
                    isDeleting={isDeleting}
                    error={deleteError}
                    onCancel={closeDeleteModal}
                    onConfirm={handleConfirmDelete}
                />
            )}

            {isSmartFormOpen && (
                <SmartFormModal
                    onClose={() => setIsSmartFormOpen(false)}
                    onSuccess={handleSmartFormSuccess}
                />
            )}

            {isImportExcelOpen && (
                <ImportExcelModal
                    onClose={() => setIsImportExcelOpen(false)}
                    onSuccess={handleImportExcelSuccess}
                />
            )}
        </div>
    );
}