import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { regeneratePlan, MealPlanBusyError, EmptyPlanError } from "@/lib/meal-plan-runner";
import { accountHasActivePremium } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

const MIN_INTERVAL_MS = 2 * 60 * 1000; // anti-spam: 1 regenerate / 2 min

export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Per-user endpoint guard (shared via Upstash): caps repeated hits even when
  // they fail before the per-row 2-min window / claim-lock would apply.
  const { success } = await rateLimit("regenerate", userId, 10, 60);
  if (!success) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment before regenerating again." },
      { status: 429 }
    );
  }

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
    select: { id: true, profileCompleted: true, mealPlanStatus: true, mealPlanGenStartedAt: true },
  });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  if (!patient.profileCompleted) return NextResponse.json({ error: "Profile not complete" }, { status: 422 });

  // Anti-spam: block only successful READY runs that finished recently.
  if (
    patient.mealPlanStatus === "READY" &&
    patient.mealPlanGenStartedAt &&
    Date.now() - patient.mealPlanGenStartedAt.getTime() < MIN_INTERVAL_MS
  ) {
    return NextResponse.json(
      { error: "Please wait a moment before regenerating again." },
      { status: 429 }
    );
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  try {
    const count = await regeneratePlan(patient.id, today);
    return NextResponse.json({ ok: true, count });
  } catch (err) {
    if (err instanceof MealPlanBusyError) {
      return NextResponse.json({ error: "A plan is already being generated." }, { status: 409 });
    }
    if (err instanceof EmptyPlanError) {
      return NextResponse.json(
        { error: "No meals matched your current profile, so your existing plan was kept. Try relaxing some restrictions." },
        { status: 422 }
      );
    }
    console.error("[regenerate]", err);
    return NextResponse.json({ error: "Generation failed." }, { status: 500 });
  }
}
