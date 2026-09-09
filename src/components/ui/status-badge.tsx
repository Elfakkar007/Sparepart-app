type StatusBadgeProps = {
    status: string;
};

// Mapping warna murni berdasarkan string status. Generic terhadap konsumen
// manapun yang mengirim output persis dari computeSparepartStatus():
// "Cukup" | "Restock ..." (partial) | "Restock Total" | "Belum Ada Stok".
function getStatusClasses(status: string): string {
    if (status === "Cukup") {
        return "bg-status-safe/10 text-status-safe";
    }
    if (status === "Restock Total") {
        return "bg-status-danger/10 text-status-danger";
    }
    if (status.startsWith("Restock ")) {
        return "bg-status-warning/10 text-status-warning";
    }
    // "Belum Ada Stok" dan status tak dikenal lainnya jatuh ke netral.
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