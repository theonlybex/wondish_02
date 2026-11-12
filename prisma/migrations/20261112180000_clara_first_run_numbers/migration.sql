-- Clara first run and full numbers. Additive only: new nullable or defaulted columns and one new table.

-- AlterTable
ALTER TABLE "Patient" ADD COLUMN "usualEating" JSONB;
ALTER TABLE "Patient" ADD COLUMN "startingPicture" JSONB;
ALTER TABLE "Patient" ADD COLUMN "weightGoal" TEXT;
ALTER TABLE "Patient" ADD COLUMN "noCondition" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Supplement" ADD COLUMN "contents" JSONB;
ALTER TABLE "Supplement" ADD COLUMN "estimated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "MealLog" ADD COLUMN "nutrients" JSONB;

-- AlterTable
ALTER TABLE "Ingredient" ADD COLUMN "nutrients" JSONB;

-- CreateTable
CREATE TABLE "TrackedLevel" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "levelKey" TEXT NOT NULL,
    "tracked" BOOLEAN NOT NULL DEFAULT true,
    "goal" DOUBLE PRECISION,
    "direction" TEXT,
    "target" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackedLevel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrackedLevel_patientId_levelKey_key" ON "TrackedLevel"("patientId", "levelKey");

-- AddForeignKey
ALTER TABLE "TrackedLevel" ADD CONSTRAINT "TrackedLevel_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
