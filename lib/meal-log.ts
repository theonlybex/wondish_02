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
import { formatLocalDate, MEAL_TYPES, type MealType } from "@/lib/local-date";

// ─── Constants / allow-lists ────────────────────────────────────────────────

// Re-exported from the pure lib/local-date.ts module so existing importers of
// these names (routes, lib/meal-log.test.ts) are untouched, while the single
// source of truth lives in the client-safe module.
export { formatLocalDate, MEAL_TYPES };
export type { MealType };

export const MEAL_LOG_SOURCES = Object.values(MealLogSource) as MealLogSource[];

const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/; // anchored (audit T1) — format only
// Exported: lib/fridge.ts imports these bounds so its parseFridgeRecipes
// clamp matches exactly what /api/meal-log accepts for caller-supplied macros.
export const MAX_SERVINGS = 50;
export const MAX_MACRO = 10000;
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

// formatLocalDate now lives in lib/local-date.ts (pure, client-safe) and is
// re-exported above; the write paths call the same single implementation.

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
  name?: string; // absent → server defaults from recipe/custom-ingredient/dish (RECIPE/CUSTOM/RESTAURANT only)
  servings: number;
  perServing?: PerServingInput; // MANUAL / PICTURE / FRIDGE
  recipeId?: string;
  customIngredientId?: string;
  restaurantDishId?: string;
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

  // name: required for MANUAL/PICTURE/FRIDGE; optional (server-defaulted) for RECIPE/CUSTOM/RESTAURANT.
  const nameProvided = raw.name !== undefined && raw.name !== null;
  if (nameProvided) {
    const n = checkName(raw.name);
    if (!n.ok) return n;
    item.name = n.value;
  }

  // restaurantDishId is only meaningful for source RESTAURANT — reject the
  // mismatch outright rather than silently dropping it (unlike recipeId,
  // which is allowed as opaque passthrough provenance on MANUAL/PICTURE/FRIDGE).
  if (source !== MealLogSource.RESTAURANT && optionalString(raw.restaurantDishId)) {
    return fail("restaurantDishId is only valid for source RESTAURANT");
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
  } else if (source === MealLogSource.RESTAURANT) {
    const restaurantDishId = optionalString(raw.restaurantDishId);
    if (!restaurantDishId) return fail("restaurantDishId is required for source RESTAURANT");
    item.restaurantDishId = restaurantDishId;
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
// `source`. RECIPE and RESTAURANT both price server-side from a whole-dish
// macro row (client macros ignored — trust boundary); CUSTOM stores the
// ingredient's per-unit macros verbatim (servings is the sole multiplier,
// applied once at read); MANUAL/PICTURE/FRIDGE use caller macros. Fetching the
// recipe / custom-ingredient / restaurant dish (and the CUSTOM premium gate) is
// the route's job; this function is pure over the already-fetched deps.

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
  unit?: string | null; // carried onto the DTO for the servings label (× 2 cups)
}
// RestaurantDish macro columns are WHOLE-DISH (schema comment: "not per-serving
// like Recipe/MealLog") — there is no dish-level servings divisor, so the dish
// itself IS one serving. Reusing recipeToPerServing with no `servings` field
// divides by the function's implicit default of 1, which is exactly this
// posture, and reuses the identical null→0 + `incomplete` (calories==null)
// semantics the RECIPE path already has — no new pricing logic needed.
export interface RestaurantDishDep {
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  fiber?: number | null;
  name: string;
}

export function resolveSnapshot(
  input: ParsedMealLog,
  deps: { recipe?: RecipeDep; customIngredient?: CustomIngredientDep; restaurantDish?: RestaurantDishDep }
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
  if (input.source === MealLogSource.RESTAURANT) {
    const dish = deps.restaurantDish;
    if (!dish) throw new Error("resolveSnapshot: RESTAURANT source requires a restaurantDish dep");
    return { snapshot: recipeToPerServing(dish), name: input.name ?? dish.name };
  }
  // MANUAL / PICTURE / FRIDGE — name guaranteed present by validation.
  return { snapshot: snapshotFromMacros(input.perServing ?? {}), name: input.name! };
}

// ─── buildMealLogCreateData ─────────────────────────────────────────────────
// The per-serving snapshot is stored UNROUNDED so N-servings totals re-sum
// exactly; rounding (r1) happens only at serialization/aggregation.

export interface MacroColumns {
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  incomplete: boolean;
}

// Caller-supplied macro sources: the client hands over per-serving macros
// directly (vs. RECIPE/CUSTOM/RESTAURANT, which the server prices from a stored row).
const CALLER_SUPPLIED_SOURCES: ReadonlySet<MealLogSource> = new Set([
  MealLogSource.MANUAL,
  MealLogSource.PICTURE,
  MealLogSource.FRIDGE,
]);

// True when the client owns this source's per-serving macros (create AND edit).
// RECIPE/CUSTOM/RESTAURANT are server-priced, so a client-supplied perServing
// must never overwrite their stored snapshot — the PATCH route guards on this too.
export function isCallerSuppliedMacroSource(source: MealLogSource): boolean {
  return CALLER_SUPPLIED_SOURCES.has(source);
}

// Column values for a caller-supplied per-serving payload. An ABSENT field
// (dropped by checkPerServing) is stored as NULL — genuinely unset — not 0, and
// `incomplete` flags when any of the five is absent. This is the write half of
// the null/0 distinction the modal reads back via perServingFromRow. RECIPE,
// CUSTOM, and RESTAURANT never come through here — their priced snapshot is
// stored verbatim.
export function nullableMacroColumns(perServing: PerServingInput | undefined): MacroColumns {
  const ps = perServing ?? {};
  const out: MacroColumns = { calories: null, protein: null, carbs: null, fat: null, fiber: null, incomplete: false };
  for (const key of MACRO_KEYS) {
    const v = ps[key];
    if (v == null) out.incomplete = true;
    else out[key] = v;
  }
  return out;
}

export interface MealLogCreateData {
  patientId: string;
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
  restaurantDishId: string | null;
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
  // Caller-supplied sources store null for absent fields (unknown ≠ 0);
  // RECIPE/CUSTOM/RESTAURANT store the server-priced snapshot verbatim.
  const cols: MacroColumns = CALLER_SUPPLIED_SOURCES.has(input.source)
    ? nullableMacroColumns(input.perServing)
    : { calories: s.calories, protein: s.protein, carbs: s.carbs, fat: s.fat, fiber: s.fiber, incomplete: s.incomplete };
  return {
    patientId,
    localDate: input.localDate,
    mealType: input.mealType,
    source: input.source,
    name: resolved.name,
    servings: input.servings,
    calories: cols.calories,
    protein: cols.protein,
    carbs: cols.carbs,
    fat: cols.fat,
    fiber: cols.fiber,
    incomplete: cols.incomplete,
    recipeId: input.recipeId ?? null,
    restaurantDishId: input.restaurantDishId ?? null,
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
  restaurantDishId: string | null;
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

// Per-field-nullable per-serving view. A macro is `null` when the row's column
// is genuinely UNSET (unknown / unpriced), and a number (r1-rounded) when it
// was recorded — the distinction the edit modal needs so a blank field stays
// blank on prefill and a re-save keeps it null rather than silently becoming 0.
// `totals` (summation) keeps its 0-coercing MacroSnapshot semantics unchanged.
export interface NullableMacroSnapshot {
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  incomplete: boolean;
}

export interface MealLogDTO {
  id: string;
  localDate: string;
  mealType: string;
  source: MealLogSource;
  name: string;
  servings: number;
  unit: string | null; // ingredient unit for CUSTOM rows (joined at read); null otherwise
  clientRequestId: string | null;
  perServing: NullableMacroSnapshot;
  totals: MacroSnapshot;
  recipeId: string | null;
  restaurantDishId: string | null;
  customIngredientId: string | null;
  journalMealId: string | null;
  pictureResultId: string | null;
  fridgeRecipeId: string | null;
  note: string | null;
  deletedAt: string | null;
  loggedAt: string;
  updatedAt: string;
}

// Totals view: null columns coerce to 0 for summation (unchanged semantics).
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

// Per-serving view: PRESERVES null (r1 only present values). This is what lets
// the modal distinguish "unset" from an explicit 0.
function perServingFromRow(row: MealLogRow): NullableMacroSnapshot {
  const round = (v: number | null) => (v == null ? null : r1(v));
  return {
    calories: round(row.calories),
    protein: round(row.protein),
    carbs: round(row.carbs),
    fat: round(row.fat),
    fiber: round(row.fiber),
    incomplete: row.incomplete,
  };
}

// `unit` is passed by the read path for CUSTOM rows (the PatientCustomIngredient
// has no MealLog relation, so it is looked up separately — see
// buildCustomUnitMap; defaults null for every other source/read).
export function serializeMealLog(row: MealLogRow, unit: string | null = null): MealLogDTO {
  const snap = snapshotFromRow(row);
  return {
    id: row.id,
    localDate: row.localDate,
    mealType: row.mealType,
    source: row.source,
    name: row.name,
    servings: row.servings,
    unit: row.source === MealLogSource.CUSTOM ? unit : null,
    clientRequestId: row.clientRequestId,
    perServing: perServingFromRow(row), // r1 at boundary, null preserved
    totals: scaleSnapshot(snap, row.servings),
    recipeId: row.recipeId,
    restaurantDishId: row.restaurantDishId,
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

// ─── buildCustomUnitMap — CUSTOM rows → ingredient unit label (DB-bound) ─────
// PatientCustomIngredient carries the freeform `unit` a CUSTOM row's `servings`
// counts in ("2 cups"), but MealLog has no Prisma relation to it (schema is not
// changed — no migration). A single keyed lookup over the CUSTOM rows on a page
// resolves the labels at read time. Ownership-scoped by patientId. Follows the
// T11/T12 convention — DB-bound, verified against the branch, not the unit sweep.

export async function buildCustomUnitMap(
  patientId: string,
  rows: readonly { source: MealLogSource; customIngredientId: string | null }[]
): Promise<Map<string, string | null>> {
  const ids = rows
    .filter((r) => r.source === MealLogSource.CUSTOM && r.customIngredientId)
    .map((r) => r.customIngredientId as string);
  if (ids.length === 0) return new Map();
  const ingredients = await prisma.patientCustomIngredient.findMany({
    where: { id: { in: Array.from(new Set(ids)) }, patientId },
    select: { id: true, unit: true },
  });
  return new Map(ingredients.map((ci) => [ci.id, ci.unit]));
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

// ─── Delta-sync cursor — compound (updatedAt, id), tie-break safe ──────────
// `updatedAt` alone is NOT a unique cursor key: a batch write (POST /batch)
// runs inside one $transaction and can land several rows with an identical
// (or millisecond-colliding) `updatedAt`. A plain `gt: lastUpdatedAt` cursor
// silently drops the remainder of that cluster whenever it straddles the
// DELTA_PAGE_SIZE page boundary — the client's next `updatedAt > cursor`
// query starts strictly after the boundary row and never revisits siblings
// that shared its timestamp. Tie-breaking on `id` (unique, monotonic per
// insert order via cuid) closes the gap: rows are ordered
// [updatedAt asc, id asc] and paged with
// `updatedAt > cursor.updatedAt OR (updatedAt = cursor.updatedAt AND id > cursor.id)`.
//
// Wire format: the cursor is OPAQUE to the client — a base64url encoding of
// `JSON.stringify({ u: updatedAt.toISOString(), i: id })`. JSON + base64url
// (not a raw `${iso}_${id}` join) sidesteps any need to reason about whether
// a cuid can contain the separator: there is no separator to collide with.
//
// External contract (UNCHANGED shape/param): the single `?updatedSince=`
// query param still means "give me everything after this instant" on the
// FIRST request, and the response is still `{ logs, nextCursor }`. What
// changes is only the CONTENT of `nextCursor` — it is now this opaque
// compound string instead of a plain ISO timestamp. A follow-up page is
// requested by echoing that `nextCursor` value back as `updatedSince`;
// `parseDeltaSyncParam` recognizes it as a compound cursor (vs. a plain
// ISO-8601 string) and resumes from the exact (updatedAt, id) boundary. This
// avoids introducing a second required query param that an in-flight iOS
// client wouldn't yet know to send.

export interface DeltaCursor {
  updatedAt: Date;
  id: string;
}

export function encodeDeltaCursor(updatedAt: Date, id: string): string {
  const json = JSON.stringify({ u: updatedAt.toISOString(), i: id });
  return Buffer.from(json, "utf8").toString("base64url");
}

export function decodeDeltaCursor(raw: string): DeltaCursor | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  let json: string;
  try {
    json = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    return null;
  }
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isObj(obj) || typeof obj.u !== "string" || typeof obj.i !== "string" || obj.i.length === 0) {
    return null;
  }
  const updatedAt = new Date(obj.u);
  if (Number.isNaN(updatedAt.getTime())) return null;
  return { updatedAt, id: obj.i };
}

export interface DeltaSyncParam {
  since: Date; // the `updatedAt` threshold to page from (cursor's, or the plain ISO on page 1)
  cursor: DeltaCursor | null; // non-null once paginating past page 1
}

// Parses the `?updatedSince=` query param. It is either a plain ISO-8601
// timestamp (first page) or an opaque compound cursor echoed back from a
// prior `nextCursor` (subsequent pages). Anything else → 400.
export function parseDeltaSyncParam(raw: string | null): ParseResult<DeltaSyncParam> {
  if (raw == null || raw === "") {
    return fail("updatedSince is required");
  }
  const cursor = decodeDeltaCursor(raw);
  if (cursor) return { ok: true, value: { since: cursor.updatedAt, cursor } };
  const since = new Date(raw);
  if (Number.isNaN(since.getTime())) {
    return fail("updatedSince must be an ISO-8601 timestamp or a valid cursor");
  }
  return { ok: true, value: { since, cursor: null } };
}

export type DeltaWhere =
  | { patientId: string; updatedAt: { gt: Date } }
  | { patientId: string; OR: [{ updatedAt: { gt: Date } }, { updatedAt: Date; id: { gt: string } }] };

// Prisma where-clause for one delta page. First page: plain `updatedAt >
// since`. Subsequent pages: compound tie-break so a same-timestamp cluster
// straddling the page boundary is never split.
export function buildDeltaWhere(patientId: string, param: DeltaSyncParam): DeltaWhere {
  if (!param.cursor) {
    return { patientId, updatedAt: { gt: param.since } };
  }
  const { updatedAt, id } = param.cursor;
  return {
    patientId,
    OR: [{ updatedAt: { gt: updatedAt } }, { updatedAt, id: { gt: id } }],
  };
}

// Matching orderBy — MUST pair with buildDeltaWhere for a stable total order.
export const DELTA_ORDER_BY = [{ updatedAt: "asc" as const }, { id: "asc" as const }];

// Opaque compound nextCursor for the next page, or null when this page was
// short (no more rows).
export function buildNextDeltaCursor(rows: readonly { updatedAt: Date; id: string }[]): string | null {
  if (rows.length !== DELTA_PAGE_SIZE) return null;
  const last = rows[rows.length - 1];
  return encodeDeltaCursor(last.updatedAt, last.id);
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
