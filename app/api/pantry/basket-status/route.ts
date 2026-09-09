import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { computeBasketReadiness } from "@/lib/basket-readiness";

// Readiness of the patient's pantry basket for a full-week generation:
// { count, min, ready, missingCategories }. Drives the planner's New-week gate.
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const patient = await prisma.patient.findFirst({
    where: { account: { clerkId: userId } },
    select: { id: true },
  });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const items = await prisma.patientPantryItem.findMany({
    where: { patientId: patient.id },
    select: { ingredient: { select: { name: true } } },
  });
  const status = computeBasketReadiness(items.map((i) => i.ingredient.name));
  return NextResponse.json(status);
}
