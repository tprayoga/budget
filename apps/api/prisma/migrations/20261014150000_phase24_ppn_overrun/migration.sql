-- AlterTable
ALTER TABLE "ClientPayment" ADD COLUMN     "pphRate" DECIMAL(16,12) NOT NULL DEFAULT 0,
ADD COLUMN     "ppnRate" DECIMAL(16,12) NOT NULL DEFAULT 0.11;

-- AlterTable
ALTER TABLE "Cluster" ADD COLUMN     "note" TEXT,
ADD COLUMN     "permitPoAmount" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Setting" ADD COLUMN     "ppnRate" DECIMAL(16,12);

-- CreateTable
CREATE TABLE "OverrunState" (
    "key" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "over" BOOLEAN NOT NULL DEFAULT false,
    "since" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OverrunState_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "OverrunState_clusterId_idx" ON "OverrunState"("clusterId");


-- Fase 2.4: isi data turunan
-- PPh termin = pajakRate cluster
UPDATE "ClientPayment" p SET "pphRate" = c."pajakRate" FROM "Cluster" c WHERE c."id" = p."clusterId";
-- PPN global default 11%
UPDATE "Setting" SET "ppnRate" = 0.11 WHERE "projectId" IS NULL AND "ppnRate" IS NULL;
-- Σ PO PERMIT (tanpa SND) per cluster
UPDATE "Cluster" c SET "permitPoAmount" = COALESCE((SELECT SUM(po."amount") FROM "ClusterPo" po WHERE po."clusterId" = c."id" AND po."kind" = 'PERMIT'), 0);
