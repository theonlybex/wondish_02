import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";

type Params = { entityType: string; id: string };

export async function GET(
  _req: NextRequest,
  { params }: { params: Params }
) {
  try {
    await requireAdmin();
    const items = await getItems(params.entityType, params.id);
    return NextResponse.json({ items });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Params }
) {
  try {
    await requireAdmin();
    const { name } = await req.json();
    if (!name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });

    const item = await createItem(params.entityType, params.id, name.trim());
    return NextResponse.json(item, { status: 201 });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Params }
) {
  try {
    await requireAdmin();
    const { searchParams } = new URL(req.url);
    const itemId = searchParams.get("itemId");
    if (!itemId) return NextResponse.json({ error: "itemId required" }, { status: 400 });

    await deleteItem(params.entityType, itemId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

async function getItems(entityType: string, id: string) {
  if (entityType === "health-condition") {
    return prisma.healthConditionBannedIngredient.findMany({
      where: { conditionId: id },
      orderBy: { name: "asc" },
    });
  }
  if (entityType === "food-preference") {
    return prisma.foodPreferenceBannedIngredient.findMany({
      where: { preferenceId: id },
      orderBy: { name: "asc" },
    });
  }
  if (entityType === "food-allergy") {
    return prisma.foodAllergyBannedIngredient.findMany({
      where: { allergyId: id },
      orderBy: { name: "asc" },
    });
  }
  if (entityType === "motivation") {
    return prisma.motivationBannedIngredient.findMany({
      where: { motivationId: id },
      orderBy: { name: "asc" },
    });
  }
  throw new Error(`Unknown entityType: ${entityType}`);
}

async function createItem(entityType: string, id: string, name: string) {
  if (entityType === "health-condition") {
    return prisma.healthConditionBannedIngredient.create({
      data: { conditionId: id, name },
    });
  }
  if (entityType === "food-preference") {
    return prisma.foodPreferenceBannedIngredient.create({
      data: { preferenceId: id, name },
    });
  }
  if (entityType === "food-allergy") {
    return prisma.foodAllergyBannedIngredient.create({
      data: { allergyId: id, name },
    });
  }
  if (entityType === "motivation") {
    return prisma.motivationBannedIngredient.create({
      data: { motivationId: id, name },
    });
  }
  throw new Error(`Unknown entityType: ${entityType}`);
}

async function deleteItem(entityType: string, itemId: string) {
  if (entityType === "health-condition") {
    return prisma.healthConditionBannedIngredient.delete({ where: { id: itemId } });
  }
  if (entityType === "food-preference") {
    return prisma.foodPreferenceBannedIngredient.delete({ where: { id: itemId } });
  }
  if (entityType === "food-allergy") {
    return prisma.foodAllergyBannedIngredient.delete({ where: { id: itemId } });
  }
  if (entityType === "motivation") {
    return prisma.motivationBannedIngredient.delete({ where: { id: itemId } });
  }
  throw new Error(`Unknown entityType: ${entityType}`);
}
