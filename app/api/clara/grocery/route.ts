import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveClaraCaller } from "@/lib/clara/caller";
import { groceryListFor } from "@/lib/clara/skills/dish";
import { parseTodayParam } from "@/lib/meal-log";
import { rateLimit } from "@/lib/rate-limit";

// The Clara app's Grocery tab.
// GET  /api/clara/grocery?today=YYYY-MM-DD -> { groups: [{ key, kind, title, reason, items: [{ id, name, favorite }] }] }
//   What to buy, chosen in code (lib/clara/grocery.ts): a group per nutrient they
//   are low on with nothing at home that helps, and a group per thin food family.
// POST /api/clara/grocery { today, bought: [ingredientId] } -> the list again
//   "Bought": those foods are now at home (the same rows the Ingredients tab marks).
//   Only foods the catalog shows this person are taken; nothing is ever unmarked here.

const MAX_BOUGHT = 100;

async function gate(limit: number) {
  const caller = await resolveClaraCaller();
  if (!caller.ok) return { error: caller.response };
  const { success } = await rateLimit("clara-grocery", caller.userId, limit, 60);
  if (!success) return { error: NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 }) };
  if (!caller.patient) return { error: NextResponse.json({ error: "Profile not found" }, { status: 404 }) };
  return { patientId: caller.patient.id };
}

export async function GET(req: Request) {
  try {
    const g = await gate(60);
    if ("error" in g) return g.error;
    const today = parseTodayParam(new URL(req.url).searchParams.get("today"));
    if (!today.ok) return NextResponse.json({ error: today.error }, { status: today.status });
    const list = await groceryListFor(g.patientId, today.value);
    if (!list) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    return NextResponse.json({ groups: list.groups });
  } catch (err) {
    console.error("[clara-grocery] get", err);
    return NextResponse.json({ error: "Could not load the grocery list" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const g = await gate(60);
    if ("error" in g) return g.error;
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const o = (raw ?? {}) as { today?: unknown; bought?: unknown };
    const today = parseTodayParam(typeof o.today === "string" ? o.today : null);
    const bought = Array.isArray(o.bought) && o.bought.every((x) => typeof x === "string" && x.length > 0 && x.length <= 64) ? [...new Set(o.bought as string[])] : null;
    if (!today.ok || !bought || bought.length === 0 || bought.length > MAX_BOUGHT) {
      return NextResponse.json({ error: "Body must be { today: YYYY-MM-DD, bought: string[] }" }, { status: 400 });
    }
    const before = await groceryListFor(g.patientId, today.value);
    if (!before) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    const ids = bought.filter((id) => before.visibleIds.has(id));
    if (ids.length > 0) {
      await prisma.patientPantryItem.createMany({ data: ids.map((ingredientId) => ({ patientId: g.patientId, ingredientId })), skipDuplicates: true });
    }
    const after = await groceryListFor(g.patientId, today.value);
    return NextResponse.json({ groups: after?.groups ?? [] });
  } catch (err) {
    console.error("[clara-grocery] post", err);
    return NextResponse.json({ error: "Could not update the grocery list" }, { status: 500 });
  }
}
