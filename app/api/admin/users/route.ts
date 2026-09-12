import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";
import { hasPaidPremium } from "@/lib/coupon";
import { manualGrantUpsertArgs, summarizeEntitlement, userRank } from "@/lib/admin-users";

const SUB_SELECT = {
  source: true,
  plan: true,
  status: true,
  stripeCurrentPeriodEnd: true,
  cancelAtPeriodEnd: true,
  stripeSubscriptionId: true,
} as const;

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

    // Premium can come from any source row (Stripe, Apple, coupon, ADMIN), so
    // the list carries a derived entitlement summary instead of one raw row.
    // Ordering by a derived value has to happen in app code: fetch every
    // match (createdAt desc), rank admins → premium → free, then page.
    const [allMatching, total] = await Promise.all([
      prisma.account.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
        include: {
          subscriptions: { select: SUB_SELECT },
          roles: { include: { role: true } },
          company: { select: { name: true } },
          // Phase 6a §4D — which restaurants each account manages, so the
          // Users screen can show memberships and offer "Assign restaurant".
          restaurantStaff: {
            select: { id: true, role: true, restaurant: { select: { id: true, name: true } } },
          },
        },
      }),
      prisma.account.count({ where }),
    ]);

    const shaped = allMatching.map(({ subscriptions, ...rest }) => ({
      ...rest,
      isAdmin: rest.roles.some((r) => r.role.name === "SUPER"),
      subscription: summarizeEntitlement(subscriptions),
    }));
    const sorted = [...shaped].sort((a, b) => userRank(a) - userRank(b));
    const items = sorted.slice((page - 1) * limit, (page - 1) * limit + limit);

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
      include: { roles: { include: { role: true } }, subscriptions: { select: SUB_SELECT } },
    });
    const targetIsAdmin = target?.roles?.some((r) => r.role.name === "SUPER") ?? false;
    if (targetIsAdmin) throw new Error("FORBIDDEN");

    if ("plan" in body) {
      const { id, plan } = body as { id: string; plan: "FREE" | "PREMIUM" };
      const subs = target?.subscriptions ?? [];

      // Manual grants never touch a live paid subscription: flipping the
      // Stripe row to FREE would not stop billing, and flipping it to PREMIUM
      // used to fake a subscription with no Stripe id behind it.
      if (hasPaidPremium(subs)) {
        return NextResponse.json(
          { error: "This account has a live Stripe/Apple subscription. Manage it there." },
          { status: 409 }
        );
      }

      if (plan === "PREMIUM") {
        await prisma.subscription.upsert(manualGrantUpsertArgs(id));
      } else {
        await prisma.$transaction([
          // Drop the manual/coupon grant.
          prisma.subscription.deleteMany({ where: { accountId: id, source: "COUPON" } }),
          // Legacy manual grants lived on the Stripe row with no Stripe id
          // behind them; put that row back to FREE so it stops counting.
          prisma.subscription.updateMany({
            where: { accountId: id, source: "STRIPE", plan: "PREMIUM", stripeSubscriptionId: null },
            data: { plan: "FREE", status: "ACTIVE", stripeCurrentPeriodEnd: null },
          }),
        ]);
      }

      const fresh = await prisma.subscription.findMany({ where: { accountId: id }, select: SUB_SELECT });
      return NextResponse.json({ id, subscription: summarizeEntitlement(fresh) });
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
