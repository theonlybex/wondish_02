// The dish generator's output contract (Clara dish_suggest / dish_plan_today).
//
// The generator answers through structured outputs (`output_config.format`,
// a strict JSON schema), so the response always parses: before this, about
// one call in six came back with `recipes` as a malformed JSON string and
// parsed to 0 candidates (docs/qa/clara-first-sim.md, item 6). Per-item
// validation is unchanged: every item still goes through parseFridgeRecipes
// and every server-side gate.
//
// The schema is leaner than the fridge route's suggest_recipes schema on
// purpose (fewer output tokens, so faster):
//   - each ingredient carries its own amount ({name, quantity, unit}), so an
//     ingredient can no longer be listed without an amount, or spelt
//     differently in the amount row (both dropped dishes before);
//   - the unit is an enum of units the gates and the pricing read;
//   - mealType, servings, emoji, fitsPlan, conflicts and missingIngredients
//     are not asked for: the server knows the meal and the servings it asked
//     for, and the rest is never shown.
// Pure: no SDK, no Prisma.

/** Units the pricing and the unit gate understand. "" only for naturally counted things (eggs). */
export const DISH_UNITS = ["g", "oz", "lb", "ml", "cup", "tablespoon", "teaspoon", "pinch", "clove", "slice", "whole", "can", ""] as const;

const NUMBER = { type: "number" } as const;

/** Strict JSON schema: every object closes with additionalProperties false and lists every key as required. */
export const DISH_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["dishes"],
  properties: {
    dishes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "description", "prepMinutes", "cookMinutes", "ingredients", "steps", "perServing"],
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          prepMinutes: { type: "integer" },
          cookMinutes: { type: "integer" },
          ingredients: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name", "quantity", "unit"],
              properties: {
                name: { type: "string" },
                quantity: NUMBER,
                unit: { type: "string", enum: [...DISH_UNITS] },
              },
            },
          },
          steps: { type: "array", items: { type: "string" } },
          perServing: {
            type: "object",
            additionalProperties: false,
            required: ["calories", "protein", "carbs", "fat", "fiber"],
            properties: { calories: NUMBER, protein: NUMBER, carbs: NUMBER, fat: NUMBER, fiber: NUMBER },
          },
        },
      },
    },
  },
} as const;

/**
 * One generated dish in the fridge parser's raw shape (what parseFridgeRecipes
 * validates). The meal and the servings are the ones the server asked for.
 * null when the item is not an object at all.
 */
export function toFridgeItem(item: unknown, meal: string, servings: number): Record<string, unknown> | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const o = item as Record<string, unknown>;
  const rows = Array.isArray(o.ingredients) ? o.ingredients : [];
  const amounts = rows.filter((r): r is Record<string, unknown> => !!r && typeof r === "object");
  return {
    name: o.name,
    description: o.description,
    emoji: "",
    usesIngredients: amounts.map((a) => (typeof a.name === "string" ? a.name.trim() : "")).filter(Boolean),
    missingIngredients: [],
    steps: o.steps,
    mealType: meal,
    servings,
    prepMinutes: o.prepMinutes,
    cookMinutes: o.cookMinutes,
    amounts: amounts.map((a) => ({ name: typeof a.name === "string" ? a.name.trim() : a.name, quantity: a.quantity, unit: a.unit })),
    perServing: o.perServing,
    fitsPlan: true,
    conflicts: [],
  };
}

/**
 * Pulls each complete dish out of the streamed JSON text as soon as its
 * closing brace arrives, so the first dish can be checked (and served) while
 * the model is still writing the others. The text is `{"dishes":[{…},{…}]}`:
 * an item is any object two levels down. Tolerant by construction: an item
 * that does not parse is skipped, and a cut-off tail yields nothing.
 */
export class DishItemExtractor {
  private buf = "";
  private i = 0;
  private depth = 0;
  private inString = false;
  private escaped = false;
  private start = -1;

  push(chunk: string): unknown[] {
    this.buf += chunk;
    const out: unknown[] = [];
    for (; this.i < this.buf.length; this.i++) {
      const c = this.buf[this.i];
      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (c === "\\") this.escaped = true;
        else if (c === '"') this.inString = false;
        continue;
      }
      if (c === '"') {
        this.inString = true;
      } else if (c === "{" || c === "[") {
        this.depth++;
        if (c === "{" && this.depth === 3) this.start = this.i;
      } else if (c === "}" || c === "]") {
        if (c === "}" && this.depth === 3 && this.start >= 0) {
          try {
            out.push(JSON.parse(this.buf.slice(this.start, this.i + 1)));
          } catch {
            // not a whole item: skipped
          }
          this.start = -1;
        }
        this.depth--;
      }
    }
    return out;
  }
}
