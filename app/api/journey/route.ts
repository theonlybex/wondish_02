import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { computeJourneyStats } from "@/lib/journey";
import { subDays } from "date-fns";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Single round-trip via the Clerk id relation (was account-then-patient).
  const patient = await prisma.patient.findFirst({ where: { account: { clerkId: userId } } });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");

  const to = toParam ? new Date(toParam) : new Date();
  const from = fromParam ? new Date(fromParam) : subDays(to, 29);
  to.setHours(23, 59, 59, 999);
  from.setHours(0, 0, 0, 0);

  const entries = await prisma.journalEntry.findMany({
    where: { patientId: patient.id, date: { gte: from, lte: to } },
    include: { meals: true },
    orderBy: { date: "asc" },
  });

  // Engagement is measured against every day in the window, not just the
  // days that happen to have a journal entry.
  const totalDays = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86400000));
  const stats = computeJourneyStats(entries, totalDays);
  return NextResponse.json({ stats, entries });
}
