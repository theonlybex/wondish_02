// User-defined health conditions (spec docs/superpowers/specs/2026-09-11-custom-conditions-design.md).
// Pure validation + helpers; the routes under app/api/patient/conditions do
// the database work. Kept free of Prisma so it is unit-testable.
import { normalizeBannedIngredientName } from "./diet-match";

export const CUSTOM_CONDITION_LIMITS = {
  perPatient: 10,
  nameMin: 2,
  nameMax: 60,
  avoidMax: 40,
  avoidNameMax: 60,
  guidanceMax: 300,
  symptomsMax: 10,
  symptomMin: 2,
  symptomMax: 40,
} as const;

export interface CustomConditionInput {
  name: string;
  avoid: string[];
  guidance: string | null;
  symptoms: string[];
}
export type CustomConditionField = "name" | "avoid" | "guidance" | "symptoms";
export type CustomConditionValidation =
  | { ok: true; value: CustomConditionInput }
  | { ok: false; error: string; field: CustomConditionField };

const collapse = (s: string) => s.trim().replace(/\s+/g, " ");
const HAS_LETTER_RE = new RegExp("\\p{L}", "u");

function stringList(raw: unknown): string[] | null {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return null;
  return raw.map((v) => (typeof v === "string" ? v : "")).map(collapse).filter(Boolean);
}

function dedupe(list: string[]): string[] {
  const seen = new Set<string>();
  return list.filter((v) => {
    const k = v.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function validateCustomCondition(body: unknown): CustomConditionValidation {
  const L = CUSTOM_CONDITION_LIMITS;
  const b = (body ?? {}) as Record<string, unknown>;

  const name = typeof b.name === "string" ? collapse(b.name) : "";
  if (name.length < L.nameMin || !HAS_LETTER_RE.test(name)) return { ok: false, field: "name", error: "Give the condition a name (at least 2 letters)." };
  if (name.length > L.nameMax) return { ok: false, field: "name", error: `Name must be ${L.nameMax} characters or fewer.` };

  const avoidRaw = stringList(b.avoid);
  if (!avoidRaw) return { ok: false, field: "avoid", error: "Ingredients to avoid must be a list of names." };
  const avoid: string[] = [];
  for (const raw of avoidRaw) {
    const n = normalizeBannedIngredientName(raw);
    if (!n) return { ok: false, field: "avoid", error: `"${raw}" is not an ingredient name (at least 2 characters).` };
    if (n.length > L.avoidNameMax) return { ok: false, field: "avoid", error: `"${n.slice(0, 20)}…" is too long (max ${L.avoidNameMax} characters).` };
    avoid.push(n);
  }
  const avoidUnique = dedupe(avoid);
  if (avoidUnique.length > L.avoidMax) return { ok: false, field: "avoid", error: `Up to ${L.avoidMax} ingredients per condition.` };

  let guidance: string | null = null;
  if (b.guidance != null && b.guidance !== "") {
    if (typeof b.guidance !== "string") return { ok: false, field: "guidance", error: "Guidance must be text." };
    guidance = collapse(b.guidance) || null;
    if (guidance && guidance.length > L.guidanceMax) return { ok: false, field: "guidance", error: `Guidance must be ${L.guidanceMax} characters or fewer.` };
  }

  const symptomsRaw = stringList(b.symptoms);
  if (!symptomsRaw) return { ok: false, field: "symptoms", error: "Symptoms must be a list of labels." };
  for (const s of symptomsRaw) {
    if (s.length < L.symptomMin || !HAS_LETTER_RE.test(s)) return { ok: false, field: "symptoms", error: `"${s}" is not a symptom label (at least 2 letters).` };
    if (s.length > L.symptomMax) return { ok: false, field: "symptoms", error: `"${s.slice(0, 20)}…" is too long (max ${L.symptomMax} characters).` };
  }
  const symptoms = dedupe(symptomsRaw);
  if (symptoms.length > L.symptomsMax) return { ok: false, field: "symptoms", error: `Up to ${L.symptomsMax} symptoms per condition.` };

  return { ok: true, value: { name, avoid: avoidUnique, guidance, symptoms } };
}

// ConditionTrackingItem.itemCode for a user label: "Brain fog" → "BRAIN_FOG".
export function symptomItemCode(label: string): string {
  const code = label
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "") // accents → base letters ("Náusea" → "Nausea")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  return code || "SYMPTOM";
}

// ConditionTrackingItem.code is globally unique ("JT-0108" for workbook rows).
export const customTrackingCode = (uuid: string) => `CUST-${uuid}`;

// Case-insensitive label match used when syncing a condition's symptom list.
export const sameLabel = (a: string, b: string) => collapse(a).toLowerCase() === collapse(b).toLowerCase();
