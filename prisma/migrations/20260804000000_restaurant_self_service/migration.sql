-- Phase 6a M1 (docs/restaurants/phase-6a-restaurant-admin-design.md §2).
-- Additive only: staff/invite/audit/ingredient-request tables, dish
-- soft-delete + freshness columns, PENDING_REVIEW dish status, catalog FK
-- on dish ingredients.

ALTER TYPE "RestaurantDishStatus" ADD VALUE 'PENDING_REVIEW';

CREATE TYPE "RestaurantStaffRole" AS ENUM ('OWNER', 'MANAGER');
CREATE TYPE "RestaurantInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');
CREATE TYPE "IngredientRequestStatus" AS ENUM ('PENDING', 'MAPPED', 'REJECTED');

ALTER TABLE "RestaurantDish"
  ADD COLUMN "lastVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "deletedAt" TIMESTAMP(3);

ALTER TABLE "RestaurantDishIngredient"
  ADD COLUMN "ingredientId" TEXT;

ALTER TABLE "RestaurantDishIngredient"
  ADD CONSTRAINT "RestaurantDishIngredient_ingredientId_fkey"
  FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "RestaurantStaff" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "role" "RestaurantStaffRole" NOT NULL DEFAULT 'MANAGER',
    "invitedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RestaurantStaff_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RestaurantStaff_accountId_restaurantId_key"
  ON "RestaurantStaff"("accountId", "restaurantId");
CREATE INDEX "RestaurantStaff_restaurantId_idx" ON "RestaurantStaff"("restaurantId");

ALTER TABLE "RestaurantStaff"
  ADD CONSTRAINT "RestaurantStaff_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RestaurantStaff"
  ADD CONSTRAINT "RestaurantStaff_restaurantId_fkey"
  FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RestaurantInvite" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "RestaurantStaffRole" NOT NULL DEFAULT 'OWNER',
    "status" "RestaurantInviteStatus" NOT NULL DEFAULT 'PENDING',
    "clerkInvitationId" TEXT,
    "invitedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "RestaurantInvite_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RestaurantInvite_restaurantId_status_idx"
  ON "RestaurantInvite"("restaurantId", "status");
CREATE INDEX "RestaurantInvite_email_idx" ON "RestaurantInvite"("email");

ALTER TABLE "RestaurantInvite"
  ADD CONSTRAINT "RestaurantInvite_restaurantId_fkey"
  FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RestaurantAuditLog" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "action" TEXT NOT NULL,
    "diff" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RestaurantAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RestaurantAuditLog_restaurantId_createdAt_idx"
  ON "RestaurantAuditLog"("restaurantId", "createdAt");

ALTER TABLE "RestaurantAuditLog"
  ADD CONSTRAINT "RestaurantAuditLog_restaurantId_fkey"
  FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "IngredientRequest" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "status" "IngredientRequestStatus" NOT NULL DEFAULT 'PENDING',
    "mappedToId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngredientRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IngredientRequest_status_idx" ON "IngredientRequest"("status");
