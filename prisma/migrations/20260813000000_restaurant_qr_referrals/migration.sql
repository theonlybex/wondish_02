-- Phase 3 §1/§2 (docs/restaurants/phase-3.md). Additive only: QR codes and
-- the referral attribution spine. No existing table is altered.

CREATE TABLE "RestaurantQrCode" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "scans" INTEGER NOT NULL DEFAULT 0,
    "signups" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RestaurantQrCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RestaurantQrCode_token_key" ON "RestaurantQrCode"("token");
CREATE INDEX "RestaurantQrCode_restaurantId_active_idx"
  ON "RestaurantQrCode"("restaurantId", "active");

ALTER TABLE "RestaurantQrCode"
  ADD CONSTRAINT "RestaurantQrCode_restaurantId_fkey"
  FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RestaurantReferral" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "restaurantQrCodeId" TEXT,
    "signedUpAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RestaurantReferral_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RestaurantReferral_accountId_restaurantId_key"
  ON "RestaurantReferral"("accountId", "restaurantId");
CREATE INDEX "RestaurantReferral_restaurantId_signedUpAt_idx"
  ON "RestaurantReferral"("restaurantId", "signedUpAt");

ALTER TABLE "RestaurantReferral"
  ADD CONSTRAINT "RestaurantReferral_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RestaurantReferral"
  ADD CONSTRAINT "RestaurantReferral_restaurantId_fkey"
  FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RestaurantReferral"
  ADD CONSTRAINT "RestaurantReferral_restaurantQrCodeId_fkey"
  FOREIGN KEY ("restaurantQrCodeId") REFERENCES "RestaurantQrCode"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
