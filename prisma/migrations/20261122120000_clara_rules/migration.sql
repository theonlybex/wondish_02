-- "How Clara cooks": the person's rule switches and their own rules, one JSON value.
-- Null means every switch on and no rules of their own, so existing rows need no backfill.
ALTER TABLE "Patient" ADD COLUMN "claraRules" JSONB;
