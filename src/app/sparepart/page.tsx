import { getSparepartList } from "@/lib/actions/sparepart";
import { SparepartGrid } from "@/components/sparepart/sparepart-grid";

export default async function SparepartPage() {
    const result = await getSparepartList();

    return (
        <SparepartGrid
            initialData={result.success ? result.data : []}
            fetchError={result.success ? undefined : result.message}
        />
    );
}