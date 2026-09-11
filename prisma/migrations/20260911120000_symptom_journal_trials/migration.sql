-- CreateEnum
CREATE TYPE "TrackingCategory" AS ENUM ('SYMPTOM', 'OBJECTIVE');

-- CreateEnum
CREATE TYPE "SymptomSeverity" AS ENUM ('NOT_PRESENT', 'MILD', 'MODERATE', 'SEVERE');

-- CreateEnum
CREATE TYPE "TrialStatus" AS ENUM ('ACTIVE', 'STOPPED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "TrialClassification" AS ENUM ('TOLERATED', 'DOSE_DEPENDENT', 'LIKELY_TRIGGER');

-- AlterTable
ALTER TABLE "HealthCondition" ADD COLUMN     "profileFactorId" INTEGER;

-- CreateTable
CREATE TABLE "ConditionTrackingItem" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "conditionId" TEXT NOT NULL,
    "category" "TrackingCategory" NOT NULL,
    "itemCode" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "inputSource" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ConditionTrackingItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalSymptom" (
    "id" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "trackingItemId" TEXT NOT NULL,
    "severity" "SymptomSeverity" NOT NULL,

    CONSTRAINT "JournalSymptom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TriggerRule" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "conditionId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "baselineDays" INTEGER NOT NULL,
    "trialDays" INTEGER NOT NULL,
    "reintroductionDays" INTEGER NOT NULL,
    "washoutDays" INTEGER NOT NULL,
    "doseDependent" BOOLEAN NOT NULL DEFAULT true,
    "examples" TEXT NOT NULL,
    "symptomsToMonitor" TEXT NOT NULL,
    "safetyNote" TEXT,
    "sourceUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TriggerRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TriggerRuleTrackingItem" (
    "ruleId" TEXT NOT NULL,
    "trackingItemId" TEXT NOT NULL,

    CONSTRAINT "TriggerRuleTrackingItem_pkey" PRIMARY KEY ("ruleId","trackingItemId")
);

-- CreateTable
CREATE TABLE "TriggerCategoryTerm" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "group" TEXT,

    CONSTRAINT "TriggerCategoryTerm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TriggerTrial" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "status" "TrialStatus" NOT NULL DEFAULT 'ACTIVE',
    "classification" "TrialClassification",
    "baselineScore" DOUBLE PRECISION,
    "eliminationScore" DOUBLE PRECISION,
    "challengeScore" DOUBLE PRECISION,
    "lastPhase" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TriggerTrial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConditionTrackingItem_code_key" ON "ConditionTrackingItem"("code");

-- CreateIndex
CREATE INDEX "ConditionTrackingItem_conditionId_category_idx" ON "ConditionTrackingItem"("conditionId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "JournalSymptom_journalEntryId_trackingItemId_key" ON "JournalSymptom"("journalEntryId", "trackingItemId");

-- CreateIndex
CREATE UNIQUE INDEX "TriggerRule_code_key" ON "TriggerRule"("code");

-- CreateIndex
CREATE INDEX "TriggerRule_conditionId_idx" ON "TriggerRule"("conditionId");

-- CreateIndex
CREATE INDEX "TriggerCategoryTerm_category_idx" ON "TriggerCategoryTerm"("category");

-- CreateIndex
CREATE UNIQUE INDEX "TriggerCategoryTerm_category_term_key" ON "TriggerCategoryTerm"("category", "term");

-- CreateIndex
CREATE INDEX "TriggerTrial_patientId_status_idx" ON "TriggerTrial"("patientId", "status");

-- AddForeignKey
ALTER TABLE "ConditionTrackingItem" ADD CONSTRAINT "ConditionTrackingItem_conditionId_fkey" FOREIGN KEY ("conditionId") REFERENCES "HealthCondition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalSymptom" ADD CONSTRAINT "JournalSymptom_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalSymptom" ADD CONSTRAINT "JournalSymptom_trackingItemId_fkey" FOREIGN KEY ("trackingItemId") REFERENCES "ConditionTrackingItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriggerRule" ADD CONSTRAINT "TriggerRule_conditionId_fkey" FOREIGN KEY ("conditionId") REFERENCES "HealthCondition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriggerRuleTrackingItem" ADD CONSTRAINT "TriggerRuleTrackingItem_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "TriggerRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriggerRuleTrackingItem" ADD CONSTRAINT "TriggerRuleTrackingItem_trackingItemId_fkey" FOREIGN KEY ("trackingItemId") REFERENCES "ConditionTrackingItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriggerTrial" ADD CONSTRAINT "TriggerTrial_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriggerTrial" ADD CONSTRAINT "TriggerTrial_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "TriggerRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- One ACTIVE trial per patient (spec invariant)
CREATE UNIQUE INDEX "TriggerTrial_one_active_per_patient" ON "TriggerTrial"("patientId") WHERE "status" = 'ACTIVE';
