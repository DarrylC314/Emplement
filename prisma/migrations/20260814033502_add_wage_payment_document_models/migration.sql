-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PAID', 'WITHHELD');

-- CreateEnum
CREATE TYPE "EmployerVerifiedStatus" AS ENUM ('UNVERIFIED');

-- AlterTable
ALTER TABLE "WeeklyCertification" ADD COLUMN     "autoDecisionActualValue" TEXT,
ADD COLUMN     "autoDecisionRuleId" TEXT,
ADD COLUMN     "autoDecisionThreshold" TEXT;

-- CreateTable
CREATE TABLE "WageRecord" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "employerName" TEXT NOT NULL,
    "fein" TEXT NOT NULL,
    "workLocation" TEXT NOT NULL,
    "jobTitle" TEXT NOT NULL,
    "firstDayWorked" TIMESTAMP(3) NOT NULL,
    "lastDayWorked" TIMESTAMP(3),
    "wageRate" DECIMAL(10,2) NOT NULL,
    "hoursPerWeek" DECIMAL(5,2) NOT NULL,
    "separationReason" TEXT NOT NULL,
    "recallDate" TIMESTAMP(3),
    "employerVerifiedStatus" "EmployerVerifiedStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "source" TEXT NOT NULL,
    "claimantConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "claimantDisputeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "weeklyCertificationId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "weeklyCertificationId" TEXT,
    "uploadedByUserId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storedPath" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "WageRecord" ADD CONSTRAINT "WageRecord_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_weeklyCertificationId_fkey" FOREIGN KEY ("weeklyCertificationId") REFERENCES "WeeklyCertification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_weeklyCertificationId_fkey" FOREIGN KEY ("weeklyCertificationId") REFERENCES "WeeklyCertification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
