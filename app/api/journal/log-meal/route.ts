import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// POST /api/journal/log-meal
// Body: { recipeId, mealTypeName, date, rating: 1 | -1 }
// Marks a meal as completed with a like/dislike rating.
// Clicking the same rating again removes the log (toggle).
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await prisma.account.findUnique({ where: { clerkId: userId } });
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const patient = await prisma.patient.findUnique({ where: { accountId: account.id } });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const { recipeId, mealTypeName, date, rating } = await req.json();
  if (!recipeId || !date) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

  const [y, m, d] = (date as string).split("-").map(Number);
  const entryDate = new Date(y, m - 1, d, 0, 0, 0, 0);
  const dateEnd = new Date(y, m - 1, d, 23, 59, 59, 999);

  // Find or create journal entry for the day
  let entry = await prisma.journalEntry.findFirst({
    where: { patientId: patient.id, date: { gte: entryDate, lte: dateEnd } },
    include: { meals: { select: { id: true, recipeId: true, skipped: true, rating: true } } },
  });

  if (!entry) {
    entry = await prisma.journalEntry.create({
      data: { patientId: patient.id, date: entryDate },
      include: { meals: { select: { id: true, recipeId: true, skipped: true, rating: true } } },
    });
  }

  const existing = entry.meals.find((ml) => ml.recipeId === recipeId && !ml.skipped);

  if (existing) {
    if (existing.rating === rating) {
      // Same button tapped again — undo / remove
      await prisma.journalMeal.delete({ where: { id: existing.id } });
    } else {
      // Different rating — update it
      await prisma.journalMeal.update({
        where: { id: existing.id },
        data: { rating },
      });
    }
  } else {
    // New log
    await prisma.journalMeal.create({
      data: {
        journalEntryId: entry.id,
        mealType: mealTypeName ?? "Meal",
        recipeId,
        skipped: false,
        rating,
      },
    });
  }

  // Return updated state for the day
  const updated = await prisma.journalMeal.findMany({
    where: { journalEntryId: entry.id, skipped: false },
    select: { recipeId: true, rating: true },
  });

  const loggedRecipeIds = updated.map((m) => m.recipeId).filter(Boolean) as string[];
  const mealRatings: Record<string, number> = {};
  for (const m of updated) {
    if (m.recipeId && m.rating != null) mealRatings[m.recipeId] = m.rating;
  }

  return NextResponse.json({ ok: true, loggedRecipeIds, mealRatings });
}
