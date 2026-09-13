"use client";

import {
    useEffect,
    useRef,
    useState,
    type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Check, ChevronDown, Loader2, X } from "lucide-react";
import {
    getSparepartByItemCode,
    submitSmartForm,
    type SubmitSmartFormInput,
} from "@/lib/actions/sparepart";
import {
    getKategoriList,
    getSatuanList,
} from "@/lib/actions/master-data";
import type { Kategori, Line, Satuan } from "@/generated/prisma/client";
import { LINES } from "./line-config";

// ==========================================================
// Tipe hasil getSparepartByItemCode diturunkan dari return type Server
// Action-nya sendiri (pola yang sama dipakai sparepart-grid.tsx untuk
// getSparepartList) — supaya tidak perlu export tipe baru dari
// sparepart.ts hanya untuk dipakai di sini.
// ==========================================================
type ByItemCodeResult = Awaited<ReturnType<typeof getSparepartByItemCode>>;
type FoundSparepart = Extract<ByItemCodeResult, { success: true }>["data"];
type FoundSparepartData = NonNullable<FoundSparepart>;

type SmartFormMode = "EMPTY" | "CHECKING" | "RESTOCK" | "PART_BARU";

type LineStockDraft = { jumlah: string; minStok: string };

type SmartFormModalProps = {
    onClose: () => void;
    /**
     * Dipanggil setelah submitSmartForm sukses. Parent (SparepartGrid)
     * yang bertanggung jawab menutup modal ini DAN me-refresh data grid
     * (router.refresh()) — modal ini sendiri tidak tahu apa-apa soal grid.
     */
    onSuccess: () => void;
};

function emptyLineStockDrafts(): Record<Line, LineStockDraft> {
    return Object.fromEntries(
        LINES.map((line) => [line.key, { jumlah: "", minStok: "" }])
    ) as Record<Line, LineStockDraft>;
}

// Kelas input dipusatkan di sini supaya konsisten antara mode bisa-edit
// (bg-app-bg, border normal) dan mode terkunci/read-only (bg abu, border
// lebih pudar, text-muted) — dipakai field master di KEDUA mode.
function inputClass(locked: boolean): string {
    return `w-full rounded border px-3 py-2 font-sans text-sm focus:outline-none focus:ring-1 disabled:cursor-not-allowed ${locked
        ? "border-ink/10 bg-ink/5 text-muted"
        : "border-ink/20 bg-app-bg text-ink focus:border-primary focus:ring-primary/30"
        }`;
}

// ==========================================================
// SEARCHABLE SELECT — pengganti <select> native untuk field master
// (Kategori/Satuan) yang bisa punya banyak sekali opsi. <select> native
// memaksa user men-scroll daftar panjang untuk cari satu nama; combobox
// ini menyembunyikan opsi di balik dropdown yang bisa disaring lewat
// pencarian, jadi tetap praktis dipakai berapa pun jumlah opsinya.
//
// Pola & styling SENGAJA disamakan dengan MultiSelectCombobox di
// filter-popup.tsx (trigger + panel absolute, klik-luar untuk menutup,
// auto-fokus kotak cari tiap dibuka) — bedanya combobox ini SINGLE-SELECT
// (pilih 1 value, trigger menampilkan label terpilih langsung, bukan chip).
//
// Generic <T extends { id: string; nama: string }> supaya bisa langsung
// menerima Kategori[]/Satuan[] dari Prisma tanpa perlu map/transformasi
// di pemanggilnya.
// ==========================================================
function SearchableSelect<T extends { id: string; nama: string }>({
    options,
    value,
    onChange,
    placeholder,
    disabled = false,
    loading = false,
}: {
    options: T[];
    value: string;
    onChange: (id: string) => void;
    placeholder: string;
    disabled?: boolean;
    loading?: boolean;
}) {
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState("");
    const wrapperRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    const isDisabled = disabled || loading;
    const selectedOption = options.find((option) => option.id === value) ?? null;

    // Tutup dropdown kalau user klik di luar wrapper — sama seperti
    // MultiSelectCombobox, pakai "mousedown" supaya kelar sebelum click
    // lain (mis. klik trigger combobox lain di sebelahnya) diproses.
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

    // Kalau combobox berubah jadi disabled/loading saat sedang terbuka
    // (mis. isSaving berubah true tepat saat dropdown terbuka), paksa
    // tertutup supaya tidak ada dropdown "mengambang" di atas field yang
    // sudah terkunci.
    useEffect(() => {
        if (isDisabled) setIsOpen(false);
    }, [isDisabled]);

    function handleToggleOpen() {
        if (isDisabled) return;
        setIsOpen((prev) => !prev);
    }

    // Trigger BUKAN elemen <button> asli (sama alasannya dengan
    // MultiSelectCombobox) supaya aman dipakai di dalam struktur apapun
    // tanpa risiko nested-button; Enter/Space ditangani manual di sini.
    function handleTriggerKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
        if (isDisabled) return;
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handleToggleOpen();
        }
    }

    function handleSelect(id: string) {
        onChange(id);
        setIsOpen(false);
    }

    const filteredOptions = query.trim()
        ? options.filter((option) =>
            option.nama.toLowerCase().includes(query.trim().toLowerCase())
        )
        : options;

    return (
        <div ref={wrapperRef} className="relative">
            <div
                role="button"
                tabIndex={isDisabled ? -1 : 0}
                onClick={handleToggleOpen}
                onKeyDown={handleTriggerKeyDown}
                aria-expanded={isOpen}
                aria-haspopup="listbox"
                aria-disabled={isDisabled}
                className={`flex items-center justify-between gap-2 rounded border px-3 py-2 font-sans text-sm outline-none transition-colors focus-visible:ring-1 focus-visible:ring-primary/30 ${isDisabled
                    ? "cursor-not-allowed border-ink/10 bg-ink/5 text-muted"
                    : "cursor-pointer border-ink/20 bg-app-bg text-ink hover:border-ink/30"
                    } ${isOpen ? "border-primary ring-1 ring-primary/30" : ""}`}
            >
                <span className={`truncate ${selectedOption ? "" : "text-muted"}`}>
                    {loading
                        ? "Memuat..."
                        : selectedOption
                            ? selectedOption.nama
                            : placeholder}
                </span>
                <ChevronDown
                    className={`h-4 w-4 shrink-0 text-muted transition-transform duration-150 ${isOpen ? "rotate-180" : ""
                        }`}
                />
            </div>

            {isOpen && !isDisabled && (
                <div
                    role="listbox"
                    // z-20 cukup: dropdown ini hanya perlu menang dari elemen
                    // normal-flow di bawahnya (Keterangan, Stok per Line) yang
                    // sama sekali tidak di-posisikan — lihat catatan z-index di
                    // MultiSelectCombobox untuk kasus yang lebih rumit (footer
                    // sticky), yang tidak berlaku di modal ini.
                    className="absolute left-0 top-full z-20 mt-1 w-full overflow-hidden rounded-md border border-ink/20 bg-surface shadow-lg"
                    onClick={(event) => event.stopPropagation()}
                >
                    <div className="border-b border-ink/10 p-1.5">
                        <input
                            ref={searchInputRef}
                            type="text"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Cari..."
                            className="w-full rounded border border-ink/15 px-2 py-1 font-sans text-sm text-ink outline-none focus:border-primary"
                        />
                    </div>
                    <div className="max-h-48 overflow-y-auto p-1">
                        {filteredOptions.length === 0 ? (
                            <p className="px-2 py-1.5 font-sans text-xs text-muted">
                                Tidak ada hasil
                            </p>
                        ) : (
                            filteredOptions.map((option) => {
                                const isSelected = option.id === value;
                                return (
                                    <button
                                        key={option.id}
                                        type="button"
                                        role="option"
                                        aria-selected={isSelected}
                                        onClick={() => handleSelect(option.id)}
                                        className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left font-sans text-sm text-ink hover:bg-app-bg"
                                    >
                                        <span className="truncate">{option.nama}</span>
                                        {isSelected && (
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
    );
}

export function SmartFormModal({ onClose, onSuccess }: SmartFormModalProps) {
    // ==========================================================
    // Data master (Kategori/Satuan) — sengaja di-fetch SENDIRI di sini
    // lewat useEffect saat modal mount, BUKAN diterima sebagai props
    // dari SparepartGrid, supaya selalu dapat data terbaru (mis.
    // kategori baru yang ditambahkan user lewat modal lain sesaat
    // sebelum modal ini dibuka).
    //
    // CATATAN: field Lokasi Rak sengaja TIDAK ditampilkan/di-fetch lagi
    // di form ini (field lokasiRakId di Sparepart & tabel LokasiRak
    // tetap ada di database, hanya disembunyikan dari UI karena rencana
    // pemakaiannya berubah jadi per-line, bukan per-part).
    // ==========================================================
    const [kategoriOptions, setKategoriOptions] = useState<Kategori[]>([]);
    const [satuanOptions, setSatuanOptions] = useState<Satuan[]>([]);
    const [isMasterDataLoading, setIsMasterDataLoading] = useState(true);
    const [masterDataError, setMasterDataError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        async function loadMasterData() {
            setIsMasterDataLoading(true);
            setMasterDataError(null);
            try {
                const [kategoriResult, satuanResult] = await Promise.all([
                    getKategoriList(),
                    getSatuanList(),
                ]);
                if (cancelled) return;

                if (!kategoriResult.success) {
                    setMasterDataError(kategoriResult.message);
                    return;
                }
                if (!satuanResult.success) {
                    setMasterDataError(satuanResult.message);
                    return;
                }

                setKategoriOptions(kategoriResult.data);
                setSatuanOptions(satuanResult.data);
            } catch (error) {
                if (!cancelled) {
                    console.error(
                        "[SmartFormModal] unexpected error saat memuat data master:",
                        error
                    );
                    setMasterDataError(
                        "Terjadi kesalahan saat memuat data master. Coba lagi."
                    );
                }
            } finally {
                if (!cancelled) setIsMasterDataLoading(false);
            }
        }

        loadMasterData();
        return () => {
            cancelled = true;
        };
        // Modal ini di-mount/unmount tiap dibuka/ditutup (lihat cara
        // SparepartGrid me-render-nya), jadi effect [] berjalan tiap
        // kali modal dibuka — sudah cukup untuk "selalu data terbaru".
    }, []);

    // ==========================================================
    // Item Code + auto-lookup (debounce ~500ms, atau langsung saat blur)
    // ==========================================================
    const [itemCode, setItemCode] = useState("");
    const [isChecking, setIsChecking] = useState(false);
    const [lookupError, setLookupError] = useState<string | null>(null);
    // itemCode di dalam lookupResult dipakai untuk tahu apakah hasil ini
    // masih relevan dengan isi input SAAT INI (user mungkin sudah
    // mengetik item code lain lagi sebelum request lama selesai).
    const [lookupResult, setLookupResult] = useState<{
        itemCode: string;
        sparepart: FoundSparepart;
    } | null>(null);

    // Ref selalu berisi nilai itemCode terbaru — dipakai di dalam
    // runLookup (closure async) untuk membuang hasil yang sudah basi
    // (race condition: request lama selesai belakangan setelah user
    // sudah lanjut mengetik item code baru).
    const itemCodeRef = useRef(itemCode);
    useEffect(() => {
        itemCodeRef.current = itemCode;
    }, [itemCode]);

    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    async function runLookup(code: string) {
        setIsChecking(true);
        setLookupError(null);
        try {
            const result = await getSparepartByItemCode(code);
            if (itemCodeRef.current.trim() !== code) return; // sudah basi

            if (!result.success) {
                setLookupError(result.message);
                setLookupResult(null);
                return;
            }
            setLookupResult({ itemCode: code, sparepart: result.data });
        } catch (error) {
            if (itemCodeRef.current.trim() !== code) return;
            console.error("[SmartFormModal] unexpected error saat cek item code:", error);
            setLookupError("Terjadi kesalahan saat mengecek item code. Coba lagi.");
        } finally {
            if (itemCodeRef.current.trim() === code) setIsChecking(false);
        }
    }

    useEffect(() => {
        const trimmed = itemCode.trim();

        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = null;
        }

        if (!trimmed) {
            setIsChecking(false);
            setLookupResult(null);
            setLookupError(null);
            return;
        }

        setIsChecking(true);
        debounceTimerRef.current = setTimeout(() => {
            runLookup(trimmed);
        }, 500);

        return () => {
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
                debounceTimerRef.current = null;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [itemCode]);

    function handleItemCodeBlur() {
        const trimmed = itemCode.trim();
        if (!trimmed) return;
        // Sudah ada hasil yang cocok & tidak sedang mengecek → tidak perlu
        // request ulang (mis. user cuma klik keluar-masuk field tanpa ubah apa-apa).
        if (!isChecking && lookupResult?.itemCode === trimmed) return;

        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = null;
        }
        runLookup(trimmed);
    }

    // Mode form diturunkan murni dari itemCode + lookupResult — bukan
    // state terpisah, supaya tidak pernah ada kondisi tidak sinkron
    // antara keduanya.
    const trimmedItemCode = itemCode.trim();
    const isLookupCurrent = lookupResult !== null && lookupResult.itemCode === trimmedItemCode;

    const mode: SmartFormMode =
        trimmedItemCode === ""
            ? "EMPTY"
            : !isLookupCurrent
                ? "CHECKING"
                : lookupResult!.sparepart
                    ? "RESTOCK"
                    : "PART_BARU";

    const foundSparepart: FoundSparepartData | null =
        mode === "RESTOCK" ? (lookupResult!.sparepart as FoundSparepartData) : null;

    // ==========================================================
    // Field master — hanya relevan & bisa diedit di mode PART_BARU.
    // Di mode RESTOCK, field yang ditampilkan diambil langsung dari
    // foundSparepart (read-only), bukan dari state ini.
    // ==========================================================
    const [namaPart, setNamaPart] = useState("");
    const [spesifikasi, setSpesifikasi] = useState("");
    const [kategoriId, setKategoriId] = useState("");
    const [satuanId, setSatuanId] = useState("");
    const [keterangan, setKeterangan] = useState("");

    // Reset isian field master tiap kali form "masuk" ke mode PART_BARU
    // untuk item code yang berbeda dari sebelumnya — supaya tidak ada
    // sisa isian nyangkut dari percobaan item code lain.
    const partBaruKey = mode === "PART_BARU" ? trimmedItemCode : null;
    useEffect(() => {
        if (partBaruKey === null) return;
        setNamaPart("");
        setSpesifikasi("");
        setKategoriId("");
        setSatuanId("");
        setKeterangan("");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [partBaruKey]);

    // ==========================================================
    // Stok per Line — 5 baris (LINE_1..GENERAL), dipakai KEDUA mode.
    // ==========================================================
    const [lineStockDrafts, setLineStockDrafts] =
        useState<Record<Line, LineStockDraft>>(emptyLineStockDrafts);

    function updateLineStockDraft(
        lineKey: Line,
        field: "jumlah" | "minStok",
        value: string
    ) {
        setLineStockDrafts((prev) => ({
            ...prev,
            [lineKey]: { ...prev[lineKey], [field]: value },
        }));
    }

    const hasAnyJumlahFilled = LINES.some(
        (line) => lineStockDrafts[line.key].jumlah.trim() !== ""
    );

    // ==========================================================
    // Validasi & submit
    // ==========================================================
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    const isFormValid =
        mode === "PART_BARU"
            ? namaPart.trim() !== "" && kategoriId !== "" && satuanId !== ""
            : mode === "RESTOCK"
                ? hasAnyJumlahFilled
                : false;

    // Susun payload lineStocks: baris dengan "Jumlah" kosong DILEWATI
    // sepenuhnya (termasuk minStok-nya) — persis pola yang dipakai
    // submitSmartForm di server (lineStocksToApply = filter jumlah > 0).
    function buildLineStocksPayload():
        | { ok: true; lineStocks: SubmitSmartFormInput["lineStocks"] }
        | { ok: false; message: string } {
        const lineStocks: SubmitSmartFormInput["lineStocks"] = [];

        for (const line of LINES) {
            const draft = lineStockDrafts[line.key];
            const jumlahTrimmed = draft.jumlah.trim();
            if (jumlahTrimmed === "") continue;

            const jumlah = Number(jumlahTrimmed);
            if (Number.isNaN(jumlah) || jumlah <= 0) {
                return {
                    ok: false,
                    message: `Jumlah untuk ${line.label} harus berupa angka lebih dari 0`,
                };
            }

            let minStok: number | undefined;
            const minTrimmed = draft.minStok.trim();
            if (minTrimmed !== "") {
                const parsedMin = Number(minTrimmed);
                if (Number.isNaN(parsedMin) || parsedMin < 0) {
                    return {
                        ok: false,
                        message: `Min Stok untuk ${line.label} harus berupa angka 0 atau lebih`,
                    };
                }
                minStok = parsedMin;
            }

            lineStocks.push({ line: line.key, jumlah, minStok });
        }

        return { ok: true, lineStocks };
    }

    async function handleSubmit() {
        if (isSaving || !isFormValid) return;
        setSaveError(null);

        const lineStocksResult = buildLineStocksPayload();
        if (!lineStocksResult.ok) {
            setSaveError(lineStocksResult.message);
            return;
        }

        if (mode === "RESTOCK" && lineStocksResult.lineStocks.length === 0) {
            setSaveError("Isi minimal 1 jumlah restock");
            return;
        }

        const payload: SubmitSmartFormInput =
            mode === "PART_BARU"
                ? {
                    itemCode: trimmedItemCode,
                    namaPart: namaPart.trim(),
                    spesifikasi: spesifikasi.trim() || undefined,
                    keterangan: keterangan.trim() || undefined,
                    kategoriId,
                    satuanId,
                    lineStocks: lineStocksResult.lineStocks,
                }
                : {
                    itemCode: trimmedItemCode,
                    lineStocks: lineStocksResult.lineStocks,
                };

        setIsSaving(true);
        try {
            const result = await submitSmartForm(payload);
            if (!result.success) {
                setIsSaving(false);
                setSaveError(result.message);
                return; // modal tetap terbuka, pesan error tampil di dalamnya
            }
            setIsSaving(false);
            onSuccess();
        } catch (error) {
            // Jaring pengaman untuk exception tak terduga di luar
            // { success: false } — kelas masalah yang sama seperti yang
            // sudah ditangani submitStokField di sparepart-grid.tsx.
            console.error("[SmartFormModal] unexpected error saat submit:", error);
            setIsSaving(false);
            setSaveError("Terjadi kesalahan tak terduga saat menyimpan. Coba lagi.");
        }
    }

    // ==========================================================
    // Render
    // ==========================================================
    const showMasterFields = mode === "RESTOCK" || mode === "PART_BARU";
    const showLineStockSection = mode === "RESTOCK" || mode === "PART_BARU";
    const masterFieldsLocked = mode === "RESTOCK";

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
            onMouseDown={(event) => {
                // Klik backdrop = batal, kecuali sedang proses simpan.
                if (event.target === event.currentTarget && !isSaving) {
                    onClose();
                }
            }}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="smart-form-title"
                className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg border border-ink/20 bg-surface shadow-xl ring-1 ring-primary/10"
            >
                {/* Header */}
                <div className="flex items-center justify-between border-b border-ink/10 px-4 py-3">
                    <div className="flex items-center gap-2">
                        <h2
                            id="smart-form-title"
                            className="font-sans text-sm font-semibold text-ink"
                        >
                            Tambah / Restock Sparepart
                        </h2>
                        {mode === "RESTOCK" && (
                            <span className="rounded-full bg-primary/10 px-2 py-0.5 font-sans text-[10px] font-semibold uppercase tracking-wide text-primary">
                                Mode: Restock
                            </span>
                        )}
                        {mode === "PART_BARU" && (
                            <span className="rounded-full bg-ink/10 px-2 py-0.5 font-sans text-[10px] font-semibold uppercase tracking-wide text-muted">
                                Mode: Part Baru
                            </span>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isSaving}
                        aria-label="Tutup"
                        className="rounded p-1 text-muted hover:bg-ink/5 disabled:opacity-60"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {/* Body (scrollable) */}
                <div className="flex-1 overflow-y-auto px-4 py-4">
                    {/* Item Code — field pertama, font-mono sesuai konvensi kolom
                        itemCode di tabel. */}
                    <div className="mb-4">
                        <label
                            htmlFor="smart-form-item-code"
                            className="mb-1 block font-sans text-xs font-medium text-ink"
                        >
                            Item Code
                        </label>
                        <div className="relative">
                            <input
                                id="smart-form-item-code"
                                type="text"
                                autoFocus
                                value={itemCode}
                                onChange={(e) => setItemCode(e.target.value)}
                                onBlur={handleItemCodeBlur}
                                disabled={isSaving}
                                placeholder="Masukkan item code..."
                                className="w-full rounded border border-ink/20 bg-app-bg px-3 py-2 pr-9 font-mono text-sm text-ink focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:opacity-60"
                            />
                            {isChecking && (
                                <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted" />
                            )}
                        </div>
                        {lookupError && (
                            <p className="mt-1 font-sans text-xs text-status-danger">
                                {lookupError}
                            </p>
                        )}
                    </div>

                    {masterDataError && (
                        <p className="mb-4 rounded border border-status-danger/30 bg-status-danger/10 px-2.5 py-1.5 font-sans text-xs text-status-danger">
                            {masterDataError}
                        </p>
                    )}

                    {/* Field master */}
                    {!showMasterFields ? (
                        <p className="mb-4 rounded border border-dashed border-ink/20 bg-app-bg px-3 py-4 text-center font-sans text-xs text-muted">
                            {mode === "CHECKING"
                                ? "Mengecek item code..."
                                : "Isi Item Code terlebih dahulu"}
                        </p>
                    ) : (
                        <div className="mb-4 space-y-3">
                            {/* Nama Part */}
                            <div>
                                <label className="mb-1 block font-sans text-xs font-medium text-ink">
                                    Nama Part{" "}
                                    {mode === "PART_BARU" && (
                                        <span className="text-status-danger">*</span>
                                    )}
                                </label>
                                <input
                                    type="text"
                                    value={
                                        mode === "RESTOCK"
                                            ? (foundSparepart?.namaPart ?? "")
                                            : namaPart
                                    }
                                    onChange={(e) => setNamaPart(e.target.value)}
                                    disabled={masterFieldsLocked || isSaving}
                                    placeholder="Nama part..."
                                    className={inputClass(masterFieldsLocked)}
                                />
                            </div>

                            {/* Spesifikasi */}
                            <div>
                                <label className="mb-1 block font-sans text-xs font-medium text-ink">
                                    Spesifikasi
                                </label>
                                <input
                                    type="text"
                                    value={
                                        mode === "RESTOCK"
                                            ? (foundSparepart?.spesifikasi ?? "")
                                            : spesifikasi
                                    }
                                    onChange={(e) => setSpesifikasi(e.target.value)}
                                    disabled={masterFieldsLocked || isSaving}
                                    placeholder="Spesifikasi (opsional)..."
                                    className={inputClass(masterFieldsLocked)}
                                />
                            </div>

                            {/* Kategori + Satuan */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="mb-1 block font-sans text-xs font-medium text-ink">
                                        Kategori{" "}
                                        {mode === "PART_BARU" && (
                                            <span className="text-status-danger">*</span>
                                        )}
                                    </label>
                                    {mode === "RESTOCK" ? (
                                        <input
                                            type="text"
                                            value={foundSparepart?.kategori.nama ?? ""}
                                            disabled
                                            className={inputClass(true)}
                                        />
                                    ) : (
                                        <SearchableSelect
                                            options={kategoriOptions}
                                            value={kategoriId}
                                            onChange={setKategoriId}
                                            placeholder="— Pilih Kategori —"
                                            disabled={isSaving}
                                            loading={isMasterDataLoading}
                                        />
                                    )}
                                </div>
                                <div>
                                    <label className="mb-1 block font-sans text-xs font-medium text-ink">
                                        Satuan{" "}
                                        {mode === "PART_BARU" && (
                                            <span className="text-status-danger">*</span>
                                        )}
                                    </label>
                                    {mode === "RESTOCK" ? (
                                        <input
                                            type="text"
                                            value={foundSparepart?.satuan.nama ?? ""}
                                            disabled
                                            className={inputClass(true)}
                                        />
                                    ) : (
                                        <SearchableSelect
                                            options={satuanOptions}
                                            value={satuanId}
                                            onChange={setSatuanId}
                                            placeholder="— Pilih Satuan —"
                                            disabled={isSaving}
                                            loading={isMasterDataLoading}
                                        />
                                    )}
                                </div>
                            </div>

                            {/* Keterangan */}
                            <div>
                                <label className="mb-1 block font-sans text-xs font-medium text-ink">
                                    Keterangan
                                </label>
                                <textarea
                                    rows={2}
                                    value={
                                        mode === "RESTOCK"
                                            ? (foundSparepart?.keterangan ?? "")
                                            : keterangan
                                    }
                                    onChange={(e) => setKeterangan(e.target.value)}
                                    disabled={masterFieldsLocked || isSaving}
                                    placeholder="Keterangan (opsional)..."
                                    className={`${inputClass(masterFieldsLocked)} resize-y`}
                                />
                            </div>
                        </div>
                    )}

                    {/* Stok per Line */}
                    {showLineStockSection && (
                        <div>
                            <p className="mb-2 font-sans text-xs font-semibold uppercase tracking-wide text-muted">
                                Stok per Line
                            </p>
                            <div className="space-y-2 rounded border border-ink/10 bg-app-bg p-3">
                                <div className="grid grid-cols-[56px_1fr_1fr] gap-2 font-sans text-[10px] font-medium uppercase tracking-wide text-muted">
                                    <span>Line</span>
                                    <span>Jumlah</span>
                                    <span>Min Stok</span>
                                </div>
                                {LINES.map((line) => (
                                    <div
                                        key={line.key}
                                        className="grid grid-cols-[56px_1fr_1fr] items-center gap-2"
                                    >
                                        <span className="font-sans text-xs font-medium text-ink">
                                            {line.label}
                                        </span>
                                        <input
                                            type="number"
                                            value={lineStockDrafts[line.key].jumlah}
                                            onChange={(e) =>
                                                updateLineStockDraft(
                                                    line.key,
                                                    "jumlah",
                                                    e.target.value
                                                )
                                            }
                                            disabled={isSaving}
                                            placeholder="0"
                                            className="w-full rounded border border-ink/20 bg-surface px-2 py-1 font-sans text-sm text-ink focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:opacity-60"
                                        />
                                        <input
                                            type="number"
                                            value={lineStockDrafts[line.key].minStok}
                                            onChange={(e) =>
                                                updateLineStockDraft(
                                                    line.key,
                                                    "minStok",
                                                    e.target.value
                                                )
                                            }
                                            disabled={isSaving}
                                            placeholder="-"
                                            className="w-full rounded border border-ink/20 bg-surface px-2 py-1 font-sans text-sm text-ink focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:opacity-60"
                                        />
                                    </div>
                                ))}
                            </div>
                            <p className="mt-1.5 font-sans text-[11px] text-muted">
                                Isi &quot;Jumlah&quot; hanya pada line yang mau ditambah stoknya —
                                baris yang dikosongkan tidak disentuh sama sekali. &quot;Min
                                Stok&quot; hanya diterapkan pada baris yang &quot;Jumlah&quot;-nya
                                juga diisi.
                            </p>
                        </div>
                    )}

                    {saveError && (
                        <p className="mt-4 rounded border border-status-danger/30 bg-status-danger/10 px-2.5 py-1.5 font-sans text-xs text-status-danger">
                            {saveError}
                        </p>
                    )}
                </div>

                {/* Footer */}
                <div className="flex justify-end gap-2 border-t border-ink/10 px-4 py-3">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isSaving}
                        className="rounded px-3 py-1.5 font-sans text-sm text-muted hover:bg-ink/5 disabled:opacity-60"
                    >
                        Batal
                    </button>
                    <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={!isFormValid || isSaving}
                        className="flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 font-sans text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60"
                    >
                        {isSaving ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <Check className="h-3.5 w-3.5" />
                        )}
                        Simpan
                    </button>
                </div>
            </div>
        </div>
    );
}