import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { buildDietMatchers, derivePatientBans, PATIENT_DIET_INCLUDE } from "@/lib/diet-match";
import { loadCatalogRows } from "@/lib/clara/kept-foods-db";
import type { CatalogRow } from "@/lib/clara/kept-foods";
import { parseSaveBody, planSave } from "@/lib/clara/ingredients-save";

// The Clara app's "at home" and favourite foods.
// GET -> the catalog the diet allows, grouped, with the person's marks.
// PUT -> save the marks for the foods shown; anything else they have is left alone.

const MAX_IDS = 300;

function toGroups(rows: CatalogRow[]) {
  const groups = new Map<string, { key: string; title: string; items: { id: string; name: string; atHome: boolean; favorite: boolean }[] }>();
  for (const r of rows) {
    let g = groups.get(r.groupKey);
    if (!g) groups.set(r.groupKey, (g = { key: r.groupKey, title: r.groupTitle, items: [] }));
    g.items.push({ id: r.id, name: r.name, atHome: r.atHome, favorite: r.favorite });
  }
  return { groups: [...groups.values()].filter((g) => g.items.length > 0) };
}

async function gate() {
  const { userId } = await auth();
  if (!userId) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const { success } = await rateLimit("clara-ingredients", userId, 120, 60);
  if (!success) return { error: NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 }) };
  const patient = await prisma.patient.findFirst({
    where: { account: { clerkId: userId } },
    include: PATIENT_DIET_INCLUDE,
  });
  if (!patient) return { error: NextResponse.json({ error: "Profile not found" }, { status: 404 }) };
  // Without the diner's own dislikes: this is where a "not for me" is seen and undone.
  const matchers = buildDietMatchers(derivePatientBans(patient, new Date(), { dislikes: false }));
  return { patientId: patient.id, matchers };
}

export async function GET() {
  const g = await gate();
  if ("error" in g) return g.error;
  return NextResponse.json(toGroups(await loadCatalogRows(g.patientId, g.matchers)));
}

export async function PUT(req: NextRequest) {
  const g = await gate();
  if ("error" in g) return g.error;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const body = parseSaveBody(raw);
  if (!body) return NextResponse.json({ error: "Body must be { atHome: string[], favorites: string[] }" }, { status: 400 });
  if (body.atHome.length > MAX_IDS || body.favorites.length > MAX_IDS) {
    return NextResponse.json({ error: `At most ${MAX_IDS} ingredients per list.` }, { status: 422 });
  }

  const patientId = g.patientId;
  const visible = new Set((await loadCatalogRows(patientId, g.matchers)).map((r) => r.id));
  const [pantry, prefs] = await Promise.all([
    prisma.patientPantryItem.findMany({ where: { patientId }, select: { ingredientId: true } }),
    prisma.patientIngredientPreference.findMany({ where: { patientId }, select: { ingredientId: true, liked: true } }),
  ]);
  const plan = planSave(
    visible,
    { pantry: new Set(pantry.map((p) => p.ingredientId)), liked: new Map(prefs.map((p) => [p.ingredientId, p.liked])) },
    body,
  );

  await prisma.$transaction([
    prisma.patientPantryItem.createMany({
      data: plan.pantryAdd.map((ingredientId) => ({ patientId, ingredientId })),
      skipDuplicates: true,
    }),
    prisma.patientPantryItem.deleteMany({ where: { patientId, ingredientId: { in: plan.pantryRemove } } }),
    ...plan.likeUpsert.map((ingredientId) =>
      prisma.patientIngredientPreference.upsert({
        where: { patientId_ingredientId: { patientId, ingredientId } },
        create: { patientId, ingredientId, liked: true },
        update: { liked: true },
      }),
    ),
    prisma.patientIngredientPreference.deleteMany({
      where: { patientId, ingredientId: { in: plan.likeDelete }, liked: true },
    }),
  ]);

  return NextResponse.json(toGroups(await loadCatalogRows(patientId, g.matchers)));
}
