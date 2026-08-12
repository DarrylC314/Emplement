-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CLAIMANT', 'CASEWORKER', 'ADMIN');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'FAILED');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('ACTIVE', 'RESTRICTED', 'DENIED', 'CLOSED');

-- CreateEnum
CREATE TYPE "AutoDecision" AS ENUM ('APPROVED', 'FLAGGED', 'DENIED');

-- CreateEnum
CREATE TYPE "ReviewActionType" AS ENUM ('APPROVED', 'DENIED', 'FLAGGED_FOR_FRAUD', 'AMOUNT_ADJUSTED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimantProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "legalName" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "ssnEncrypted" TEXT,
    "phone" TEXT,
    "mailingAddress" TEXT,
    "identityVerificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClaimantProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdentityVerificationAttempt" (
    "id" TEXT NOT NULL,
    "claimantId" TEXT NOT NULL,
    "mockProvider" TEXT NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "mockReferenceId" TEXT NOT NULL,

    CONSTRAINT "IdentityVerificationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "claimantId" TEXT NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'ACTIVE',
    "benefitYearStart" TIMESTAMP(3) NOT NULL,
    "benefitYearEnd" TIMESTAMP(3) NOT NULL,
    "weeklyBenefitAmount" DECIMAL(10,2) NOT NULL,
    "openedDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyCertification" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "weekEndingDate" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ableAndAvailable" BOOLEAN NOT NULL,
    "workedThisWeek" BOOLEAN NOT NULL,
    "earnings" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "refusedWork" BOOLEAN NOT NULL,
    "autoDecision" "AutoDecision" NOT NULL,
    "autoDecisionReason" TEXT NOT NULL,

    CONSTRAINT "WeeklyCertification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobSearchActivity" (
    "id" TEXT NOT NULL,
    "weeklyCertificationId" TEXT NOT NULL,
    "employerName" TEXT NOT NULL,
    "contactMethod" TEXT NOT NULL,
    "contactDate" TIMESTAMP(3) NOT NULL,
    "position" TEXT NOT NULL,

    CONSTRAINT "JobSearchActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseNote" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "caseworkerId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimReviewAction" (
    "id" TEXT NOT NULL,
    "weeklyCertificationId" TEXT NOT NULL,
    "caseworkerId" TEXT NOT NULL,
    "action" "ReviewActionType" NOT NULL,
    "reason" TEXT NOT NULL,
    "previousValue" TEXT,
    "newValue" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimReviewAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "claimantId" TEXT NOT NULL,
    "caseworkerId" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetEntity" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimantProfile_userId_key" ON "ClaimantProfile"("userId");

-- AddForeignKey
ALTER TABLE "ClaimantProfile" ADD CONSTRAINT "ClaimantProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityVerificationAttempt" ADD CONSTRAINT "IdentityVerificationAttempt_claimantId_fkey" FOREIGN KEY ("claimantId") REFERENCES "ClaimantProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_claimantId_fkey" FOREIGN KEY ("claimantId") REFERENCES "ClaimantProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyCertification" ADD CONSTRAINT "WeeklyCertification_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobSearchActivity" ADD CONSTRAINT "JobSearchActivity_weeklyCertificationId_fkey" FOREIGN KEY ("weeklyCertificationId") REFERENCES "WeeklyCertification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseNote" ADD CONSTRAINT "CaseNote_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseNote" ADD CONSTRAINT "CaseNote_caseworkerId_fkey" FOREIGN KEY ("caseworkerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimReviewAction" ADD CONSTRAINT "ClaimReviewAction_weeklyCertificationId_fkey" FOREIGN KEY ("weeklyCertificationId") REFERENCES "WeeklyCertification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimReviewAction" ADD CONSTRAINT "ClaimReviewAction_caseworkerId_fkey" FOREIGN KEY ("caseworkerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_claimantId_fkey" FOREIGN KEY ("claimantId") REFERENCES "ClaimantProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_caseworkerId_fkey" FOREIGN KEY ("caseworkerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
