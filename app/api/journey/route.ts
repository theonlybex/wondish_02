import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getJourneyPayload } from "@/lib/journey-data";
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

  // One fetch path shared with app/(dashboard)/journey/page.tsx — additive
  // response shape: { stats, macroStats, entries } (existing consumers of
  // stats/entries unbroken).
  const payload = await getJourneyPayload(patient.id, from, to);
  return NextResponse.json(payload);
}
