-- CreateTable
CREATE TABLE "FoodToAvoidBannedIngredient" (
    "id" TEXT NOT NULL,
    "avoidId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "FoodToAvoidBannedIngredient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FoodToAvoidBannedIngredient_avoidId_name_key" ON "FoodToAvoidBannedIngredient"("avoidId", "name");

-- AddForeignKey
ALTER TABLE "FoodToAvoidBannedIngredient" ADD CONSTRAINT "FoodToAvoidBannedIngredient_avoidId_fkey" FOREIGN KEY ("avoidId") REFERENCES "FoodToAvoid"("id") ON DELETE CASCADE ON UPDATE CASCADE;

