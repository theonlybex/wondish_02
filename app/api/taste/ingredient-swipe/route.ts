import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const patient = await prisma.patient.findFirst({
    where: { account: { clerkId: userId } },
    select: { id: true },
  });
  if (!patient) return NextResponse.json({ error: "No profile" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { ingredientId, liked } = (body ?? {}) as { ingredientId?: unknown; liked?: unknown };
  if (typeof ingredientId !== "string" || ingredientId.length === 0 || typeof liked !== "boolean") {
    return NextResponse.json({ error: "ingredientId (string) and liked (boolean) required" }, { status: 400 });
  }

  // A nonexistent ingredientId would surface as an FK-violation 500.
  const ingredient = await prisma.ingredient.findUnique({ where: { id: ingredientId }, select: { id: true } });
  if (!ingredient) return NextResponse.json({ error: "Ingredient not found" }, { status: 404 });

  await prisma.patientIngredientPreference.upsert({
    where: { patientId_ingredientId: { patientId: patient.id, ingredientId } },
    create: { patientId: patient.id, ingredientId, liked },
    update: { liked },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const patient = await prisma.patient.findFirst({
    where: { account: { clerkId: userId } },
    select: { id: true },
  });
  if (!patient) return NextResponse.json({ error: "No profile" }, { status: 404 });

  const ingredientId = new URL(req.url).searchParams.get("ingredientId");
  if (!ingredientId) return NextResponse.json({ error: "ingredientId required" }, { status: 400 });

  await prisma.patientIngredientPreference.deleteMany({ where: { patientId: patient.id, ingredientId } });
  return NextResponse.json({ ok: true });
}
