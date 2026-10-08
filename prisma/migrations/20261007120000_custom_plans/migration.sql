-- Custom plans: a FoodPreference (diet) row owned by one patient, with a note
-- for Clara. Mirrors 20260911180000_custom_conditions. Global rows keep name
-- uniqueness through a partial index; custom rows are unique per owner.
-- Additive and backward compatible.
ALTER TABLE "FoodPreference" ADD COLUMN "guidance" TEXT,
ADD COLUMN "ownerPatientId" TEXT;

ALTER TABLE "FoodPreference" ADD CONSTRAINT "FoodPreference_ownerPatientId_fkey"
  FOREIGN KEY ("ownerPatientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX IF EXISTS "FoodPreference_name_key";
CREATE UNIQUE INDEX "FoodPreference_global_name_key" ON "FoodPreference"("name") WHERE "ownerPatientId" IS NULL;
CREATE UNIQUE INDEX "FoodPreference_ownerPatientId_name_key" ON "FoodPreference"("ownerPatientId", "name");
CREATE INDEX "FoodPreference_ownerPatientId_idx" ON "FoodPreference"("ownerPatientId");
