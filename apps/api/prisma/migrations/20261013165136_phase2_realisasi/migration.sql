-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('SUBCON_JASA', 'SUBCON_MATERIAL', 'PERMIT', 'OPS', 'PJD', 'TICKET', 'HOMEBASE', 'MOTOR_MOBIL', 'MATERIAL_PEMBELIAN', 'PAJAK', 'LAINNYA');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('PERLU_VERIFIKASI', 'TERVERIFIKASI', 'DITOLAK');

-- CreateEnum
CREATE TYPE "ExpenseSource" AS ENUM ('MANUAL', 'MOBILE', 'WEBHOOK', 'IMPORT_RAB', 'CLIENT_PAYMENT');

-- CreateEnum
CREATE TYPE "AllocationMethod" AS ENUM ('EQUAL', 'PRO_RATA_PO', 'MANUAL');

-- CreateEnum
CREATE TYPE "TerminKind" AS ENUM ('IMPLEMENTASI', 'PERMIT');

-- CreateEnum
CREATE TYPE "AgingType" AS ENUM ('CALENDAR', 'WORKING');

-- CreateEnum
CREATE TYPE "ClientPaymentStatus" AS ENUM ('UNBILLED', 'INVOICED', 'PAID');

-- AlterTable
ALTER TABLE "Setting" ADD COLUMN     "realisasiWarnPct" DECIMAL(16,12);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "clusterId" TEXT,
    "date" DATE,
    "periodLabel" TEXT,
    "category" "ExpenseCategory" NOT NULL,
    "budgetCode" "FrCode" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "termin" TEXT,
    "vendor" TEXT,
    "invoiceNo" TEXT,
    "attachmentUrl" TEXT,
    "attachmentName" TEXT,
    "attachmentMime" TEXT,
    "fundRequestId" TEXT,
    "status" "ExpenseStatus" NOT NULL,
    "source" "ExpenseSource" NOT NULL,
    "sourceRef" TEXT,
    "allocationMethod" "AllocationMethod",
    "rejectNote" TEXT,
    "createdById" TEXT,
    "apiKeyId" TEXT,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseAllocation" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "pct" DECIMAL(16,12) NOT NULL,

    CONSTRAINT "ExpenseAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryMapping" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "category" "ExpenseCategory" NOT NULL,
    "budgetCode" "FrCode",

    CONSTRAINT "CategoryMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TerminTemplate" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "kind" "TerminKind" NOT NULL,
    "agingDays" INTEGER,
    "agingType" "AgingType",
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TerminTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TerminTemplateLine" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "terminKe" INTEGER NOT NULL,
    "pct" DECIMAL(16,12) NOT NULL,
    "keterangan" TEXT,

    CONSTRAINT "TerminTemplateLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientPayment" (
    "id" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "kind" "TerminKind" NOT NULL,
    "termin" INTEGER NOT NULL,
    "pct" DECIMAL(16,12),
    "amount" DECIMAL(18,2) NOT NULL,
    "keterangan" TEXT,
    "invoiceNo" TEXT,
    "invoiceDate" DATE,
    "dueDate" DATE,
    "paidDate" DATE,
    "paidAmount" DECIMAL(18,2),
    "status" "ClientPaymentStatus" NOT NULL DEFAULT 'UNBILLED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HariLibur" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "HariLibur_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashLedger" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "projectId" TEXT,
    "projectLabel" TEXT,
    "cashAccount" TEXT,
    "accountName" TEXT,
    "cashIn" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "cashOut" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sourceKey" TEXT NOT NULL,
    "sourceSheet" TEXT,
    "sourceRow" INTEGER,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "createdById" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportMappingRule" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "clusterId" TEXT,
    "clusterIds" TEXT[],
    "method" "AllocationMethod",
    "category" "ExpenseCategory",
    "createdById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportMappingRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Expense_sourceRef_key" ON "Expense"("sourceRef");

-- CreateIndex
CREATE INDEX "Expense_projectId_status_idx" ON "Expense"("projectId", "status");

-- CreateIndex
CREATE INDEX "Expense_clusterId_idx" ON "Expense"("clusterId");

-- CreateIndex
CREATE INDEX "Expense_fundRequestId_idx" ON "Expense"("fundRequestId");

-- CreateIndex
CREATE INDEX "ExpenseAllocation_clusterId_idx" ON "ExpenseAllocation"("clusterId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseAllocation_expenseId_clusterId_key" ON "ExpenseAllocation"("expenseId", "clusterId");

-- CreateIndex
CREATE UNIQUE INDEX "CategoryMapping_projectId_category_key" ON "CategoryMapping"("projectId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "TerminTemplate_clientId_kind_key" ON "TerminTemplate"("clientId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "TerminTemplateLine_templateId_terminKe_key" ON "TerminTemplateLine"("templateId", "terminKe");

-- CreateIndex
CREATE UNIQUE INDEX "ClientPayment_clusterId_kind_termin_key" ON "ClientPayment"("clusterId", "kind", "termin");

-- CreateIndex
CREATE UNIQUE INDEX "HariLibur_date_key" ON "HariLibur"("date");

-- CreateIndex
CREATE UNIQUE INDEX "CashLedger_sourceKey_key" ON "CashLedger"("sourceKey");

-- CreateIndex
CREATE INDEX "CashLedger_projectId_date_idx" ON "CashLedger"("projectId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE UNIQUE INDEX "ImportMappingRule_sourceKey_key" ON "ImportMappingRule"("sourceKey");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "Cluster"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_fundRequestId_fkey" FOREIGN KEY ("fundRequestId") REFERENCES "FundRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseAllocation" ADD CONSTRAINT "ExpenseAllocation_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseAllocation" ADD CONSTRAINT "ExpenseAllocation_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "Cluster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryMapping" ADD CONSTRAINT "CategoryMapping_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TerminTemplate" ADD CONSTRAINT "TerminTemplate_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TerminTemplateLine" ADD CONSTRAINT "TerminTemplateLine_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "TerminTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientPayment" ADD CONSTRAINT "ClientPayment_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "Cluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashLedger" ADD CONSTRAINT "CashLedger_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
