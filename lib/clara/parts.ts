// Typed reply parts (Clara-first slice 1): structured pieces of a reply that an
// app build can draw as chips/cards/steps. Builds that do not ask for them get
// partAsText() appended to the reply text instead, so no reply is ever blank.
// Types-only import: the loop imports this module and must stay free of prisma.
import type { LevelKey } from "@/lib/levels";

/** A dish as Clara suggested it, with per-serving numbers from its own amounts. */
export interface ClaraRecipe {
  name: string;
  servings: number;
  minutes: number;
  ingredients: { name: string; quantity: number | null; unit: string }[];
  steps: string[];
  /** sodium is null when the dish's amounts could not be priced. */
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
