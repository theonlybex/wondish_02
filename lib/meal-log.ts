// ─── Wondish Meal-Log Core (validation + snapshot resolution) ───────────────
// The single home for all meal-log request validation, snapshot resolution,
// Prisma arg building, DTO serialization, and daily-target/envelope derivation.
// Routes (app/api/meal-log/*) stay thin: parse → resolve snapshot → write →
// envelope. All macro arithmetic lives in lib/macros.ts; all "should eat"
// target math lives in lib/caloric-engine.ts. This module wires them together.
//
// Pure functions here (parse*/build*/resolve*/serialize*/computeRemaining) are
// unit-tested in lib/meal-log.test.ts. The async DB-bound helpers (getDayTarget
// /getDayEnvelope) follow the repo's T11/T12 convention — route-level DB
// behavior is verified manually against the dev branch, not in the unit sweep.
// ────────────────────────────────────────────────────────────────────────────

import { MealLogSource } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  type MacroSnapshot,
  recipeToPerServing,
  snapshotFromMacros,
  snapshotFromCustomIngredient,
  scaleSnapshot,
  sumMealLogs,
  r1,
} from "@/lib/macros";
import {
  computeAllMetrics,
  computeWeeklyTarget,
  convertWeight,
  resolveDailyTargets,
  type DailyTargets,
  type Sex,
  type CaloricProfileInput,
} from "@/lib/caloric-engine";
import { getPlanDayCalories } from "@/lib/meal-plan";

// ─── Constants / allow-lists ────────────────────────────────────────────────

export const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export const MEAL_LOG_SOURCES = Object.values(MealLogSource) as MealLogSource[];

const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/; // anchored (audit T1) — format only
const MAX_SERVINGS = 50;
const MAX_MACRO = 10000;
const MAX_NAME = 120;
const MAX_BATCH_ITEMS = 50;
const MAX_RANGE_DAYS = 366;
export const DELTA_PAGE_SIZE = 500;
const MACRO_KEYS = ["calories", "protein", "carbs", "fat", "fiber"] as const;

// ─── Result type ────────────────────────────────────────────────────────────

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; status: number };

const fail = (error: string, status = 400): ParseResult<never> => ({ ok: false, error, status });

// ─── formatLocalDate ────────────────────────────────────────────────────────
// Local getters, zero-padded — the string-for-string twin of iOS's
// DateFormatter "yyyy-MM-dd" in the device's current calendar. Every web write
// path derives localDate from this on the BROWSER's clock. Never
// toISOString().slice(0,10) (UTC → the T3 off-by-one).

export function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ─── Parsed shapes ──────────────────────────────────────────────────────────

// Parsed output: checkPerServing drops null/undefined and keeps only valid
// numbers, so the resolved type carries no nulls (feeds snapshotFromMacros
// directly without a coercion step).
export interface PerServingInput {
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
}

export interface ParsedMealLog {
  localDate: string;
  mealType: MealType;
  source: MealLogSource;
  name?: string; // absent → server defaults from recipe/custom-ingredient (RECIPE/CUSTOM only)
  servings: number;
  perServing?: PerServingInput; // MANUAL / PICTURE / FRIDGE
  recipeId?: string;
  customIngredientId?: string;
  journalMealId?: string;
  pictureResultId?: string;
  fridgeRecipeId?: string;
  note?: string;
  clientRequestId?: string;
}

export interface ParsedBatch {
  localDate: string;
  mealType: MealType;
  items: ParsedMealLog[];
}

export interface ParsedPatch {
  servings?: number;
  mealType?: MealType;
  name?: string;
  localDate?: string;
  perServing?: PerServingInput;
  deletedAt?: null; // undo only — resurrection to null is the sole allowed value
}

// ─── Field validators (shared) ──────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function checkLocalDate(v: unknown): ParseResult<string> {
  if (typeof v !== "string" || !LOCAL_DATE_RE.test(v)) {
    return fail("localDate is required and must be a YYYY-MM-DD string");
  }
  return { ok: true, value: v };
}

function checkMealType(v: unknown): ParseResult<MealType> {
  if (typeof v !== "string" || !MEAL_TYPES.includes(v as MealType)) {
    return fail(`mealType must be one of: ${MEAL_TYPES.join(", ")}`);
  }
  return { ok: true, value: v as MealType };
}

function checkServings(v: unknown): ParseResult<number> {
  if (v === undefined || v === null) return { ok: true, value: 1 };
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > MAX_SERVINGS) {
    return fail(`servings must be a number in (0, ${MAX_SERVINGS}]`);
  }
  return { ok: true, value: v };
}

function checkName(v: unknown): ParseResult<string> {
  if (typeof v !== "string") return fail("name must be a string");
  const trimmed = v.trim();
  if (!trimmed || trimmed.length > MAX_NAME) {
    return fail(`name must be non-empty and <= ${MAX_NAME} characters`);
  }
  return { ok: true, value: trimmed };
}

function checkPerServing(v: unknown): ParseResult<PerServingInput> {
  if (!isObj(v)) return fail("perServing must be an object of macro values");
  const out: PerServingInput = {};
  for (const key of MACRO_KEYS) {
    const raw = v[key];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > MAX_MACRO) {
      return fail(`perServing.${key} must be a number in [0, ${MAX_MACRO}]`);
    }
    out[key] = raw;
  }
  return { ok: true, value: out };
}

function optionalString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

// ─── Item validation (shared by single-write and batch) ─────────────────────
// localDate + mealType come from a resolved context (the single body validates
// its own; a batch validates the envelope once, then injects into each item).

function validateItem(raw: unknown, localDate: string, mealType: MealType): ParseResult<ParsedMealLog> {
  if (!isObj(raw)) return fail("meal-log item must be an object");

  // source (default MANUAL)
  let source: MealLogSource = MealLogSource.MANUAL;
  if (raw.source !== undefined) {
    if (typeof raw.source !== "string" || !MEAL_LOG_SOURCES.includes(raw.source as MealLogSource)) {
      return fail(`source must be one of: ${MEAL_LOG_SOURCES.join(", ")}`);
    }
    source = raw.source as MealLogSource;
  }

  const servings = checkServings(raw.servings);
  if (!servings.ok) return servings;

  const item: ParsedMealLog = {
    localDate,
    mealType,
    source,
    servings: servings.value,
    journalMealId: optionalString(raw.journalMealId),
    pictureResultId: optionalString(raw.pictureResultId),
    fridgeRecipeId: optionalString(raw.fridgeRecipeId),
    note: optionalString(raw.note),
    clientRequestId: optionalString(raw.clientRequestId),
  };

  // name: required for MANUAL/PICTURE/FRIDGE; optional (server-defaulted) for RECIPE/CUSTOM.
  const nameProvided = raw.name !== undefined && raw.name !== null;
  if (nameProvided) {
    const n = checkName(raw.name);
    if (!n.ok) return n;
    item.name = n.value;
  }

  // source-specific required inputs
  if (source === MealLogSource.RECIPE) {
    const recipeId = optionalString(raw.recipeId);
    if (!recipeId) return fail("recipeId is required for source RECIPE");
    item.recipeId = recipeId;
  } else if (source === MealLogSource.CUSTOM) {
    const customIngredientId = optionalString(raw.customIngredientId);
    if (!customIngredientId) return fail("customIngredientId is required for source CUSTOM");
    item.customIngredientId = customIngredientId;
  } else {
    // MANUAL / PICTURE / FRIDGE — caller supplies per-serving macros and a name.
    if (!nameProvided) return fail(`name is required for source ${source}`);
    const ps = checkPerServing(raw.perServing);
    if (!ps.ok) return ps;
    item.perServing = ps.value;
    // opaque provenance is still carried on recipeId when supplied (FRIDGE persisted, etc.)
    const recipeId = optionalString(raw.recipeId);
    if (recipeId) item.recipeId = recipeId;
  }

  return { ok: true, value: item };
}

// ─── parseMealLogInput (single write) ───────────────────────────────────────

export function parseMealLogInput(raw: unknown): ParseResult<ParsedMealLog> {
  if (!isObj(raw)) return fail("request body must be a JSON object");
  const ld = checkLocalDate(raw.localDate);
  if (!ld.ok) return ld;
  const mt = checkMealType(raw.mealType);
  if (!mt.ok) return mt;
  return validateItem(raw, ld.value, mt.value);
}

// ─── parseBatchInput (multi-item) ───────────────────────────────────────────

export function parseBatchInput(raw: unknown): ParseResult<ParsedBatch> {
  if (!isObj(raw)) return fail("request body must be a JSON object");
  const ld = checkLocalDate(raw.localDate);
  if (!ld.ok) return ld;
  const mt = checkMealType(raw.mealType);
  if (!mt.ok) return mt;
  if (!Array.isArray(raw.items) || raw.items.length < 1 || raw.items.length > MAX_BATCH_ITEMS) {
    return fail(`items must be an array of 1-${MAX_BATCH_ITEMS} entries`);
  }
  const items: ParsedMealLog[] = [];
  for (const rawItem of raw.items) {
    const parsed = validateItem(rawItem, ld.value, mt.value);
    if (!parsed.ok) return parsed;
    items.push(parsed.value);
  }
  return { ok: true, value: { localDate: ld.value, mealType: mt.value, items } };
}

// ─── parsePatchInput (edit / undo) ──────────────────────────────────────────

export function parsePatchInput(raw: unknown): ParseResult<ParsedPatch> {
  if (!isObj(raw)) return fail("request body must be a JSON object");
  const out: ParsedPatch = {};

  if (raw.servings !== undefined) {
    if (typeof raw.servings !== "number" || !Number.isFinite(raw.servings) || raw.servings <= 0 || raw.servings > MAX_SERVINGS) {
      return fail(`servings must be a number in (0, ${MAX_SERVINGS}]`);
    }
    out.servings = raw.servings;
  }
  if (raw.mealType !== undefined) {
    const mt = checkMealType(raw.mealType);
    if (!mt.ok) return mt;
    out.mealType = mt.value;
  }
  if (raw.name !== undefined) {
    const n = checkName(raw.name);
    if (!n.ok) return n;
    out.name = n.value;
  }
  if (raw.localDate !== undefined) {
    const ld = checkLocalDate(raw.localDate);
    if (!ld.ok) return ld;
    out.localDate = ld.value;
  }
  if (raw.perServing !== undefined) {
    const ps = checkPerServing(raw.perServing);
    if (!ps.ok) return ps;
    out.perServing = ps.value;
  }
  if (raw.deletedAt !== undefined) {
    if (raw.deletedAt !== null) return fail("deletedAt may only be set to null (undo)");
    out.deletedAt = null;
  }

  return { ok: true, value: out };
}

// ─── resolveSnapshot — per-source snapshot + name resolution (pure) ─────────
// The per-serving snapshot is produced by the matching lib/macros function per
// `source`. RECIPE prices server-side (client macros ignored — trust boundary);
// CUSTOM stores the ingredient's per-unit macros verbatim (servings is the sole
// multiplier, applied once at read); MANUAL/PICTURE/FRIDGE use caller macros.
// Fetching the recipe / custom-ingredient (and the CUSTOM premium gate) is the
// route's job; this function is pure over the already-fetched deps.

export interface RecipeDep {
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  fiber?: number | null;
  servings?: number | null;
  name: string;
}
export interface CustomIngredientDep {
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  name: string;
}

export function resolveSnapshot(
  input: ParsedMealLog,
  deps: { recipe?: RecipeDep; customIngredient?: CustomIngredientDep }
): { snapshot: MacroSnapshot; name: string } {
  if (input.source === MealLogSource.RECIPE) {
    const recipe = deps.recipe;
    if (!recipe) throw new Error("resolveSnapshot: RECIPE source requires a recipe dep");
    return { snapshot: recipeToPerServing(recipe), name: input.name ?? recipe.name };
  }
  if (input.source === MealLogSource.CUSTOM) {
    const ci = deps.customIngredient;
    if (!ci) throw new Error("resolveSnapshot: CUSTOM source requires a customIngredient dep");
    return { snapshot: snapshotFromCustomIngredient(ci), name: input.name ?? ci.name };
  }
  // MANUAL / PICTURE / FRIDGE — name guaranteed present by validation.
  return { snapshot: snapshotFromMacros(input.perServing ?? {}), name: input.name! };
}

// ─── buildMealLogCreateData ─────────────────────────────────────────────────
// The per-serving snapshot is stored UNROUNDED so N-servings totals re-sum
// exactly; rounding (r1) happens only at serialization/aggregation.

export interface MealLogCreateData {
  patientId: string;
  localDate: string;
  mealType: string;
  source: MealLogSource;
  name: string;
  servings: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  incomplete: boolean;
  recipeId: string | null;
  customIngredientId: string | null;
  journalMealId: string | null;
  pictureResultId: string | null;
  fridgeRecipeId: string | null;
  note: string | null;
  clientRequestId: string | null;
}

export function buildMealLogCreateData(
  patientId: string,
  input: ParsedMealLog,
  resolved: { snapshot: MacroSnapshot; name: string }
): MealLogCreateData {
  const s = resolved.snapshot;
  return {
    patientId,
    localDate: input.localDate,
    mealType: input.mealType,
    source: input.source,
    name: resolved.name,
    servings: input.servings,
    calories: s.calories,
    protein: s.protein,
    carbs: s.carbs,
    fat: s.fat,
    fiber: s.fiber,
    incomplete: s.incomplete,
    recipeId: input.recipeId ?? null,
    customIngredientId: input.customIngredientId ?? null,
    journalMealId: input.journalMealId ?? null,
    pictureResultId: input.pictureResultId ?? null,
    fridgeRecipeId: input.fridgeRecipeId ?? null,
    note: input.note ?? null,
    clientRequestId: input.clientRequestId ?? null,
  };
}

// ─── buildMealLogUpsertArgs — PINNED create-or-return-existing ───────────────
// update: {} is a hard pin: a replayed offline create must NEVER re-write the
// create payload over a PATCH edit that landed first. Prisma's empty update
// still bumps @updatedAt (benign — the row re-surfaces in delta sync with
// unchanged content). Only valid when clientRequestId is present.

export function buildMealLogUpsertArgs(data: MealLogCreateData) {
  return {
    where: { patientId_clientRequestId: { patientId: data.patientId, clientRequestId: data.clientRequestId! } },
    create: data,
    update: {},
  };
}

// ─── buildMealLogLookupWhere — dual address, ownership-scoped ────────────────
// The PATCH/DELETE path segment may be the server id (cuid) OR a
// clientRequestId; either resolves the same owned row. Ownership scope
// (patientId) makes it unambiguous cross-patient.

export function buildMealLogLookupWhere(patientId: string, param: string) {
  return { patientId, OR: [{ id: param }, { clientRequestId: param }] };
}

// ─── serializeMealLog — DTO (r1 at this display boundary) ───────────────────

export interface MealLogRow {
  id: string;
  localDate: string;
  mealType: string;
  source: MealLogSource;
  name: string;
  servings: number;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  incomplete: boolean;
  recipeId: string | null;
  customIngredientId: string | null;
  journalMealId: string | null;
  pictureResultId: string | null;
  fridgeRecipeId: string | null;
  note: string | null;
  clientRequestId: string | null;
  deletedAt: Date | null;
  loggedAt: Date;
  updatedAt: Date;
}

export interface MealLogDTO {
  id: string;
  localDate: string;
  mealType: string;
  source: MealLogSource;
  name: string;
  servings: number;
  clientRequestId: string | null;
  perServing: MacroSnapshot;
  totals: MacroSnapshot;
  recipeId: string | null;
  customIngredientId: string | null;
  journalMealId: string | null;
  pictureResultId: string | null;
  fridgeRecipeId: string | null;
  note: string | null;
  deletedAt: string | null;
  loggedAt: string;
  updatedAt: string;
}

function snapshotFromRow(row: MealLogRow): MacroSnapshot {
  return {
    calories: row.calories ?? 0,
    protein: row.protein ?? 0,
    carbs: row.carbs ?? 0,
    fat: row.fat ?? 0,
    fiber: row.fiber ?? 0,
    incomplete: row.incomplete,
  };
}

export function serializeMealLog(row: MealLogRow): MealLogDTO {
  const snap = snapshotFromRow(row);
  return {
    id: row.id,
    localDate: row.localDate,
    mealType: row.mealType,
    source: row.source,
    name: row.name,
    servings: row.servings,
    clientRequestId: row.clientRequestId,
    perServing: scaleSnapshot(snap, 1), // r1 at the display boundary
    totals: scaleSnapshot(snap, row.servings),
    recipeId: row.recipeId,
    customIngredientId: row.customIngredientId,
    journalMealId: row.journalMealId,
    pictureResultId: row.pictureResultId,
    fridgeRecipeId: row.fridgeRecipeId,
    note: row.note,
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    loggedAt: row.loggedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ─── remaining — signed target − totals (null when no target) ───────────────

export interface Remaining {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export function computeRemaining(target: DailyTargets | null, totals: MacroSnapshot): Remaining | null {
  if (!target) return null;
  return {
    calories: r1(target.calories - totals.calories),
    protein: r1(target.protein - totals.protein),
    carbs: r1(target.carbs - totals.carbs),
    fat: r1(target.fat - totals.fat),
  };
}

// ─── Daily target derivation (DB-bound; route helper) ───────────────────────
// Reuse-only: builds the caloric profile exactly as /api/patient/caloric-
// profile does, resolves the macro profile from the patient's conditions/
// motivations, and lets the plan-ramp budget (getPlanDayCalories) win when a
// plan covers the day (basis "plan-ramp"), steady-state otherwise. Returns null
// on an incomplete caloric profile — routes emit dayTarget: null (never a 422).

function resolveSex(sexAtBirth: string | null): Sex | null {
  if (!sexAtBirth) return null;
  const s = sexAtBirth.toLowerCase();
  if (s === "male") return "male";
  if (s === "female") return "female";
  return null;
}

/**
 * @param usePlanRamp when false (range/Stats reads that span many days), the
 *   plan-ramp lookup is skipped and the steady-state target is returned.
 */
export async function getDayTarget(
  patientId: string,
  localDate: string,
  usePlanRamp = true
): Promise<DailyTargets | null> {
  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    include: {
      physicalActivity: true,
      healthConditions: { include: { condition: true } },
      motivations: { include: { motivation: true } },
    },
  });
  if (!patient) return null;
  if (!patient.weight || !patient.height || !patient.birthday || !patient.physicalActivity?.level) return null;
  const sex = resolveSex(patient.sexAtBirth);
  if (!sex) return null;

  const input: CaloricProfileInput = {
    sex,
    birthday: new Date(patient.birthday),
    heightValue: patient.height,
    heightUnit: patient.heightUnit === "in" ? "in" : "cm",
    cbwValue: patient.weight,
    cbwUnit: (patient.weightUnit === "lbs" ? "lbs" : "kg") as "kg" | "lbs",
    activityLevel: patient.physicalActivity.level,
    utbwValue: patient.goalWeight,
    utbwUnit: (patient.goalWeightUnit === "lbs" ? "lbs" : "kg") as "kg" | "lbs" | null,
  };
  const profile = computeAllMetrics(input);
  const anchorStartKg = patient.mealPlanWeight != null ? convertWeight(patient.mealPlanWeight, "lbs").kg : null;
  const weeklyTarget = computeWeeklyTarget({
    profile,
    anchorStartKg,
    planStartDate: patient.mealPlanStartDate ?? null,
  });

  const planDayCalories = usePlanRamp ? await getPlanDayCalories(patientId, localDate) : null;
  const healthConditionNames = patient.healthConditions.map((hc) => hc.condition.name);
  const motivationNames = patient.motivations.map((pm) => pm.motivation.name);

  return resolveDailyTargets(
    { tdeeCBW: profile.tdeeCBW, weeklyTarget },
    healthConditionNames,
    motivationNames,
    planDayCalories
  );
}

// ─── getDayEnvelope — { dayTotals, dayTarget, remaining } for one day ────────
// The shared response fragment returned by every write and the day GET.

export interface DayEnvelope {
  dayTotals: MacroSnapshot;
  dayTarget: DailyTargets | null;
  remaining: Remaining | null;
}

export async function getDayEnvelope(patientId: string, localDate: string): Promise<DayEnvelope> {
  const rows = await prisma.mealLog.findMany({
    where: { patientId, localDate, deletedAt: null },
  });
  const dayTotals = sumMealLogs(rows);
  const dayTarget = await getDayTarget(patientId, localDate);
  const remaining = computeRemaining(dayTarget, dayTotals);
  return { dayTotals, dayTarget, remaining };
}

// ─── Range window guard (Stats range GET) ───────────────────────────────────

export function validateRange(from: string, to: string): ParseResult<{ from: string; to: string }> {
  const f = checkLocalDate(from);
  if (!f.ok) return f;
  const t = checkLocalDate(to);
  if (!t.ok) return t;
  if (from > to) return fail("`from` must be on or before `to`");
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const days = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000) + 1;
  if (days > MAX_RANGE_DAYS) return fail(`range window must be <= ${MAX_RANGE_DAYS} days`);
  return { ok: true, value: { from, to } };
}
