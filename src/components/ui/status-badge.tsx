type StatusBadgeProps = {
    status: string;
};

// Mapping warna status:
// - "Cukup"   -> Hijau (status-safe)
// - "Restock" -> Merah (status-danger)
function getStatusClasses(status: string): string {
    if (status === "Cukup") {
        return "bg-status-safe/10 text-status-safe";
    }
    if (status === "Restock" || status === "Kurang" || status.startsWith("Restock")) {
        return "bg-status-danger/10 text-status-danger";
    }
    // "Belum Ada Stok" atau status tak dikenal lainnya jatuh ke warna netral
    return "bg-muted/10 text-muted";
}

export function StatusBadge({ status }: StatusBadgeProps) {
    return (
        <span
            className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 font-sans text-xs font-semibold ${getStatusClasses(
                status
            )}`}
        >
            {status}
        </span>
    );
}