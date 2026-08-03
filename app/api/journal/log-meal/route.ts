import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseLocalDateStrict, upsertMealCompletion } from "@/lib/journal";

// POST /api/journal/log-meal
// Body: { recipeId, mealTypeName, date, rating: 1 | -1 }
// Marks a meal as completed with a like/dislike rating.
// Clicking the same rating again removes the log (toggle).
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Single round-trip via the Clerk id relation (was account-then-patient).
  const patient = await prisma.patient.findFirst({ where: { account: { clerkId: userId } } });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { recipeId, mealTypeName, date, rating } = body as {
    recipeId?: string;
    mealTypeName?: string;
    date?: string;
    rating?: number;
  };
  if (!recipeId || !date) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

  // Contract is rating: 1 | -1 (like/dislike); anything else was previously
  // stored verbatim (audit Task 14).
  if (rating !== 1 && rating !== -1) {
    return NextResponse.json({ error: "rating must be 1 or -1" }, { status: 400 });
  }

  const parsedDate = parseLocalDateStrict(date);
  if (!parsedDate) {
    return NextResponse.json({ error: "date must be a YYYY-MM-DD string" }, { status: 400 });
  }

  // Shared completion write path (S3 extraction — lib/journal.ts). Toggle mode
  // preserves this route's UI contract: same rating again = undo.
  const result = await upsertMealCompletion(patient.id, {
    recipeId,
    mealTypeName,
    date,
    rating: rating as 1 | -1,
    toggle: true,
  });
  if (result === null) {
    return NextResponse.json({ error: "date must be a YYYY-MM-DD string" }, { status: 400 });
  }

  // Day state by the entry id the helper actually wrote to: JournalEntry has
  // no unique (patientId, date), so a second findFirst could pick a different
  // duplicate row and report the just-written meal as missing.
  const updated = await prisma.journalMeal.findMany({
    where: { journalEntryId: result.journalEntryId, skipped: false },
    select: { recipeId: true, rating: true },
  });

  const loggedRecipeIds = updated.map((m) => m.recipeId).filter(Boolean) as string[];
  const mealRatings: Record<string, number> = {};
  for (const m of updated) {
    if (m.recipeId && m.rating != null) mealRatings[m.recipeId] = m.rating;
  }

  return NextResponse.json({ ok: true, loggedRecipeIds, mealRatings });
}
