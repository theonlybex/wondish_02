// Pure validation for the /api/supplements routes, following lib/journal.ts:
// routes stay thin, everything decidable without Prisma lives (and is tested) here.
import { parseLocalDateStrict } from "./journal";

export type SupplementTimeSlot = "MORNING" | "AFTERNOON" | "EVENING";
const TIME_SLOTS: readonly string[] = ["MORNING", "AFTERNOON", "EVENING"];
const MAX_LEN = 100;

export type SupplementBodyValidation =
  | { ok: true; name?: string; dosage?: string | null; timeSlot?: SupplementTimeSlot }
  | { ok: false; error: string };

/**
 * partial:false (POST) requires name + timeSlot; partial:true (PATCH)
 * validates only the keys present so a rename doesn't have to resend the slot.
 * dosage:null is a deliberate "clear it"; name:null is rejected.
 */
export function validateSupplementBody(
  body: Record<string, unknown>,
  { partial }: { partial: boolean },
): SupplementBodyValidation {
  const out: { ok: true; name?: string; dosage?: string | null; timeSlot?: SupplementTimeSlot } = { ok: true };

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
