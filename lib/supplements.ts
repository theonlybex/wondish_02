// Pure validation for the /api/supplements routes, following lib/journal.ts:
// routes stay thin, everything decidable without Prisma lives (and is tested) here.
import { parseLocalDateStrict } from "./journal";
import { LEVELS, type FullLevelKey, type PillContent } from "./level-catalogue";

export type SupplementTimeSlot = "MORNING" | "AFTERNOON" | "EVENING";
const TIME_SLOTS: readonly string[] = ["MORNING", "AFTERNOON", "EVENING"];
const MAX_LEN = 100;

const MAX_CONTENTS = 30;
const MAX_AMOUNT = 100000;
const CONTENT_UNITS: readonly string[] = ["g", "mg", "mcg"];
const LEVEL_KEYS: readonly string[] = LEVELS.map((l) => l.key);

export type SupplementBodyValidation =
  | {
      ok: true;
      name?: string;
      dosage?: string | null;
      timeSlot?: SupplementTimeSlot;
      contents?: PillContent[] | null;
      estimated?: boolean;
    }
  | { ok: false; error: string };

function parseContents(raw: unknown): { ok: true; value: PillContent[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "contents must be a list" };
  if (raw.length > MAX_CONTENTS) return { ok: false, error: `contents must have at most ${MAX_CONTENTS} entries` };
  const value: PillContent[] = [];
  const seen = new Set<string>();
  for (const c of raw) {
    if (c === null || typeof c !== "object" || Array.isArray(c)) return { ok: false, error: "each contents entry must be an object" };
    const { key, amount, unit } = c as Record<string, unknown>;
    if (typeof key !== "string" || !LEVEL_KEYS.includes(key)) return { ok: false, error: "contents key is not a known level" };
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) {
      return { ok: false, error: `contents amount must be greater than 0 and at most ${MAX_AMOUNT}` };
    }
    if (typeof unit !== "string" || !CONTENT_UNITS.includes(unit)) return { ok: false, error: "contents unit must be g, mg or mcg" };
    if (seen.has(key)) return { ok: false, error: "contents must not repeat a key" };
    seen.add(key);
    value.push({ key: key as FullLevelKey, amount, unit: unit as PillContent["unit"] });
  }
  return { ok: true, value };
}

/**
 * partial:false (POST) requires name + timeSlot; partial:true (PATCH)
 * validates only the keys present so a rename doesn't have to resend the slot.
 * dosage:null is a deliberate "clear it"; name:null is rejected.
 */
export function validateSupplementBody(
  body: Record<string, unknown>,
  { partial }: { partial: boolean },
): SupplementBodyValidation {
  const out: Extract<SupplementBodyValidation, { ok: true }> = { ok: true };

  if (body.name !== undefined || !partial) {
    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      return { ok: false, error: "name must be a non-empty string" };
    }
    const name = body.name.trim();
    if (name.length > MAX_LEN) return { ok: false, error: `name must be at most ${MAX_LEN} characters` };
    out.name = name;
  }

  if (body.dosage !== undefined || !partial) {
    if (body.dosage === undefined || body.dosage === null || body.dosage === "") {
      out.dosage = null;
    } else if (typeof body.dosage === "string") {
      const dosage = body.dosage.trim();
      if (dosage.length > MAX_LEN) return { ok: false, error: `dosage must be at most ${MAX_LEN} characters` };
      out.dosage = dosage.length === 0 ? null : dosage;
    } else {
      return { ok: false, error: "dosage must be a string" };
    }
  }

  if (body.timeSlot !== undefined || !partial) {
    if (typeof body.timeSlot !== "string" || !TIME_SLOTS.includes(body.timeSlot)) {
      return { ok: false, error: "timeSlot must be MORNING, AFTERNOON or EVENING" };
    }
    out.timeSlot = body.timeSlot as SupplementTimeSlot;
  }

  if (body.contents !== undefined) {
    if (body.contents === null) {
      out.contents = null;
    } else {
      const c = parseContents(body.contents);
      if (!c.ok) return c;
      out.contents = c.value;
    }
  }

  if (body.estimated !== undefined) {
    if (typeof body.estimated !== "boolean") return { ok: false, error: "estimated must be a boolean" };
    out.estimated = body.estimated;
  }

  return out;
}

export type IntakeBodyValidation =
  | { ok: true; date: Date; taken: boolean }
  | { ok: false; error: string };

export function validateIntakeBody(body: Record<string, unknown>): IntakeBodyValidation {
  const date = parseLocalDateStrict(body.date);
  if (!date) return { ok: false, error: "date must be a YYYY-MM-DD string" };
  date.setHours(0, 0, 0, 0);
  if (typeof body.taken !== "boolean") return { ok: false, error: "taken must be a boolean" };
  return { ok: true, date, taken: body.taken };
}

/** The two new keys on every supplement object the API returns. */
export function supplementExtras(row: { contents: unknown; estimated: boolean }): {
  contents: PillContent[] | null;
  estimated: boolean;
} {
  return { contents: Array.isArray(row.contents) ? (row.contents as PillContent[]) : null, estimated: row.estimated };
}

/** True when the body changes name, dosage or contents relative to what is stored. */
export function editsPillFacts(
  stored: { name: string; dosage: string | null; contents: unknown },
  v: { name?: string; dosage?: string | null; contents?: PillContent[] | null },
): boolean {
  if (v.name !== undefined && v.name !== stored.name) return true;
  if (v.dosage !== undefined && v.dosage !== stored.dosage) return true;
  if (v.contents !== undefined) {
    const was = Array.isArray(stored.contents) ? stored.contents : null;
    if (JSON.stringify(v.contents) !== JSON.stringify(was)) return true;
  }
  return false;
}
