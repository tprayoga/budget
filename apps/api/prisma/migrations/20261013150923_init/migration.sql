-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'PM', 'FINANCE', 'DIREKTUR', 'INVESTOR');

-- CreateEnum
CREATE TYPE "ClusterStatus" AS ENUM ('PLAN', 'ONGOING', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Division" AS ENUM ('IBK', 'TELCO');

-- CreateEnum
CREATE TYPE "LineMode" AS ENUM ('PCT', 'RP');

-- CreateEnum
CREATE TYPE "BudgetCode" AS ENUM ('SUBCON', 'TICKET', 'INDIRECT', 'DIRECT', 'OPS_KANTOR', 'MOTOR_MOBIL', 'HOMEBASE', 'ALLOWANCE', 'MARKETING');

-- CreateEnum
CREATE TYPE "FrCode" AS ENUM ('SUBCON', 'PERMIT', 'TICKET', 'PAJAK', 'INDIRECT', 'DIRECT', 'OPS_KANTOR', 'MOTOR_MOBIL', 'HOMEBASE', 'ALLOWANCE', 'MARKETING');

-- CreateEnum
CREATE TYPE "FrStatus" AS ENUM ('DRAFT', 'DIAJUKAN', 'DIPERIKSA_FINANCE', 'DISETUJUI_DIREKTUR', 'DIKETAHUI_INVESTOR', 'DICAIRKAN', 'DITOLAK');

-- CreateEnum
CREATE TYPE "ApprovalStep" AS ENUM ('DIAJUKAN', 'PERIKSA_FINANCE', 'SETUJU_DIREKTUR', 'MENGETAHUI_INVESTOR', 'PENCAIRAN');

-- CreateEnum
CREATE TYPE "ApprovalAction" AS ENUM ('APPROVE', 'REJECT');

-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('PROYEKSI_BUDGET', 'PO_SPK', 'RENCANA_KERJA', 'BOQ_PENAWARAN', 'LAPORAN_TERMIN_SEBELUMNYA', 'LAINNYA', 'BUKTI_CAIR');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "jabatan" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "interestRate" DECIMAL(12,8),
    "retensiAsCost" BOOLEAN,
    "rekeningBank" TEXT,
    "rekeningNo" TEXT,
    "rekeningNama" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetTemplate" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "pajakRate" DECIMAL(12,8),
    "retensiRate" DECIMAL(12,8),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetTemplateLine" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "code" "BudgetCode" NOT NULL,
    "mode" "LineMode" NOT NULL DEFAULT 'PCT',
    "pct" DECIMAL(12,8),
    "amount" DECIMAL(18,2),

    CONSTRAINT "BudgetTemplateLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cluster" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "info" TEXT,
    "division" "Division",
    "status" "ClusterStatus" NOT NULL DEFAULT 'PLAN',
    "nilaiPoImpl" DECIMAL(18,2) NOT NULL,
    "nilaiPoPermit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "permitCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "pajakRate" DECIMAL(12,8) NOT NULL,
    "retensiRate" DECIMAL(12,8) NOT NULL DEFAULT 0.10,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cluster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetLine" (
    "id" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "code" "BudgetCode" NOT NULL,
    "label" TEXT NOT NULL,
    "mode" "LineMode" NOT NULL,
    "pct" DECIMAL(12,8),
    "amount" DECIMAL(18,2),
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "BudgetLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FpdSequence" (
    "projectId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FpdSequence_pkey" PRIMARY KEY ("projectId","year","month")
);

-- CreateTable
CREATE TABLE "FundRequest" (
    "id" TEXT NOT NULL,
    "number" TEXT,
    "clusterId" TEXT NOT NULL,
    "terminKe" INTEGER NOT NULL,
    "tanggal" DATE NOT NULL,
    "periode" TEXT,
    "diajukanOlehId" TEXT NOT NULL,
    "diajukanKepada" TEXT NOT NULL DEFAULT 'Investor',
    "justifikasi" TEXT NOT NULL,
    "rekeningBank" TEXT,
    "rekeningNo" TEXT,
    "rekeningNama" TEXT,
    "status" "FrStatus" NOT NULL DEFAULT 'DRAFT',
    "nilaiProyek" DECIMAL(18,2) NOT NULL,
    "interestRate" DECIMAL(12,8) NOT NULL,
    "retensiAsCost" BOOLEAN NOT NULL,
    "infoBunga" DECIMAL(18,2) NOT NULL,
    "infoRetensi" DECIMAL(18,2) NOT NULL,
    "infoProfit" DECIMAL(18,2) NOT NULL,
    "infoMargin" DECIMAL(12,8) NOT NULL,
    "totalDiajukan" DECIMAL(18,2) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "cairTanggal" DATE,
    "cairBuktiAttachmentId" TEXT,
    "overrideReason" TEXT,
    "overrideById" TEXT,
    "rejectedNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FundRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundRequestLine" (
    "id" TEXT NOT NULL,
    "fundRequestId" TEXT NOT NULL,
    "budgetCode" "FrCode" NOT NULL,
    "label" TEXT NOT NULL,
    "budgetAmount" DECIMAL(18,2) NOT NULL,
    "pctNilaiProyek" DECIMAL(12,8) NOT NULL,
    "pctCair" DECIMAL(12,8) NOT NULL DEFAULT 1,
    "diajukan" DECIMAL(18,2) NOT NULL,
    "sudahDicairkanSebelum" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sedangDiproses" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sisaBudget" DECIMAL(18,2) NOT NULL,
    "keterangan" TEXT,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "FundRequestLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "fundRequestId" TEXT NOT NULL,
    "step" "ApprovalStep" NOT NULL,
    "userId" TEXT NOT NULL,
    "action" "ApprovalAction" NOT NULL,
    "note" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "fundRequestId" TEXT NOT NULL,
    "kind" "AttachmentKind" NOT NULL,
    "label" TEXT,
    "fileUrl" TEXT,
    "fileName" TEXT,
    "mimeType" TEXT,
    "size" INTEGER,
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "userId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Client_name_key" ON "Client"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Project_code_key" ON "Project"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMember_userId_projectId_key" ON "ProjectMember"("userId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Setting_projectId_key" ON "Setting"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetTemplate_projectId_key" ON "BudgetTemplate"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetTemplateLine_templateId_code_key" ON "BudgetTemplateLine"("templateId", "code");

-- CreateIndex
CREATE INDEX "Cluster_projectId_idx" ON "Cluster"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Cluster_projectId_name_key" ON "Cluster"("projectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetLine_clusterId_code_key" ON "BudgetLine"("clusterId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "FundRequest_number_key" ON "FundRequest"("number");

-- CreateIndex
CREATE UNIQUE INDEX "FundRequest_cairBuktiAttachmentId_key" ON "FundRequest"("cairBuktiAttachmentId");

-- CreateIndex
CREATE INDEX "FundRequest_clusterId_status_idx" ON "FundRequest"("clusterId", "status");

-- CreateIndex
CREATE INDEX "FundRequest_status_idx" ON "FundRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "FundRequestLine_fundRequestId_budgetCode_key" ON "FundRequestLine"("fundRequestId", "budgetCode");

-- CreateIndex
CREATE INDEX "Approval_fundRequestId_idx" ON "Approval"("fundRequestId");

-- CreateIndex
CREATE INDEX "Attachment_fundRequestId_idx" ON "Attachment"("fundRequestId");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetTemplate" ADD CONSTRAINT "BudgetTemplate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetTemplateLine" ADD CONSTRAINT "BudgetTemplateLine_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "BudgetTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cluster" ADD CONSTRAINT "Cluster_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "Cluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FpdSequence" ADD CONSTRAINT "FpdSequence_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundRequest" ADD CONSTRAINT "FundRequest_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "Cluster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundRequest" ADD CONSTRAINT "FundRequest_diajukanOlehId_fkey" FOREIGN KEY ("diajukanOlehId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundRequest" ADD CONSTRAINT "FundRequest_overrideById_fkey" FOREIGN KEY ("overrideById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundRequest" ADD CONSTRAINT "FundRequest_cairBuktiAttachmentId_fkey" FOREIGN KEY ("cairBuktiAttachmentId") REFERENCES "Attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundRequestLine" ADD CONSTRAINT "FundRequestLine_fundRequestId_fkey" FOREIGN KEY ("fundRequestId") REFERENCES "FundRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_fundRequestId_fkey" FOREIGN KEY ("fundRequestId") REFERENCES "FundRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_fundRequestId_fkey" FOREIGN KEY ("fundRequestId") REFERENCES "FundRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
