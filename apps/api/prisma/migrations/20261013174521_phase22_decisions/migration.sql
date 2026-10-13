-- AlterTable
ALTER TABLE "Cluster" ADD COLUMN     "implementationDate" DATE;

-- AlterTable
ALTER TABLE "ImportHeldItem" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'EXPENSE',
ADD COLUMN     "resolution" TEXT;

-- AlterTable
ALTER TABLE "ImportMappingRule" ADD COLUMN     "clusterFilter" TEXT;

-- CreateTable
CREATE TABLE "DataPatch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataPatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DataPatch_name_key" ON "DataPatch"("name");
