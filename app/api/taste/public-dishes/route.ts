import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const candidates = await prisma.recipe.findMany({
    where: { isPublic: true },
    select: {
      id: true,
      name: true,
      emoji: true,
      description: true,
      calories: true,
      tags: true,
      mealType: { select: { name: true } },
      ethnic: { select: { name: true } },
    },
    take: 100,
  });

  const shuffled = [...candidates].sort(() => Math.random() - 0.5);
  return NextResponse.json({ dishes: shuffled.slice(0, 20) });
}
