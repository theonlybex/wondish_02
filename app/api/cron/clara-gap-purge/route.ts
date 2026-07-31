import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { gapRetentionCutoff, isAuthorizedCron, GAP_RETENTION_DAYS } from "@/lib/clara/retention";

// GET /api/cron/clara-gap-purge — enforces the 180-day retention the spec
// promises for the capability-gap ledger (spec §5.1). Scheduled by the Vercel
// cron in vercel.json; protected by CRON_SECRET, which Vercel sends as a bearer
// token. Unset secret ⇒ 401, so an unconfigured deploy cannot delete anything.
export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = gapRetentionCutoff(new Date());
  const { count } = await prisma.claraCapabilityRequest.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });

  console.log(`[clara-gap-purge] deleted ${count} rows older than ${cutoff.toISOString()}`);
  return NextResponse.json({
    deleted: count,
    cutoff: cutoff.toISOString(),
    retentionDays: GAP_RETENTION_DAYS,
  });
}
