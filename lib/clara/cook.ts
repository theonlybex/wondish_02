// Cooking session: "cook this dish with me" on the server. The app sends the
// dish's recipe once (start); it is validated, rebuilt key by key and stored on
// the conversation. "ate" logs the dish from that STORED recipe, never from
// anything the second request says, and is idempotent per conversation.
// Clara never calls this: each action is the person's own tap.
import { MealLogSource, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  buildMealLogCreateData,
  buildMealLogUpsertArgs,
  formatLocalDate,
  MAX_MACRO,
  MAX_NAME,
  MAX_SERVINGS,
  MEAL_TYPES,
  parseTodayParam,
  resolveSnapshot,
  type MealLogCreateData,
  type MealType,
  type ParseResult,
} from "@/lib/meal-log";
import { titleFrom } from "./conversations";
import type { ClaraRecipe } from "./parts";

const MAX_DISH_ID = 128;
const MAX_MINUTES = 24 * 60;
const MAX_INGREDIENTS = 60;
const MAX_STEPS = 40;
const MAX_STEP_CHARS = 1000;
const MAX_UNIT_CHARS = 40;
const MAX_QUANTITY = 100000;
const MAX_SODIUM_MG = 100000;

export type CookAction =
  | { action: "start"; dish: { dishId: string; name: string; recipe: ClaraRecipe } }
  | { action: "done" }
  | { action: "ate"; portion: 1 | 0.5; mealType: MealType; today: string | undefined };

const fail = (error: string, status = 400): ParseResult<never> => ({ ok: false, error, status });
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const inRange = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const text = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim().length > 0 && v.length <= max ? v.trim() : null;

/**
 * Checks a recipe (from the app, or read back from storage) and rebuilds it
 * with only the known keys. Returns null when anything is missing or out of range.
 */
export function validateRecipe(raw: unknown): ClaraRecipe | null {
  if (!isObj(raw)) return null;
  const name = text(raw.name, MAX_NAME);
  if (!name || !inRange(raw.servings, 0.01, MAX_SERVINGS) || !inRange(raw.minutes, 0, MAX_MINUTES)) return null;

  if (!Array.isArray(raw.ingredients) || raw.ingredients.length > MAX_INGREDIENTS) return null;
  const ingredients: ClaraRecipe["ingredients"] = [];
  for (const i of raw.ingredients) {
    if (!isObj(i)) return null;
    const iname = text(i.name, MAX_NAME);
    if (!iname || typeof i.unit !== "string" || i.unit.length > MAX_UNIT_CHARS) return null;
    if (i.quantity !== null && !inRange(i.quantity, 0, MAX_QUANTITY)) return null;
    ingredients.push({ name: iname, quantity: i.quantity, unit: i.unit });
  }

  if (!Array.isArray(raw.steps) || raw.steps.length < 1 || raw.steps.length > MAX_STEPS) return null;
  const steps: string[] = [];
  for (const s of raw.steps) {
    const step = text(s, MAX_STEP_CHARS);
    if (!step) return null;
    steps.push(step);
  }

  const p = raw.perServing;
  if (!isObj(p)) return null;
  for (const k of ["calories", "protein", "carbs", "fat", "fibre"] as const) {
    if (!inRange(p[k], 0, MAX_MACRO)) return null;
  }
  if (p.sodium !== null && !inRange(p.sodium, 0, MAX_SODIUM_MG)) return null;

  return {
    name,
    servings: raw.servings as number,
    minutes: raw.minutes as number,
    ingredients,
    steps,
    perServing: {
      calories: p.calories as number,
      protein: p.protein as number,
      carbs: p.carbs as number,
      fat: p.fat as number,
      fibre: p.fibre as number,
      sodium: p.sodium as number | null,
    },
  };
}

export function parseCookBody(raw: unknown): ParseResult<CookAction> {
  if (!isObj(raw)) return fail("request body must be a JSON object");
  switch (raw.action) {
    case "start": {
      if (!isObj(raw.dish)) return fail("dish is required");
      const dishId = text(raw.dish.dishId, MAX_DISH_ID);
      const name = text(raw.dish.name, MAX_NAME);
      if (!dishId) return fail("dish.dishId is required");
      if (!name) return fail("dish.name is required");
      const recipe = validateRecipe(raw.dish.recipe);
      if (!recipe) return fail("dish.recipe is missing or invalid");
      return { ok: true, value: { action: "start", dish: { dishId, name, recipe } } };
    }
    case "done":
      return { ok: true, value: { action: "done" } };
    case "ate": {
      if (raw.portion !== 1 && raw.portion !== 0.5) return fail("portion must be 1 or 0.5");
      let mealType: MealType = "dinner";
      if (raw.mealType !== undefined) {
        if (typeof raw.mealType !== "string" || !MEAL_TYPES.includes(raw.mealType as MealType)) {
          return fail(`mealType must be one of: ${MEAL_TYPES.join(", ")}`);
        }
        mealType = raw.mealType as MealType;
      }
      let today: string | undefined;
      if (raw.today !== undefined) {
        const t = parseTodayParam(typeof raw.today === "string" ? raw.today : "");
        if (!t.ok) return t;
        today = t.value;
      }
      return { ok: true, value: { action: "ate", portion: raw.portion, mealType, today } };
    }
    default:
      return fail("action must be one of: start, done, ate");
  }
}

/** Persistence port. Every method is scoped by patientId in the same query. */
export interface CookDeps {
  /** null when the conversation is not the patient's. */
  getCook: (conversationId: string, patientId: string) => Promise<{ dishName: string | null; recipe: unknown } | null>;
  /** true when an owned row was updated. */
  saveStart: (
    conversationId: string,
    patientId: string,
    v: { title: string; dishName: string; recipe: ClaraRecipe }
  ) => Promise<boolean>;
  markDone: (conversationId: string, patientId: string, at: Date) => Promise<boolean>;
  /** Creates the log unless one with the same (patientId, clientRequestId) exists. */
  logOnce: (data: MealLogCreateData) => Promise<void>;
}

export type CookResult = { ok: true } | { ok: false; status: 404 | 409; error: string };

const NOT_FOUND: CookResult = { ok: false, status: 404, error: "Conversation not found" };

export const cookLogKey = (conversationId: string) => `cook-${conversationId}`;

export function makeCookService(deps: CookDeps = prismaCookDeps, now: () => Date = () => new Date()) {
  return {
    async apply(conversationId: string, patientId: string, a: CookAction): Promise<CookResult> {
      if (a.action === "start") {
        const title = titleFrom(a.dish.name); // same 60-char cap as every chat title
        const saved = await deps.saveStart(conversationId, patientId, {
          title,
          dishName: title,
          recipe: a.dish.recipe,
        });
        return saved ? { ok: true } : NOT_FOUND;
      }
      if (a.action === "done") {
        return (await deps.markDone(conversationId, patientId, now())) ? { ok: true } : NOT_FOUND;
      }

      const cook = await deps.getCook(conversationId, patientId);
      if (!cook) return NOT_FOUND;
      const recipe = validateRecipe(cook.recipe);
      if (!cook.dishName || !recipe) {
        return { ok: false, status: 409, error: "Start cooking this dish before logging it" };
      }
      const ps = recipe.perServing;
      const input = {
        localDate: a.today ?? formatLocalDate(now()),
        mealType: a.mealType,
        source: MealLogSource.CLARA,
        name: cook.dishName,
        servings: a.portion,
        perServing: { calories: ps.calories, protein: ps.protein, carbs: ps.carbs, fat: ps.fat, fiber: ps.fibre },
        clientRequestId: cookLogKey(conversationId),
        estimated: false,
        ...(ps.sodium !== null ? { sodium: ps.sodium } : {}),
      };
      await deps.logOnce(buildMealLogCreateData(patientId, input, resolveSnapshot(input, {})));
      return { ok: true };
    },
  };
}

export type CookService = ReturnType<typeof makeCookService>;

const prismaCookDeps: CookDeps = {
  getCook: async (conversationId, patientId) =>
    prisma.claraConversation.findFirst({
      where: { id: conversationId, patientId },
      select: { dishName: true, recipe: true },
    }),
  saveStart: async (conversationId, patientId, v) => {
    const { count } = await prisma.claraConversation.updateMany({
      where: { id: conversationId, patientId },
      data: { title: v.title, dishName: v.dishName, recipe: v.recipe as unknown as Prisma.InputJsonValue },
    });
    return count > 0;
  },
  markDone: async (conversationId, patientId, at) => {
    const { count } = await prisma.claraConversation.updateMany({
      where: { id: conversationId, patientId },
      data: { cookedAt: at },
    });
    return count > 0;
  },
  logOnce: async (data) => {
    try {
      // Pinned `update: {}`: a replay returns the existing row untouched.
      await prisma.mealLog.upsert(buildMealLogUpsertArgs(data));
    } catch (err) {
      // Two taps raced through the non-atomic upsert: the row exists now.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    }
  },
};
