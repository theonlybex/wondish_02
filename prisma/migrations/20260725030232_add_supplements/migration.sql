-- CreateTable
CREATE TABLE "Supplement" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dosage" TEXT,
    "timeSlot" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Supplement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplementIntake" (
    "id" TEXT NOT NULL,
    "supplementId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplementIntake_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Supplement_patientId_idx" ON "Supplement"("patientId");

-- CreateIndex
CREATE INDEX "SupplementIntake_patientId_date_idx" ON "SupplementIntake"("patientId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SupplementIntake_supplementId_date_key" ON "SupplementIntake"("supplementId", "date");

-- AddForeignKey
ALTER TABLE "Supplement" ADD CONSTRAINT "Supplement_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplementIntake" ADD CONSTRAINT "SupplementIntake_supplementId_fkey" FOREIGN KEY ("supplementId") REFERENCES "Supplement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
