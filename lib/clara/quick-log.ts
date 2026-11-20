// Quick log (2026-11-20, owner): answering a meal reminder is a finished
// interaction. The person types what they had under the notification, or
// takes one picture, and the meal is estimated and logged at once: no app
// opening for a typed answer, no questions, no "want me to log it?".
//
// One model call names the meal and lists its foods with grams. The numbers
// come from the same food table the dish cards and photo meals use
// (lib/clara/food-grams.ts); a food the table does not know keeps the model's
// own figure. The row is saved as an estimate, so the Log says so, and the
// app offers Undo on its confirmation.
import type Anthropic from "@anthropic-ai/sdk";
import { MealLogSource } from "@prisma/client";
import { CLARA_MODEL } from "./anthropic-client";
import { priceFoodRow, MAX_FOOD_GRAMS, MAX_FOOD_ROWS } from "./food-grams";
import type { ClaraPhoto } from "./photo";
import {
  buildMealLogCreateData,
  buildMealLogUpsertArgs,
  parseMealLogInput,
  resolveSnapshot,
} from "@/lib/meal-log";

export const QUICK_LOG_MEALS = ["breakfast", "lunch", "dinner", "snack"] as const;
export type QuickLogMeal = (typeof QUICK_LOG_MEALS)[number];
export const MAX_QUICK_NOTE = 500;
export const QUICK_LOG_MAX_TOKENS = 1500;
export const QUICK_NAME_MAX = 60;

const NUMBER = { type: "number" } as const;

export const QUICK_LOG_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["isMeal", "name", "foods"],
  properties: {
    isMeal: { type: "boolean" },
    name: { type: "string" },
    foods: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "grams", "asServed", "calories", "protein", "carbs", "fat"],
        properties: {
          name: { type: "string" },
          grams: NUMBER,
          asServed: { type: "boolean" },
          calories: NUMBER,
          protein: NUMBER,
          carbs: NUMBER,
          fat: NUMBER,
        },
      },
    },
  },
} as const;

export function quickLogSystemPrompt(meal: QuickLogMeal): string {
  return [
    `The person answered a reminder about their ${meal} by describing it in a few words or by sending one photo. Work out what they ate so it can be logged. You cannot ask them anything: make your best estimate.`,
    "Return:",
    `- name: a short plain name for the meal as they would say it ("Chicken wrap and an apple"), at most ${QUICK_NAME_MAX} characters.`,
    "- foods: every food in the meal as its own row, with grams for one adult portion unless they gave an amount. Oil, butter, dressing and sauce are their own rows. asServed is true for cooked or ready-to-eat weights (the usual case) and false only for dry or raw weights they stated.",
    "- For each food also give your own calories, protein, carbs and fat for that many grams. They are used only when the food data does not know the food.",
    "- isMeal: false when the words or the photo show no food or drink that was eaten (a question, a greeting, an empty plate, something that is not food). Then return an empty foods list.",
    "A drink with calories counts. Water, black coffee and plain tea are not rows.",
  ].join("\n");
}

export interface QuickLogFood {
  name: string;
  grams: number;
  asServed: boolean;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface QuickLogEstimate {
  isMeal: boolean;
  name: string;
  foods: QuickLogFood[];
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

/** Reads the model's JSON. null when it is not the expected shape. */
export function parseQuickLogEstimate(raw: unknown): QuickLogEstimate | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.isMeal !== "boolean" || typeof r.name !== "string" || !Array.isArray(r.foods)) return null;
  const foods: QuickLogFood[] = [];
  for (const item of r.foods.slice(0, MAX_FOOD_ROWS)) {
    if (typeof item !== "object" || item === null) continue;
    const f = item as Record<string, unknown>;
    const name = typeof f.name === "string" ? f.name.trim().slice(0, 80) : "";
    const grams = num(f.grams);
    if (name.length === 0 || grams <= 0 || grams > MAX_FOOD_GRAMS) continue;
    foods.push({ name, grams, asServed: f.asServed !== false, calories: num(f.calories), protein: num(f.protein), carbs: num(f.carbs), fat: num(f.fat) });
  }
  return { isMeal: r.isMeal, name: r.name.trim().slice(0, QUICK_NAME_MAX), foods };
}

export interface QuickLogTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  /** Foods the table did not know: the model's own figures were used for them. */
  modelEstimated: string[];
}

const r1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * The meal's numbers: each food priced from the food table, and the model's
 * own figure for a food the table does not know.
 */
export function quickLogTotals(foods: readonly QuickLogFood[]): QuickLogTotals {
  let calories = 0, protein = 0, carbs = 0, fat = 0;
  const modelEstimated: string[] = [];
  for (const f of foods) {
    const priced = priceFoodRow({ name: f.name, grams: f.grams, asServed: f.asServed });
    if (priced.source === "unknown" || priced.calories === null) {
      modelEstimated.push(f.name);
      calories += f.calories; protein += f.protein; carbs += f.carbs; fat += f.fat;
    } else {
      calories += priced.calories; protein += priced.protein ?? 0; carbs += priced.carbs ?? 0; fat += priced.fat ?? 0;
    }
  }
  return { calories: Math.round(calories), protein: r1(protein), carbs: r1(carbs), fat: r1(fat), modelEstimated };
}

export type QuickLogModel = Pick<Anthropic, "messages">;

/** One model call: the meal's name and foods from the words or the photo. */
export async function estimateQuickLog(
  client: QuickLogModel,
  input: { meal: QuickLogMeal; note?: string; photo?: ClaraPhoto },
): Promise<QuickLogEstimate | null> {
  const words = (input.note ?? "").trim();
  const content: Anthropic.ContentBlockParam[] = [];
  if (input.photo) {
    content.push({ type: "image", source: { type: "base64", media_type: input.photo.mediaType, data: input.photo.data } });
  }
  content.push({ type: "text", text: words.length > 0 ? `What I had for ${input.meal}: ${words}` : `This photo is my ${input.meal}.` });
  const msg = await client.messages.create({
    model: CLARA_MODEL,
    max_tokens: QUICK_LOG_MAX_TOKENS,
    thinking: { type: "disabled" },
    system: quickLogSystemPrompt(input.meal),
    output_config: { format: { type: "json_schema", schema: QUICK_LOG_SCHEMA as unknown as Record<string, unknown> } },
    messages: [{ role: "user", content }],
  });
  const text = msg.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text;
  if (!text) return null;
  try {
    return parseQuickLogEstimate(JSON.parse(text));
  } catch {
    return null;
  }
}

/** The request body. `requestId` makes a retry return the same row. */
export interface QuickLogBody {
  meal: QuickLogMeal;
  today: string;
  requestId: string;
  note?: string;
}

export function parseQuickLogBody(raw: unknown): { ok: true; value: QuickLogBody } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "Invalid body" };
  const b = raw as Record<string, unknown>;
  if (typeof b.meal !== "string" || !QUICK_LOG_MEALS.includes(b.meal as QuickLogMeal)) return { ok: false, error: "meal must be breakfast, lunch, dinner or snack" };
  if (typeof b.today !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.today)) return { ok: false, error: "today must be YYYY-MM-DD" };
  if (typeof b.requestId !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(b.requestId)) return { ok: false, error: "Invalid requestId" };
  const note = typeof b.note === "string" ? b.note.trim() : "";
  if (note.length > MAX_QUICK_NOTE) return { ok: false, error: `note must be <= ${MAX_QUICK_NOTE} characters` };
  return { ok: true, value: { meal: b.meal as QuickLogMeal, today: b.today, requestId: b.requestId, ...(note.length > 0 ? { note } : {}) } };
}

/**
 * The meal-log upsert for a quick log: source CLARA, marked as an estimate,
 * tied to the photo when there was one, and keyed by the app's request id so
 * a retried request never logs the meal twice.
 */
export function quickLogUpsertArgs(
  patientId: string,
  body: QuickLogBody,
  estimate: QuickLogEstimate,
  totals: QuickLogTotals,
  photoId?: string,
): { ok: true; args: ReturnType<typeof buildMealLogUpsertArgs> } | { ok: false; error: string } {
  const parsed = parseMealLogInput({
    localDate: body.today,
    mealType: body.meal,
    source: MealLogSource.CLARA,
    name: estimate.name.length > 0 ? estimate.name : `${body.meal[0].toUpperCase()}${body.meal.slice(1)}`,
    servings: 1,
    perServing: { calories: totals.calories, protein: totals.protein, carbs: totals.carbs, fat: totals.fat },
    estimated: true,
    ...(body.note ? { note: body.note } : {}),
    ...(photoId ? { pictureResultId: photoId } : {}),
    clientRequestId: `quick:${body.requestId}`,
  });
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const resolved = resolveSnapshot(parsed.value, {});
  return { ok: true, args: buildMealLogUpsertArgs(buildMealLogCreateData(patientId, parsed.value, resolved)) };
}
