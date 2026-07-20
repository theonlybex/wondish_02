-- CreateEnum
CREATE TYPE "MealLogSource" AS ENUM ('MANUAL', 'RECIPE', 'PICTURE', 'FRIDGE', 'CUSTOM');

-- CreateTable
CREATE TABLE "MealLog" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "mealType" TEXT NOT NULL,
    "source" "MealLogSource" NOT NULL DEFAULT 'MANUAL',
    "name" TEXT NOT NULL,
    "servings" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "calories" DOUBLE PRECISION,
    "protein" DOUBLE PRECISION,
    "carbs" DOUBLE PRECISION,
    "fat" DOUBLE PRECISION,
    "fiber" DOUBLE PRECISION,
    "incomplete" BOOLEAN NOT NULL DEFAULT false,
    "recipeId" TEXT,
    "customIngredientId" TEXT,
    "journalMealId" TEXT,
    "pictureResultId" TEXT,
    "fridgeRecipeId" TEXT,
    "note" TEXT,
    "clientRequestId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MealLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MealLog_patientId_localDate_idx" ON "MealLog"("patientId", "localDate");

-- CreateIndex
CREATE INDEX "MealLog_patientId_updatedAt_idx" ON "MealLog"("patientId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MealLog_patientId_clientRequestId_key" ON "MealLog"("patientId", "clientRequestId");

-- AddForeignKey
ALTER TABLE "MealLog" ADD CONSTRAINT "MealLog_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealLog" ADD CONSTRAINT "MealLog_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

