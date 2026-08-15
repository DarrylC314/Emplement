-- CreateEnum
CREATE TYPE "NamePrefix" AS ENUM ('MR', 'MRS', 'MS', 'DR', 'MX');

-- CreateEnum
CREATE TYPE "NameSuffix" AS ENUM ('JR', 'SR', 'II', 'III', 'IV');

-- AlterTable
ALTER TABLE "ClaimantProfile" ADD COLUMN     "gender" TEXT,
ADD COLUMN     "prefix" "NamePrefix",
ADD COLUMN     "suffix" "NameSuffix";
