-- What the person READS weights in ("kg" | "lbs"). Patient.weightUnit is the
-- STORAGE unit — the profile route writes "lbs" on every save — so it could
-- never double as a preference, and cycle 15's toggle silently reverted.
-- Nullable and additive: null means "decide from the height unit", which is
-- exactly how every account behaves today.
ALTER TABLE "Patient" ADD COLUMN "displayWeightUnit" TEXT;
