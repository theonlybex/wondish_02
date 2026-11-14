// A photo sent to Clara with a chat message (2026-11-14, user request: "a
// picture mode to send lunch picture to Clara"). The photo itself is NOT
// stored: the model sees it on the turn it was sent, and the saved user row
// keeps a marker `[photo:<id>]` so a reopened chat knows a photo was there
// (the app keeps its own copy under that id). Clara's reply, which names what
// she saw, carries the photo's meaning into later turns.
// Types-only imports: the loop and the service import this module.
import type { ModelContentBlock } from "./types";

export type PhotoMediaType = "image/jpeg" | "image/png" | "image/webp";
const MEDIA_TYPES: readonly PhotoMediaType[] = ["image/jpeg", "image/png", "image/webp"];

/**
 * Base64 characters allowed (~3 MB of image). Vercel caps a request body at
 * 4.5 MB; the app sends a JPEG at most 1600 px on the long side (~0.3-0.8 MB).
 */
export const MAX_PHOTO_BASE64_CHARS = 4_000_000;

export interface ClaraPhoto {
  /** The app's id for its own copy (letters, digits, dashes; 8-64). */
  id: string;
  mediaType: PhotoMediaType;
  /** Base64, no data: prefix, no newlines. */
  data: string;
}

/** What the model reads when the person sent a photo and no words. */
export const PHOTO_ONLY_TEXT = "Here is a photo of my food.";

/** Title of a chat that starts with a photo and no words. */
export const PHOTO_TITLE = "Photo of my food";

/**
 * Said to Clara (system prompt) on the turn a photo arrives. Intake wording,
 * never body state (spec). Logging stays behind the confirm rule: the answer
 * boxes come first and logs_create runs on the next turn.
 */
export function photoInstructions(firstName: string): string {
  return [
    `${firstName} sent a photo with this message, usually of food they are eating or about to eat.`,
    "Look at it closely. In one short line, name the dish or foods you see and roughly how much (a plate, a bowl, about 300 g).",
    "Then give your estimate per serving: calories, protein, carbs and fat, and say in one line what it adds to their day (intake words: \"this adds a good amount of fibre\", never \"your fibre is low\").",
    "If you cannot tell what something is, say so and ask, with answer boxes. If the photo is not food (a menu, a label, a fridge), say what you see and help with that instead.",
    "End by asking whether to log it, with answer boxes: the meal for now first (\"Log as lunch\"), then the other likely meal, then \"Don't log\".",
    "Never log on this turn. When they pick a log answer, call logs_create with the name and exactly the numbers you stated.",
  ].join(" ");
}

/**
 * Reads the optional `photo` key of a chat body. Absent ⇒ no photo. Present
 * but wrong ⇒ an error (400): a client that tried to send a photo should hear
 * that it failed rather than have Clara answer without it.
 */
export function parsePhoto(raw: unknown): { ok: true; photo?: ClaraPhoto } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true };
  if (typeof raw !== "object") return { ok: false, error: "Invalid photo" };
  const p = raw as Record<string, unknown>;
  if (typeof p.id !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(p.id)) return { ok: false, error: "Invalid photo" };
  if (typeof p.mediaType !== "string" || !MEDIA_TYPES.includes(p.mediaType as PhotoMediaType)) {
    return { ok: false, error: "That picture type is not supported. Send a JPEG, PNG or WebP." };
  }
  if (typeof p.data !== "string" || p.data.length === 0) return { ok: false, error: "Invalid photo" };
  if (p.data.length > MAX_PHOTO_BASE64_CHARS) return { ok: false, error: "That picture is too large. Try a smaller one." };
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(p.data)) return { ok: false, error: "Invalid photo" };
  return { ok: true, photo: { id: p.id, mediaType: p.mediaType as PhotoMediaType, data: p.data } };
}

const MARKER = /^\[photo:([A-Za-z0-9-]{8,64})\]\s?/;

/** The saved user row: `[photo:<id>] <their words>` (words may be empty). */
export function photoStoredText(photoId: string, message: string): string {
  return `[photo:${photoId}]${message.length > 0 ? ` ${message}` : ""}`;
}

/** Splits a saved row; null when it carries no photo marker. */
export function splitPhotoMarker(content: string): { photoId: string; text: string } | null {
  const m = MARKER.exec(content);
  if (!m) return null;
  return { photoId: m[1], text: content.slice(m[0].length) };
}

/** A saved photo row as the model reads it later (the photo is gone). */
export function photoReplayText(content: string): string {
  const split = splitPhotoMarker(content);
  if (!split) return content;
  return split.text.length > 0 ? `[I sent a photo of my food] ${split.text}` : "[I sent a photo of my food]";
}

/** This turn's user content: the photo first, then the words. */
export function photoContent(photo: ClaraPhoto, message: string): ModelContentBlock[] {
  return [
    { type: "image", source: { type: "base64", media_type: photo.mediaType, data: photo.data } },
    { type: "text", text: message.length > 0 ? message : PHOTO_ONLY_TEXT },
  ];
}
