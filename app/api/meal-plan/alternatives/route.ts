import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const mealTypeId = searchParams.get("mealTypeId");
  const excludeRecipeId = searchParams.get("excludeRecipeId");

  if (!mealTypeId) {
    return NextResponse.json({ error: "mealTypeId required" }, { status: 400 });
  }

  const alternatives = await prisma.recipe.findMany({
    where: {
      mealTypeId,
      isPublic: true,
      ...(excludeRecipeId ? { id: { not: excludeRecipeId } } : {}),
    },
    take: 3,
    orderBy: { createdAt: "desc" },
    include: { mealType: true, ingredients: { include: { ingredient: true } } },
  });

  return NextResponse.json({ alternatives });
}
