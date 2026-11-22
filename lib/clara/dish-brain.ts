// The dish brain: everything Clara knows about a person when she writes them a
// dish, built once per request from what the dish skill already loads plus the
// brain reads (dish-brain-db.ts). Pure: no database, no model client.
import type { DailyTargets } from "@/lib/caloric-engine";
import { evaluateDishAgainstProfile, type DietMatchers } from "@/lib/diet-match";
import { staplesFor } from "@/lib/kitchen-basics";
import type { FullLevelKey } from "@/lib/level-catalogue";
import type { MealType } from "@/lib/local-date";
import { buildFullNumbers, ageOn, type FullDay } from "@/lib/numbers-full";
import { currentStartingPicture } from "@/lib/onboarding";
import { freeStaplesFor } from "./recipe-generation";
import { homeProteins, type HomeProtein } from "./dish-protein";
import { DEFAULT_DISH_RULES, keptUnderRules, type DishRules } from "./dish-rules";
import type { KeptFoods } from "./kept-foods";
import { levelCeilings, steerLevels, type LevelSteer, type PictureLevels, type SteerRow, type TodayTotals } from "./level-steer";
import { mealTarget, type MealTarget } from "./meal-target";
import { chooseProtein, proteinNeed, proteinRuleApplies, type ProteinChoice, type ProteinNeed } from "./protein-rule";

export interface BrainRows {
  week: { range: { fromDate: string; toDate: string }; days: FullDay[] } | null;
  dayTarget: DailyTargets | null;
  /** Live pills; null when the read failed (then there is no picture). */
  pills: { name: string; contents: unknown; estimated: boolean }[] | null;
  /** Today's logged dish names, oldest first. */
  todayDishes: string[];
  /** Dish names logged in the six days before today, oldest first. Optional: absent is none. */
  recentDishes?: string[];
  /** Every food they marked as liked, catalog or not. */
  liked: { name: string; allergenGroups: string[] }[];
}

export const NO_BRAIN_ROWS: BrainRows = Object.freeze({
  week: null,
  dayTarget: null,
  pills: null,
  todayDishes: Object.freeze([]) as unknown as string[],
  liked: Object.freeze([]) as unknown as BrainRows["liked"],
}) as BrainRows;

export interface BrainPatient {
  sexAtBirth?: string | null;
  birthday?: Date | null;
  usualEating?: unknown;
  missingStaples?: string[] | null;
  healthConditions: { condition: { name: string } }[];
  motivations: { motivation: { name: string } }[];
}

export interface DishBrain {
  rules: DishRules;
  /** keptUnderRules(kept, rules). */
  kept: KeptFoods;
  home: HomeProtein[];
  /** Catalog favourites plus every other liked food the diet allows; [] with favourFavourites off; at most 40. */
  favourites: string[];
  /** Kitchen basics the diet allows; [] without matchers. */
  basics: string[];
  dayCalories: number | null;
  conditionNames: string[];
  motivationNames: string[];
  sodiumLimitMg: number;
  week: SteerRow[];
  picture: PictureLevels | null;
  today: TodayTotals | null;
  usedToday: string[];
  /** Dish names from the six days before today (their log), oldest first: the next dish is asked to differ. */
  usedRecently: string[];
  /** The diet matchers the brain was built with; absent without them. Level examples are filtered through them. */
  matchers?: DietMatchers;
}

const MAX_FAVOURITES = 40;
const DEFAULT_SODIUM_LIMIT_MG = 2300;

function favouritesFrom(kept: KeptFoods, liked: BrainRows["liked"], matchers: DietMatchers | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (name: string) => {
    const k = name.trim().toLowerCase();
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(name);
  };
  for (const f of kept.favorites) add(f);
  for (const l of liked) {
    if (matchers && !evaluateDishAgainstProfile([l.name], matchers, [l.allergenGroups]).passed) continue;
    add(l.name);
  }
  return out.slice(0, MAX_FAVOURITES);
}

/** Everything optional but `kept`: with nothing else it is a person with no reads (no target, no levels, no basics). */
export function brainFrom(a: {
  kept: KeptFoods;
  rules?: DishRules;
  rows?: BrainRows;
  today?: string;
  patient?: BrainPatient;
  matchers?: DietMatchers;
  sodiumLimitMg?: number;
}): DishBrain {
  const rules: DishRules = a.rules ?? { ...DEFAULT_DISH_RULES };
  const rows = a.rows ?? NO_BRAIN_ROWS;
  const kept = keptUnderRules(a.kept, rules);
  const p = a.patient;
  const conditionNames = (p?.healthConditions ?? []).map((h) => h.condition.name);
  const motivationNames = (p?.motivations ?? []).map((m) => m.motivation.name);
  const sodiumLimitMg = a.sodiumLimitMg ?? DEFAULT_SODIUM_LIMIT_MG;

  const basics = a.matchers
    ? freeStaplesFor(a.matchers, staplesFor(p?.missingStaples ?? null, [...kept.proteinNames, ...kept.atHome]))
    : [];

  let week: SteerRow[] = [];
  if (rows.week && p && a.today) {
    const t = rows.dayTarget;
    const sex = p.sexAtBirth === "MALE" || p.sexAtBirth === "FEMALE" ? p.sexAtBirth : null;
    week = buildFullNumbers({
      days: rows.week.days,
      range: rows.week.range,
      macroTargets: t ? { calories: t.calories, protein: t.protein, carbs: t.carbs } : null,
      person: { sexAtBirth: sex, age: p.birthday ? ageOn(p.birthday.toISOString().slice(0, 10), a.today) : null },
      conditionNames,
      pills: (rows.pills ?? []).map(({ contents, estimated }) => ({ contents, estimated })),
      trackedRows: [],
      picture: null,
      weight: null,
    }).levels;
  }

  // A failed pills read is no picture, never one that forgets their pills.
  const picture = rows.pills !== null ? currentStartingPicture(p?.usualEating ?? null, rows.pills.map((x) => x.name)) : null;

  const day = a.today && rows.week ? rows.week.days.find((d) => d.localDate === a.today) : undefined;
  const today: TodayTotals | null = day
    ? {
        meals: day.meals, calories: day.calories, protein: day.protein, carbs: day.carbs,
        fibre: day.fibre, sodium: day.sodium, saturatedFat: day.saturatedFat, addedSugar: day.addedSugar,
      }
    : null;

  return {
    rules,
    kept,
    home: homeProteins(kept),
    favourites: rules.favourFavourites ? favouritesFrom(kept, rows.liked, a.matchers) : [],
    basics,
    dayCalories: rows.dayTarget?.calories ?? null,
    conditionNames,
    motivationNames,
    sodiumLimitMg,
    week,
    picture,
    today,
    usedToday: [...rows.todayDishes],
    usedRecently: [...(rows.recentDishes ?? [])],
    ...(a.matchers ? { matchers: a.matchers } : {}),
  };
}

export interface AskSteer {
  ruleOn: boolean;
  choice: ProteinChoice | null;
  /** How much this dish should lean on protein; "push" with mainsOnProtein on and nothing known. */
  need: ProteinNeed;
  target: MealTarget;
  levels: LevelSteer[];
  ceilings: Partial<Record<FullLevelKey, number>>;
}

export function steerForAsk(
  brain: DishBrain,
  ask: { mealType: MealType; wants?: string; avoid?: string[]; summary: PictureLevels; picture?: PictureLevels },
  who: { patientId: string; today: string },
): AskSteer {
  const ruleOn = brain.rules.onlyHomeProteins && proteinRuleApplies(brain.home, ask.wants);
  const choice = ruleOn
    ? chooseProtein({
        mealType: ask.mealType,
        ...(ask.wants !== undefined ? { wants: ask.wants } : {}),
        home: brain.home,
        usedToday: [...brain.usedToday, ...(ask.avoid ?? [])],
        patientId: who.patientId,
        today: who.today,
        rules: brain.rules,
      })
    : null;
  const target = mealTarget({
    mealType: ask.mealType,
    dayCalories: brain.dayCalories,
    conditionNames: brain.conditionNames,
    motivationNames: brain.motivationNames,
    rules: brain.rules,
  });
  const claimed = ask.picture ?? ask.summary;
  const levels = brain.rules.steerByLevels
    ? steerLevels({
        mealType: ask.mealType,
        claims: { little: claimed.little, aLot: claimed.aLot, source: ask.picture ? "answers" : "week" },
        week: brain.week,
        picture: brain.picture,
        today: brain.today,
        sodiumLimitMg: brain.sodiumLimitMg,
      })
    : [];
  // Limits have no switch.
  const ceilings = levelCeilings({ mealType: ask.mealType, sodiumLimitMg: brain.sodiumLimitMg, week: brain.week });
  const need: ProteinNeed = brain.rules.mainsOnProtein
    ? proteinNeed({
        conditionNames: brain.conditionNames,
        motivationNames: brain.motivationNames,
        weekWord: brain.week.find((r) => r.key === "protein")?.word ?? null,
        behindToday: levels.some((l) => l.key === "protein" && l.direction === "more" && l.why === "today"),
      })
    : "free";
  return { ruleOn, choice, need, target, levels, ceilings };
}
