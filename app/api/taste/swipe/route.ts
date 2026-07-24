import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { accountHasActivePremium } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await prisma.account.findUnique({
    where: { clerkId: userId },
    include: { subscriptions: true, roles: { include: { role: true } }, patient: true },
  });
  if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isAdmin = account.roles?.some((r) => r.role.name === "SUPER") ?? false;
  const isPremium = isAdmin || accountHasActivePremium(account.subscriptions);
  if (!isPremium) return NextResponse.json({ error: "Premium required" }, { status: 403 });

  const patient = account.patient;
  if (!patient) return NextResponse.json({ error: "No profile" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { recipeId, liked } = (body ?? {}) as { recipeId?: unknown; liked?: unknown };
  if (typeof recipeId !== "string" || recipeId.length === 0 || typeof liked !== "boolean") {
    return NextResponse.json({ error: "recipeId (string) and liked (boolean) required" }, { status: 400 });
  }

  // A nonexistent recipeId used to surface as an FK-violation 500.
  const recipe = await prisma.recipe.findUnique({ where: { id: recipeId }, select: { id: true } });
  if (!recipe) return NextResponse.json({ error: "Recipe not found" }, { status: 404 });

  await prisma.patientDishPreference.upsert({
    where: { patientId_recipeId: { patientId: patient.id, recipeId } },
    create: { patientId: patient.id, recipeId, liked },
    update: { liked },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await prisma.account.findUnique({
    where: { clerkId: userId },
    include: { subscriptions: true, roles: { include: { role: true } }, patient: true },
  });
  if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isAdmin = account.roles?.some((r) => r.role.name === "SUPER") ?? false;
  const isPremium = isAdmin || accountHasActivePremium(account.subscriptions);
  if (!isPremium) return NextResponse.json({ error: "Premium required" }, { status: 403 });

  const patient = account.patient;
  if (!patient) return NextResponse.json({ error: "No profile" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const recipeId = searchParams.get("recipeId");
  if (!recipeId) return NextResponse.json({ error: "recipeId required" }, { status: 400 });

  await prisma.patientDishPreference.deleteMany({
    where: { patientId: patient.id, recipeId },
  });

  return NextResponse.json({ ok: true });
}
