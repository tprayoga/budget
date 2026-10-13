-- CreateEnum
CREATE TYPE "PoKind" AS ENUM ('IMPLEMENTASI', 'PERMIT', 'SND', 'ADDWORK', 'DEDUCTION');

-- AlterEnum
ALTER TYPE "ExpenseCategory" ADD VALUE 'MARKETING_FEE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TerminKind" ADD VALUE 'SND';
ALTER TYPE "TerminKind" ADD VALUE 'ADDWORK';
ALTER TYPE "TerminKind" ADD VALUE 'DEDUCTION';

-- DropIndex
DROP INDEX "ClientPayment_clusterId_kind_termin_key";

-- AlterTable
ALTER TABLE "ClientPayment" ADD COLUMN     "fromTemplate" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "poId" TEXT;

-- AlterTable
ALTER TABLE "Setting" ADD COLUMN     "realisasiOverPct" DECIMAL(16,12);

-- CreateTable
CREATE TABLE "ClusterPo" (
    "id" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "kind" "PoKind" NOT NULL,
    "poNumber" TEXT,
    "poDate" DATE,
    "amount" DECIMAL(18,2) NOT NULL,
    "passThroughCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "sourceRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClusterPo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldOverride" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "userId" TEXT,
    "reason" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FieldOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientInvoiceRef" (
    "id" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "clusterId" TEXT,
    "blockTitle" TEXT,
    "termin" INTEGER,
    "invoiceNo" TEXT NOT NULL,
    "netAmount" DECIMAL(18,2),
    "dueDate" DATE,
    "statusText" TEXT,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "appliedPaymentId" TEXT,
    "appliedAt" TIMESTAMP(3),
    "appliedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientInvoiceRef_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClusterPo_sourceRef_key" ON "ClusterPo"("sourceRef");

-- CreateIndex
CREATE INDEX "ClusterPo_clusterId_idx" ON "ClusterPo"("clusterId");

-- CreateIndex
CREATE UNIQUE INDEX "FieldOverride_entity_entityId_field_key" ON "FieldOverride"("entity", "entityId", "field");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_key_key" ON "Notification"("userId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ClientInvoiceRef_sourceRef_key" ON "ClientInvoiceRef"("sourceRef");

-- CreateIndex
CREATE INDEX "ClientInvoiceRef_projectId_idx" ON "ClientInvoiceRef"("projectId");

-- CreateIndex
CREATE INDEX "ClientPayment_clusterId_kind_idx" ON "ClientPayment"("clusterId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ClientPayment_poId_termin_key" ON "ClientPayment"("poId", "termin");

-- AddForeignKey
ALTER TABLE "ClientPayment" ADD CONSTRAINT "ClientPayment_poId_fkey" FOREIGN KEY ("poId") REFERENCES "ClusterPo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClusterPo" ADD CONSTRAINT "ClusterPo_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "Cluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientInvoiceRef" ADD CONSTRAINT "ClientInvoiceRef_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "Cluster"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientInvoiceRef" ADD CONSTRAINT "ClientInvoiceRef_appliedPaymentId_fkey" FOREIGN KEY ("appliedPaymentId") REFERENCES "ClientPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

