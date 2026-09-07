-- CreateTable
CREATE TABLE "PatientPantryItem" (
    "patientId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientPantryItem_pkey" PRIMARY KEY ("patientId","ingredientId")
);

-- AddForeignKey
ALTER TABLE "PatientPantryItem" ADD CONSTRAINT "PatientPantryItem_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientPantryItem" ADD CONSTRAINT "PatientPantryItem_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
