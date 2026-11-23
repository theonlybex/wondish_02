-- Apple in-app purchases for the Clara iOS app: which Apple purchase an APPLE
-- subscription row holds, what was bought, and when it ends (null: lifetime).
-- All nullable, so existing rows need no backfill.
ALTER TABLE "Subscription" ADD COLUMN "appleOriginalTransactionId" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "appleProductId" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "appleExpiresAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Subscription_appleOriginalTransactionId_key" ON "Subscription"("appleOriginalTransactionId");
