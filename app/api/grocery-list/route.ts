import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const patient = await prisma.patient.findUnique({
    where: { accountId: session.user.id },
  });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const startDate = from ? new Date(from) : new Date();
  const endDate = to ? new Date(to) : new Date();
  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(23, 59, 59, 999);

  const menus = await prisma.menu.findMany({
    where: {
      patientId: patient.id,
      date: { gte: startDate, lte: endDate },
    },
    include: {
      recipe: {
        include: {
          ingredients: {
            include: { ingredient: true },
          },
        },
      },
    },
  });

  // Aggregate ingredient quantities
  const aggregated: Record<
    string,
    { ingredientId: string; name: string; totalQuantity: number; unit: string | null }
  > = {};

  for (const menu of menus) {
    for (const ri of menu.recipe.ingredients) {
      const key = ri.ingredientId;
      if (!aggregated[key]) {
        aggregated[key] = {
          ingredientId: ri.ingredientId,
          name: ri.ingredient.name,
          totalQuantity: 0,
          unit: ri.unit ?? ri.ingredient.unit ?? null,
        };
      }
      aggregated[key].totalQuantity += ri.quantity ?? 1;
    }
  }

  const items = Object.values(aggregated).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  return NextResponse.json({ items });
}
