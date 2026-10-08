// Pure validation for user feedback reports (spec 2026-10-07-feedback-reports-design).
// Rate-limit bucket: "ai-" so it is a spend bucket (lib/rate-limit fails it
// closed per instance on a backend error, instead of open).
export const FEEDBACK_RATE_BUCKET = "ai-feedback-submit";
export const FEEDBACK_AREAS = ["meal-plan", "ingredients", "clara", "journal", "trials", "profile", "other"] as const;
export const FEEDBACK_TEXT_MIN = 10;
export const FEEDBACK_TEXT_MAX = 2000;
// Vercel refuses request bodies over 4.5 MB (a non-JSON 413, before our code
// runs): 4 MB leaves room for the text fields and multipart framing.
export const FEEDBACK_MAX_IMAGE_MB = 4;
export const FEEDBACK_MAX_IMAGE_BYTES = FEEDBACK_MAX_IMAGE_MB * 1024 * 1024;

export function validateFeedbackText(raw: unknown): { ok: true; text: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: "Tell us what went wrong." };
  const text = raw.trim();
  if (text.length < FEEDBACK_TEXT_MIN) return { ok: false, error: `Please add a little more detail (at least ${FEEDBACK_TEXT_MIN} characters).` };
  if (text.length > FEEDBACK_TEXT_MAX) return { ok: false, error: `Please keep it under ${FEEDBACK_TEXT_MAX} characters.` };
  return { ok: true, text };
}

export function validateArea(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const a = raw.trim().toLowerCase();
  return (FEEDBACK_AREAS as readonly string[]).includes(a) ? a : null;
}

// The declared content type is the client's claim; the bytes decide.
export function sniffImage(buf: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  const at = (i: number, bytes: number[]) => bytes.every((b, k) => buf[i + k] === b);
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (at(0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return "image/webp";
  return null;
}
