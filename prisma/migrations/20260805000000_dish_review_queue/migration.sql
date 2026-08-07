-- Phase 6a M3 (docs/restaurants/phase-6a-restaurant-admin-design.md §7).
-- Additive only: dish revision rows for the ops review queue — PUBLISH
-- (first publish, dish held in PENDING_REVIEW) and EDIT (staged
-- name/ingredient changes on a live dish; swap in on approval).

CREATE TYPE "DishRevisionKind" AS ENUM ('PUBLISH', 'EDIT');
CREATE TYPE "DishRevisionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

CREATE TABLE "RestaurantDishRevision" (
    "id" TEXT NOT NULL,
    "dishId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "kind" "DishRevisionKind" NOT NULL,
    "status" "DishRevisionStatus" NOT NULL DEFAULT 'PENDING',
    "submittedBy" TEXT NOT NULL,
    "name" TEXT,
    "ingredients" JSONB,
    "reviewNote" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RestaurantDishRevision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RestaurantDishRevision_status_createdAt_idx"
  ON "RestaurantDishRevision"("status", "createdAt");
CREATE INDEX "RestaurantDishRevision_restaurantId_status_reviewedAt_idx"
  ON "RestaurantDishRevision"("restaurantId", "status", "reviewedAt");
CREATE INDEX "RestaurantDishRevision_dishId_status_idx"
  ON "RestaurantDishRevision"("dishId", "status");

ALTER TABLE "RestaurantDishRevision"
  ADD CONSTRAINT "RestaurantDishRevision_dishId_fkey"
  FOREIGN KEY ("dishId") REFERENCES "RestaurantDish"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RestaurantDishRevision"
  ADD CONSTRAINT "RestaurantDishRevision_restaurantId_fkey"
  FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
