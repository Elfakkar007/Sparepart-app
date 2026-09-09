-- CreateEnum
CREATE TYPE "Line" AS ENUM ('LINE_1', 'LINE_2', 'LINE_3', 'LINE_4', 'GENERAL');

-- CreateEnum
CREATE TYPE "TipeMovement" AS ENUM ('MASUK', 'KELUAR', 'KOREKSI');

-- CreateEnum
CREATE TYPE "SumberMovement" AS ENUM ('ADMIN_MASUK', 'ADMIN_KOREKSI', 'LOGBOOK', 'PM');

-- CreateTable
CREATE TABLE "Kategori" (
    "id" TEXT NOT NULL,
    "nama" TEXT NOT NULL,

    CONSTRAINT "Kategori_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LokasiRak" (
    "id" TEXT NOT NULL,
    "nama" TEXT NOT NULL,

    CONSTRAINT "LokasiRak_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Satuan" (
    "id" TEXT NOT NULL,
    "nama" TEXT NOT NULL,

    CONSTRAINT "Satuan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sparepart" (
    "id" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "namaPart" TEXT NOT NULL,
    "spesifikasi" TEXT,
    "keterangan" TEXT,
    "stok" INTEGER NOT NULL DEFAULT 0,
    "kategoriId" TEXT NOT NULL,
    "satuanId" TEXT NOT NULL,
    "lokasiRakId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sparepart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SparepartLineStock" (
    "id" TEXT NOT NULL,
    "sparepartId" TEXT NOT NULL,
    "line" "Line" NOT NULL,
    "jumlah" INTEGER NOT NULL DEFAULT 0,
    "minStok" INTEGER NOT NULL DEFAULT 0,
    "lastOpnameDate" TIMESTAMP(3),

    CONSTRAINT "SparepartLineStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "sparepartId" TEXT NOT NULL,
    "line" "Line" NOT NULL,
    "tipe" "TipeMovement" NOT NULL,
    "sumber" "SumberMovement" NOT NULL,
    "jumlah" INTEGER NOT NULL,
    "referensi" TEXT,
    "keterangan" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Kategori_nama_key" ON "Kategori"("nama");

-- CreateIndex
CREATE UNIQUE INDEX "LokasiRak_nama_key" ON "LokasiRak"("nama");

-- CreateIndex
CREATE UNIQUE INDEX "Satuan_nama_key" ON "Satuan"("nama");

-- CreateIndex
CREATE UNIQUE INDEX "Sparepart_itemCode_key" ON "Sparepart"("itemCode");

-- CreateIndex
CREATE UNIQUE INDEX "SparepartLineStock_sparepartId_line_key" ON "SparepartLineStock"("sparepartId", "line");

-- AddForeignKey
ALTER TABLE "Sparepart" ADD CONSTRAINT "Sparepart_kategoriId_fkey" FOREIGN KEY ("kategoriId") REFERENCES "Kategori"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sparepart" ADD CONSTRAINT "Sparepart_satuanId_fkey" FOREIGN KEY ("satuanId") REFERENCES "Satuan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sparepart" ADD CONSTRAINT "Sparepart_lokasiRakId_fkey" FOREIGN KEY ("lokasiRakId") REFERENCES "LokasiRak"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SparepartLineStock" ADD CONSTRAINT "SparepartLineStock_sparepartId_fkey" FOREIGN KEY ("sparepartId") REFERENCES "Sparepart"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_sparepartId_fkey" FOREIGN KEY ("sparepartId") REFERENCES "Sparepart"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
