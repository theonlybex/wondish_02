import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";
import { aggregateGaps, MIN_SAMPLE_DAYS, MIN_SAMPLE_USERS } from "@/lib/clara/admin-gaps";
import { parseLocalDateStrict } from "@/lib/journal";

const DAY_MS = 86_400_000;

function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// GET /api/admin/clara-gaps?from=YYYY-MM-DD&to=YYYY-MM-DD
// Owner-only demand report: what users asked Clara for that she could not do.
// Ranking counts DISTINCT USERS, never rows — see lib/clara/admin-gaps.ts.
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();

    const { searchParams } = new URL(req.url);
    const rawFrom = searchParams.get("from");
    const rawTo = searchParams.get("to");
    const parsedFrom = rawFrom ? parseLocalDateStrict(rawFrom) : null;
    const parsedTo = rawTo ? parseLocalDateStrict(rawTo) : null;
    if ((rawFrom && !parsedFrom) || (rawTo && !parsedTo)) {
      return NextResponse.json({ error: "from/to must be YYYY-MM-DD strings" }, { status: 400 });
    }

    const toDate = parsedTo ?? new Date();
    const fromDate = parsedFrom ?? new Date(toDate.getTime() - 29 * DAY_MS);
    const to = toLocalDateString(toDate);
    const from = toLocalDateString(fromDate);

    const windowDays = Math.max(
      1,
      Math.round((toDate.getTime() - fromDate.getTime()) / DAY_MS) + 1
    );
    const prevTo = toLocalDateString(new Date(fromDate.getTime() - DAY_MS));
    const prevFrom = toLocalDateString(new Date(fromDate.getTime() - windowDays * DAY_MS));

    const select = {
      patientId: true,
      category: true,
      reason: true,
      summary: true,
      surface: true,
      localDate: true,
    };
    const [rows, previous] = await Promise.all([
      prisma.claraCapabilityRequest.findMany({
        where: { localDate: { gte: from, lte: to } },
        select,
      }),
      prisma.claraCapabilityRequest.findMany({
        where: { localDate: { gte: prevFrom, lte: prevTo } },
        select,
      }),
    ]);

    const report = aggregateGaps(rows, { previous });
    const distinctUsers = new Set(rows.map((r) => r.patientId)).size;

    return NextResponse.json({
      from,
      to,
      windowDays,
      ...report,
      // Below the bar the default wave order in the program spec still stands.
      sampleReady: distinctUsers >= MIN_SAMPLE_USERS && windowDays >= MIN_SAMPLE_DAYS,
      thresholds: { minUsers: MIN_SAMPLE_USERS, minDays: MIN_SAMPLE_DAYS, distinctUsers },
    });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
