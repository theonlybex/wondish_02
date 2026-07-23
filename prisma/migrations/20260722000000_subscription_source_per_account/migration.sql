-- CreateEnum
CREATE TYPE "SubscriptionSource" AS ENUM ('STRIPE', 'APPLE', 'COUPON', 'ADMIN');

-- AlterTable
-- Backfill safety: every row that exists today predates per-source
-- subscriptions and was written by the Stripe integration, so the default
-- backfills them as `STRIPE` with no data loss.
ALTER TABLE "Subscription" ADD COLUMN "source" "SubscriptionSource" NOT NULL DEFAULT 'STRIPE';

-- DropIndex
-- The Account<->Subscription relation is becoming one-to-many (one row per
-- source, e.g. STRIPE + APPLE can coexist on the same account), so the sole
-- `accountId` unique no longer holds.
DROP INDEX "Subscription_accountId_key";

-- CreateIndex
-- Replaces it with a per-source unique: at most one row per (account, source).
CREATE UNIQUE INDEX "Subscription_accountId_source_key" ON "Subscription"("accountId", "source");
