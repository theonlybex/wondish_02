import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { regeneratePlan, MealPlanBusyError, EmptyPlanError } from "@/lib/meal-plan-runner";
import { accountHasActivePremium } from "@/lib/auth";

export const maxDuration = 60;

// Full regenerate-route gate set (2026-07-24 audit Task 13): this endpoint
// triggers the same expensive full-plan rebuild as /regenerate but shipped
// with none of its guards — a free-user paywall bypass, plus garbage dates
// stamping mealPlanStatus FAILED with a misleading error.
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Same bucket as /regenerate — both trigger the same rebuild.
  const { success } = await rateLimit("regenerate", userId, 10, 60);
  if (!success) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment before regenerating again." },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { startDate } = (body ?? {}) as { startDate?: unknown };

  const account = await prisma.account.findUnique({
    where: { clerkId: userId },
    include: { subscriptions: true, roles: { include: { role: true } } },
  });
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const isAdmin = account.roles?.some((r) => r.role.name === "SUPER") ?? false;
  const isPremium = isAdmin || accountHasActivePremium(account.subscriptions);
  if (!isPremium) return NextResponse.json({ error: "Premium required" }, { status: 403 });

  const patient = await prisma.patient.findUnique({
    where: { accountId: account.id },
    select: { id: true, profileCompleted: true },
  });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  if (!patient.profileCompleted) return NextResponse.json({ error: "Profile not complete" }, { status: 422 });

  const start = new Date(typeof startDate === "string" || typeof startDate === "number" ? startDate : NaN);
  if (Number.isNaN(start.getTime())) {
    return NextResponse.json({ error: "Invalid startDate" }, { status: 400 });
  }
  start.setHours(0, 0, 0, 0);

  // Atomic blue/green regenerate — no unguarded wipe.
  try {
    const count = await regeneratePlan(patient.id, start);
    return NextResponse.json({ ok: true, count, startDate: start.toISOString() });
  } catch (err) {
    if (err instanceof MealPlanBusyError) {
      return NextResponse.json({ error: "A plan is already being generated." }, { status: 409 });
    }
    if (err instanceof EmptyPlanError) {
      return NextResponse.json(
        { error: "No meals matched your current profile, so your existing plan was kept." },
        { status: 422 }
      );
    }
    throw err;
  }
}
