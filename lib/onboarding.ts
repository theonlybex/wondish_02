import { LEVELS, TYPICAL_PILLS, type FullLevelKey, type PillName } from "./level-catalogue";
import {
  USUAL_EATING_KEYS,
  startingPicture as computeStartingPicture,
  type Answer,
  type StartingPicture,
  type UsualEating,
} from "./starting-picture";
import { conditionLabel } from "./condition-groups";

/**
 * Shared onboarding-completeness logic.
 *
 * Both `Account.onboardingComplete` and `Patient.profileCompleted` are
 * `@default(false)` columns that were added after real accounts already
 * existed, and neither was backfilled. So for any account created before those
 * flags shipped, the flags read `false` even though the user has a fully
 * completed profile — which traps them in the onboarding redirect.
 *
 * To decide whether onboarding is genuinely done we therefore look at the real
 * core fields the caloric engine needs, not the (possibly stale) flags. This
 * mirrors the `isProfileComplete` check in app/api/patient/profile/route.ts.
 */

export type ProfileCompletionInput =
  | {
      birthday?: Date | string | null;
      height?: number | null;
      heightFt?: number | null;
      heightIn?: number | null;
      weight?: number | null;
      physicalActivityId?: string | null;
    }
  | null
  | undefined;

export function isProfileComplete(patient: ProfileCompletionInput): boolean {
  if (!patient) return false;
  const pos = (n: number | null | undefined): boolean =>
    n != null && Number.isFinite(n) && n > 0;
  const nonNeg = (n: number | null | undefined): boolean =>
    n != null && Number.isFinite(n) && n >= 0;
  const hasHeight = pos(patient.height) || (pos(patient.heightFt) && nonNeg(patient.heightIn));
  const validBirthday =
    patient.birthday instanceof Date
      ? !Number.isNaN(patient.birthday.getTime())
      : Boolean(patient.birthday);
  return Boolean(validBirthday && hasHeight && pos(patient.weight) && patient.physicalActivityId);
}

// ─── Clara first run: usual eating, pills, starting picture ───────────────────
// Pure functions behind GET/PUT /api/onboarding. The route loads and saves;
// everything decidable lives here so tests need no Prisma or Clerk.

export const PILL_NAMES = Object.keys(TYPICAL_PILLS) as PillName[];
const MAX_PILLS = 20;
export const WEIGHT_GOALS = ["lose", "keep", "gain", "none"] as const;
export type WeightGoal = (typeof WEIGHT_GOALS)[number];

export const emptyUsualEating = (): UsualEating =>
  Object.fromEntries(USUAL_EATING_KEYS.map((k) => [k, null])) as UsualEating;

/** Reads a stored Json value defensively: bad or missing keys become unanswered. */
export function normaliseUsualEating(raw: unknown): UsualEating {
  const out = emptyUsualEating();
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const k of USUAL_EATING_KEYS) {
      const v = (raw as Record<string, unknown>)[k];
      if (v === 0 || v === 1 || v === 2) out[k] = v;
    }
  }
  return out;
}

export interface OnboardingPutValue {
  /** Only the keys sent; null clears an answer, an absent key is left alone. */
  usualEating?: Partial<UsualEating>;
  pills?: PillName[];
  weightGoal?: WeightGoal | null;
  noCondition?: boolean;
}

export type OnboardingValidation =
  | { ok: true; value: OnboardingPutValue }
  | { ok: false; error: string; field: string };

/**
 * Hand-written validation for PUT /api/onboarding. Every key is optional.
 * A usualEating object is merged over the stored answers: keys it leaves out are
 * unchanged, an explicit null clears one.
 */
export function validateOnboardingBody(body: unknown): OnboardingValidation {
  const fail = (field: string, error: string): OnboardingValidation => ({ ok: false, error, field });
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return fail("body", "Send a JSON object.");
  }
  const b = body as Record<string, unknown>;
  const value: OnboardingPutValue = {};

  if (b.usualEating !== undefined) {
    const u = b.usualEating;
    if (u === null || typeof u !== "object" || Array.isArray(u)) {
      return fail("usualEating", "usualEating must be an object.");
    }
    const out: Partial<UsualEating> = {};
    for (const [k, v] of Object.entries(u as Record<string, unknown>)) {
      if (!(USUAL_EATING_KEYS as readonly string[]).includes(k)) return fail("usualEating", `Unknown answer "${k}".`);
      if (v !== null && v !== 0 && v !== 1 && v !== 2) return fail("usualEating", `${k} must be 0, 1, 2 or null.`);
      out[k as keyof UsualEating] = v as Answer;
    }
    value.usualEating = out;
  }

  if (b.pills !== undefined) {
    if (!Array.isArray(b.pills)) return fail("pills", "pills must be a list of names.");
    if (b.pills.length > MAX_PILLS) return fail("pills", `pills must have at most ${MAX_PILLS} entries.`);
    const seen = new Set<PillName>();
    for (const p of b.pills) {
      if (typeof p !== "string" || !(PILL_NAMES as string[]).includes(p)) return fail("pills", "Unknown pill name.");
      seen.add(p as PillName);
    }
    value.pills = [...seen];
  }

  if (b.weightGoal !== undefined) {
    if (b.weightGoal !== null && !(WEIGHT_GOALS as readonly unknown[]).includes(b.weightGoal)) {
      return fail("weightGoal", "weightGoal must be lose, keep, gain, none or null.");
    }
    value.weightGoal = b.weightGoal as WeightGoal | null;
  }

  if (b.noCondition !== undefined) {
    if (typeof b.noCondition !== "boolean") return fail("noCondition", "noCondition must be true or false.");
    value.noCondition = b.noCondition;
  }

  return { ok: true, value };
}

// The common-condition chips, in display order, matched to database names. Names come from
// lib/condition-groups.ts. Matching is on a folded name.
const CHIPS: { label: string; names: string[] }[] = [
  { label: "Type 2 diabetes", names: ["Type 2 Diabetes"] },
  { label: "High blood pressure", names: ["Hypertension"] },
  { label: "High cholesterol", names: ["High Cholesterol"] },
  { label: "Acid reflux (GERD)", names: ["GERD"] },
  { label: "IBS (constipation)", names: ["IBS-C"] },
  { label: "IBS (diarrhoea)", names: ["IBS-D"] },
  { label: "IBS (mixed)", names: ["IBS-M"] },
  { label: "Celiac disease", names: ["Celiac Disease"] },
  { label: "Kidney disease", names: ["Chronic Kidney Disease stage 1-2"] },
  { label: "PCOS", names: ["PCOS"] },
  { label: "Fatty liver", names: ["Fatty Liver Disease (NAFLD)"] },
  { label: "Migraine", names: ["Migraine"] },
];
const fold = (s: string) => s.trim().toLowerCase().replace(/[\u2010-\u2015]/g, "-").replace(/\s+/g, " ");

export interface ConditionChip { id: string; name: string; common: boolean; label: string }

/** Every condition, with `common` marking the chips (chip label as `label`). */
export function commonConditions(all: { id: string; name: string }[]): ConditionChip[] {
  const byName = new Map(all.map((c) => [fold(c.name), c]));
  const chips: ConditionChip[] = [];
  for (const chip of CHIPS) {
    const row = byName.get(fold(chip.names[0]));
    if (row) chips.push({ id: row.id, name: row.name, common: true, label: chip.label });
  }
  const chipIds = new Set(chips.map((c) => c.id));
  const rest = all
    .filter((c) => !chipIds.has(c.id))
    .map((c) => ({ id: c.id, name: c.name, common: false, label: conditionLabel(c.name) }));
  return [...chips, ...rest];
}

export interface PillRow { id: string; name: string; estimated: boolean; contents?: unknown }

/** The catalogue pill a stored name stands for (folded match), or undefined. */
export function catalogueNameOf(name: string): PillName | undefined {
  return PILL_NAMES.find((n) => fold(n) === fold(name));
}

/**
 * The starting picture as it is NOW: computed from the stored answers and the
 * live catalogue pills, so pills changed elsewhere (e.g. /api/supplements)
 * never leave a stale picture. Null when the person has never answered.
 */
export function currentStartingPicture(usualEating: unknown, liveSupplementNames: string[]): StartingPicture | null {
  if (usualEating == null) return null;
  const pills = liveSupplementNames.map(catalogueNameOf).filter((n): n is PillName => !!n);
  return computeStartingPicture(normaliseUsualEating(usualEating), pills);
}

/**
 * Which pill rows to create and which to soft-delete so the live catalogue
 * pills match the requested names. The list is authoritative for the seven
 * catalogue names: a live catalogue-named pill that is not listed is removed,
 * edited or not; a name already live creates nothing. Supplements with other
 * names are never touched.
 */
export function reconcilePills(
  existing: PillRow[],
  requestedNames: PillName[],
): { create: PillName[]; softDelete: string[] } {
  const want = new Set(requestedNames.map(fold));
  const isCatalogue = (name: string) => PILL_NAMES.some((n) => fold(n) === fold(name));
  const have = new Set(existing.map((e) => fold(e.name)));
  const create = requestedNames.filter((n, i) => !have.has(fold(n)) && requestedNames.indexOf(n) === i);
  const softDelete = existing.filter((e) => isCatalogue(e.name) && !want.has(fold(e.name))).map((e) => e.id);
  return { create, softDelete };
}

export interface OnboardingPatientUpdate {
  usualEating?: UsualEating;
  startingPicture: StartingPicture;
  weightGoal?: WeightGoal | null;
  noCondition?: boolean;
}

/** Everything a PUT will write, decided without touching the database. */
export function planOnboardingPut(
  value: OnboardingPutValue,
  current: { usualEating: unknown; supplements: PillRow[] },
): {
  patientData: OnboardingPatientUpdate;
  pillOps: { create: PillName[]; softDelete: string[]; fillContents: { id: string; name: PillName }[] };
  removeBuiltInConditions: boolean;
} {
  const merged: UsualEating = { ...normaliseUsualEating(current.usualEating), ...(value.usualEating ?? {}) };
  const livePillNames = current.supplements
    .map((s) => PILL_NAMES.find((n) => fold(n) === fold(s.name)))
    .filter((n): n is PillName => !!n);
  const reconciled = value.pills ? reconcilePills(current.supplements, value.pills) : { create: [], softDelete: [] };
  // A live catalogue-named pill with no contents gets the typical ones, so it counts on Numbers.
  const fillContents = current.supplements.flatMap((s) => {
    const name = catalogueNameOf(s.name);
    return name && s.contents == null && !reconciled.softDelete.includes(s.id) ? [{ id: s.id, name }] : [];
  });
  const pillOps = { ...reconciled, fillContents };
  const finalPills: PillName[] = value.pills ?? livePillNames;
  const patientData: OnboardingPatientUpdate = { startingPicture: computeStartingPicture(merged, finalPills) };
  if (value.usualEating && Object.keys(value.usualEating).length > 0) patientData.usualEating = merged;
  if (value.weightGoal !== undefined) patientData.weightGoal = value.weightGoal;
  if (value.noCondition !== undefined) patientData.noCondition = value.noCondition;
  return { patientData, pillOps, removeBuiltInConditions: value.noCondition === true };
}

const LB_TO_KG = 0.45359237;
const nameOf = (key: string) => LEVELS.find((l) => l.key === key)?.name ?? key;

export interface OnboardingPatientRow {
  birthday: Date | string | null;
  sexAtBirth: string | null;
  height: number | null; // cm, or inches when heightUnit is "in"
  heightUnit?: string | null; // "cm" | "in" | "ftin"
  weight: number | null; // lbs
  physicalActivityId: string | null;
  usualEating: unknown;
  startingPicture: unknown;
  weightGoal: string | null;
  noCondition: boolean;
  conditionIds: string[];
  allergyIds: string[];
  // Present on the row but unused here; lets callers pass the whole Prisma row.
  heightFt?: number | null;
  heightIn?: number | null;
}

const CM_PER_INCH = 2.54;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Height in cm from however it was stored: cm as is, inches, or feet and inches. */
export function heightToCm(p: {
  height: number | null;
  heightUnit?: string | null;
  heightFt?: number | null;
  heightIn?: number | null;
}): number | null {
  const ok = (n: number | null | undefined): n is number => n != null && Number.isFinite(n);
  const positive = (n: number): number | null => (Number.isFinite(n) && n > 0 ? round1(n) : null);
  if (p.heightUnit === "ftin") {
    if (ok(p.heightFt)) return positive((p.heightFt * 12 + (ok(p.heightIn) ? p.heightIn : 0)) * CM_PER_INCH);
    return ok(p.height) ? positive(p.height) : null;
  }
  if (!ok(p.height)) return null;
  return positive(p.heightUnit === "in" ? p.height * CM_PER_INCH : p.height);
}

export function buildOnboardingResponse(input: {
  conditions: { id: string; name: string }[];
  allergies: { id: string; name: string }[];
  activities: { id: string; name: string }[];
  patient: OnboardingPatientRow | null;
  pills: string[];
}) {
  const { patient } = input;
  const conditions = commonConditions(input.conditions);
  const knownConditions = new Set(input.conditions.map((c) => c.id));
  const conditionIds = (patient?.conditionIds ?? []).filter((id) => knownConditions.has(id));
  const live = currentStartingPicture(patient?.usualEating, input.pills);
  const named = (keys: unknown) =>
    (Array.isArray(keys) ? keys : [])
      .filter((k): k is FullLevelKey => typeof k === "string" && LEVELS.some((l) => l.key === k))
      .map((key) => ({ key, name: nameOf(key) }));
  const birthday =
    patient?.birthday == null
      ? null
      : new Date(patient.birthday).toISOString().slice(0, 10);
  return {
    complete: isProfileComplete(patient),
    conditions,
    allergies: input.allergies,
    activities: input.activities,
    profile: {
      conditionIds,
      noCondition: (patient?.noCondition ?? false) && conditionIds.length === 0,
      birthday,
      sexAtBirth: patient?.sexAtBirth ?? null,
      heightCm: patient ? heightToCm(patient) : null,
      weightKg: patient?.weight == null ? null : Math.round(patient.weight * LB_TO_KG * 10) / 10,
      activityId: patient?.physicalActivityId ?? null,
      allergyIds: patient?.allergyIds ?? [],
    },
    usualEating: normaliseUsualEating(patient?.usualEating),
    pills: [...new Set(input.pills.map(catalogueNameOf).filter((n): n is PillName => !!n))],
    weightGoal: (patient?.weightGoal ?? null) as WeightGoal | null,
    startingPicture: { little: named(live?.little), aLot: named(live?.aLot) },
  };
}
