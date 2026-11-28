// A photo sent to Clara with a chat message (2026-11-14, user request: "a
// picture mode to send lunch picture to Clara"). The photo itself is NOT
// stored: the model sees it on the turn it was sent, and the saved user row
// keeps a marker `[photo:<id>]` so a reopened chat knows a photo was there
// (the app keeps its own copy under that id). Clara's reply, which names what
// she saw, carries the photo's meaning into later turns.
// Types-only imports: the loop and the service import this module.
import type { ModelContentBlock, ModelMessage } from "./types";

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
    "Look at it closely and first decide what it is: a plate or food to eat, a restaurant menu, a fridge or ingredients, or something else (a label, a receipt). The gram steps below are only for a plate or food to eat.",
    PHOTO_MENU_STEPS,
    PHOTO_FRIDGE_STEPS,
    "Something else: say what you see and help with that.",
    "In your first line, name every food you can see with your gram guess for each (\"chicken breast about 120 g, white rice about 150 g, salad leaves about 40 g\"). Write this line every time: later messages do not have the photo, only this line.",
    PHOTO_GRAM_STEPS,
  ].join(" ");
}

/** A restaurant menu (the start list's "Photo of a menu", 2026-11-17). */
const PHOTO_MENU_STEPS = [
  "A restaurant menu: pick up to 4 dishes from it that fit their conditions, allergies and numbers, best first.",
  "One short line each: the dish as the menu names it, then why it fits. Then one line on what to ask the kitchen (an allergen to check, sauce on the side, a swap).",
  "If a dish they might want does not fit, say so in one line. Never invent a dish that is not on the menu; if you cannot read part of it, say which part.",
  "No gram questions and no logging for a menu. End by asking which one they will have, with the dish names as answer boxes.",
].join(" ");

/** A fridge, a shelf or ingredients on a counter ("Photo of my fridge"). */
const PHOTO_FRIDGE_STEPS = [
  "A fridge or ingredients: in your first line, name what you can see that is useful for cooking (\"eggs, spinach, feta, half a lemon, cooked rice\"). Later messages do not have the photo, only this line.",
  "Then call dish_suggest once, with wants set to a dish built from those ingredients (\"an omelette with spinach and feta\"), so the app shows a dish card they can cook. Do not write a recipe yourself.",
  "After the card, say in one line which of the ingredients it uses and anything it needs that you did not see. No gram questions and no logging for a fridge.",
].join(" ");

/**
 * The gram questions and the pricing, shared by the photo turn and the turns
 * that answer its questions (those turns no longer have the photo).
 */
const PHOTO_GRAM_STEPS = [
  "Your goal is the grams of each food inside the meal. Ask up to 3 short questions to pin them down, ONE per message, each with answer boxes that give amounts in everyday words with grams (\"Small bowl, about 100 g\", \"Medium, about 180 g\", \"Large, about 250 g\").",
  "Ask first about what the photo cannot show and what changes calories most: oil, butter, dressing or sauce (\"None\", \"1 tsp, about 5 g\", \"1 tbsp, about 14 g\", \"More\"), then the portion of the most filling food. Skip anything their note already answers. A simple food with nothing hidden (an apple, a yoghurt pot) needs no questions.",
  "Every question's boxes end with \"Just estimate\", which means stop asking and use your best guesses.",
  "When the grams are settled, call foods_nutrition with every food and its grams (oil, butter, dressing and sauce as their own rows), and on every row your own calories, protein, carbs and fat for that many grams: they are used only for a food the food data does not know.",
  "Then give one short list of the foods with their grams, the totals per serving (calories, protein, carbs, fat) exactly as `totals` gives them, never a sum of your own, and one line on what it adds to their day (intake words: \"this adds a good amount of fibre\", never \"your fibre is low\").",
  "End by asking whether to log it, with answer boxes: the meal for now first (\"Log as lunch\"), then the other likely meal, then \"Don't log\".",
  "Logging only happens after they tap a \"Log as …\" box: then call logs_create with the name and the same foods list you sent to foods_nutrition (no macro numbers: the app works them out from the foods). Answering a gram question never logs anything.",
].join(" ");

/** Said to Clara on the turns that follow a photo, while its questions run. */
export function photoFollowUpInstructions(firstName: string): string {
  return [
    `${firstName} recently sent a photo of food (marked [I sent a photo of my food]); you no longer have the photo, only your own description of it.`,
    "If you are still working out that meal, carry on:",
    PHOTO_GRAM_STEPS,
  ].join(" ");
}

/** Text a saved photo row starts with when the model reads it later. */
export const PHOTO_REPLAY_PREFIX = "[I sent a photo of my food]";

/** How many of the newest member messages a photo's questions may run over. */
export const PHOTO_FLOW_USER_TURNS = 5;

/**
 * True when one of the newest member messages in the history was a photo,
 * so its gram questions may still be running.
 */
export function inPhotoFlow(history: readonly ModelMessage[]): boolean {
  let seen = 0;
  for (let i = history.length - 1; i >= 0 && seen < PHOTO_FLOW_USER_TURNS; i--) {
    const m = history[i];
    if (m.role !== "user" || typeof m.content !== "string") continue; // tool results are user rows too
    seen++;
    if (m.content.startsWith(PHOTO_REPLAY_PREFIX)) return true;
  }
  return false;
}

/**
 * The id of the photo whose questions may still be running: the newest photo
 * row among the newest member rows, as saved (`[photo:<id>] words`). A meal
 * logged in that flow is tied to it, so the Log can show the picture.
 */
export function photoIdInFlow(savedUserRows: readonly string[]): string | undefined {
  for (const content of savedUserRows.slice(0, PHOTO_FLOW_USER_TURNS)) {
    const split = splitPhotoMarker(content);
    if (split) return split.photoId;
  }
  return undefined;
}

/**
 * While a photo's questions run, a reply only counts as a yes to logging when
 * it is a log answer ("Log as lunch", "log it"). Answering "Medium, about
 * 180 g" must not let logs_create run.
 */
export function isLogAnswer(message: string): boolean {
  return /^\s*log\b/i.test(message);
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
  return split.text.length > 0 ? `${PHOTO_REPLAY_PREFIX} ${split.text}` : PHOTO_REPLAY_PREFIX;
}

/** This turn's user content: the photo first, then the words. */
export function photoContent(photo: ClaraPhoto, message: string): ModelContentBlock[] {
  return [
    { type: "image", source: { type: "base64", media_type: photo.mediaType, data: photo.data } },
    { type: "text", text: message.length > 0 ? message : PHOTO_ONLY_TEXT },
  ];
}
