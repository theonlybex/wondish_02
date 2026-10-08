-- Feedback reports: user bug reports grouped into issues by the triage bot. Additive.
-- CreateEnum
CREATE TYPE "FeedbackCategory" AS ENUM ('SAFETY_FOOD', 'WRONG_FOOD', 'MEAL_PLAN', 'SHOPPING', 'CLARA', 'JOURNAL', 'TRIALS', 'PROFILE', 'BILLING', 'PERFORMANCE', 'UI', 'IDEA', 'OTHER');

-- CreateEnum
CREATE TYPE "FeedbackSeverity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('NEW', 'INVESTIGATING', 'FIXED', 'WONT_FIX');

-- CreateEnum
CREATE TYPE "TriageState" AS ENUM ('PENDING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "FeedbackIssue" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "FeedbackCategory" NOT NULL,
    "severity" "FeedbackSeverity" NOT NULL,
    "status" "FeedbackStatus" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedbackIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedbackReport" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "issueId" TEXT,
    "text" TEXT NOT NULL,
    "area" TEXT,
    "context" JSONB NOT NULL,
    "screenshotKey" TEXT,
    "triage" "TriageState" NOT NULL DEFAULT 'PENDING',
    "triageNote" TEXT,
    "triageTries" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedbackReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeedbackIssue_status_severity_idx" ON "FeedbackIssue"("status", "severity");

-- CreateIndex
CREATE INDEX "FeedbackReport_patientId_createdAt_idx" ON "FeedbackReport"("patientId", "createdAt");

-- CreateIndex
CREATE INDEX "FeedbackReport_triage_idx" ON "FeedbackReport"("triage");

-- CreateIndex
CREATE INDEX "FeedbackReport_issueId_idx" ON "FeedbackReport"("issueId");

-- AddForeignKey
ALTER TABLE "FeedbackReport" ADD CONSTRAINT "FeedbackReport_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackReport" ADD CONSTRAINT "FeedbackReport_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "FeedbackIssue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

