-- AlterTable
ALTER TABLE "Recipe" ADD COLUMN     "steps" TEXT[] DEFAULT ARRAY[]::TEXT[];
