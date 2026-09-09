import type { Line } from "@/generated/prisma/client";

// Urutan & label kolom sub-header per line di tabel, sekaligus urutan &
// label checkbox Line di popup filter. Satu sumber kebenaran dipakai oleh
// sparepart-grid.tsx dan filter-popup.tsx supaya keduanya selalu sinkron
// (tidak ada risiko urutan/label L1-L4/General beda antara tabel & filter).
export const LINES: { key: Line; label: string }[] = [
    { key: "LINE_1", label: "L1" },
    { key: "LINE_2", label: "L2" },
    { key: "LINE_3", label: "L3" },
    { key: "LINE_4", label: "L4" },
    { key: "GENERAL", label: "General" },
];