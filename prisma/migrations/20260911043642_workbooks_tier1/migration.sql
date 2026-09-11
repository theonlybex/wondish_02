-- AlterTable
ALTER TABLE "Ingredient" ADD COLUMN     "allergenGroups" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "canonicalId" TEXT,
ADD COLUMN     "components" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "formId" TEXT,
ADD COLUMN     "groceryCategory" TEXT;

-- AlterTable
ALTER TABLE "Recipe" ADD COLUMN     "addedSugars" DOUBLE PRECISION,
ADD COLUMN     "saturatedFat" DOUBLE PRECISION,
ADD COLUMN     "sodium" DOUBLE PRECISION,
ADD COLUMN     "sourceRow" INTEGER,
ADD COLUMN     "stepsSource" TEXT,
ADD COLUMN     "sugars" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "IngredientUnitConversion" (
    "id" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "baseQuantity" DOUBLE PRECISION NOT NULL,
    "baseUnit" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,

    CONSTRAINT "IngredientUnitConversion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IngredientUnitConversion_ingredientId_unit_key" ON "IngredientUnitConversion"("ingredientId", "unit");

-- CreateIndex
CREATE UNIQUE INDEX "Ingredient_formId_key" ON "Ingredient"("formId");

-- AddForeignKey
ALTER TABLE "IngredientUnitConversion" ADD CONSTRAINT "IngredientUnitConversion_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

