-- Beta premium coupons: the instant at which access granted by a PREMIUM
-- code ends. Nullable and additive; existing rows are ADMIN codes (null).
ALTER TABLE "Coupon" ADD COLUMN "accessUntil" TIMESTAMP(3);
