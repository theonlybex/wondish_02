import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await prisma.account.findUnique({ where: { clerkId: userId } });
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const patient = await prisma.patient.findUnique({ where: { accountId: account.id } });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const startDate = from ? new Date(from) : new Date();
  const endDate = to ? new Date(to) : new Date();
  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(23, 59, 59, 999);

  const menus = await prisma.menu.findMany({
    where: { patientId: patient.id, date: { gte: startDate, lte: endDate } },
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
