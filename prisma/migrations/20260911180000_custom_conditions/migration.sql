-- Custom (user-defined) health conditions: a HealthCondition row owned by one
-- patient. Global rows keep name uniqueness through a partial index; custom
-- rows are unique per owner. Additive and backward compatible.
ALTER TABLE "HealthCondition" ADD COLUMN "ownerPatientId" TEXT;
ALTER TABLE "HealthCondition" ADD COLUMN "guidance" TEXT;

ALTER TABLE "HealthCondition"
  ADD CONSTRAINT "HealthCondition_ownerPatientId_fkey"
  FOREIGN KEY ("ownerPatientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX IF EXISTS "HealthCondition_name_key";
CREATE UNIQUE INDEX "HealthCondition_global_name_key" ON "HealthCondition"("name") WHERE "ownerPatientId" IS NULL;
CREATE UNIQUE INDEX "HealthCondition_ownerPatientId_name_key" ON "HealthCondition"("ownerPatientId", "name");
CREATE INDEX "HealthCondition_ownerPatientId_idx" ON "HealthCondition"("ownerPatientId");
