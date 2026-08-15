-- AlterTable
ALTER TABLE "EmploymentEvent" ADD COLUMN     "dismissedAt" TIMESTAMP(3),
ADD COLUMN     "dismissedByUserId" TEXT;

-- AddForeignKey
ALTER TABLE "EmploymentEvent" ADD CONSTRAINT "EmploymentEvent_dismissedByUserId_fkey" FOREIGN KEY ("dismissedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
