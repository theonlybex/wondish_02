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
  const dateParam = searchParams.get("date");
  const date = dateParam ? new Date(dateParam) : new Date();
  date.setHours(0, 0, 0, 0);
  const dateEnd = new Date(date);
  dateEnd.setHours(23, 59, 59, 999);

  const entry = await prisma.journalEntry.findFirst({
    where: {
      patientId: patient.id,
      date: { gte: date, lte: dateEnd },
    },
    include: { meals: true },
  });

  return NextResponse.json({ entry });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const patient = await prisma.patient.findUnique({
    where: { accountId: session.user.id },
  });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const body = await req.json();
  const { date, mood, weight, energyLevel, activityLevel, notes, meals } = body;

  const entryDate = new Date(date);
  entryDate.setHours(0, 0, 0, 0);
  const dateEnd = new Date(entryDate);
  dateEnd.setHours(23, 59, 59, 999);

  const existing = await prisma.journalEntry.findFirst({
    where: {
      patientId: patient.id,
      date: { gte: entryDate, lte: dateEnd },
    },
  });

  const entryData = {
    mood: mood ?? null,
    weight: weight ? parseFloat(weight) : null,
    energyLevel: energyLevel ?? null,
    activityLevel: activityLevel ?? null,
    notes: notes ?? null,
  };

  let entry;
  await prisma.$transaction(async (tx) => {
    if (existing) {
      entry = await tx.journalEntry.update({
        where: { id: existing.id },
        data: entryData,
      });
      await tx.journalMeal.deleteMany({ where: { journalEntryId: existing.id } });
    } else {
      entry = await tx.journalEntry.create({
        data: {
          ...entryData,
          patientId: patient.id,
          date: entryDate,
        },
      });
    }

    if (meals?.length) {
      await tx.journalMeal.createMany({
        data: meals.map(
          (m: {
            mealType: string;
            recipeId?: string;
            preparation?: string;
            skipped?: boolean;
            rating?: number;
          }) => ({
            journalEntryId: entry!.id,
            mealType: m.mealType,
            recipeId: m.recipeId ?? null,
            preparation: m.preparation ?? null,
            skipped: m.skipped ?? false,
            rating: m.rating ?? null,
          })
        ),
      });
    }
  });

  return NextResponse.json({ ok: true });
}
