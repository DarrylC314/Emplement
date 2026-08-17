-- CreateEnum
CREATE TYPE "CredentialType" AS ENUM ('EDUCATION', 'MILITARY_SERVICE', 'LAW_ENFORCEMENT', 'CERTIFICATION', 'OTHER');

-- CreateEnum
CREATE TYPE "CredentialRequestStatus" AS ENUM ('PENDING_AUTHORIZATION', 'AUTHORIZED', 'CONFIRMED', 'NO_RECORD_FOUND', 'DECLINED');

-- CreateEnum
CREATE TYPE "CredentialReportingMethod" AS ENUM ('REQUEST_RESPONSE', 'PROACTIVE_AGREEMENT');

-- AlterTable
ALTER TABLE "EmployerProfile" ADD COLUMN     "credentialReportingAgreement" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CredentialVerificationRequest" (
    "id" TEXT NOT NULL,
    "claimantProfileId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "credentialType" "CredentialType" NOT NULL,
    "requestedTitle" TEXT,
    "requestedByUserId" TEXT NOT NULL,
    "status" "CredentialRequestStatus" NOT NULL DEFAULT 'PENDING_AUTHORIZATION',
    "authorizedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "respondedByUserId" TEXT,
    "responseNote" TEXT,
    "resultingCredentialRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CredentialVerificationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CredentialRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "CredentialType" NOT NULL,
    "title" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "detailsSchemaVersion" INTEGER NOT NULL DEFAULT 1,
    "details" JSONB NOT NULL,
    "ssnHash" TEXT,
    "matchedClaimantProfileId" TEXT,
    "reportedVia" "CredentialReportingMethod" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dismissedAt" TIMESTAMP(3),
    "dismissedByUserId" TEXT,

    CONSTRAINT "CredentialRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CredentialVerificationRequest_resultingCredentialRecordId_key" ON "CredentialVerificationRequest"("resultingCredentialRecordId");

-- AddForeignKey
ALTER TABLE "CredentialVerificationRequest" ADD CONSTRAINT "CredentialVerificationRequest_claimantProfileId_fkey" FOREIGN KEY ("claimantProfileId") REFERENCES "ClaimantProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CredentialVerificationRequest" ADD CONSTRAINT "CredentialVerificationRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "EmployerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CredentialVerificationRequest" ADD CONSTRAINT "CredentialVerificationRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CredentialVerificationRequest" ADD CONSTRAINT "CredentialVerificationRequest_respondedByUserId_fkey" FOREIGN KEY ("respondedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CredentialVerificationRequest" ADD CONSTRAINT "CredentialVerificationRequest_resultingCredentialRecordId_fkey" FOREIGN KEY ("resultingCredentialRecordId") REFERENCES "CredentialRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CredentialRecord" ADD CONSTRAINT "CredentialRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "EmployerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CredentialRecord" ADD CONSTRAINT "CredentialRecord_matchedClaimantProfileId_fkey" FOREIGN KEY ("matchedClaimantProfileId") REFERENCES "ClaimantProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CredentialRecord" ADD CONSTRAINT "CredentialRecord_dismissedByUserId_fkey" FOREIGN KEY ("dismissedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
