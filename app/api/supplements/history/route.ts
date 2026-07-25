import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseLocalDateStrict } from "@/lib/journal";

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const patient = await prisma.patient.findFirst({ where: { account: { clerkId: userId } } });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const from = parseLocalDateStrict(req.nextUrl.searchParams.get("from"));
  const to = parseLocalDateStrict(req.nextUrl.searchParams.get("to"));
  if (!from || !to) {
    return NextResponse.json({ error: "from and to must be YYYY-MM-DD strings" }, { status: 400 });
  }
  from.setHours(0, 0, 0, 0);
  to.setHours(23, 59, 59, 999);

  const [intakes, liveCount] = await Promise.all([
    prisma.supplementIntake.findMany({
      where: { patientId: patient.id, date: { gte: from, lte: to } },
      // Includes soft-deleted supplements: past days stay truthful.
      include: { supplement: { select: { name: true } } },
      orderBy: { date: "asc" },
    }),
    // "of N" denominator: current live supplement count. Per-day historical
    // denominators would need created/deleted interval math the journal
    // doesn't need — YAGNI, revisit if users notice.
    prisma.supplement.count({ where: { patientId: patient.id, deletedAt: null } }),
  ]);

  const byDate = new Map<string, { name: string }[]>();
  for (const intake of intakes) {
    const key = fmtDate(new Date(intake.date));
    const list = byDate.get(key) ?? [];
    list.push({ name: intake.supplement.name });
    byDate.set(key, list);
  }

  const days = Array.from(byDate.entries()).map(([date, taken]) => ({
    date,
    taken,
    total: Math.max(liveCount, taken.length),
  }));
  return NextResponse.json({ days });
}
