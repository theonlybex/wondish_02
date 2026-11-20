// Loads one person's diet card from the database (the pure part is lib/diet-card.ts).
import { prisma } from "@/lib/db";
import { PATIENT_FOOD_MAP_INCLUDE } from "@/lib/food-map";
import { buildDietCard, type DietCard } from "@/lib/diet-card";

export async function loadDietCard(patientId: string, showConditions: boolean): Promise<DietCard | null> {
  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    include: { ...PATIENT_FOOD_MAP_INCLUDE, account: { select: { firstName: true } } },
  });
  if (!patient) return null;
  const liked = await prisma.patientIngredientPreference.findMany({
    where: { patientId, liked: true },
    select: { ingredient: { select: { name: true } } },
    take: 40,
  });
  return buildDietCard(patient.account.firstName, patient, { showConditions, likes: liked.map((l) => l.ingredient.name) });
}
