import { MealLogSource } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  MEAL_TYPES,
  parseMealLogInput,
  resolveSnapshot,
  buildMealLogCreateData,
  buildMealLogUpsertArgs,
  serializeMealLog,
  type MealLogRow,
  type MealLogCreateData,
} from "@/lib/meal-log";
import { parseLocalDateStrict, upsertMealCompletion } from "@/lib/journal";
import {
  deriveLoggedRecipeIds,
  findAlternatives,
  validateSwapCandidate,
  type AlternativeRecipe,
  type SwapCandidateRecipe,
  type SameDayMenuLike,
  type SwapPatientLike,
} from "@/lib/meal-plan";
import { getExchangesForRange } from "@/lib/plan-exchanges";
import type { PlanExchangeDTO } from "@/types";
import { PATIENT_DIET_INCLUDE } from "@/lib/diet-match";
import { rateLimit } from "@/lib/rate-limit";
import type { ClaraContext, Skill, ToolResult } from "../types";

export const PLAN_WRITE_HOURLY_CAP = 30;
export const PLAN_WRITE_RATE_LIMIT_NAME = "clara-plan-write";
export const PLAN_WRITE_RATE_LIMIT_WINDOW_SEC = 3600;

export interface PlanMenuRow {
  id: string;
  date: Date;
  mealTypeId: string | null;
  mealTypeName: string | null;
  recipe: {
    id: string;
    name: string;
    calories: number | null;
    protein: number | null;
    carbs: number | null;
    fat: number | null;
    fiber: number | null;
    /**
     * Recipe columns are WHOLE-DISH totals; recipeToPerServing divides by
     * this. Omitting it from a select silently prices whole dishes as
     * per-serving (S3 review Critical) — it is required here so structural
     * typing cannot hide the omission again.
     */
    servings: number | null;
  };
}

/** Effects, injected so every handler path is unit-tested without a DB. */
export interface PlanDeps {
  getPlanMeta(patientId: string): Promise<{ activePlanVersion: number } | null>;
  findMenus(patientId: string, planVersion: number, start: Date, end: Date): Promise<PlanMenuRow[]>;
  findMenuById(menuId: string, patientId: string, planVersion: number): Promise<PlanMenuRow | null>;
  completionState(
    patientId: string,
    localDate: string
  ): Promise<{ loggedRecipeIds: string[]; mealRatings: Record<string, number> }>;
  getExchanges(patientId: string, planVersion: number, from: string, to: string): Promise<PlanExchangeDTO[]>;
  findDietPatient(patientId: string): Promise<SwapPatientLike | null>;
  findPublicRecipe(recipeId: string): Promise<(SwapCandidateRecipe & { id: string; name: string }) | null>;
  findSameDayMenus(
    patientId: string,
    planVersion: number,
    date: Date,
    excludeMenuId: string
  ): Promise<SameDayMenuLike[]>;
  alternativesFor(
    patient: SwapPatientLike,
    q: { mealTypeId: string; excludeRecipeId?: string; currentCalories?: number }
  ): Promise<AlternativeRecipe[]>;
  upsertCompletion: typeof upsertMealCompletion;
  createMealLog(args: ReturnType<typeof buildMealLogUpsertArgs>): Promise<MealLogRow>;
  swapMenuRecipe(menuId: string, recipeId: string): Promise<void>;
  consumeWriteBudget(patientId: string): Promise<boolean>;
}

// Local date plumbing — same 3-line copies every route carries.
const toLocalDateString = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const localMidnight = (s: string): Date => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const addDaysLocal = (d: Date, n: number): Date => {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
};

const prismaDeps: PlanDeps = {
  getPlanMeta: async (patientId) => {
    const p = await prisma.patient.findUnique({
      where: { id: patientId },
      select: { activePlanVersion: true },
    });
    return p ? { activePlanVersion: p.activePlanVersion } : null;
  },
  findMenus: async (patientId, planVersion, start, end) => {
    const rows = await prisma.menu.findMany({
      where: { patientId, planVersion, date: { gte: start, lte: end } },
      include: {
        recipe: {
          select: { id: true, name: true, calories: true, protein: true, carbs: true, fat: true, fiber: true, servings: true },
        },
        mealType: { select: { name: true } },
      },
      orderBy: [{ date: "asc" }, { mealType: { name: "asc" } }],
    });
    return rows.map((m) => ({
      id: m.id,
      date: m.date,
      mealTypeId: m.mealTypeId,
      mealTypeName: m.mealType?.name ?? null,
      recipe: m.recipe,
    }));
  },
  findMenuById: async (menuId, patientId, planVersion) => {
    const m = await prisma.menu.findFirst({
      where: { id: menuId, patientId, planVersion },
      include: {
        recipe: {
          select: { id: true, name: true, calories: true, protein: true, carbs: true, fat: true, fiber: true, servings: true },
        },
        mealType: { select: { name: true } },
      },
    });
    return m
      ? { id: m.id, date: m.date, mealTypeId: m.mealTypeId, mealTypeName: m.mealType?.name ?? null, recipe: m.recipe }
      : null;
  },
  completionState: async (patientId, localDate) => {
    // Mirror of the meal-plan GET route's journal+intake union ("log-to-numbers
    // sync"): a dish is done when journal-completed OR intake-logged; ratings
    // stay journal-only.
    const day = localMidnight(localDate);
    const dayEnd = new Date(day);
    dayEnd.setHours(23, 59, 59, 999);
    const entry = await prisma.journalEntry.findFirst({
      where: { patientId, date: { gte: day, lte: dayEnd } },
      include: { meals: { select: { recipeId: true, skipped: true, rating: true } } },
    });
    const activeMeals = (entry?.meals ?? []).filter((m) => !m.skipped && m.recipeId);
    const intakeLogs = await prisma.mealLog.findMany({
      where: { patientId, localDate, deletedAt: null, recipeId: { not: null } },
      select: { recipeId: true },
    });
    const loggedRecipeIds = deriveLoggedRecipeIds(
      activeMeals.map((m) => m.recipeId as string),
      intakeLogs.map((l) => l.recipeId as string)
    );
    const mealRatings: Record<string, number> = {};
    for (const m of activeMeals) {
      if (m.recipeId && m.rating != null) mealRatings[m.recipeId] = m.rating;
    }
    return { loggedRecipeIds, mealRatings };
  },
  getExchanges: getExchangesForRange,
  findDietPatient: async (patientId) =>
    prisma.patient.findFirst({ where: { id: patientId }, include: PATIENT_DIET_INCLUDE }) as never,
  findPublicRecipe: async (recipeId) =>
    prisma.recipe.findFirst({
      where: { id: recipeId, isPublic: true },
      include: { dishType: { select: { name: true } }, ingredients: { include: { ingredient: true } } },
    }) as never,
  findSameDayMenus: async (patientId, planVersion, date, excludeMenuId) => {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);
    return prisma.menu.findMany({
      where: { patientId, planVersion, id: { not: excludeMenuId }, date: { gte: dayStart, lte: dayEnd } },
      include: {
        recipe: { select: { family: true, subFamily: true, dishType: { select: { name: true } } } },
      },
    });
  },
  alternativesFor: (patient, q) => findAlternatives(patient, q),
  upsertCompletion: upsertMealCompletion,
  createMealLog: async (args) => prisma.mealLog.upsert(args),
  swapMenuRecipe: async (menuId, recipeId) => {
    await prisma.menu.update({ where: { id: menuId }, data: { recipeId } });
  },
  consumeWriteBudget: async (patientId) => {
    const { success } = await rateLimit(
      PLAN_WRITE_RATE_LIMIT_NAME,
      patientId,
      PLAN_WRITE_HOURLY_CAP,
      PLAN_WRITE_RATE_LIMIT_WINDOW_SEC
    );
    return success;
  },
};

const invalid = (message: string): ToolResult => ({ ok: false, reason: "INVALID_INPUT", message });
const notFound = (message: string): ToolResult => ({ ok: false, reason: "NOT_FOUND", message });

const EMPTY_PLAN_NOTE =
  "No meal plan covers this period — suggest opening the Meal Plan tab to generate one.";
const WEEK_NOTE = "Completion state is not shown in the week view — ask about a single day for that.";

export function makePlanHandlers(deps: PlanDeps = prismaDeps) {
  /** Shared write preamble: budget → meta → menu. */
  const resolveForWrite = async (
    ctx: ClaraContext,
    input: Record<string, unknown>
  ): Promise<
    { ok: true; menu: PlanMenuRow; meta: { activePlanVersion: number } } | { ok: false; result: ToolResult }
  > => {
    const menuId = typeof input.menuId === "string" ? input.menuId : "";
    if (!menuId) return { ok: false, result: invalid("menuId is required — find it with plan_get first") };
    if (!(await deps.consumeWriteBudget(ctx.patientId))) {
      return {
        ok: false,
        result: { ok: false, reason: "FAILED", message: "Too many changes in a short time — try again later." },
      };
    }
    const meta = await deps.getPlanMeta(ctx.patientId);
    if (!meta) return { ok: false, result: notFound("No profile found.") };
    const menu = await deps.findMenuById(menuId, ctx.patientId, meta.activePlanVersion);
    if (!menu) return { ok: false, result: notFound("No such planned meal — find it with plan_get first.") };
    return { ok: true, menu, meta };
  };

  const get = async (ctx: ClaraContext, input: Record<string, unknown>): Promise<ToolResult> => {
    const weekStart = typeof input.weekStart === "string" ? input.weekStart : undefined;
    const dateIn = typeof input.date === "string" ? input.date : undefined;
    const anchor = weekStart ?? dateIn ?? ctx.today;
    if (!parseLocalDateStrict(anchor)) return invalid("date/weekStart must be YYYY-MM-DD");
    const meta = await deps.getPlanMeta(ctx.patientId);
    if (!meta) return notFound("No profile found.");

    const dayCount = weekStart ? 7 : 1;
    const startDate = localMidnight(anchor);
    const endDate = addDaysLocal(startDate, dayCount - 1);
    endDate.setHours(23, 59, 59, 999);
    const from = anchor;
    const to = toLocalDateString(endDate);

    const [menus, exchanges] = await Promise.all([
      deps.findMenus(ctx.patientId, meta.activePlanVersion, startDate, endDate),
      deps.getExchanges(ctx.patientId, meta.activePlanVersion, from, to),
    ]);
    // Completion is a single-day concept here (the week view has none on the
    // web either) — and skipping it for weeks avoids 7 extra reads.
    const completion =
      dayCount === 1 && menus.length > 0
        ? await deps.completionState(ctx.patientId, anchor)
        : { loggedRecipeIds: [] as string[], mealRatings: {} as Record<string, number> };

    const resolvedByMenuId = new Map(
      exchanges
        .filter((x) => x.status === "RESOLVED" && x.displacedMenuId)
        .map((x) => [x.displacedMenuId as string, x])
    );
    const pending = exchanges.filter((x) => x.status === "PENDING");

    const days = Array.from({ length: dayCount }, (_, i) => {
      const dayDate = addDaysLocal(startDate, i);
      const dayStr = toLocalDateString(dayDate);
      const meals = menus
        .filter((m) => toLocalDateString(m.date) === dayStr)
        .map((m) => {
          const x = resolvedByMenuId.get(m.id);
          if (x) {
            const scale = (v: number | null) => (v ?? 0) * x.servings;
            return {
              menuId: m.id,
              name: x.name,
              mealType: m.mealTypeName,
              calories: scale(x.perServing.calories),
              protein: scale(x.perServing.protein),
              carbs: scale(x.perServing.carbs),
              fat: scale(x.perServing.fat),
              done: x.eaten,
              rating: null as number | null,
              exchange: { source: x.source, originLabel: x.originLabel },
            };
          }
          return {
            menuId: m.id,
            name: m.recipe.name,
            mealType: m.mealTypeName,
            calories: m.recipe.calories,
            protein: m.recipe.protein,
            carbs: m.recipe.carbs,
            fat: m.recipe.fat,
            done: completion.loggedRecipeIds.includes(m.recipe.id),
            rating: completion.mealRatings[m.recipe.id] ?? null,
            exchange: null as null | { source: string; originLabel: string },
          };
        });
      return {
        date: dayStr,
        meals,
        pendingExchanges: pending
          .filter((x) => x.localDate === dayStr)
          .map((x) => ({ name: x.name, originLabel: x.originLabel })),
      };
    });

    const note = menus.length === 0 ? EMPTY_PLAN_NOTE : dayCount > 1 ? WEEK_NOTE : undefined;
    return { ok: true, data: { from, to, days, ...(note ? { note } : {}) } };
  };

  const alternatives = async (ctx: ClaraContext, input: Record<string, unknown>): Promise<ToolResult> => {
    const menuId = typeof input.menuId === "string" ? input.menuId : "";
    if (!menuId) return invalid("menuId is required — find it with plan_get first");
    const meta = await deps.getPlanMeta(ctx.patientId);
    if (!meta) return notFound("No profile found.");
    const menu = await deps.findMenuById(menuId, ctx.patientId, meta.activePlanVersion);
    if (!menu) return notFound("No such planned meal — find it with plan_get first.");
    if (!menu.mealTypeId) return invalid("This meal slot cannot be searched for alternatives.");
    const patient = await deps.findDietPatient(ctx.patientId);
    if (!patient) return notFound("No profile found.");
    const alts = await deps.alternativesFor(patient, {
      mealTypeId: menu.mealTypeId,
      excludeRecipeId: menu.recipe.id,
      currentCalories: menu.recipe.calories ?? 0,
    });
    return {
      ok: true,
      data: {
        menuId,
        alternatives: alts.map((a) => ({
          recipeId: a.id,
          name: a.name,
          calories: a.calories,
          protein: a.protein,
          carbs: a.carbs,
          fat: a.fat,
        })),
      },
    };
  };

  const markDone = async (ctx: ClaraContext, input: Record<string, unknown>): Promise<ToolResult> => {
    if (input.rating !== undefined && input.rating !== "liked" && input.rating !== "disliked") {
      return invalid('rating must be "liked" or "disliked" — no other scale exists');
    }
    const pre = await resolveForWrite(ctx, input);
    if (!pre.ok) return pre.result;
    const rating = input.rating === "liked" ? 1 : input.rating === "disliked" ? -1 : null;
    const res = await deps.upsertCompletion(ctx.patientId, {
      recipeId: pre.menu.recipe.id,
      mealTypeName: pre.menu.mealTypeName ?? "Meal",
      // The MENU's day, not today: the plan view derives "done" per plan day.
      date: toLocalDateString(pre.menu.date),
      rating,
      toggle: false,
    });
    if (res === null) {
      return { ok: false, reason: "FAILED", message: "Could not record the completion." };
    }
    return {
      ok: true,
      data: {
        marked: {
          menuId: pre.menu.id,
          name: pre.menu.recipe.name,
          date: toLocalDateString(pre.menu.date),
          action: res.action,
          rating: res.rating,
        },
      },
    };
  };

  const logEaten = async (
    ctx: ClaraContext,
    input: Record<string, unknown>,
    toolUseId?: string
  ): Promise<ToolResult> => {
    // Hard requirement (S1 rule): a fallback dedupe key would upsert-collide
    // across DIFFERENT meals.
    if (!toolUseId) {
      return { ok: false, reason: "FAILED", message: "Internal: missing tool call id." };
    }
    const pre = await resolveForWrite(ctx, input);
    if (!pre.ok) return pre.result;

    const date = typeof input.date === "string" ? input.date : ctx.today;
    // Calendar-strict, not just format-strict: parseMealLogInput's regex lets
    // "2026-02-30" through and JS Date rolls it over without NaN — a phantom
    // localDate invisible to day summaries. Round-trip closes both holes.
    if (!parseLocalDateStrict(date) || toLocalDateString(localMidnight(date)) !== date) {
      return invalid("date must be a real calendar date (YYYY-MM-DD)");
    }
    const menuMealType = pre.menu.mealTypeName?.toLowerCase();
    const inputMealType = typeof input.mealType === "string" ? input.mealType : undefined;
    const mealType =
      inputMealType && MEAL_TYPES.includes(inputMealType as never)
        ? inputMealType
        : menuMealType && MEAL_TYPES.includes(menuMealType as never)
          ? menuMealType
          : undefined;
    if (!mealType) return invalid(`mealType must be one of: ${MEAL_TYPES.join(", ")}`);

    const parsed = parseMealLogInput({
      localDate: date,
      mealType,
      source: MealLogSource.RECIPE,
      recipeId: pre.menu.recipe.id,
      servings: input.servings ?? 1,
      clientRequestId: `clara:${toolUseId}`,
    });
    if (!parsed.ok) return invalid(parsed.error);
    // Server-priced: the recipe row IS the snapshot — never the model's numbers.
    const resolved = resolveSnapshot(parsed.value, { recipe: pre.menu.recipe });
    const data: MealLogCreateData = buildMealLogCreateData(ctx.patientId, parsed.value, resolved);
    const row = await deps.createMealLog(buildMealLogUpsertArgs(data));
    return { ok: true, data: { logged: serializeMealLog(row) } };
  };

  const swap = async (ctx: ClaraContext, input: Record<string, unknown>): Promise<ToolResult> => {
    const recipeId = typeof input.recipeId === "string" ? input.recipeId : "";
    if (!recipeId) return invalid("recipeId is required — pick one from plan_alternatives first");
    const pre = await resolveForWrite(ctx, input);
    if (!pre.ok) return pre.result;
    const recipe = await deps.findPublicRecipe(recipeId);
    if (!recipe) return notFound("That recipe isn't available — pick one from the alternatives offered.");
    const patient = await deps.findDietPatient(ctx.patientId);
    if (!patient) return notFound("No profile found.");
    // Reuse resolveForWrite's meta: a second fetch could straddle a plan
    // regeneration and validate family/sub-family against the WRONG version's
    // day (S3 review).
    const sameDay = await deps.findSameDayMenus(ctx.patientId, pre.meta.activePlanVersion, pre.menu.date, pre.menu.id);
    const verdict = validateSwapCandidate(patient, { mealTypeId: pre.menu.mealTypeId }, recipe, sameDay);
    if (!verdict.ok) return invalid(verdict.message);
    await deps.swapMenuRecipe(pre.menu.id, recipe.id);
    return {
      ok: true,
      data: { swapped: { menuId: pre.menu.id, from: pre.menu.recipe.name, to: recipe.name } },
    };
  };

  return { get, alternatives, markDone, logEaten, swap };
}

const handlers = makePlanHandlers();

export const planSkill: Skill = {
  name: "plan",
  promptFragment:
    "About your plan_ tools: the meal plan is what is SCHEDULED, not what was eaten. plan_get shows the planned dishes for a day (or a week with weekStart) — including days where the user exchanged a planned dish for a restaurant or fridge meal; present the exchanged-in dish as the day's actual meal and mention it replaced the original. To swap a dish: plan_get to find the meal, then plan_alternatives for up to three valid options, present them, and only after the user picks and confirms call plan_swap_dish. When the user says they ate a planned dish: find it with plan_get first, then propose marking it done (plan_mark_done, rating optional — the app only knows liked or disliked, so map or ask; star ratings do not exist), and ask ONCE whether they also want it counted in their intake numbers — if yes, plan_log_eaten; never assume one implies the other, and execute either only after their yes. You cannot regenerate or rebuild the plan — send them to the Meal Plan tab and call gap_report (category MEAL_PLAN, reason OUT_OF_SCOPE). You also cannot add, remove, or reschedule planned meals: gap_report (MEAL_PLAN). Marking a meal as skipped is not something you can do yet: gap_report (JOURNAL).",
  tools: [
    {
      def: {
        name: "plan_get",
        description:
          "The user's planned meals for one day (default today) or a week (weekStart). Includes swaps-in-progress and restaurant/fridge exchanges. Use for 'what's for dinner', 'what's planned' — and to FIND a planned meal (its menuId) before marking it done or swapping it. NOT for logging unplanned food or listing what was eaten — logs_ tools own intake.",
        input_schema: {
          type: "object",
          properties: {
            date: { type: "string", description: "YYYY-MM-DD; omit for today. Resolve relative phrases against today's date first." },
            weekStart: { type: "string", description: "YYYY-MM-DD; returns this day plus the next six." },
          },
        },
      },
      handler: handlers.get,
    },
    {
      def: {
        name: "plan_alternatives",
        description:
          "Up to three valid replacement dishes for one planned meal. menuId must come from plan_get in this conversation. Use before proposing any swap. Candidates already respect the user's dietary profile.",
        input_schema: {
          type: "object",
          properties: { menuId: { type: "string" } },
          required: ["menuId"],
        },
      },
      handler: handlers.alternatives,
    },
    {
      def: {
        name: "plan_mark_done",
        isWrite: true,
        description:
          "Mark a planned dish as completed in the user's journal, AFTER they confirmed. Optional rating 'liked' or 'disliked' (the only scale that exists). Does NOT add it to intake numbers — plan_log_eaten does that, and only if the user wants it.",
        input_schema: {
          type: "object",
          properties: {
            menuId: { type: "string" },
            rating: { type: "string", enum: ["liked", "disliked"] },
          },
          required: ["menuId"],
        },
      },
      handler: handlers.markDone,
    },
    {
      def: {
        name: "plan_log_eaten",
        isWrite: true,
        description:
          "Add a planned dish the user actually ate to their intake log (real recipe macros), AFTER they confirmed. Independent of plan_mark_done. date defaults to today — the day they ate it, not the plan slot.",
        input_schema: {
          type: "object",
          properties: {
            menuId: { type: "string" },
            date: { type: "string", description: "YYYY-MM-DD; omit for today." },
            servings: { type: "number", description: "Defaults to 1." },
            mealType: {
              type: "string",
              enum: ["breakfast", "lunch", "dinner", "snack"],
              description: "Only needed when the plan slot's meal type is non-standard.",
            },
          },
          required: ["menuId"],
        },
      },
      handler: handlers.logEaten,
    },
    {
      def: {
        name: "plan_swap_dish",
        isWrite: true,
        description:
          "Replace one planned meal with a recipe the user picked from plan_alternatives, AFTER they confirmed the specific choice. Validates meal slot, dietary profile, macro fit, and same-day variety — a rejection explains why.",
        input_schema: {
          type: "object",
          properties: { menuId: { type: "string" }, recipeId: { type: "string" } },
          required: ["menuId", "recipeId"],
        },
      },
      handler: handlers.swap,
    },
  ],
};
