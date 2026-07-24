import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getJourneyPayload } from "@/lib/journey-data";
import { parseLocalDateStrict } from "@/lib/journal";
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

  // Local-date parse (audit Task 15 — the last surviving UTC-parse): a bare
  // new Date("YYYY-MM-DD") is UTC midnight, so on negative-offset servers
  // ?to= landed on the previous local day and the requested end date's data
  // was silently dropped from the window. Garbage params now 400.
  let to: Date;
  let from: Date;
  if (toParam) {
    const parsed = parseLocalDateStrict(toParam);
    if (!parsed) return NextResponse.json({ error: "to must be a YYYY-MM-DD string" }, { status: 400 });
    to = parsed;
  } else {
    to = new Date();
  }
  if (fromParam) {
    const parsed = parseLocalDateStrict(fromParam);
    if (!parsed) return NextResponse.json({ error: "from must be a YYYY-MM-DD string" }, { status: 400 });
    from = parsed;
  } else {
    from = subDays(to, 29);
  }
  to.setHours(23, 59, 59, 999);
  from.setHours(0, 0, 0, 0);

  // One fetch path shared with app/(dashboard)/journey/page.tsx — additive
  // response shape: { stats, macroStats, entries } (existing consumers of
  // stats/entries unbroken).
  const payload = await getJourneyPayload(patient.id, from, to);
  return NextResponse.json(payload);
}
