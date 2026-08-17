-- CreateEnum
CREATE TYPE "TriggerSource" AS ENUM ('SYSTEM_SCHEDULED', 'SYSTEM_MANUAL_CHECK', 'STAFF');

-- AlterEnum
ALTER TYPE "ClaimStatus" ADD VALUE 'REEVALUATION_REQUIRED';

-- AlterTable
ALTER TABLE "EmploymentEvent" ADD COLUMN     "expectedEndDate" TIMESTAMP(3),
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "separationTriggeredAt" TIMESTAMP(3),
ADD COLUMN     "triggerSource" "TriggerSource",
ADD COLUMN     "triggeredByUserId" TEXT;

-- AlterTable
ALTER TABLE "JobPosting" ADD COLUMN     "expectedEndDate" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "EmploymentEvent" ADD CONSTRAINT "EmploymentEvent_triggeredByUserId_fkey" FOREIGN KEY ("triggeredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
