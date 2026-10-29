import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { gapRetentionCutoff, isAuthorizedCron, CONVERSATION_RETENTION_DAYS } from "@/lib/clara/retention";

// GET /api/cron/clara-conversation-purge — deletes saved Clara chats that have
// had no new message for 180 days. Messages go with them (cascade); memories
// are untouched (their conversationId is set null by the FK). Scheduled by the
// Vercel cron in vercel.json; protected by CRON_SECRET, which Vercel sends as a
// bearer token. Unset secret => 401, so an unconfigured deploy cannot delete anything.
export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = gapRetentionCutoff(new Date(), CONVERSATION_RETENTION_DAYS);
  const { count } = await prisma.claraConversation.deleteMany({
    where: { updatedAt: { lt: cutoff } },
  });

  console.log(`[clara-conversation-purge] deleted ${count} conversations idle since before ${cutoff.toISOString()}`);
  return NextResponse.json({
    deleted: count,
    cutoff: cutoff.toISOString(),
    retentionDays: CONVERSATION_RETENTION_DAYS,
  });
}
