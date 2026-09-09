import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// POST /api/taste/ingredients/reset — clear ALL of the patient's ingredient
// preferences so they can rate their favorites from scratch.
export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const patient = await prisma.patient.findFirst({
    where: { account: { clerkId: userId } },
    select: { id: true },
  });
  if (!patient) return NextResponse.json({ error: "No profile" }, { status: 404 });

  const { count } = await prisma.patientIngredientPreference.deleteMany({
    where: { patientId: patient.id },
  });
  return NextResponse.json({ ok: true, cleared: count });
}
