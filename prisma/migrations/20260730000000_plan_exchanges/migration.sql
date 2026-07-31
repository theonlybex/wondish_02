-- Additive only (cycle.md §2.3). Two overlay tables + MealLog provenance column.
CREATE TYPE "PlanExchangeStatus" AS ENUM ('PENDING', 'RESOLVED', 'CANCELLED');

CREATE TABLE "RestaurantPlanExchange" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "planVersion" INTEGER NOT NULL,
    "status" "PlanExchangeStatus" NOT NULL DEFAULT 'PENDING',
    "displacedMenuId" TEXT,
    "servings" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "restaurantDishId" TEXT,
    "name" TEXT NOT NULL,
    "restaurantName" TEXT NOT NULL,
    "calories" DOUBLE PRECISION,
    "protein" DOUBLE PRECISION,
    "carbs" DOUBLE PRECISION,
    "fat" DOUBLE PRECISION,
    "fiber" DOUBLE PRECISION,
    "incomplete" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "RestaurantPlanExchange_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FridgePlanExchange" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "planVersion" INTEGER NOT NULL,
    "status" "PlanExchangeStatus" NOT NULL DEFAULT 'PENDING',
    "displacedMenuId" TEXT,
    "servings" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "fridgeRecipeId" TEXT,
    "name" TEXT NOT NULL,
    "emoji" TEXT,
    "mealType" TEXT,
    "usesIngredients" TEXT[],
    "steps" TEXT[],
    "calories" DOUBLE PRECISION NOT NULL,
    "protein" DOUBLE PRECISION NOT NULL,
    "carbs" DOUBLE PRECISION NOT NULL,
    "fat" DOUBLE PRECISION NOT NULL,
    "fiber" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "FridgePlanExchange_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "MealLog" ADD COLUMN "planExchangeId" TEXT;

CREATE UNIQUE INDEX "RestaurantPlanExchange_displacedMenuId_key" ON "RestaurantPlanExchange"("displacedMenuId");
CREATE UNIQUE INDEX "FridgePlanExchange_displacedMenuId_key" ON "FridgePlanExchange"("displacedMenuId");
CREATE INDEX "RestaurantPlanExchange_patientId_planVersion_localDate_stat_idx" ON "RestaurantPlanExchange"("patientId", "planVersion", "localDate", "status");
CREATE INDEX "FridgePlanExchange_patientId_planVersion_localDate_status_idx" ON "FridgePlanExchange"("patientId", "planVersion", "localDate", "status");

ALTER TABLE "RestaurantPlanExchange" ADD CONSTRAINT "RestaurantPlanExchange_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RestaurantPlanExchange" ADD CONSTRAINT "RestaurantPlanExchange_displacedMenuId_fkey" FOREIGN KEY ("displacedMenuId") REFERENCES "Menu"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RestaurantPlanExchange" ADD CONSTRAINT "RestaurantPlanExchange_restaurantDishId_fkey" FOREIGN KEY ("restaurantDishId") REFERENCES "RestaurantDish"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FridgePlanExchange" ADD CONSTRAINT "FridgePlanExchange_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FridgePlanExchange" ADD CONSTRAINT "FridgePlanExchange_displacedMenuId_fkey" FOREIGN KEY ("displacedMenuId") REFERENCES "Menu"("id") ON DELETE SET NULL ON UPDATE CASCADE;
