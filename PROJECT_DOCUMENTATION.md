# Dokumentasi Struktur Proyek (Sparepart App)

Proyek ini dibangun menggunakan **Next.js 15+ (App Router)** dengan **TypeScript**, **Tailwind CSS**, dan **Prisma ORM**. Berikut adalah dokumentasi struktur folder kustom dan fungsinya dalam aplikasi ini.

---

## 📁 `prisma/`
Folder ini berisi semua konfigurasi dan logika yang berhubungan dengan *database* menggunakan Prisma ORM. Ini murni area **Backend**.
- **`schema.prisma`**: File paling penting di sini. Berisi definisi tabel (model) *database* seperti `Sparepart`, `LineStock`, dan `StockMovement`.
- **`migrations/`**: Berisi riwayat perubahan struktur tabel *database* (otomatis di-generate saat menjalankan `prisma migrate`).
- **`seed.ts`**: Skrip untuk mengisi data awal (*dummy* atau data *master* bawaan) ke dalam *database* saat pertama kali di-*setup*.

---

## 📁 `src/`
Ini adalah jantung dari aplikasi. Semua kode aplikasi (baik *Frontend* maupun *Backend*) berada di dalam folder ini.

### 📂 `src/app/`
Folder bawaan Next.js App Router. Mengatur sistem *routing* (halaman web) aplikasi.
- **`layout.tsx` & `page.tsx`**: Kerangka utama aplikasi dan halaman *Home/Dashboard*.
- **`globals.css`**: File CSS utama (menggunakan Tailwind CSS).
- **`master-data/`**, **`sparepart/`**, **`login/`**: Folder-folder ini adalah **Frontend Pages**. Masing-masing menghasilkan URL di web (contoh: `/master-data`, `/login`). Di dalamnya terdapat file `page.tsx` yang merender UI halaman tersebut.

### 📂 `src/components/`
Berisi komponen-komponen React (UI) yang bersifat *reusable* (bisa dipakai berulang kali). Ini murni area **Frontend**.
- **`sparepart/`**: Berisi komponen kompleks khusus untuk fitur *sparepart*.
  - `sparepart-grid.tsx`: Komponen utama tabel/grid yang menampilkan daftar *sparepart*, mengatur status *sticky header*, dan merender sel tabel.
  - `filter-popup.tsx`: UI untuk popup pencarian dan penyaringan (*filter*) data.
  - `smart-form-modal.tsx`: UI *modal* untuk menambah atau merestock *sparepart* baru.
  - `import-excel-modal.tsx`: UI untuk fitur *import* data massal menggunakan Excel.
- **`ui/`**: Berisi komponen-komponen kecil (atom) dasar yang bisa dipakai di mana saja.
  - `status-badge.tsx`: UI untuk menampilkan label status (contoh: "Cukup", "Restock") dengan warna yang sesuai.
- **`master-data/`**: Komponen UI yang spesifik digunakan pada halaman Master Data.

## 📁 `src/`
Ini adalah jantung dari aplikasi. Semua kode aplikasi (baik *Frontend* maupun *Backend*) berada di dalam folder ini. 

### File di root `src/`
- **`auth.ts`**: Menangani logika utama autentikasi menggunakan NextAuth.js. Menjembatani *frontend* dan *backend* untuk verifikasi *login*.
- **`auth.config.ts`**: Berisi konfigurasi rute mana saja yang dikunci (*protected routes*) dan konfigurasi sesi (*session*) untuk NextAuth.
- **`proxy.ts`**: Mengatur pengaturan proksi (*proxy*) untuk kebutuhan komunikasi API khusus jika diperlukan (terutama di lingkungan pengembangan).

### 📂 `src/app/`
Folder bawaan Next.js App Router. Setiap folder di dalamnya yang memiliki file `page.tsx` akan menjadi URL web (Routing).
- **`favicon.ico`**: Ikon aplikasi yang muncul di *tab browser*.
- **`globals.css`**: File CSS global tempat Tailwind CSS dan kustomisasi gaya dasar aplikasi didefinisikan.
- **`layout.tsx`**: Kerangka utama (*layout*) HTML yang membungkus semua halaman (termasuk komponen *navbar* atau *sidebar* jika ada).
- **`page.tsx`**: Halaman utama aplikasi (berada di *root* `/`).
- 📂 **`login/`**: Halaman *Login* (URL: `/login`).
  - `page.tsx`: Me-render halaman login secara keseluruhan.
  - `login-form.tsx`: UI komponen formulir (*form*) khusus untuk menginput *username* dan *password*.
  - `actions.ts`: **(Backend)** *Server Action* untuk memproses *login* di sisi server saat formulir dikirim.
- 📂 **`master-data/`**: Halaman Master Data (URL: `/master-data`).
  - `page.tsx`: Me-render halaman master data.
- 📂 **`sparepart/`**: Halaman Sparepart (URL: `/sparepart`).
  - `page.tsx`: Me-render halaman daftar sparepart.

### 📂 `src/components/`
Berisi komponen-komponen React (UI) modular pembangun tampilan aplikasi. Area ini murni berjalan di sisi **Frontend**.
- 📂 **`layout/`**: Komponen pembentuk kerangka struktur halaman (*layout*).
  - `sidebar.tsx`: Komponen navigasi samping (*sidebar*) utama yang adaptif (bisa *collapse/expand*), menampilkan menu navigasi modul-modul, tombol *logout*, dan identitas *user* aktif.
- 📂 **`sparepart/`**: Komponen spesifik untuk manajemen sparepart.
  - `sparepart-grid.tsx`: Komponen masif dan paling penting. Menangani UI tabel *sparepart*, mengatur sel mana yang bisa di-*edit*, kalkulasi ukuran kolom dinamis, dan *sticky header*.
  - `filter-popup.tsx`: UI komponen *dropdown* untuk menyaring data (berdasarkan *line*, kategori, satuan, lokasi, status).
  - `column-visibility-popup.tsx`: UI komponen berupa popup kecil (ikon mata) untuk menyembunyikan atau menampilkan berbagai kolom di tabel (seperti Kategori, Satuan, Total, dan grup kolom per-Line).
  - `popover-portal.tsx`: Komponen utilitas (*Portal*) yang membantu me-render popup menembus hierarki HTML sehingga popup tidak terpotong oleh batas *scroll* atau *overflow* tabel.
  - `smart-form-modal.tsx`: Komponen jendela *modal* dinamis untuk membuat item *sparepart* baru atau melakukan *restock* barang.
  - `import-excel-modal.tsx`: Komponen jendela *modal* untuk mengunggah file Excel secara massal.
  - `line-config.ts`: Konfigurasi statis untuk daftar *Line* produksi (contoh: L1, L2, L3).
- 📂 **`master-data/`**: Komponen spesifik untuk manajemen data statis pendukung.
  - `master-data-manager.tsx`: Antarmuka manajemen di mana pengguna bisa menambah, mengubah, atau menghapus data Kategori dan Satuan.
- 📂 **`ui/`**: Komponen dasar (*atomic/reusable*) yang sangat kecil.
  - `status-badge.tsx`: Komponen visual pembuat label pil (*badge*) berwarna (contoh: hijau untuk "Cukup", merah untuk "Restock").

### 📂 `src/lib/`
Berisi fungsi pembantu (*utilities*), inisialisasi basis data, dan aturan logika sistem.
- **`prisma.ts`**: Skrip inisialisasi (*Singleton*) Prisma Client. Fungsinya agar koneksi ke basis data (*database*) tidak terbuka berulang kali secara mubazir saat aplikasi berjalan.
- **`status-helper.ts`**: Menyediakan rumus/logika universal untuk menghitung apakah stok "Cukup" atau harus "Restock", sehingga logika ini bisa dipakai oleh *Frontend* (untuk warna) maupun *Backend* (untuk validasi).
- 📂 **`actions/`**: Ini adalah **Backend murni (Server Actions)**. Semua file di sini adalah perantara antara komponen React dan database Prisma.
  - `_shared.ts`: Fungsi-fungsi bantuan (*helper*) yang dibagikan dan dipakai bersama oleh *actions* lainnya.
  - `master-data.ts`: Menangani operasi CRUD (simpan/hapus) untuk tabel master (Kategori/Satuan) di database.
  - `sparepart.ts`: Menangani pencarian, penambahan data baru, hingga penghapusan dari tabel `Sparepart` di database.
  - `stock-movement.ts`: Fungsi *backend* paling krusial. Mencatat setiap kali pengguna menambah atau mengurangi stok (jejak rekam barang masuk/keluar) di database.
  - `stock-errors.ts`: Mendefinisikan tipe-tipe *error* (pesan gagal) khusus seputar kendala penyimpanan stok barang.

### 📂 `src/types/`
Area deklarasi tipe data untuk TypeScript.
- **`next-auth.d.ts`**: Menimpa tipe bawaan NextAuth agar *session* pengguna mengenali tipe kustom aplikasi ini.

### 📂 `src/generated/`
Folder *auto-generated* (dihasilkan otomatis oleh sistem).
- **`prisma/`**: Berisi klien Prisma tergenerasi yang dimodifikasi. Pengembang umumnya tidak pernah menyentuh atau mengedit isi folder ini secara manual.

---

## 🔄 Ringkasan Alur Kerja
1. **User melihat UI**: User membuka URL halaman di dalam `src/app/`.
2. **Halaman merakit Komponen**: Halaman memanggil komponen-komponen visual dari dalam `src/components/`.
3. **User berinteraksi**: Jika user menyimpan data, komponen memanggil logika keamanan dan struktur data di `src/lib/actions/` (Server Actions).
4. **Server memproses (Backend)**: File *action* akan memvalidasi *request*, kemudian berinteraksi dengan database melalui `src/lib/prisma.ts`.
