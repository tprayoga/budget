-- CreateEnum
CREATE TYPE "ReferenceValueType" AS ENUM ('INVOICE_TOTAL', 'NET');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "referenceValueType" "ReferenceValueType" NOT NULL DEFAULT 'INVOICE_TOTAL';

