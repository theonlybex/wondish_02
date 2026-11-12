import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { formatLocalDate, validateRange } from "@/lib/meal-log";
import { groupLogByDate } from "@/lib/log-view";

const MAX_LOG_DAYS = 31;
const DEFAULT_LOG_DAYS = 14;

function addDays(localDate: string, delta: number): string {
  const [y, m, d] = localDate.split("-").map(Number);
  return formatLocalDate(new Date(y, m - 1, d + delta));
}

// ─── GET /api/log?from=YYYY-MM-DD&to=YYYY-MM-DD — read-only Log tab feed ─────
export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success } = await rateLimit("log-read", userId, 120, 60);
  if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  const patient = await prisma.patient.findFirst({ where: { account: { clerkId: userId } } });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  let from = searchParams.get("from");
  let to = searchParams.get("to");
  if (to == null) to = from == null ? formatLocalDate(new Date()) : null;
  if (from == null && to != null) from = addDays(to, -(DEFAULT_LOG_DAYS - 1));
  if (from == null || to == null) {
    return NextResponse.json({ error: "Both from and to are required for a range query" }, { status: 400 });
  }

  const range = validateRange(from, to);
  if (!range.ok) return NextResponse.json({ error: range.error }, { status: range.status });
  if (addDays(from, MAX_LOG_DAYS - 1) < to) {
    return NextResponse.json({ error: `range window must be <= ${MAX_LOG_DAYS} days` }, { status: 400 });
  }

  const rows = await prisma.mealLog.findMany({
    where: { patientId: patient.id, localDate: { gte: from, lte: to }, deletedAt: null },
    select: { id: true, localDate: true, mealType: true, name: true, source: true, estimated: true, loggedAt: true, deletedAt: true },
    orderBy: { loggedAt: "asc" },
  });
  return NextResponse.json({ days: groupLogByDate(rows) });
}
