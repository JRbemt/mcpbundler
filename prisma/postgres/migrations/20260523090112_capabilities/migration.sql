-- AlterTable
ALTER TABLE "mcps" ADD COLUMN     "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[];
