import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { pruneClaraLibrary } from "@/lib/prune-clara-library";

export const maxDuration = 60;

// POST /api/admin/prune-clara[?apply=1&days=30] — SUPER only. Prunes stale,
// unreferenced Clara-generated dishes to keep the library lean. Dry-run by
// default (reports candidates); ?apply=1 actually deletes.
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await prisma.account.findUnique({
    where: { clerkId: userId },
    include: { roles: { include: { role: true } } },
  });
  const isAdmin = account?.roles?.some((r) => r.role.name === "SUPER") ?? false;
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const apply = searchParams.get("apply") === "1";
  const days = Number(searchParams.get("days"));
  const olderThanDays = Number.isFinite(days) && days > 0 ? days : 30;

  const { candidates, deleted } = await pruneClaraLibrary(prisma, { apply, olderThanDays });
  return NextResponse.json({ apply, olderThanDays, candidates: candidates.length, deleted });
}
