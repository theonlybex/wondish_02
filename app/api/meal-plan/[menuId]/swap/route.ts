import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { menuId: string } }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await prisma.account.findUnique({ where: { clerkId: userId } });
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const { recipeId } = await req.json();

  const patient = await prisma.patient.findUnique({ where: { accountId: account.id } });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const menu = await prisma.menu.findFirst({
    where: { id: params.menuId, patientId: patient.id },
  });
  if (!menu) return NextResponse.json({ error: "Menu not found" }, { status: 404 });

  const updated = await prisma.menu.update({
    where: { id: params.menuId },
    data: { recipeId },
    include: { recipe: { include: { mealType: true } }, mealType: true },
  });

  return NextResponse.json(updated);
}
