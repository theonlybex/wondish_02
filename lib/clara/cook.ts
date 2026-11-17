// Cooking session: "cook this dish with me" on the server. The app sends the
// dish's recipe once (start); it is validated, rebuilt key by key and stored on
// the conversation, per dish (cook-dishes.ts): one chat can hold up to three
// cookable dishes. "ate" logs a dish from its STORED recipe, never from
// anything the second request says, and is idempotent per conversation and
// dish. Clara never calls this: each action is the person's own tap.
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
import { cookDishesJson, latestCookDish, LEGACY_DISH_ID, readCookDishes, type CookDishes } from "./cook-dishes";
import type { ClaraRecipe } from "./parts";

const MAX_DISH_ID = 128;
const MAX_MINUTES = 24 * 60;
const MAX_INGREDIENTS = 60;
const MAX_STEPS = 40;
const MAX_STEP_CHARS = 1000;
const MAX_UNIT_CHARS = 40;
const MAX_QUANTITY = 100000;
const MAX_SODIUM_MG = 100000;

/** Servings an "ate" answer may log. */
export const ATE_PORTIONS = [0.25, 0.5, 1, 2] as const;
export type AtePortion = (typeof ATE_PORTIONS)[number];

export type CookAction =
  | { action: "start"; dish: { dishId: string; name: string; recipe: ClaraRecipe } }
  // dishId absent (older app builds): the most recently started dish.
  | { action: "done"; dishId?: string }
  | { action: "ate"; portion: AtePortion; mealType: MealType; today: string | undefined; dishId?: string };

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

/** `dishId` on done / ate: absent is fine (older builds); present must be a real id. */
function optionalDishId(raw: Record<string, unknown>): ParseResult<string | undefined> {
  if (raw.dishId === undefined) return { ok: true, value: undefined };
  const dishId = text(raw.dishId, MAX_DISH_ID);
  return dishId ? { ok: true, value: dishId } : fail("dishId must be a non-empty string");
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
    case "done": {
      const d = optionalDishId(raw);
      if (!d.ok) return d;
      return { ok: true, value: d.value === undefined ? { action: "done" } : { action: "done", dishId: d.value } };
    }
    case "ate": {
      // 1 and 0.5 are "I ate it" and "I ate some of it"; 2 and 0.25 come from
      // a double or half portion cooked ("How hungry are you?", 2026-11-17).
      if (!ATE_PORTIONS.includes(raw.portion as AtePortion)) return fail("portion must be 0.25, 0.5, 1 or 2");
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
      const d = optionalDishId(raw);
      if (!d.ok) return d;
      const ate: CookAction = { action: "ate", portion: raw.portion as AtePortion, mealType, today };
      return { ok: true, value: d.value === undefined ? ate : { ...ate, dishId: d.value } };
    }
    default:
      return fail("action must be one of: start, done, ate");
  }
}

/** The conversation's cook columns as stored. */
export interface CookRow {
  dishName: string | null;
  cookedAt: Date | null;
  recipe: unknown;
}

/** What a start / done writes. `title`, `dishName` and `recipe` are left alone when absent. */
export interface CookWrite {
  title?: string;
  dishName?: string;
  cookedAt: Date | null;
  recipe?: CookDishes;
}

/** Persistence port. Every method is scoped by patientId in the same query. */
export interface CookDeps {
  /** null when the conversation is not the patient's. */
  getCook: (conversationId: string, patientId: string) => Promise<CookRow | null>;
  /**
   * Reads the row and writes what `change` returns as one step, the row locked
   * in between (two dishes started at once must not drop one). null when the
   * conversation is not the patient's.
   */
  updateCook: <T>(
    conversationId: string,
    patientId: string,
    change: (row: CookRow) => { write: CookWrite | null; result: T }
  ) => Promise<T | null>;
  /** Creates the log unless one with the same (patientId, clientRequestId) exists. */
  logOnce: (data: MealLogCreateData) => Promise<void>;
}

export type CookResult = { ok: true } | { ok: false; status: 404 | 409; error: string };

const NOT_FOUND: CookResult = { ok: false, status: 404, error: "Conversation not found" };
const OK: CookResult = { ok: true };
const NOT_STARTED: CookResult = { ok: false, status: 409, error: "Start cooking this dish before logging it" };
const DONE_NOT_STARTED: CookResult = { ok: false, status: 409, error: "Start cooking this dish before finishing it" };

/**
 * The log's idempotency key: one row per conversation AND dish. A dish stored
 * by a build that kept one recipe per chat keeps that build's key
 * (`cook-<conversationId>`), so a replay does not log it again.
 */
export const cookLogKey = (conversationId: string, dishId: string = LEGACY_DISH_ID) =>
  dishId === LEGACY_DISH_ID ? `cook-${conversationId}` : `cook-${conversationId}-${dishId}`;

const toDate = (iso: string | null) => (iso ? new Date(iso) : null);

export function makeCookService(deps: CookDeps = prismaCookDeps, now: () => Date = () => new Date()) {
  return {
    async apply(conversationId: string, patientId: string, a: CookAction): Promise<CookResult> {
      if (a.action === "start") {
        const title = titleFrom(a.dish.name); // same 60-char cap as every chat title
        const startedAt = now().toISOString();
        const result = await deps.updateCook(conversationId, patientId, (row) => {
          const dishes = readCookDishes(row.recipe, row);
          // Starting the same dish again keeps when it was cooked.
          const cookedAt = dishes.get(a.dish.dishId)?.cookedAt ?? null;
          dishes.set(a.dish.dishId, { name: title, recipe: a.dish.recipe, startedAt, cookedAt });
          // The chat's title, dishName and cookedAt reflect the most recently started dish.
          return { write: { title, dishName: title, cookedAt: toDate(cookedAt), recipe: dishes }, result: OK };
        });
        return result ?? NOT_FOUND;
      }

      if (a.action === "done") {
        const at = now();
        const result = await deps.updateCook(conversationId, patientId, (row): { write: CookWrite | null; result: CookResult } => {
          const dishes = readCookDishes(row.recipe, row);
          const latest = latestCookDish(dishes);
          if (a.dishId !== undefined && !dishes.has(a.dishId)) return { write: null, result: DONE_NOT_STARTED };
          const dishId = a.dishId ?? latest?.dishId;
          // Nothing started and no dishId (an older build): mark the chat, as before.
          if (dishId === undefined || !latest) return { write: { cookedAt: at }, result: OK };
          dishes.set(dishId, { ...dishes.get(dishId)!, cookedAt: at.toISOString() });
          const cookedAt = dishId === latest.dishId ? at : row.cookedAt;
          return { write: { cookedAt, recipe: dishes }, result: OK };
        });
        return result ?? NOT_FOUND;
      }

      const row = await deps.getCook(conversationId, patientId);
      if (!row) return NOT_FOUND;
      const dishes = readCookDishes(row.recipe, row);
      let found: { dishId: string; name: string; recipe: unknown } | null = null;
      if (a.dishId === undefined) {
        const latest = latestCookDish(dishes);
        if (latest) found = { dishId: latest.dishId, name: latest.dish.name, recipe: latest.dish.recipe };
      } else {
        const dish = dishes.get(a.dishId);
        const legacy = dishes.size === 1 ? dishes.get(LEGACY_DISH_ID) : undefined;
        if (dish) found = { dishId: a.dishId, name: dish.name, recipe: dish.recipe };
        // A chat started by a build that stored one recipe and no dishId: its
        // only dish is the one being answered.
        else if (legacy) found = { dishId: LEGACY_DISH_ID, name: legacy.name, recipe: legacy.recipe };
      }
      const recipe = found ? validateRecipe(found.recipe) : null;
      if (!found || !recipe) return NOT_STARTED;
      const ps = recipe.perServing;
      const input = {
        localDate: a.today ?? formatLocalDate(now()),
        mealType: a.mealType,
        source: MealLogSource.CLARA,
        name: found.name,
        servings: a.portion,
        perServing: { calories: ps.calories, protein: ps.protein, carbs: ps.carbs, fat: ps.fat, fiber: ps.fibre },
        clientRequestId: cookLogKey(conversationId, found.dishId),
        estimated: false,
        ...(ps.sodium !== null ? { sodium: ps.sodium } : {}),
      };
      await deps.logOnce(buildMealLogCreateData(patientId, input, resolveSnapshot(input, {})));
      return OK;
    },
  };
}

export type CookService = ReturnType<typeof makeCookService>;

const prismaCookDeps: CookDeps = {
  getCook: async (conversationId, patientId) =>
    prisma.claraConversation.findFirst({
      where: { id: conversationId, patientId },
      select: { dishName: true, cookedAt: true, recipe: true },
    }),
  updateCook: async (conversationId, patientId, change) =>
    prisma.$transaction(async (tx) => {
      // Row lock, scoped by owner: a second start for the same chat waits here
      // and then reads this one's dishes.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "ClaraConversation" WHERE id = ${conversationId} AND "patientId" = ${patientId} FOR UPDATE
      `;
      if (locked.length === 0) return null;
      const row = await tx.claraConversation.findFirst({
        where: { id: conversationId, patientId },
        select: { dishName: true, cookedAt: true, recipe: true },
      });
      if (!row) return null;
      const { write, result } = change(row);
      if (write) {
        await tx.claraConversation.updateMany({
          where: { id: conversationId, patientId },
          data: {
            ...(write.title !== undefined ? { title: write.title } : {}),
            ...(write.dishName !== undefined ? { dishName: write.dishName } : {}),
            cookedAt: write.cookedAt,
            ...(write.recipe !== undefined
              ? { recipe: cookDishesJson(write.recipe) as unknown as Prisma.InputJsonValue }
              : {}),
          },
        });
      }
      return result;
    }),
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
