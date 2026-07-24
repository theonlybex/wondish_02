import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseLocalDateStrict } from "@/lib/journal";

// Local-date parse (audit Task 15): `new Date("YYYY-MM-DD")` UTC-parses and
// shifts the window a day early on negative-offset servers; garbage input
// previously produced a NaN Date → Prisma 500. Invalid params now 400.
function parseWindowParam(raw: string | null): Date | null | "invalid" {
  if (raw === null) return null;
  return parseLocalDateStrict(raw) ?? "invalid";
}

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Single round-trip via the Clerk id relation (was account-then-patient).
  const patient = await prisma.patient.findFirst({ where: { account: { clerkId: userId } } });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const from = parseWindowParam(searchParams.get("from"));
  const to = parseWindowParam(searchParams.get("to"));
  if (from === "invalid" || to === "invalid") {
    return NextResponse.json({ error: "from/to must be YYYY-MM-DD strings" }, { status: 400 });
  }

  const startDate = from ?? new Date();
  const endDate = to ?? new Date();
  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(23, 59, 59, 999);

  const menus = await prisma.menu.findMany({
    where: { patientId: patient.id, planVersion: patient.activePlanVersion, date: { gte: startDate, lte: endDate } },
    include: { recipe: { include: { ingredients: { include: { ingredient: true } } } } },
  });

  const aggregated: Record<string, { ingredientId: string; name: string; totalQuantity: number; unit: string | null }> = {};

  for (const menu of menus) {
    for (const ri of menu.recipe.ingredients) {
      const key = ri.ingredientId;
      if (!aggregated[key]) {
        aggregated[key] = { ingredientId: ri.ingredientId, name: ri.ingredient.name, totalQuantity: 0, unit: ri.unit ?? ri.ingredient.unit ?? null };
      }
      aggregated[key].totalQuantity += ri.quantity ?? 1;
    }
  }

  const items = Object.values(aggregated).sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ items });
}
