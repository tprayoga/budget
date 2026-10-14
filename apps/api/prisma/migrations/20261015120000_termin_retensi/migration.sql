-- AlterTable
ALTER TABLE "ClientPayment" ADD COLUMN     "opnameDate" DATE,
ADD COLUMN     "retentionMonths" INTEGER,
ADD COLUMN     "retentionReleaseDate" DATE;

-- AlterTable
ALTER TABLE "TerminTemplateLine" ADD COLUMN     "retentionMonths" INTEGER;

