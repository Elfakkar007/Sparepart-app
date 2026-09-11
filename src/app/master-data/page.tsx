import {
    getKategoriList,
    getSatuanList,
    getLokasiRakList,
} from "@/lib/actions/master-data";
import { MasterDataManager } from "@/components/master-data/master-data-manager";

export default async function MasterDataPage() {
    // Fetch ketiga list secara paralel, sama pola dengan SparepartPage.
    const [kategoriResult, satuanResult, lokasiRakResult] = await Promise.all([
        getKategoriList(),
        getSatuanList(),
        getLokasiRakList(),
    ]);

    return (
        <main className="min-h-screen bg-app-bg px-4 py-8">
            <div className="mx-auto mb-6 max-w-2xl">
                <h1 className="text-lg font-semibold text-ink">
                    Kelola Master Data
                </h1>
                <p className="text-sm text-muted">
                    Kategori, satuan, dan lokasi rak yang dipakai di data sparepart.
                </p>
            </div>

            <MasterDataManager
                initialKategori={kategoriResult.success ? kategoriResult.data : []}
                initialSatuan={satuanResult.success ? satuanResult.data : []}
                initialLokasiRak={lokasiRakResult.success ? lokasiRakResult.data : []}
            />
        </main>
    );
}