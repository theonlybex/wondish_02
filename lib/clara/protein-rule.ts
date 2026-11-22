// The strict protein rule, today's protein, and the "from your kitchen" line.
// Pure: no database, no model client.
import type { MealType } from "../local-date";
import { builtOn, eggsOnlyKitchen, homeProteins, mainProteins, proteinKind, type BuiltOn, type DishIngredient, type HomeProtein } from "./dish-protein";
import type { DishRules } from "./dish-rules";
import { foodMatches, type KeptFoods } from "./kept-foods";

/** The protein key a request names ("a chicken dish" → "chicken", "tofu stir-fry" → "tofu"); null when it names none. */
export function requestedProtein(wants: string): string | null {
  return proteinKind(wants)?.key ?? null;
}

/** On when a meat, plant, egg or pulse protein is at home, unless the request names a protein that is not at home. */
export function proteinRuleApplies(home: readonly HomeProtein[], wants: string | undefined): boolean {
  if (!home.some((p) => p.cls !== "dairy")) return false;
  const text = wants?.trim();
  if (!text) return true;
  const asked = requestedProtein(text);
  return asked === null || home.some((p) => p.key === asked);
}

export type ProteinBreak = "meat-not-at-home" | "built-on-not-at-home" | "main-without-protein" | "main-on-side-protein";

/** Check 4b of the design. null = passes. */
export function proteinRuleBreak(a: {
  mealType: MealType; wants?: string;
  ingredients: readonly DishIngredient[]; steps?: readonly string[];
  home: readonly HomeProtein[];
  rules: Pick<DishRules, "onlyHomeProteins" | "mainsOnProtein">;
}): ProteinBreak | null {
  if (!proteinRuleApplies(a.home, a.wants)) return null;
  const homeKeys = new Set(a.home.map((p) => p.key));
  const built = builtOn(a.ingredients, a.steps);
  const isMain = a.mealType === "lunch" || a.mealType === "dinner";
  // An eggs-only kitchen: a main may be built on any meat-free protein (the meat check below still runs).
  const freeMain = isMain && eggsOnlyKitchen(a.home);
  if (a.rules.onlyHomeProteins) {
    for (const ing of a.ingredients) {
      const kind = proteinKind(ing.name);
      if (kind && kind.cls === "meat" && !homeKeys.has(kind.key)) return "meat-not-at-home";
    }
    if (built && !homeKeys.has(built.key) && !freeMain) return "built-on-not-at-home";
  }
  // OFF 2026-11-22 (owner: "lets remove the protein has to be in every dish for now"): a lunch or
  // dinner with no protein at its centre (a salad, cooked potatoes) passes. Protein is a need of the
  // day now (proteinNeed below), asked for in the instructions, never a reason to drop a dish.
  // Restore: uncomment.
  // if (a.rules.mainsOnProtein && isMain && a.wants === undefined) {
  //   if (!built) return "main-without-protein";
  //   if (a.rules.onlyHomeProteins && !freeMain && !mainProteins(a.home).some((p) => p.key === built.key)) return "main-on-side-protein";
  // }
  return null;
}

/**
 * How much this dish should lean on protein (owner, 2026-11-22):
 *  - "hold": a condition calls for modest protein (a kidney condition);
 *  - "free": this week's logs put protein on track and today is not behind: the dish may have none;
 *  - "push": everything else (behind, a muscle goal, or nothing logged to go by).
 */
export type ProteinNeed = "push" | "free" | "hold" | "skip";

/**
 * "skip": with protein on track ("free"), one lunch in two is asked to have no meat, fish or eggs at
 * its centre (owner, 2026-11-22: "sometimes a salad can also be an option"). Chosen in code, by
 * person and day like the rotation, because the model left to itself picked an egg dish every time.
 */
export function skipsProtein(need: ProteinNeed, mealType: MealType, patientId: string, today: string): boolean {
  if (need !== "free" || mealType !== "lunch") return false;
  const [y, m, d] = today.split("-").map(Number);
  const dayNumber = Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
  return (fnv1a(patientId) + dayNumber) % 2 === 0;
}
export function proteinNeed(a: {
  conditionNames: readonly string[];
  motivationNames: readonly string[];
  /** The week's word for protein on the Numbers tab; null when there are not enough logs. */
  weekWord: string | null;
  /** Today's logs put protein well behind for this time of day. */
  behindToday: boolean;
}): ProteinNeed {
  if (a.conditionNames.some((n) => n.toLowerCase().includes("kidney"))) return "hold";
  if (a.motivationNames.some((m) => /muscle|gain/i.test(m))) return "push";
  return a.weekWord === "on track" && !a.behindToday ? "free" : "push";
}

export interface ProteinChoice { key: string; name: string; why: "today" | "rotation" }

/** Two protein keys are the same kind when they are equal after removing a leading "ground " from both. */
export function sameProteinKind(a: string, b: string): boolean {
  const strip = (k: string) => (k.startsWith("ground ") ? k.slice(7) : k);
  return strip(a) === strip(b);
}

/** mainProteins sorted by key, then (favourFavourites) each favourite among them once more, sorted by key. */
export function rotationWheel(home: readonly HomeProtein[], favourFavourites: boolean): HomeProtein[] {
  const byKey = (x: HomeProtein, y: HomeProtein) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0);
  const main = mainProteins(home).sort(byKey);
  const favs = favourFavourites ? main.filter((p) => p.favourite) : [];
  return [...main, ...favs];
}

export function fnv1a(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** null for breakfast and snack, when `wants` is set, when the wheel is empty, and in an eggs-only kitchen. */
export function chooseProtein(a: {
  mealType: MealType; wants?: string;
  home: readonly HomeProtein[];
  /** Dish names used today, oldest first: today's logged dishes, then the dishes this chat already showed. */
  usedToday: readonly string[];
  patientId: string; today: string; // "YYYY-MM-DD"
  rules: Pick<DishRules, "sameProteinToday" | "favourFavourites">;
}): ProteinChoice | null {
  if (a.mealType !== "lunch" && a.mealType !== "dinner") return null;
  if (a.wants !== undefined) return null;
  if (eggsOnlyKitchen(a.home)) return null;
  const wheel = rotationWheel(a.home, a.rules.favourFavourites);
  if (wheel.length === 0) return null;
  if (a.rules.sameProteinToday) {
    for (let i = a.usedToday.length - 1; i >= 0; i--) {
      const key = proteinKind(a.usedToday[i])?.key;
      if (!key) continue;
      const hit = wheel.find((p) => sameProteinKind(p.key, key));
      if (hit) return { key: hit.key, name: hit.name, why: "today" };
    }
  }
  const [y, m, d] = a.today.split("-").map(Number);
  const dayNumber = Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
  const pick = wheel[(fnv1a(a.patientId) + dayNumber) % wheel.length];
  return { key: pick.key, name: pick.name, why: "rotation" };
}

export interface FromHome { text: string; foods: string[]; proteinNotAtHome?: string }

/** null when nothing is marked at home (kept.proteinNames and kept.atHome both empty). */
export function fromHomeLine(ingredientNames: readonly string[], kept: KeptFoods, built: BuiltOn | null): FromHome | null {
  if (kept.proteinNames.length === 0 && kept.atHome.length === 0) return null;
  const foods = [...kept.proteinNames, ...kept.atHome]
    .filter((f) => ingredientNames.some((n) => foodMatches(f, n)))
    .slice(0, 6);
  const text = foods.length > 0 ? `From your kitchen: ${foods.join(", ")}.` : "Nothing from your at-home list.";
  const out: FromHome = { text, foods };
  if (built && !homeProteins(kept).some((p) => p.key === built.key)) {
    out.proteinNotAtHome = built.name;
    out.text = `${built.name.charAt(0).toUpperCase()}${built.name.slice(1)} is not on your at-home list. ${text}`;
  }
  return out;
}
