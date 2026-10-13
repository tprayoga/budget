-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "note" TEXT;

-- AlterTable
ALTER TABLE "ImportMappingRule" ADD COLUMN     "manualPcts" JSONB,
ADD COLUMN     "note" TEXT;

-- CreateTable
CREATE TABLE "ImportHeldItem" (
    "id" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sheet" TEXT NOT NULL,
    "cell" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "blockTitle" TEXT,
    "groupTitle" TEXT,
    "label" TEXT NOT NULL,
    "date" DATE,
    "periodLabel" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "suggestedCategory" "ExpenseCategory",
    "suggestedTarget" JSONB,
    "status" TEXT NOT NULL DEFAULT 'HELD',
    "note" TEXT,
    "expenseId" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportHeldItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ImportHeldItem_sourceRef_key" ON "ImportHeldItem"("sourceRef");

-- CreateIndex
CREATE INDEX "ImportHeldItem_projectId_status_idx" ON "ImportHeldItem"("projectId", "status");
