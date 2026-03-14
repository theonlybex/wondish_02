import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/admin-params";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";

export async function GET(
  _req: NextRequest,
  { params }: { params: { type: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    requireAdmin(session);

    const items = await getModel(params.type).findMany({
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ items });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { type: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    requireAdmin(session);

    const { name } = await req.json();
    const item = await getModel(params.type).create({ data: { name } });
    return NextResponse.json(item, { status: 201 });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { type: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    requireAdmin(session);

    const { id, name } = await req.json();
    const item = await getModel(params.type).update({ where: { id }, data: { name } });
    return NextResponse.json(item);
  } catch (err) {
    return adminErrorResponse(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { type: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    requireAdmin(session);

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    await getModel(params.type).delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getModel(type: string): any {
  const map: Record<string, unknown> = {
    gender: prisma.gender,
    "physical-activity": prisma.physicalActivity,
    "meal-type": prisma.mealType,
    "dish-type": prisma.dishType,
    ethnic: prisma.ethnic,
    motivation: prisma.motivation,
    "food-preference": prisma.foodPreference,
    "food-to-avoid": prisma.foodToAvoid,
    "food-allergy": prisma.foodAllergy,
    "health-condition": prisma.healthCondition,
  };

  const model = map[type];
  if (!model) throw new Error(`Unknown parameter type: ${type}`);
  return model;
}
