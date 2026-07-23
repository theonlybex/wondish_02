import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";

export async function GET(req: NextRequest) {
  try {
    const admin = await requireAdmin();

    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get("page") ?? "1");
    const limit = parseInt(searchParams.get("limit") ?? "20");
    const search = searchParams.get("search") ?? "";

    const where = search
      ? {
          OR: [
            { email: { contains: search, mode: "insensitive" as const } },
            { firstName: { contains: search, mode: "insensitive" as const } },
            { lastName: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {};

    // Prisma can't order a to-many relation by a nested scalar field (only by
    // _count), so "plan desc" ordering — premium accounts first — has to move
    // to app code. To preserve the exact prior order (and total/pagination),
    // fetch every matching account pre-sorted by createdAt desc, then do a
    // stable sort by the STRIPE-row plan (desc) before slicing the page. The
    // STRIPE row is the pre-migration single subscription row, so this
    // reproduces the old `orderBy subscription.plan desc, createdAt desc`
    // exactly for every account today (all rows are still source=STRIPE).
    const [allMatching, total] = await Promise.all([
      prisma.account.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
        include: {
          subscriptions: { where: { source: "STRIPE" }, select: { plan: true, status: true } },
          roles: { include: { role: true } },
          company: { select: { name: true } },
        },
      }),
      prisma.account.count({ where }),
    ]);

    const sorted = [...allMatching].sort((a, b) => {
      const planA = a.subscriptions[0]?.plan ?? "FREE";
      const planB = b.subscriptions[0]?.plan ?? "FREE";
      if (planA === planB) return 0;
      return planA > planB ? -1 : 1; // desc: "PREMIUM" > "FREE"
    });
    const items = sorted
      .slice((page - 1) * limit, (page - 1) * limit + limit)
      .map(({ subscriptions, ...rest }) => ({ ...rest, subscription: subscriptions[0] ?? null }));

    return NextResponse.json({ items, total, page, limit, currentAccountId: admin.id });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const admin = await requireAdmin();

    const body = await req.json();
    const targetId = body.id as string;

    if (targetId === admin.id) throw new Error("FORBIDDEN");

    const target = await prisma.account.findUnique({
      where: { id: targetId },
      include: { roles: { include: { role: true } } },
    });
    const targetIsAdmin = target?.roles?.some((r) => r.role.name === "SUPER") ?? false;
    if (targetIsAdmin) throw new Error("FORBIDDEN");

    if ("plan" in body) {
      const { id, plan } = body as { id: string; plan: "FREE" | "PREMIUM" };

      // Targets the STRIPE-source row — see the GET handler above for why
      // (pre-migration this was the account's sole subscription row).
      await prisma.subscription.upsert({
        where: { accountId_source: { accountId: id, source: "STRIPE" } },
        update: {
          plan,
          status: plan === "PREMIUM" ? "ACTIVE" : "CANCELED",
        },
        create: {
          accountId: id,
          source: "STRIPE",
          plan,
          status: plan === "PREMIUM" ? "ACTIVE" : "CANCELED",
        },
      });

      return NextResponse.json({ id, plan });
    }

    const { id, isEnabled } = body as { id: string; isEnabled: boolean };

    const account = await prisma.account.update({
      where: { id },
      data: { isEnabled },
      select: { id: true, email: true, isEnabled: true },
    });

    return NextResponse.json(account);
  } catch (err) {
    return adminErrorResponse(err);
  }
}
