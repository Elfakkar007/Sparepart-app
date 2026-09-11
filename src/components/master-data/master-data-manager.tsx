"use client";

import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Kategori, LokasiRak, Satuan } from "@/generated/prisma/client";
import type { ActionResult } from "@/lib/actions/_shared";
import {
    addKategori,
    updateKategori,
    deleteKategori,
    addSatuan,
    updateSatuan,
    deleteSatuan,
    addLokasiRak,
    updateLokasiRak,
    deleteLokasiRak,
} from "@/lib/actions/master-data";

// Bentuk minimum yang dibutuhkan UI ini dari Kategori/Satuan/LokasiRak.
// Ketiga tipe Prisma di atas structurally cocok (punya id & nama), jadi
// bisa langsung dipakai sebagai MasterDataItem[] tanpa mapping.
type MasterDataItem = {
    id: string;
    nama: string;
};

type MasterDataType = "kategori" | "satuan" | "lokasiRak";

type MasterDataManagerProps = {
    initialKategori: Kategori[];
    initialSatuan: Satuan[];
    initialLokasiRak: LokasiRak[];
};

const TABS: { type: MasterDataType; label: string }[] = [
    { type: "kategori", label: "Kategori" },
    { type: "satuan", label: "Satuan" },
    { type: "lokasiRak", label: "Lokasi Rak" },
];

// Peta action per tab, supaya <MasterDataList /> di bawah bisa reusable
// dan tinggal dipanggil 3x dengan action function yang sesuai type-nya.
const ACTIONS: Record<
    MasterDataType,
    {
        noun: string; // dipakai di placeholder & pesan, mis. "lokasi rak"
        add: (nama: string) => Promise<ActionResult<MasterDataItem>>;
        update: (
            id: string,
            namaBaru: string
        ) => Promise<ActionResult<MasterDataItem>>;
        delete: (id: string) => Promise<ActionResult<{ deletedId: string }>>;
    }
> = {
    kategori: {
        noun: "kategori",
        add: addKategori,
        update: updateKategori,
        delete: deleteKategori,
    },
    satuan: {
        noun: "satuan",
        add: addSatuan,
        update: updateSatuan,
        delete: deleteSatuan,
    },
    lokasiRak: {
        noun: "lokasi rak",
        add: addLokasiRak,
        update: updateLokasiRak,
        delete: deleteLokasiRak,
    },
};

export function MasterDataManager({
    initialKategori,
    initialSatuan,
    initialLokasiRak,
}: MasterDataManagerProps) {
    const [activeTab, setActiveTab] = useState<MasterDataType>("kategori");

    // State per tabel, dipisah supaya pindah tab tidak kehilangan
    // perubahan yang sudah dibuat di tab lain.
    const [kategoriItems, setKategoriItems] =
        useState<MasterDataItem[]>(initialKategori);
    const [satuanItems, setSatuanItems] =
        useState<MasterDataItem[]>(initialSatuan);
    const [lokasiRakItems, setLokasiRakItems] =
        useState<MasterDataItem[]>(initialLokasiRak);

    const itemsByType: Record<MasterDataType, MasterDataItem[]> = {
        kategori: kategoriItems,
        satuan: satuanItems,
        lokasiRak: lokasiRakItems,
    };

    const setItemsByType: Record<
        MasterDataType,
        Dispatch<SetStateAction<MasterDataItem[]>>
    > = {
        kategori: setKategoriItems,
        satuan: setSatuanItems,
        lokasiRak: setLokasiRakItems,
    };

    const activeConfig = ACTIONS[activeTab];

    return (
        <div className="mx-auto max-w-2xl">
            {/* Tabs */}
            <div className="mb-6 flex border-b border-surface">
                {TABS.map((tab) => {
                    const isActive = tab.type === activeTab;
                    return (
                        <button
                            key={tab.type}
                            type="button"
                            onClick={() => setActiveTab(tab.type)}
                            className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${isActive
                                    ? "border-primary text-primary"
                                    : "border-transparent text-muted hover:text-ink"
                                }`}
                        >
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            <MasterDataList
                key={activeTab}
                type={activeTab}
                noun={activeConfig.noun}
                items={itemsByType[activeTab]}
                setItems={setItemsByType[activeTab]}
                addAction={activeConfig.add}
                updateAction={activeConfig.update}
                deleteAction={activeConfig.delete}
            />
        </div>
    );
}

// ==========================================================
// Komponen reusable untuk konten 1 tab: form tambah + list +
// edit inline + modal hapus. Struktur SAMA untuk ketiga tabel,
// bedanya cuma `items` dan action function yang di-pass dari atas.
// ==========================================================
function MasterDataList({
    type,
    noun,
    items,
    setItems,
    addAction,
    updateAction,
    deleteAction,
}: {
    type: MasterDataType;
    noun: string;
    items: MasterDataItem[];
    setItems: Dispatch<SetStateAction<MasterDataItem[]>>;
    addAction: (nama: string) => Promise<ActionResult<MasterDataItem>>;
    updateAction: (
        id: string,
        namaBaru: string
    ) => Promise<ActionResult<MasterDataItem>>;
    deleteAction: (id: string) => Promise<ActionResult<{ deletedId: string }>>;
}) {
    // --- Form tambah ---
    const [newNama, setNewNama] = useState("");
    const [addError, setAddError] = useState<string | null>(null);
    const [isAdding, setIsAdding] = useState(false);

    // --- Edit inline ---
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState("");
    const [editError, setEditError] = useState<string | null>(null);
    const [isSavingEdit, setIsSavingEdit] = useState(false);

    // --- Modal konfirmasi hapus ---
    const [deleteTarget, setDeleteTarget] = useState<MasterDataItem | null>(
        null
    );
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    async function handleAdd() {
        const trimmed = newNama.trim();
        if (!trimmed) {
            setAddError("Nama tidak boleh kosong");
            return;
        }

        setAddError(null);
        setIsAdding(true);
        const result = await addAction(trimmed);
        setIsAdding(false);

        if (!result.success) {
            setAddError(result.message);
            return;
        }

        setItems((prev) =>
            [...prev, result.data].sort((a, b) => a.nama.localeCompare(b.nama))
        );
        setNewNama("");
    }

    function startEdit(item: MasterDataItem) {
        setEditingId(item.id);
        setEditValue(item.nama);
        setEditError(null);
    }

    function cancelEdit() {
        setEditingId(null);
        setEditValue("");
        setEditError(null);
    }

    async function saveEdit(id: string) {
        const trimmed = editValue.trim();
        if (!trimmed) {
            setEditError("Nama tidak boleh kosong");
            return;
        }

        setEditError(null);
        setIsSavingEdit(true);
        const result = await updateAction(id, trimmed);
        setIsSavingEdit(false);

        if (!result.success) {
            setEditError(result.message);
            return;
        }

        setItems((prev) =>
            prev
                .map((item) => (item.id === id ? result.data : item))
                .sort((a, b) => a.nama.localeCompare(b.nama))
        );
        setEditingId(null);
        setEditValue("");
    }

    function openDeleteModal(item: MasterDataItem) {
        setDeleteTarget(item);
        setDeleteError(null);
    }

    function closeDeleteModal() {
        if (isDeleting) return;
        setDeleteTarget(null);
        setDeleteError(null);
    }

    async function confirmDelete() {
        if (!deleteTarget) return;

        setDeleteError(null);
        setIsDeleting(true);
        const result = await deleteAction(deleteTarget.id);
        setIsDeleting(false);

        if (!result.success) {
            // Tampilkan pesan apa adanya (mis. "Masih dipakai oleh 3 part,
            // tidak bisa dihapus"), modal tetap terbuka.
            setDeleteError(result.message);
            return;
        }

        setItems((prev) => prev.filter((item) => item.id !== deleteTarget.id));
        setDeleteTarget(null);
    }

    return (
        <div>
            {/* Form tambah */}
            <div className="mb-6">
                <div className="flex gap-2">
                    <input
                        id={`${type}-new-nama`}
                        type="text"
                        value={newNama}
                        onChange={(e) => {
                            setNewNama(e.target.value);
                            if (addError) setAddError(null);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") handleAdd();
                        }}
                        placeholder={`Nama ${noun} baru`}
                        disabled={isAdding}
                        className="flex-1 rounded-md border border-surface bg-app-bg px-3 py-2 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
                    />
                    <button
                        type="button"
                        onClick={handleAdd}
                        disabled={isAdding}
                        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
                    >
                        {isAdding ? "Menambah..." : "Tambah"}
                    </button>
                </div>
                {addError && (
                    <p className="mt-1.5 text-sm text-status-danger">{addError}</p>
                )}
            </div>

            {/* List */}
            {items.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted">
                    Belum ada data
                </p>
            ) : (
                <ul className="divide-y divide-surface overflow-hidden rounded-md border border-surface">
                    {items.map((item) => {
                        const isEditing = editingId === item.id;
                        return (
                            <li
                                key={item.id}
                                className="flex items-center gap-2 bg-app-bg px-3 py-2.5"
                            >
                                {isEditing ? (
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2">
                                            <input
                                                id={`${type}-edit-${item.id}`}
                                                type="text"
                                                value={editValue}
                                                onChange={(e) => {
                                                    setEditValue(e.target.value);
                                                    if (editError) setEditError(null);
                                                }}
                                                onKeyDown={(e) => {
                                                    if (e.key === "Enter") saveEdit(item.id);
                                                    if (e.key === "Escape") cancelEdit();
                                                }}
                                                autoFocus
                                                disabled={isSavingEdit}
                                                className="flex-1 rounded-md border border-primary bg-surface px-2 py-1 text-sm text-ink focus:outline-none disabled:opacity-60"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => saveEdit(item.id)}
                                                disabled={isSavingEdit}
                                                className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-60"
                                            >
                                                Simpan
                                            </button>
                                            <button
                                                type="button"
                                                onClick={cancelEdit}
                                                disabled={isSavingEdit}
                                                className="rounded-md border border-surface px-2.5 py-1 text-xs font-medium text-subtle hover:bg-surface disabled:opacity-60"
                                            >
                                                Batal
                                            </button>
                                        </div>
                                        {editError && (
                                            <p className="mt-1 text-xs text-status-danger">
                                                {editError}
                                            </p>
                                        )}
                                    </div>
                                ) : (
                                    <>
                                        <button
                                            type="button"
                                            onClick={() => startEdit(item)}
                                            className="flex-1 truncate text-left text-sm text-ink hover:text-primary"
                                        >
                                            {item.nama}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => openDeleteModal(item)}
                                            aria-label={`Hapus ${noun} ${item.nama}`}
                                            className="rounded-md p-1.5 text-status-danger hover:bg-status-danger/10"
                                        >
                                            <TrashIcon />
                                        </button>
                                    </>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}

            {/* Modal konfirmasi hapus */}
            {deleteTarget && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4"
                    onClick={closeDeleteModal}
                >
                    <div
                        className="w-full max-w-sm rounded-lg bg-app-bg p-5 shadow-lg"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 className="text-sm font-semibold text-ink">
                            Hapus {noun} &quot;{deleteTarget.nama}&quot;?
                        </h3>
                        <p className="mt-1 text-sm text-subtle">
                            Tindakan ini tidak bisa dibatalkan.
                        </p>

                        {deleteError && (
                            <p className="mt-3 rounded-md bg-status-danger/10 px-3 py-2 text-sm text-status-danger">
                                {deleteError}
                            </p>
                        )}

                        <div className="mt-4 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={closeDeleteModal}
                                disabled={isDeleting}
                                className="rounded-md border border-surface px-3 py-1.5 text-sm font-medium text-subtle hover:bg-surface disabled:opacity-60"
                            >
                                Batal
                            </button>
                            <button
                                type="button"
                                onClick={confirmDelete}
                                disabled={isDeleting}
                                className="rounded-md bg-status-danger px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
                            >
                                {isDeleting ? "Menghapus..." : "Hapus"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function TrashIcon() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
        >
            <path d="M3 6h18" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
        </svg>
    );
}