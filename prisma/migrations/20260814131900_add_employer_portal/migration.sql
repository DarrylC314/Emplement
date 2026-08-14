-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'EMPLOYER';

-- AlterEnum
ALTER TYPE "EmployerVerifiedStatus" ADD VALUE 'VERIFIED';
ALTER TYPE "EmployerVerifiedStatus" ADD VALUE 'DISPUTED';

-- CreateEnum
CREATE TYPE "EmploymentEventType" AS ENUM ('HIRE', 'SEPARATION');

-- AlterTable
ALTER TABLE "ClaimantProfile" ADD COLUMN "ssnHash" TEXT;

-- AlterTable
ALTER TABLE "WageRecord" ADD COLUMN "employerDisputeNote" TEXT;

-- CreateTable
CREATE TABLE "EmployerProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fein" TEXT,
    "companyName" TEXT,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmploymentEvent" (
    "id" TEXT NOT NULL,
    "employerId" TEXT NOT NULL,
    "type" "EmploymentEventType" NOT NULL,
    "employeeName" TEXT NOT NULL,
    "ssnHash" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "matchedClaimantProfileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmploymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmployerProfile_userId_key" ON "EmployerProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployerProfile_fein_key" ON "EmployerProfile"("fein");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimantProfile_ssnHash_key" ON "ClaimantProfile"("ssnHash");

-- AddForeignKey
ALTER TABLE "EmployerProfile" ADD CONSTRAINT "EmployerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmploymentEvent" ADD CONSTRAINT "EmploymentEvent_employerId_fkey" FOREIGN KEY ("employerId") REFERENCES "EmployerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmploymentEvent" ADD CONSTRAINT "EmploymentEvent_matchedClaimantProfileId_fkey" FOREIGN KEY ("matchedClaimantProfileId") REFERENCES "ClaimantProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
