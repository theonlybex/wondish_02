-- CreateTable
CREATE TABLE "PatientIngredientPreference" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "liked" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientIngredientPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PatientIngredientPreference_patientId_ingredientId_key" ON "PatientIngredientPreference"("patientId", "ingredientId");

-- AddForeignKey
ALTER TABLE "PatientIngredientPreference" ADD CONSTRAINT "PatientIngredientPreference_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientIngredientPreference" ADD CONSTRAINT "PatientIngredientPreference_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
