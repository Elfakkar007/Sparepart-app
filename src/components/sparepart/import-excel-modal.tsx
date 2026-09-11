"use client";

import {
    useMemo,
    useRef,
    useState,
    type ChangeEvent,
    type DragEvent,
} from "react";
import * as XLSX from "xlsx";
import {
    ArrowLeft,
    ArrowRight,
    CheckCircle2,
    FileSpreadsheet,
    Loader2,
    Upload,
    X,
    XCircle,
} from "lucide-react";
import {
    importSparepartExcel,
    type ImportSparepartExcelResult,
} from "@/lib/actions/sparepart";

// ==========================================================
// FIELD SISTEM — daftar field yang bisa dipetakan dari kolom Excel.
//
// `matchHints`: dipakai auto-match tahap mapping. Tiap hint & tiap
// header kolom Excel dinormalisasi (lowercase, tanpa spasi/simbol) lalu
// dicocokkan longgar (substring dua arah) — lihat normalizeHeader &
// autoMatchColumns di bawah. Hint sengaja TIDAK memakai kata generik
// seperti "stok" atau "nama" sendirian, supaya field "Jumlah Line 1"
// dan "Min Stok Line 1" (atau "Nama Part" vs "Nama Kategori") tidak
// auto-match ke kolom yang salah karena sama-sama mengandung kata itu.
//
// `isNumeric`: menentukan field ini dikonversi ke Number saat
// buildMappedData, bukan disimpan sebagai string.
// ==========================================================

export type SystemFieldKey =
    | "itemCode"
    | "namaPart"
    | "spesifikasi"
    | "keterangan"
    | "kategoriNama"
    | "satuanNama"
    | "lokasiRakNama"
    | "jumlahLine1"
    | "minStokLine1"
    | "jumlahLine2"
    | "minStokLine2"
    | "jumlahLine3"
    | "minStokLine3"
    | "jumlahLine4"
    | "minStokLine4"
    | "jumlahGeneral"
    | "minStokGeneral";

type SystemFieldDef = {
    key: SystemFieldKey;
    label: string;
    required?: boolean;
    isNumeric?: boolean;
    matchHints: string[];
};

const SYSTEM_FIELDS: SystemFieldDef[] = [
    {
        key: "itemCode",
        label: "Item Code",
        required: true,
        matchHints: ["itemcode", "item code", "kodeitem", "kode item", "kodepart", "kode part", "sku"],
    },
    {
        key: "namaPart",
        label: "Nama Part",
        matchHints: ["namapart", "nama part", "partname", "part name", "nama barang"],
    },
    {
        key: "spesifikasi",
        label: "Spesifikasi",
        matchHints: ["spesifikasi", "specification", "spec", "spek"],
    },
    {
        key: "keterangan",
        label: "Keterangan",
        matchHints: ["keterangan", "catatan", "notes", "note", "remark"],
    },
    {
        key: "kategoriNama",
        label: "Kategori",
        matchHints: ["kategori", "category", "namakategori", "categoryname"],
    },
    {
        key: "satuanNama",
        label: "Satuan",
        matchHints: ["satuan", "unit", "uom", "namasatuan"],
    },
    {
        key: "lokasiRakNama",
        label: "Lokasi Rak",
        matchHints: ["lokasirak", "lokasi rak", "rak", "location", "namalokasirak"],
    },
    {
        key: "jumlahLine1",
        label: "Jumlah — Line 1",
        isNumeric: true,
        matchHints: ["jumlahline1", "jumlah line1", "jumlah line 1", "qtyline1", "qty line1", "qty line 1"],
    },
    {
        key: "minStokLine1",
        label: "Min Stok — Line 1",
        isNumeric: true,
        matchHints: ["minstokline1", "min stok line1", "min stok line 1", "minline1", "min line1", "min line 1"],
    },
    {
        key: "jumlahLine2",
        label: "Jumlah — Line 2",
        isNumeric: true,
        matchHints: ["jumlahline2", "jumlah line2", "jumlah line 2", "qtyline2", "qty line2", "qty line 2"],
    },
    {
        key: "minStokLine2",
        label: "Min Stok — Line 2",
        isNumeric: true,
        matchHints: ["minstokline2", "min stok line2", "min stok line 2", "minline2", "min line2", "min line 2"],
    },
    {
        key: "jumlahLine3",
        label: "Jumlah — Line 3",
        isNumeric: true,
        matchHints: ["jumlahline3", "jumlah line3", "jumlah line 3", "qtyline3", "qty line3", "qty line 3"],
    },
    {
        key: "minStokLine3",
        label: "Min Stok — Line 3",
        isNumeric: true,
        matchHints: ["minstokline3", "min stok line3", "min stok line 3", "minline3", "min line3", "min line 3"],
    },
    {
        key: "jumlahLine4",
        label: "Jumlah — Line 4",
        isNumeric: true,
        matchHints: ["jumlahline4", "jumlah line4", "jumlah line 4", "qtyline4", "qty line4", "qty line 4"],
    },
    {
        key: "minStokLine4",
        label: "Min Stok — Line 4",
        isNumeric: true,
        matchHints: ["minstokline4", "min stok line4", "min stok line 4", "minline4", "min line4", "min line 4"],
    },
    {
        key: "jumlahGeneral",
        label: "Jumlah — General",
        isNumeric: true,
        matchHints: ["jumlahgeneral", "jumlah general", "qtygeneral", "qty general"],
    },
    {
        key: "minStokGeneral",
        label: "Min Stok — General",
        isNumeric: true,
        matchHints: ["minstokgeneral", "min stok general", "mingeneral", "min general"],
    },
];

const SYSTEM_FIELDS_BY_KEY = new Map(SYSTEM_FIELDS.map((field) => [field.key, field]));

// Pengelompokan murni untuk tampilan tahap mapping (supaya tidak jadi 1
// daftar rata 17 baris) — tidak mempengaruhi logic mapping/auto-match.
const FIELD_GROUPS: { title: string; keys: SystemFieldKey[] }[] = [
    { title: "Data Umum", keys: ["itemCode", "namaPart", "spesifikasi", "keterangan"] },
    {
        title: "Master (nama dicocokkan nanti, tidak divalidasi di sini)",
        keys: ["kategoriNama", "satuanNama", "lokasiRakNama"],
    },
    { title: "Stok — Line 1", keys: ["jumlahLine1", "minStokLine1"] },
    { title: "Stok — Line 2", keys: ["jumlahLine2", "minStokLine2"] },
    { title: "Stok — Line 3", keys: ["jumlahLine3", "minStokLine3"] },
    { title: "Stok — Line 4", keys: ["jumlahLine4", "minStokLine4"] },
    { title: "Stok — General", keys: ["jumlahGeneral", "minStokGeneral"] },
];

// Pilihan kolom Excel per field sistem — disimpan sebagai INDEX kolom
// (bukan nama header), supaya tetap unik & benar walau ada 2 header
// dengan teks yang sama persis. `null` = "Tidak dipetakan".
type ColumnMapping = Record<SystemFieldKey, number | null>;

const EMPTY_MAPPING: ColumnMapping = SYSTEM_FIELDS.reduce((acc, field) => {
    acc[field.key] = null;
    return acc;
}, {} as ColumnMapping);

// 1 baris = 1 array nilai sel mentah dari SheetJS, BELUM divalidasi atau
// dikonversi sama sekali — itu tugas Server Action di tahap berikutnya,
// bukan tahap parsing/mapping di modal ini.
type RawRow = unknown[];

type MappedRow = Partial<Record<SystemFieldKey, string | number>>;

function normalizeHeader(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Auto-match SEDERHANA: field sistem dicek berurutan sesuai SYSTEM_FIELDS
// (itemCode dulu, dst), dicocokkan ke header Excel yang BELUM "diambil"
// field lain, lewat substring dua arah setelah dinormalisasi. Kalau tidak
// ada header yang cocok, field itu dibiarkan null ("Tidak dipetakan").
function autoMatchColumns(headers: string[]): ColumnMapping {
    const normalizedHeaders = headers.map(normalizeHeader);
    const usedColumns = new Set<number>();
    const mapping: ColumnMapping = { ...EMPTY_MAPPING };

    for (const field of SYSTEM_FIELDS) {
        const matchIndex = normalizedHeaders.findIndex((header, index) => {
            if (usedColumns.has(index) || !header) return false;
            return field.matchHints.some((hint) => {
                const normalizedHint = normalizeHeader(hint);
                return (
                    header === normalizedHint ||
                    header.includes(normalizedHint) ||
                    normalizedHint.includes(header)
                );
            });
        });

        if (matchIndex !== -1) {
            mapping[field.key] = matchIndex;
            usedColumns.add(matchIndex);
        }
    }

    return mapping;
}

// Baca SHEET PERTAMA sebuah file .xlsx/.xls di client (SheetJS). Baris
// pertama sheet = header kolom, semua baris setelahnya = data mentah
// apa adanya (array of array) — tidak diproses/divalidasi di sini.
async function parseWorkbookFile(
    file: File
): Promise<{ headers: string[]; rows: RawRow[] }> {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });

    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
        throw new Error("File tidak punya sheet sama sekali");
    }
    const sheet = workbook.Sheets[firstSheetName];

    // header: 1 -> hasilnya array of array (baris ke-0 = header), BUKAN
    // langsung di-parse jadi object per baris.
    const rawSheetRows = XLSX.utils.sheet_to_json<RawRow>(sheet, {
        header: 1,
        defval: "",
        blankrows: false,
    });

    const [headerRow, ...dataRows] = rawSheetRows;
    if (!headerRow || headerRow.length === 0) {
        throw new Error("Baris header tidak ditemukan di sheet pertama");
    }

    const headers = headerRow.map((cell) => String(cell ?? "").trim());
    return { headers, rows: dataRows };
}

// Bangun array of object final sesuai mapping yang SEDANG dipilih user.
// Kolom yang tidak dipetakan / sel kosong -> field itu tidak disertakan
// di objek baris (bukan "" atau 0). Field numerik dikonversi ke Number
// (kalau hasilnya NaN, diperlakukan sama seperti kosong / dilewati).
function buildMappedData(rows: RawRow[], mapping: ColumnMapping): MappedRow[] {
    return rows.map((row) => {
        const result: MappedRow = {};

        for (const field of SYSTEM_FIELDS) {
            const columnIndex = mapping[field.key];
            if (columnIndex === null) continue;

            const rawValue = row[columnIndex];
            if (rawValue === undefined || rawValue === null || rawValue === "") {
                continue;
            }

            if (field.isNumeric) {
                const numericValue = Number(rawValue);
                if (!Number.isNaN(numericValue)) {
                    result[field.key] = numericValue;
                }
            } else {
                result[field.key] = String(rawValue).trim();
            }
        }

        return result;
    });
}

type ImportExcelModalProps = {
    onClose: () => void;
    /**
     * Dipanggil setelah user menekan "Tutup" di tahap hasil (bukan
     * setelah importSparepartExcel selesai — proses bisa selesai dengan
     * sebagian/semua baris gagal dan user masih perlu baca ringkasannya
     * dulu). Sama seperti SmartFormModal: parent (SparepartGrid) yang
     * bertanggung jawab menutup modal ini DAN me-refresh data grid
     * (router.refresh()) — modal ini sendiri tidak tahu apa-apa soal grid.
     */
    onSuccess?: () => void;
};

export function ImportExcelModal({ onClose, onSuccess }: ImportExcelModalProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [currentStep, setCurrentStep] = useState<"upload" | "mapping" | "hasil">(
        "upload"
    );
    const [isDragActive, setIsDragActive] = useState(false);
    const [isParsing, setIsParsing] = useState(false);
    const [parseError, setParseError] = useState<string | null>(null);

    const [fileName, setFileName] = useState<string | null>(null);
    const [headers, setHeaders] = useState<string[]>([]);
    const [rawRows, setRawRows] = useState<RawRow[]>([]);
    const [mapping, setMapping] = useState<ColumnMapping>(EMPTY_MAPPING);

    // Tahap "hasil" — hasil dari importSparepartExcel (server action),
    // ditampilkan sebagai ringkasan + tabel detail per baris.
    const [isProcessing, setIsProcessing] = useState(false);
    const [processError, setProcessError] = useState<string | null>(null);
    const [importResult, setImportResult] = useState<ImportSparepartExcelResult | null>(
        null
    );

    // Dipakai supaya klik backdrop / tombol close tidak menutup modal
    // begitu saja di tengah proses baca file ATAU di tengah proses import
    // (bisa banyak baris, jangan sampai user menutup modal sebelum
    // selesai lalu bingung apakah datanya sudah masuk atau belum).
    const isBusy = isParsing || isProcessing;

    async function handleFile(file: File) {
        setParseError(null);
        setIsParsing(true);

        try {
            const { headers: parsedHeaders, rows } = await parseWorkbookFile(file);
            setFileName(file.name);
            setHeaders(parsedHeaders);
            setRawRows(rows);
            setMapping(autoMatchColumns(parsedHeaders));
        } catch (error) {
            console.error("[ImportExcelModal] gagal membaca file:", error);
            setFileName(null);
            setHeaders([]);
            setRawRows([]);
            setMapping(EMPTY_MAPPING);
            setParseError(
                "Gagal membaca file. Pastikan file berformat .xlsx/.xls dan sheet pertama punya baris header."
            );
        } finally {
            setIsParsing(false);
        }
    }

    function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        // Reset value supaya user bisa pilih file yang SAMA dua kali
        // berturut-turut dan tetap trigger onChange.
        event.target.value = "";
        if (file) void handleFile(file);
    }

    function handleDrop(event: DragEvent<HTMLDivElement>) {
        event.preventDefault();
        setIsDragActive(false);
        const file = event.dataTransfer.files?.[0];
        if (file) void handleFile(file);
    }

    function handleMappingChange(key: SystemFieldKey, rawValue: string) {
        setMapping((prev) => ({
            ...prev,
            [key]: rawValue === "" ? null : Number(rawValue),
        }));
    }

    async function handleProcessImport() {
        if (isProcessing) return;

        const mappedData = buildMappedData(rawRows, mapping);

        setProcessError(null);
        setIsProcessing(true);
        try {
            const result = await importSparepartExcel(mappedData);
            if (!result.success) {
                // Kegagalan action itu sendiri (bukan per-baris) — mis.
                // gagal memuat master data di awal. Tetap di tahap
                // mapping supaya user bisa coba lagi.
                setProcessError(result.message);
                return;
            }
            setImportResult(result.data);
            setCurrentStep("hasil");
        } catch (error) {
            console.error("[ImportExcelModal] gagal memproses import:", error);
            setProcessError(
                "Terjadi kesalahan tak terduga saat memproses import. Coba lagi."
            );
        } finally {
            setIsProcessing(false);
        }
    }

    // Tombol "Tutup" di tahap hasil — beda dengan onClose (Batal) di
    // tahap upload/mapping, ini SELALU berarti proses import sudah
    // selesai dijalankan (baik semua sukses maupun sebagian gagal),
    // jadi grid tetap perlu di-refresh supaya baris yang berhasil
    // langsung kelihatan.
    function handleCloseAfterResult() {
        if (typeof onSuccess === "function") {
            onSuccess();
        }
        onClose();
    }

    const isItemCodeMapped = mapping.itemCode !== null;

    const previewFields = useMemo(
        () => SYSTEM_FIELDS.filter((field) => mapping[field.key] !== null),
        [mapping]
    );
    const previewRows = useMemo(() => rawRows.slice(0, 3), [rawRows]);

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
            onMouseDown={(event) => {
                // Klik di backdrop (bukan di panel-nya) = tutup, kecuali
                // sedang proses baca file/import. Di tahap "hasil" proses
                // import SUDAH selesai dijalankan, jadi tutup lewat sini
                // juga harus tetap refresh grid — sama seperti tombol
                // "Tutup" — bukan cuma dibatalkan begitu saja.
                if (event.target === event.currentTarget && !isBusy) {
                    if (currentStep === "hasil") {
                        handleCloseAfterResult();
                    } else {
                        onClose();
                    }
                }
            }}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="import-excel-title"
                className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg border border-ink/20 bg-surface shadow-xl ring-1 ring-primary/10"
            >
                <div className="flex items-center justify-between border-b border-ink/10 px-5 py-4">
                    <div>
                        <h2
                            id="import-excel-title"
                            className="font-sans text-sm font-semibold text-ink"
                        >
                            Import dari Excel
                        </h2>
                        <p className="mt-0.5 font-sans text-xs text-muted">
                            {currentStep === "upload"
                                ? "Tahap 1/3 — Unggah file"
                                : currentStep === "mapping"
                                    ? "Tahap 2/3 — Petakan kolom"
                                    : "Tahap 3/3 — Hasil import"}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={currentStep === "hasil" ? handleCloseAfterResult : onClose}
                        disabled={isBusy}
                        aria-label="Tutup"
                        className="rounded p-1 text-muted hover:bg-ink/5 disabled:opacity-60"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto px-5 py-4">
                    {currentStep === "upload" ? (
                        <>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".xlsx,.xls"
                                onChange={handleInputChange}
                                className="hidden"
                            />
                            <div
                                onClick={() => fileInputRef.current?.click()}
                                onDragOver={(event) => {
                                    event.preventDefault();
                                    setIsDragActive(true);
                                }}
                                onDragLeave={() => setIsDragActive(false)}
                                onDrop={handleDrop}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter" || event.key === " ") {
                                        event.preventDefault();
                                        fileInputRef.current?.click();
                                    }
                                }}
                                className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors ${isDragActive
                                    ? "border-primary bg-primary/5"
                                    : "border-ink/20 bg-app-bg hover:border-primary/40"
                                    }`}
                            >
                                {isParsing ? (
                                    <Loader2 className="h-7 w-7 animate-spin text-primary" />
                                ) : (
                                    <Upload className="h-7 w-7 text-muted" />
                                )}
                                <p className="mt-3 font-sans text-sm font-medium text-ink">
                                    {fileName ?? "Klik atau seret file ke sini"}
                                </p>
                                <p className="mt-1 font-sans text-xs text-muted">
                                    Format .xlsx atau .xls — sheet pertama & baris pertama
                                    dibaca sebagai header
                                </p>
                            </div>

                            {parseError && (
                                <p className="mt-3 rounded border border-status-danger/30 bg-status-danger/10 px-3 py-2 font-sans text-xs text-status-danger">
                                    {parseError}
                                </p>
                            )}

                            {!parseError && headers.length > 0 && (
                                <div className="mt-3 flex items-center gap-2 rounded border border-primary/30 bg-primary/5 px-3 py-2">
                                    <FileSpreadsheet className="h-4 w-4 shrink-0 text-primary" />
                                    <p className="font-sans text-xs text-ink">
                                        <span className="font-medium">{headers.length}</span> kolom
                                        terdeteksi,{" "}
                                        <span className="font-medium">{rawRows.length}</span> baris
                                        data ditemukan.
                                    </p>
                                </div>
                            )}
                        </>
                    ) : currentStep === "mapping" ? (
                        <>
                            <p className="mb-3 font-sans text-xs text-muted">
                                Cocokkan tiap field sistem dengan kolom dari file{" "}
                                <span className="font-medium text-ink">{fileName}</span>. Field
                                bertanda <span className="text-status-danger">*</span> wajib
                                dipetakan.
                            </p>

                            <div className="rounded-lg border border-ink/10">
                                {FIELD_GROUPS.map((group, groupIdx) => (
                                    <div
                                        key={group.title}
                                        className={groupIdx > 0 ? "border-t border-ink/10" : ""}
                                    >
                                        <p className="bg-app-bg px-3 py-1.5 font-sans text-[11px] font-semibold uppercase tracking-wide text-muted">
                                            {group.title}
                                        </p>
                                        {group.keys.map((key) => {
                                            const field = SYSTEM_FIELDS_BY_KEY.get(key)!;
                                            return (
                                                <div
                                                    key={key}
                                                    className="flex items-center justify-between gap-3 border-t border-ink/10 px-3 py-2"
                                                >
                                                    <span className="font-sans text-sm text-ink">
                                                        {field.label}
                                                        {field.required && (
                                                            <span className="ml-1 text-status-danger">
                                                                *
                                                            </span>
                                                        )}
                                                    </span>
                                                    <select
                                                        value={mapping[key] ?? ""}
                                                        onChange={(event) =>
                                                            handleMappingChange(key, event.target.value)
                                                        }
                                                        className="w-56 shrink-0 rounded-md border border-ink/20 bg-surface px-2.5 py-1.5 font-sans text-sm text-ink focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
                                                    >
                                                        <option value="">— Tidak dipetakan —</option>
                                                        {headers.map((header, index) => (
                                                            <option key={index} value={index}>
                                                                {header || `Kolom ${index + 1}`}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ))}
                            </div>

                            {!isItemCodeMapped && (
                                <p className="mt-2 font-sans text-xs text-status-danger">
                                    Item Code wajib dipetakan sebelum bisa diproses.
                                </p>
                            )}

                            <p className="mb-1.5 mt-4 font-sans text-xs font-semibold uppercase tracking-wide text-muted">
                                Preview 3 baris pertama
                            </p>
                            {previewFields.length === 0 ? (
                                <p className="rounded border border-ink/10 bg-app-bg px-3 py-4 text-center font-sans text-xs text-muted">
                                    Belum ada kolom yang dipetakan.
                                </p>
                            ) : (
                                <div className="overflow-x-auto rounded border border-ink/10">
                                    <table className="w-full border-collapse text-left text-xs">
                                        <thead>
                                            <tr className="bg-app-bg">
                                                {previewFields.map((field) => (
                                                    <th
                                                        key={field.key}
                                                        className="border-b border-ink/10 px-2.5 py-1.5 font-sans font-semibold text-ink"
                                                    >
                                                        {field.label}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {previewRows.length === 0 ? (
                                                <tr>
                                                    <td
                                                        colSpan={previewFields.length}
                                                        className="px-2.5 py-3 text-center font-sans text-muted"
                                                    >
                                                        Tidak ada baris data
                                                    </td>
                                                </tr>
                                            ) : (
                                                previewRows.map((row, rowIdx) => (
                                                    <tr
                                                        key={rowIdx}
                                                        className={rowIdx % 2 === 0 ? "bg-surface" : "bg-app-bg"}
                                                    >
                                                        {previewFields.map((field) => {
                                                            const columnIndex = mapping[field.key];
                                                            const value =
                                                                columnIndex !== null ? row[columnIndex] : "";
                                                            return (
                                                                <td
                                                                    key={field.key}
                                                                    className="max-w-[160px] truncate border-b border-ink/10 px-2.5 py-1.5 font-sans text-ink"
                                                                >
                                                                    {value === undefined ||
                                                                        value === null ||
                                                                        value === ""
                                                                        ? "-"
                                                                        : String(value)}
                                                                </td>
                                                            );
                                                        })}
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            {isProcessing && (
                                <div className="mt-3 flex items-center gap-2 rounded border border-primary/30 bg-primary/5 px-3 py-2">
                                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                                    <p className="font-sans text-xs text-ink">
                                        Memproses... jangan tutup jendela ini sampai selesai.
                                    </p>
                                </div>
                            )}

                            {processError && (
                                <p className="mt-3 rounded border border-status-danger/30 bg-status-danger/10 px-3 py-2 font-sans text-xs text-status-danger">
                                    {processError}
                                </p>
                            )}
                        </>
                    ) : (
                        <>
                            <div className="rounded-lg border border-ink/10 bg-app-bg px-4 py-3">
                                <p className="font-sans text-sm text-ink">
                                    <span className="font-semibold text-status-safe">
                                        {importResult?.totalSukses ?? 0} berhasil
                                    </span>
                                    {", "}
                                    <span className="font-semibold text-status-danger">
                                        {importResult?.totalGagal ?? 0} gagal
                                    </span>{" "}
                                    dari{" "}
                                    <span className="font-semibold">
                                        {(importResult?.totalSukses ?? 0) +
                                            (importResult?.totalGagal ?? 0)}
                                    </span>{" "}
                                    baris total.
                                </p>
                            </div>

                            <div className="mt-3 max-h-80 overflow-y-auto rounded-lg border border-ink/10">
                                <table className="w-full border-collapse text-left text-xs">
                                    <thead className="sticky top-0">
                                        <tr className="bg-app-bg">
                                            <th className="border-b border-ink/10 px-2.5 py-1.5 font-sans font-semibold text-ink">
                                                Baris
                                            </th>
                                            <th className="border-b border-ink/10 px-2.5 py-1.5 font-sans font-semibold text-ink">
                                                Item Code
                                            </th>
                                            <th className="border-b border-ink/10 px-2.5 py-1.5 font-sans font-semibold text-ink">
                                                Status
                                            </th>
                                            <th className="border-b border-ink/10 px-2.5 py-1.5 font-sans font-semibold text-ink">
                                                Keterangan
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(importResult?.hasil.length ?? 0) === 0 ? (
                                            <tr>
                                                <td
                                                    colSpan={4}
                                                    className="px-2.5 py-3 text-center font-sans text-muted"
                                                >
                                                    Tidak ada baris yang diproses.
                                                </td>
                                            </tr>
                                        ) : (
                                            importResult!.hasil.map((item, index) => (
                                                <tr
                                                    key={`${item.row}-${item.itemCode}`}
                                                    className={index % 2 === 0 ? "bg-surface" : "bg-app-bg"}
                                                >
                                                    <td className="border-b border-ink/10 px-2.5 py-1.5 font-sans text-ink">
                                                        {item.row}
                                                    </td>
                                                    <td className="max-w-[140px] truncate border-b border-ink/10 px-2.5 py-1.5 font-sans text-ink">
                                                        {item.itemCode}
                                                    </td>
                                                    <td className="border-b border-ink/10 px-2.5 py-1.5">
                                                        {item.status === "SUKSES" ? (
                                                            <span className="inline-flex items-center gap-1 rounded-full bg-status-safe/10 px-2 py-0.5 font-sans text-[11px] font-semibold text-status-safe">
                                                                <CheckCircle2 className="h-3 w-3" />
                                                                Sukses
                                                            </span>
                                                        ) : (
                                                            <span className="inline-flex items-center gap-1 rounded-full bg-status-danger/10 px-2 py-0.5 font-sans text-[11px] font-semibold text-status-danger">
                                                                <XCircle className="h-3 w-3" />
                                                                Gagal
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="max-w-[220px] border-b border-ink/10 px-2.5 py-1.5 font-sans text-ink">
                                                        {item.status === "SUKSES"
                                                            ? item.mode === "PART_BARU"
                                                                ? "Part baru dibuat"
                                                                : "Restock ditambahkan"
                                                            : item.pesan ?? "-"}
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-ink/10 px-5 py-3">
                    {currentStep === "upload" ? (
                        <>
                            <button
                                type="button"
                                onClick={onClose}
                                className="rounded px-3 py-1.5 font-sans text-sm text-muted hover:bg-ink/5"
                            >
                                Batal
                            </button>
                            <button
                                type="button"
                                onClick={() => setCurrentStep("mapping")}
                                disabled={headers.length === 0 || isParsing}
                                className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 font-sans text-sm font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                Lanjut ke Mapping
                                <ArrowRight className="h-4 w-4" />
                            </button>
                        </>
                    ) : currentStep === "mapping" ? (
                        <>
                            <button
                                type="button"
                                onClick={() => setCurrentStep("upload")}
                                disabled={isProcessing}
                                className="flex items-center gap-1.5 rounded px-3 py-1.5 font-sans text-sm text-muted hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <ArrowLeft className="h-4 w-4" />
                                Kembali
                            </button>
                            <button
                                type="button"
                                onClick={handleProcessImport}
                                disabled={!isItemCodeMapped || isProcessing}
                                className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 font-sans text-sm font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {isProcessing && <Loader2 className="h-4 w-4 animate-spin" />}
                                {isProcessing ? "Memproses..." : "Proses Import"}
                            </button>
                        </>
                    ) : (
                        <button
                            type="button"
                            onClick={handleCloseAfterResult}
                            className="rounded-md bg-primary px-4 py-1.5 font-sans text-sm font-medium text-white hover:bg-primary/90"
                        >
                            Tutup
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}