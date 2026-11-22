// Typed reply parts (Clara-first slice 1): structured pieces of a reply that an
// app build can draw as chips/cards/steps. Builds that do not ask for them get
// partAsText() appended to the reply text instead, so no reply is ever blank.
// Types-only import: the loop imports this module and must stay free of prisma.
import type { LevelKey } from "@/lib/levels";

/** A dish as Clara suggested it, with per-serving numbers from its own amounts. */
export interface ClaraRecipe {
  name: string;
  /**
   * How many people the dish is for. The ingredient quantities stay PER
   * SERVING; the app multiplies them by this to show the shopping and cooking
   * amounts. When it is more than 1 the steps carry no amounts.
   */
  servings: number;
  minutes: number;
  /** quantity and unit are for ONE serving (see `servings`). */
  ingredients: { name: string; quantity: number | null; unit: string }[];
  steps: string[];
  /**
   * Per serving. calories/protein/carbs/fat are priced from the amounts where
   * the dish prices, else the generator's checked figures. fibre is the dish's
   * declared figure (pricing has no fibre column). sodium is null unless every
   * ingredient and salty seasoning was priced.
   */
  perServing: { calories: number; protein: number; carbs: number; fat: number; fibre: number; sodium: number | null };
}

export type ClaraPart =
  | { kind: "levels"; little: { key: LevelKey; name: string }[]; aLot: { key: LevelKey; name: string }[] }
  | {
      kind: "dish";
      dishId: string;
      name: string;
      minutes: number;
      calories: number;
      reasons: { level: string; direction: "up" | "down"; text: string }[];
      /**
       * The whole dish, for the app to send back when cooking starts (the cook
       * endpoint stores it and logs from it). Optional: not every dish card is
       * cookable, and partAsText never reads it.
       */
      recipe?: ClaraRecipe;
      /** What the dish uses from the person's at-home list. Optional: absent when nothing is marked, and for older servers. partAsText never reads it. */
      fromHome?: { text: string; foods: string[]; proteinNotAtHome?: string };
    }
  | { kind: "steps"; dishId: string; steps: { n: number; text: string; timerMinutes: number | null }[] };

/** The fallback an old client reads: the same content, written out. */
export function partAsText(part: ClaraPart): string {
  switch (part.kind) {
    case "levels": {
      const segs: string[] = [];
      if (part.little.length > 0) segs.push(`little: ${part.little.map((l) => l.name).join(", ")}`);
      if (part.aLot.length > 0) segs.push(`a lot: ${part.aLot.map((l) => l.name).join(", ")}`);
      return segs.join("; ");
    }
    case "dish": {
      const head = `${part.name} (${part.minutes} min, ${part.calories} kcal)`;
      return [head, ...part.reasons.map((r) => `- ${r.level} ${r.direction}: ${r.text}`)].join("\n");
    }
    case "steps":
      return part.steps
        .map((s) => `${s.n}. ${s.text}${s.timerMinutes !== null ? ` (${s.timerMinutes} min)` : ""}`)
        .join("\n");
  }
}
