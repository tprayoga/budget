-- AlterTable
ALTER TABLE "Cluster" ADD COLUMN     "terminOffset" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "FundRequest" ADD COLUMN     "recalcNote" TEXT;

-- AlterTable
ALTER TABLE "FundRequestLine" ADD COLUMN     "realisasiTanpaPengajuan" DECIMAL(18,2) NOT NULL DEFAULT 0;

