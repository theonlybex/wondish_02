-- Phase 6a audit fix (review of 19d983c): at most ONE PENDING revision per
-- dish, enforced by the database. Concurrent staff PATCHes or concurrent
-- queue backfills could double-insert, and the M3 code merges/cancels only
-- the newest pending row — a duplicate becomes a stuck, undecidable queue
-- card. Older duplicates (if any) are cancelled before the index lands.

UPDATE "RestaurantDishRevision" r SET "status" = 'CANCELLED'
WHERE r."status" = 'PENDING' AND EXISTS (
  SELECT 1 FROM "RestaurantDishRevision" newer
  WHERE newer."dishId" = r."dishId"
    AND newer."status" = 'PENDING'
    AND (newer."createdAt" > r."createdAt"
         OR (newer."createdAt" = r."createdAt" AND newer."id" > r."id"))
);

CREATE UNIQUE INDEX "RestaurantDishRevision_one_pending_per_dish"
  ON "RestaurantDishRevision"("dishId") WHERE "status" = 'PENDING';
