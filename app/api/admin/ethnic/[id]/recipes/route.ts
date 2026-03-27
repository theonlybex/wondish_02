import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";

type Params = { id: string };

// GET — list all recipes assigned to this ethnic cuisine
export async function GET(
  _req: NextRequest,
  { params }: { params: Params }
) {
  try {
    await requireAdmin();
    const recipes = await prisma.recipe.findMany({
      where: { ethnicId: params.id },
      select: { id: true, name: true, emoji: true, mealType: { select: { name: true } } },
      orderBy: { name: "asc" },
    });
    return NextResponse.json({ recipes });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

// POST — assign a recipe to this ethnic cuisine
export async function POST(
  req: NextRequest,
  { params }: { params: Params }
) {
  try {
    await requireAdmin();
    const { recipeId } = await req.json();
    if (!recipeId) return NextResponse.json({ error: "recipeId required" }, { status: 400 });

    const recipe = await prisma.recipe.update({
      where: { id: recipeId },
      data: { ethnicId: params.id },
      select: { id: true, name: true, emoji: true, mealType: { select: { name: true } } },
    });
    return NextResponse.json(recipe);
  } catch (err) {
    return adminErrorResponse(err);
  }
}

// DELETE — unassign a recipe from this ethnic cuisine
export async function DELETE(
  req: NextRequest,
  { params: _params }: { params: Params }
) {
  try {
    await requireAdmin();
    const { searchParams } = new URL(req.url);
    const recipeId = searchParams.get("recipeId");
    if (!recipeId) return NextResponse.json({ error: "recipeId required" }, { status: 400 });

    await prisma.recipe.update({
      where: { id: recipeId },
      data: { ethnicId: null },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
