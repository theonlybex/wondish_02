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
  usualEating?: UsualEating;
  pills?: PillName[];
  weightGoal?: WeightGoal | null;
  noCondition?: boolean;
}

export type OnboardingValidation =
  | { ok: true; value: OnboardingPutValue }
  | { ok: false; error: string; field: string };

/**
 * Hand-written validation for PUT /api/onboarding. Every key is optional.
 * A usualEating object replaces the stored one; keys it leaves out are unanswered.
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
    const out = emptyUsualEating();
    for (const [k, v] of Object.entries(u as Record<string, unknown>)) {
      if (!(USUAL_EATING_KEYS as readonly string[]).includes(k)) return fail("usualEating", `Unknown answer "${k}".`);
      if (v !== null && v !== 0 && v !== 1 && v !== 2) return fail("usualEating", `${k} must be 0, 1, 2 or null.`);
      out[k as keyof UsualEating] = v as Answer;
    }
    value.usualEating = out;
  }

  if (b.pills !== undefined) {
    if (!Array.isArray(b.pills)) return fail("pills", "pills must be a list of names.");
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

// The ten chips, in display order, matched to database names. Names come from
// lib/condition-groups.ts. Matching is on a folded name; the first listed name
// that exists wins. IBS maps to IBS-M (the unspecified-pattern row).
const CHIPS: { label: string; names: string[] }[] = [
  { label: "Type 2 diabetes", names: ["Type 2 Diabetes"] },
  { label: "High blood pressure", names: ["Hypertension"] },
  { label: "High cholesterol", names: ["High Cholesterol"] },
  { label: "Acid reflux (GERD)", names: ["GERD"] },
  { label: "IBS", names: ["IBS-M"] },
  { label: "Celiac disease", names: ["Celiac Disease"] },
  { label: "Kidney disease", names: ["Chronic Kidney Disease stage 1-2"] },
  { label: "PCOS", names: ["PCOS"] },
  { label: "Fatty liver", names: ["Fatty Liver Disease (NAFLD)"] },
  { label: "Migraine", names: ["Migraine"] },
];
const fold = (s: string) => s.trim().toLowerCase().replace(/[\u2010-\u2015]/g, "-").replace(/\s+/g, " ");

export interface ConditionChip { id: string; name: string; common: boolean; label: string }

/** Every condition, with `common` marking the ten chips (chip label as `label`). */
export function commonConditions(all: { id: string; name: string }[]): ConditionChip[] {
  const byName = new Map(all.map((c) => [fold(c.name), c]));
  const chipFor = new Map<string, string>(); // condition id -> chip label
  for (const chip of CHIPS) {
    for (const n of chip.names) {
      const hit = byName.get(fold(n));
      if (hit) {
        chipFor.set(hit.id, chip.label);
        break;
      }
    }
  }
  const chips = CHIPS.flatMap((chip) => {
    const id = [...chipFor].find(([, l]) => l === chip.label)?.[0];
    const row = id ? all.find((c) => c.id === id) : undefined;
    return row ? [{ id: row.id, name: row.name, common: true, label: chip.label }] : [];
  });
  const chipIds = new Set(chips.map((c) => c.id));
  const rest = all
    .filter((c) => !chipIds.has(c.id))
    .map((c) => ({ id: c.id, name: c.name, common: false, label: conditionLabel(c.name) }));
  return [...chips, ...rest];
}

export interface PillRow { id: string; name: string; estimated: boolean }

/**
 * Which pill rows to create and which to soft-delete so the live rows match the
 * requested names. A name that already exists (edited or not) creates nothing.
 * Only typical-dose rows (estimated) with a catalogue name are removed; a pill
 * the person edited (estimated = false) is never touched.
 */
export function reconcilePills(
  existing: PillRow[],
  requestedNames: PillName[],
): { create: PillName[]; softDelete: string[] } {
  const want = new Set(requestedNames.map(fold));
  const have = new Set(existing.map((e) => fold(e.name)));
  const create = requestedNames.filter((n, i) => !have.has(fold(n)) && requestedNames.indexOf(n) === i);
  const softDelete = existing
    .filter((e) => e.estimated && (PILL_NAMES as string[]).some((n) => fold(n) === fold(e.name)) && !want.has(fold(e.name)))
    .map((e) => e.id);
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
): { patientData: OnboardingPatientUpdate; pillOps: { create: PillName[]; softDelete: string[] } } {
  const usualEating = value.usualEating ?? normaliseUsualEating(current.usualEating);
  const livePillNames = current.supplements
    .map((s) => PILL_NAMES.find((n) => fold(n) === fold(s.name)))
    .filter((n): n is PillName => !!n);
  const pillOps = value.pills ? reconcilePills(current.supplements, value.pills) : { create: [], softDelete: [] };
  const finalPills: PillName[] = value.pills
    ? [...new Set([...value.pills, ...livePillNames.filter((n) => current.supplements.some((s) => !s.estimated && fold(s.name) === fold(n)))])]
    : livePillNames;
  const patientData: OnboardingPatientUpdate = { startingPicture: computeStartingPicture(usualEating, finalPills) };
  if (value.usualEating) patientData.usualEating = value.usualEating;
  if (value.weightGoal !== undefined) patientData.weightGoal = value.weightGoal;
  if (value.noCondition !== undefined) patientData.noCondition = value.noCondition;
  return { patientData, pillOps };
}

const LB_TO_KG = 0.45359237;
const nameOf = (key: string) => LEVELS.find((l) => l.key === key)?.name ?? key;

export interface OnboardingPatientRow {
  birthday: Date | string | null;
  sexAtBirth: string | null;
  height: number | null; // cm
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
  const stored = (patient?.startingPicture ?? null) as Partial<StartingPicture> | null;
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
      conditionIds: (patient?.conditionIds ?? []).filter((id) => knownConditions.has(id)),
      noCondition: patient?.noCondition ?? false,
      birthday,
      sexAtBirth: patient?.sexAtBirth ?? null,
      heightCm: patient?.height ?? null,
      weightKg: patient?.weight == null ? null : Math.round(patient.weight * LB_TO_KG * 10) / 10,
      activityId: patient?.physicalActivityId ?? null,
      allergyIds: patient?.allergyIds ?? [],
    },
    usualEating: normaliseUsualEating(patient?.usualEating),
    pills: input.pills.filter((n): n is PillName => (PILL_NAMES as string[]).includes(n)),
    weightGoal: (patient?.weightGoal ?? null) as WeightGoal | null,
    startingPicture: { little: named(stored?.little), aLot: named(stored?.aLot) },
  };
}
