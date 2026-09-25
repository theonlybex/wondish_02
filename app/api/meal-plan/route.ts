// PREMIUM GATE (parked 2026-09-17 — uncomment with the block below to restore):
// import { premiumGatesEnabled } from "@/lib/billing/gates";
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { regeneratePlan, clampPlanStartToToday, MealPlanBusyError, EmptyPlanError, ThinPlanError, PlanPreflightError } from "@/lib/meal-plan-runner";
import { internalError } from "@/lib/api-error";
import { getPlanDayCalories, deriveLoggedRecipeIds, dishSodiumMg, DAILY_SODIUM_MAX_MG } from "@/lib/meal-plan";
import { computeDailyMacros, resolveMacroProfile } from "@/lib/caloric-engine";
import { normalizeCuisine } from "@/lib/clara/recipe-generation";
import { guardAiSpend, tierFor } from "@/lib/ai-budget";
import { getExchangesForRange, splitByStatus } from "@/lib/plan-exchanges";
import { addDays } from "date-fns";

// 300s (Vercel's current default ceiling) not 60: a real week generation was
// measured at 55-73s, so the old cap killed it mid-build — and it had also
// forced ANTHROPIC_TIMEOUT_MS down to 25s, which timed out the recipe
// top-up and left slots filled by one repeated dish (2026-09-24).
export const maxDuration = 300;

// "YYYY-MM-DD" local-calendar string for a Date — the string-out twin of
// getPlanDayCalories' localDateFromString, matching the local-date semantics
// the rest of this route already uses (localMidnight below).
function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Single round-trip via the Clerk id relation (was account-then-patient).
  const patient = await prisma.patient.findFirst({
    where: { account: { clerkId: userId } },
    select: {
      id: true, mealPlanStartDate: true, activePlanVersion: true,
      weight: true, weightUnit: true,
      goalWeight: true, goalWeightUnit: true,
      height: true, heightUnit: true,
      sexAtBirth: true, birthday: true,
      physicalActivity: { select: { level: true } },
      // Needed for dailyMacroTarget below: the macro split depends on the
      // patient's conditions (diabetic) and motivations (muscle gain).
      healthConditions: { select: { condition: { select: { name: true } } } },
      motivations: { select: { motivation: { select: { name: true } } } },
    },
  });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const dateParam = searchParams.get("date");
  const weekStartParam = searchParams.get("weekStart");

  let startDate: Date;
  let endDate: Date;

  // Parse "yyyy-MM-dd" as local midnight — new Date("yyyy-MM-dd") parses as UTC
  // which causes a day shift in UTC- timezones. Use explicit local construction instead.
  function localMidnight(str: string): Date {
    const [y, m, d] = str.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  // A date this route cannot parse used to reach Prisma as an Invalid Date and
  // come back as a 500 with an EMPTY body — the only error on the route that
  // wasn't JSON, so a client had nothing to show (QA: ?date=notadate,
  // ?date=9999-99-99). Answer like every other bad input here.
  const badDate = (v: string | null): boolean => {
    if (!v) return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return true;
    return Number.isNaN(localMidnight(v).getTime());
  };
  if (badDate(dateParam) || badDate(weekStartParam)) {
    return NextResponse.json({ error: "Invalid date — expected YYYY-MM-DD." }, { status: 400 });
  }

  if (weekStartParam) {
    startDate = localMidnight(weekStartParam);
    endDate = addDays(startDate, 6);
    endDate.setHours(23, 59, 59, 999);
  } else {
    const d = dateParam ? localMidnight(dateParam) : new Date(new Date().setHours(0, 0, 0, 0));
    startDate = d;
    endDate = new Date(d);
    endDate.setHours(23, 59, 59, 999);
  }

  const menus = await prisma.menu.findMany({
    where: { patientId: patient.id, planVersion: patient.activePlanVersion, date: { gte: startDate, lte: endDate } },
    include: {
      recipe: { include: { mealType: true, dishType: true, ethnic: true, ingredients: { include: { ingredient: true } } } },
      mealType: true,
    },
    orderBy: [{ date: "asc" }, { mealType: { name: "asc" } }],
  });

  // For single-day requests, also return which recipes are logged in journal
  let loggedRecipeIds: string[] = [];
  let mealRatings: Record<string, number> = {};
  if (!weekStartParam) {
    const journalEntry = await prisma.journalEntry.findFirst({
      where: { patientId: patient.id, date: { gte: startDate, lte: endDate } },
      include: { meals: { select: { recipeId: true, skipped: true, rating: true } } },
    });
    const activeMeals = (journalEntry?.meals ?? []).filter((m) => !m.skipped && m.recipeId);
    // Log-to-numbers sync (2026-07-30): "Log meal" writes /api/meal-log
    // intake, not JournalMeal — union live intake rows in so logging from
    // any surface marks the dish done (deleting the log un-marks it).
    // Ratings stay journal-only.
    const intakeLogs = await prisma.mealLog.findMany({
      where: { patientId: patient.id, localDate: toLocalDateString(startDate), deletedAt: null, recipeId: { not: null } },
      select: { recipeId: true },
    });
    loggedRecipeIds = deriveLoggedRecipeIds(
      activeMeals.map((m) => m.recipeId as string),
      intakeLogs.map((l) => l.recipeId as string)
    );
    for (const m of activeMeals) {
      if (m.recipeId && m.rating != null) mealRatings[m.recipeId] = m.rating;
    }
  }

  const dailyCalorieTarget = !weekStartParam
    ? await getPlanDayCalories(patient.id, toLocalDateString(startDate))
    : null;

  // Target grams for the day, from the same macro profile the builder uses.
  //
  // The daily view showed "0 / 2255 kcal" (the TARGET) directly above
  // "PROTEIN 0/166g · CARBS 0/259g · FAT 0/43g" (the sum of the day's PLANNED
  // dishes) — the same widget, the same visual grammar, two different
  // denominators and no label on either. /overview meanwhile showed
  // target-derived grams for the same day, so protein read 166 g on one screen
  // and 169 g on the other (QA 2026-09-24). One denominator, stated.
  const dailyMacroTarget =
    dailyCalorieTarget != null
      ? (() => {
          const conditionNames = patient.healthConditions?.map((hc) => hc.condition.name) ?? [];
          const motivationNames = patient.motivations?.map((pm) => pm.motivation.name) ?? [];
          const macros = computeDailyMacros(dailyCalorieTarget, resolveMacroProfile(conditionNames, motivationNames));
          return {
            protein: Math.round(macros.totalProteinG),
            carbs: Math.round(macros.totalCarbsG),
            fat: Math.round(macros.totalFatG),
          };
        })()
      : null;

  // Opt-in plan-exchange overlay (pinned wire contract: without the param the
  // response stays byte-identical). Single-day requests only — the week view
  // is unchanged this cycle (spec 2026-07-30-plan-exchanges-design.md).
  let exchanges: ReturnType<typeof splitByStatus> | undefined;
  if (!weekStartParam && searchParams.get("exchanges") === "1") {
    const day = toLocalDateString(startDate);
    exchanges = splitByStatus(await getExchangesForRange(patient.id, patient.activePlanVersion, day, day));
  }

  return NextResponse.json({
    menus,
    mealPlanStartDate: patient.mealPlanStartDate,
    loggedRecipeIds,
    mealRatings,
    dailyCalorieTarget,
    dailyMacroTarget,
    // Sodium from the ADDED SALT on the day's ingredient rows — the part the
    // plan controls and the part that was running 3,000-4,100 mg a day. Named
    // precisely: it is not a total-diet figure, and calling it one would be the
    // same kind of overclaim this file has been fixing all week.
    daySaltSodiumMg: Math.round(
      menus.reduce((sum, m) => sum + dishSodiumMg(m.recipe?.ingredients ?? []), 0)
    ),
    dailySodiumGuidelineMg: DAILY_SODIUM_MAX_MG,
    ...(exchanges ? { exchanges } : {}),
  });
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Same bucket as /regenerate — both trigger the same full-plan rebuild.
  const { success } = await rateLimit("regenerate", userId, 10, 60);
  if (!success) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment before regenerating again." },
      { status: 429 }
    );
  }

  const account = await prisma.account.findUnique({
    where: { clerkId: userId },
    include: { subscriptions: true, roles: { include: { role: true } }, patient: true },
  });
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const isAdmin = account.roles?.some((r) => r.role.name === "SUPER") ?? false;
  const aiTier = tierFor(account.subscriptions, isAdmin);
  // PREMIUM GATE (parked): blocked the whole endpoint before the allowance
  // model replaced it. isPremium is gone, so this is the aiTier equivalent.
  // if (premiumGatesEnabled() && aiTier === "free") return NextResponse.json({ error: "Premium required" }, { status: 403 });

  const patient = account.patient;
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  if (!patient.profileCompleted) {
    return NextResponse.json({ error: "Profile not complete" }, { status: 422 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { startDate, claraFirst, cuisine } = (body ?? {}) as { startDate?: unknown; claraFirst?: unknown; cuisine?: unknown };
  const parsed = new Date(typeof startDate === "string" || typeof startDate === "number" ? startDate : NaN);

  if (isNaN(parsed.getTime())) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  // A past start builds a plan that can end before today — the UI then reads
  // an empty "today" as generation having failed.
  const start = clampPlanStartToToday(parsed);

  // Clara is the default dish source and cuisine is OPTIONAL — a whole-plan
  // build with no cuisine simply lets Clara vary cuisines ("Surprise me" → null).
  // Cuisine now only scopes the current-day route (/api/meal-plan/day).
  const wantClara = claraFirst === true;

  // Does this account already have a plan? Decides which allowance pays (see
  // the preflight below). The anchor moving is still an init: that IS the
  // start-date change planInit exists for.
  const anchorMoves =
    patient.mealPlanStartDate != null &&
    toLocalDateString(new Date(patient.mealPlanStartDate)) !== toLocalDateString(start);
  const existingRows = await prisma.menu.count({
    where: { patientId: patient.id, planVersion: patient.activePlanVersion },
  });
  const hasExistingPlan = existingRows > 0 && !anchorMoves;

  try {
    const count = await regeneratePlan(patient.id, start, undefined, {
      claraFirst: wantClara,
      cuisine: wantClara ? normalizeCuisine(cuisine) : null,
      // Every plan (re)generation can trigger a Clara top-up call — spend
      // guard. Charged under the claim, so only the request that actually
      // builds pays for it.
      preflight: async () => {
        // planInit is the ONBOARDING allowance — the first plan, and a change
        // of start date. A patient who already has a plan calling this route is
        // regenerating, and that is what planGen meters: without the
        // distinction, a beta account refused its 4th new week of the week
        // (planGen 3/week) could simply POST here and rebuild 172 rows on the
        // planInit budget, twice a day, for free (QA 2026-09-24). Whichever
        // bucket applies, it is charged before the model runs.
        const kind = hasExistingPlan ? "planGen" : "planInit";
        const guard = await guardAiSpend(userId, kind, aiTier);
        return guard.ok ? null : { status: guard.status, body: { ...guard.body } };
      },
    });
    return NextResponse.json({ ok: true, count });
  } catch (err) {
    if (err instanceof MealPlanBusyError) {
      return NextResponse.json({ error: "A plan is already being generated." }, { status: 409 });
    }
    if (err instanceof PlanPreflightError) {
      return NextResponse.json(err.body, { status: err.status });
    }
    // Rows were built, but not enough of the week to be usable (e.g. only
    // lunches). The previous plan is still active; say what was missing.
    if (err instanceof ThinPlanError) {
      return NextResponse.json(
        {
          error: `We could only fill ${err.filledCoreSlots} of ${err.expectedCoreSlots} meals from your ingredients — your previous plan was kept. Add a few more, especially breakfast staples, and try again.`,
          code: "thin_plan",
          filledCoreSlots: err.filledCoreSlots,
          expectedCoreSlots: err.expectedCoreSlots,
        },
        { status: 422 }
      );
    }
    if (err instanceof EmptyPlanError) {
      return NextResponse.json(
        { error: "No meals matched your current profile, so your existing plan was kept." },
        { status: 422 }
      );
    }
    return internalError("meal-plan/create", err, "Couldn't generate your plan — please try again.");
  }
}
