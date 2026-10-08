-- Kitchen basics: the staples a patient says they don't have. Additive; default empty (all assumed).
-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "missingStaples" TEXT[] DEFAULT ARRAY[]::TEXT[];

