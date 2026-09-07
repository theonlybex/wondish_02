import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

// The patient's current at-home ingredients ("what's in your fridge").
// GET  → current items + a common-ingredients starter grid (+ ?q= search).
// PUT  → replace the whole set with body.ingredientIds.
// Consumer-facing — unlike /api/ingredients/search, which is staff-only.

const MAX_PANTRY_ITEMS = 300;

async function resolvePatient(userId: string) {
  return prisma.patient.findFirst({
    where: { account: { clerkId: userId } },
    select: { id: true },
  });
}

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success } = await rateLimit("pantry", userId, 120, 60);
  if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  const patient = await resolvePatient(userId);
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length >= 2) {
    const rows = await prisma.ingredient.findMany({
      where: { name: { contains: q, mode: "insensitive" } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 25,
    });
    const lower = q.toLowerCase();
    const ingredients = [
      ...rows.filter((r) => r.name.toLowerCase().startsWith(lower)),
      ...rows.filter((r) => !r.name.toLowerCase().startsWith(lower)),
    ].slice(0, 12);
    return NextResponse.json({ ingredients });
  }

  const [items, usage] = await Promise.all([
    prisma.patientPantryItem.findMany({
      where: { patientId: patient.id },
      select: { ingredient: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    // Most-used ingredients across the public catalog make the best starter
    // grid — they unlock the most dishes per tap.
    prisma.recipeIngredient.groupBy({
      by: ["ingredientId"],
      where: { recipe: { isPublic: true } },
      _count: { ingredientId: true },
      orderBy: { _count: { ingredientId: "desc" } },
      take: 36,
    }),
  ]);

  const commonRows = await prisma.ingredient.findMany({
    where: { id: { in: usage.map((u) => u.ingredientId) } },
    select: { id: true, name: true },
  });
  const order = new Map(usage.map((u, i) => [u.ingredientId, i]));
  const common = commonRows.sort(
    (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)
  );

  return NextResponse.json({
    items: items.map((i) => i.ingredient),
    common,
  });
}

export async function PUT(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success } = await rateLimit("pantry", userId, 120, 60);
  if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  const patient = await resolvePatient(userId);
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const ids = (body as { ingredientIds?: unknown })?.ingredientIds;
  if (!Array.isArray(ids) || ids.some((i) => typeof i !== "string")) {
    return NextResponse.json({ error: "ingredientIds must be an array of ids" }, { status: 400 });
  }
  if (ids.length > MAX_PANTRY_ITEMS) {
    return NextResponse.json(
      { error: `Pantry is capped at ${MAX_PANTRY_ITEMS} ingredients.` },
      { status: 422 }
    );
  }

  // Silently drop ids that don't exist — the picker only offers real rows, so
  // anything else is a stale/tampered client, not a user mistake worth a 4xx.
  const valid = await prisma.ingredient.findMany({
    where: { id: { in: ids as string[] } },
    select: { id: true },
  });

  await prisma.$transaction([
    prisma.patientPantryItem.deleteMany({ where: { patientId: patient.id } }),
    prisma.patientPantryItem.createMany({
      data: valid.map((v) => ({ patientId: patient.id, ingredientId: v.id })),
      skipDuplicates: true,
    }),
  ]);

  return NextResponse.json({ ok: true, count: valid.length });
}
