import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { CUISINE_STAPLES } from "@/lib/cuisine-ingredients";

// GET /api/pantry/cuisine-ids — map every cuisine-staple name to a real
// Ingredient id (finding, or creating the missing ones), so the client can add
// a staple to the pantry by tapping it. Returns { ids: { <lowercased name>: id } }.
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const patient = await prisma.patient.findFirst({
    where: { account: { clerkId: userId } },
    select: { id: true },
  });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const names = Array.from(new Set(Object.values(CUISINE_STAPLES).flat().map((n) => n.trim())));
  const ids: Record<string, string> = {};

  for (const name of names) {
    const existing = await prisma.ingredient.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
      select: { id: true },
    });
    if (existing) {
      ids[name.toLowerCase()] = existing.id;
      continue;
    }
    try {
      const created = await prisma.ingredient.create({ data: { name }, select: { id: true } });
      ids[name.toLowerCase()] = created.id;
    } catch {
      // P2002 race — someone created it between find and create; re-read the winner.
      const winner = await prisma.ingredient.findFirst({
        where: { name: { equals: name, mode: "insensitive" } },
        select: { id: true },
      });
      if (winner) ids[name.toLowerCase()] = winner.id;
    }
  }

  return NextResponse.json({ ids });
}
