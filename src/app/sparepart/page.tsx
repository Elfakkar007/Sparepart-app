import { getSparepartList } from "@/lib/actions/sparepart";
import {
    getKategoriList,
    getSatuanList,
    getLokasiRakList,
} from "@/lib/actions/master-data";
import { SparepartGrid } from "@/components/sparepart/sparepart-grid";

export default async function SparepartPage() {
    // Fetch semua data yang dibutuhkan secara paralel supaya tidak waterfall.
    const [sparepartResult, kategoriResult, satuanResult, lokasiRakResult] =
        await Promise.all([
            getSparepartList(),
            getKategoriList(),
            getSatuanList(),
            getLokasiRakList(),
        ]);

    return (
        <div>

            <SparepartGrid
                initialData={sparepartResult.success ? sparepartResult.data : []}
                fetchError={sparepartResult.success ? undefined : sparepartResult.message}
                kategoriOptions={kategoriResult.success ? kategoriResult.data : []}
                satuanOptions={satuanResult.success ? satuanResult.data : []}
                lokasiRakOptions={lokasiRakResult.success ? lokasiRakResult.data : []}
            />
        </div>
    );
}