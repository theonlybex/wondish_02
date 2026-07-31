-- CreateEnum
CREATE TYPE "ClaraGapCategory" AS ENUM ('LOGS', 'NUTRITION', 'MEAL_PLAN', 'JOURNAL', 'SUPPLEMENTS', 'FILTERS', 'GROCERY', 'RESTAURANTS', 'FRIDGE', 'EXCHANGES', 'PROGRESS', 'TASTE', 'CUSTOM_INGREDIENTS', 'BODY_GOALS', 'OTHER');

-- CreateEnum
CREATE TYPE "ClaraGapReason" AS ENUM ('NOT_BUILT', 'FLAGGED_OFF', 'OUT_OF_SCOPE', 'UNCLEAR');

-- CreateTable
CREATE TABLE "ClaraCapabilityRequest" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "category" "ClaraGapCategory" NOT NULL,
    "reason" "ClaraGapReason" NOT NULL DEFAULT 'NOT_BUILT',
    "summary" TEXT NOT NULL,
    "surface" TEXT NOT NULL DEFAULT 'unknown',
    "localDate" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaraCapabilityRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClaraCapabilityRequest_patientId_category_localDate_key" ON "ClaraCapabilityRequest"("patientId", "category", "localDate");

-- CreateIndex
CREATE INDEX "ClaraCapabilityRequest_category_createdAt_idx" ON "ClaraCapabilityRequest"("category", "createdAt");

-- AddForeignKey
ALTER TABLE "ClaraCapabilityRequest" ADD CONSTRAINT "ClaraCapabilityRequest_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
