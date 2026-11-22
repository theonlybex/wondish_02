// The Grocery list of the Clara app (owner, 2026-11-22): what to buy, chosen in
// code, never by the model. Two kinds of group:
//  - one per nutrient the person is low on, when nothing they have at home is a
//    real source of it: catalog foods that are ("For fibre");
//  - one per food family that is thin at home, fewer than two foods of it
//    ("Protein variety").
// Favourites come first in a group. Foods the diet bans never reach here (the
// catalog rows are already filtered). Pure: no database, no model client.
import { LEVELS, type FullLevelKey } from "@/lib/level-catalogue";
import { proteinKind } from "./dish-protein";
import type { CatalogRow } from "./kept-foods";
import type { PictureLevels, SteerRow } from "./level-steer";

export interface GroceryItem { id: string; name: string; favorite: boolean }
export interface GroceryGroup {
  /** "level:fibre" or "variety:proteins". */
  key: string;
  kind: "level" | "variety";
  title: string;
  /** One plain sentence saying why the group is on the list. */
  reason: string;
  /** May be empty for a level their diet leaves no food for; then `note` says what to do. */
  items: GroceryItem[];
  /** Nothing they eat is a real source of it: what people usually do. With foods, those are the small sources. */
  note?: string;
  /** Other nutrients they are low on that a food in this group also covers, so none goes unnamed. */
  also?: { level: string; food: string }[];
}

/** The most foods in a nutrient group, and in a variety group (one purchase closes a variety group). */
export const MAX_LEVEL_ITEMS = 4;
export const MAX_VARIETY_ITEMS = 3;
/** The most nutrient groups with foods; a level their diet leaves no food for is always shown. */
export const MAX_LEVEL_GROUPS = 5;
/** A family with fewer foods at home than this gets a variety group. */
export const MIN_FAMILY_AT_HOME = 2;

const DEF = new Map(LEVELS.map((l) => [l.key as string, l]));
const ORDER = new Map(LEVELS.map((l, i) => [l.key as string, i]));

export interface LowLevel { key: FullLevelKey; name: string; why: "week" | "answers" }

/**
 * Every level the person is low on, in the Numbers list's order: the week's logs first ("little"),
 * then the first-run answers for levels the logs cannot count. Limits ("under") are never here.
 */
export function lowLevels(week: readonly SteerRow[], picture: PictureLevels | null): LowLevel[] {
  const out = new Map<string, LowLevel>();
  const measured = new Set<string>();
  for (const r of week) {
    if (!r.word) continue;
    measured.add(r.key);
    const def = DEF.get(r.key);
    if (def && def.direction !== "under" && r.word === "little") out.set(r.key, { key: def.key, name: def.name, why: "week" });
  }
  for (const k of picture?.little ?? []) {
    const def = DEF.get(k);
    if (def && def.direction !== "under" && !measured.has(k) && !out.has(k)) out.set(k, { key: def.key, name: def.name, why: "answers" });
  }
  return [...out.values()].sort((x, y) => ORDER.get(x.key)! - ORDER.get(y.key)!);
}

/** Protein foods are a catalog group, not a list. */
const isProteinRow = (r: CatalogRow) => {
  const k = proteinKind(r.name);
  // Bacon seasons a dish; it is not what a meal is built on.
  return k !== null && k.cls !== "dairy" && !/\bbacon\b/i.test(r.name);
};

// A mixed first offer for proteins (the catalog lists the poultry and red meats first): a bird, a fish, a red meat, a plant protein, a pulse.
const PROTEIN_FIRST = ["Boneless chicken breasts", "Salmon fillets", "Ground beef", "Extra-firm tofu", "Black beans", "Large eggs", "Canned tuna", "Shrimp", "Ground turkey", "Green lentils"];
// The same for the other two families: everyday foods a cook builds on, not the catalog's alphabet.
const PRODUCE_FIRST = ["Broccoli", "Bell peppers", "Carrots", "Roma tomatoes", "Russet potatoes", "Bananas", "Kale", "Sweet potatoes", "Zucchini", "Apples"];
const GRAINS_FIRST = ["Rolled oats", "Brown rice", "Spaghetti", "Sliced bread", "Quinoa", "Jasmine rice", "Couscous", "Flour tortillas"];
const ranked = (first: readonly string[]) => (rows: readonly CatalogRow[]) => {
  const rank = (r: CatalogRow) => { const i = first.indexOf(r.name); return i < 0 ? first.length : i; };
  return rows.map((r, i) => ({ r, i })).sort((x, y) => rank(x.r) - rank(y.r) || x.i - y.i).map((x) => x.r);
};
const mixedProteins = ranked(PROTEIN_FIRST);

/**
 * The catalog foods that are sources of each level, the strongest first. The first `strong` of them
 * are real sources: only those count as "something at home helps" (an egg does not cover vitamin D,
 * green beans do not cover fibre), and they lead the group. Written out by name because matching
 * the dish instructions' example words against the catalog put green beans first for fibre and
 * lost the lentils (grocery review, 2026-11-22). Placeholder for clinician review, like LEVELS.
 */
export const SOURCES: Readonly<Partial<Record<FullLevelKey, { foods: readonly string[]; strong: number }>>> = {
  carbs: { foods: ["Jasmine rice", "Russet potatoes", "Rolled oats", "Spaghetti", "Sliced bread", "Brown rice", "Sweet potatoes", "Quinoa"], strong: 8 },
  fibre: { foods: ["Green lentils", "Black beans", "Rolled oats", "Chia seeds", "Garbanzo beans", "Red lentils", "White beans", "Avocados", "Green peas", "Barley", "Quinoa", "Ground flaxseed", "Broccoli", "Brown rice"], strong: 11 },
  // The target (250 mg) is the fish kind, EPA and DHA. Walnuts, chia and flax carry the plant kind, of which the body turns little into those.
  omega3: { foods: ["Salmon fillets", "Canned tuna", "Walnuts", "Chia seeds", "Ground flaxseed"], strong: 2 },
  potassium: { foods: ["Russet potatoes", "White beans", "Spinach", "Bananas", "Avocados", "Sweet potatoes", "Black beans", "Green lentils", "Yukon Gold potatoes"], strong: 9 },
  // Tofu counts when set with calcium and the plant milks when fortified, as most sold are. Parmesan is eaten by the spoonful.
  calcium: { foods: ["Plain Greek yogurt", "Whole milk", "Extra-firm tofu", "Shredded cheddar", "Almond milk", "Oat milk", "Shredded mozzarella", "Kale", "White beans", "Almonds", "Grated parmesan", "Sesame seeds"], strong: 7 },
  iron: { foods: ["Green lentils", "Ground beef", "Garbanzo beans", "Extra-firm tofu", "Black beans", "Red lentils", "White beans", "Sirloin steak", "Spinach"], strong: 8 },
  magnesium: { foods: ["Almonds", "Black beans", "Spinach", "Rolled oats", "Quinoa", "Chia seeds", "Brown rice"], strong: 6 },
  zinc: { foods: ["Ground beef", "Garbanzo beans", "Green lentils", "Sirloin steak", "Sesame seeds", "Rolled oats"], strong: 4 },
  iodine: { foods: ["Whole milk", "Plain Greek yogurt", "Large eggs", "Shrimp", "Canned tuna", "Tilapia fillets"], strong: 3 },
  vitaminA: { foods: ["Sweet potatoes", "Carrots", "Spinach", "Kale", "Large eggs"], strong: 4 },
  vitaminB6: { foods: ["Garbanzo beans", "Salmon fillets", "Boneless chicken breasts", "Russet potatoes", "Bananas"], strong: 5 },
  // The plant milks are usually fortified with B12 and D; nothing else a vegan eats carries them.
  vitaminB12: { foods: ["Salmon fillets", "Ground beef", "Canned tuna", "Sirloin steak", "Whole milk", "Plain Greek yogurt", "Large eggs", "Oat milk", "Almond milk"], strong: 6 },
  vitaminC: { foods: ["Bell peppers", "Broccoli", "Oranges", "Strawberries", "Brussels sprouts", "Kale", "Roma tomatoes", "Lemons"], strong: 6 },
  // Salmon, and milk as sold (fortified). A can of tuna or an egg gives about a twentieth of the day.
  vitaminD: { foods: ["Salmon fillets", "Whole milk", "Oat milk", "Almond milk", "Canned tuna", "Large eggs"], strong: 2 },
  vitaminE: { foods: ["Almonds", "Avocados", "Spinach"], strong: 2 },
  vitaminK: { foods: ["Kale", "Spinach", "Broccoli", "Green cabbage", "Brussels sprouts"], strong: 5 },
  folate: { foods: ["Green lentils", "Garbanzo beans", "Black beans", "Spinach", "Asparagus", "Broccoli", "Avocados"], strong: 7 },
};

/** The catalog foods that are sources of a level, strongest first, with whether each is a real source. */
export function richRows(key: FullLevelKey, rows: readonly CatalogRow[]): { row: CatalogRow; strong: boolean }[] {
  if (key === "protein") return mixedProteins(rows.filter(isProteinRow)).map((row) => ({ row, strong: true }));
  const src = SOURCES[key];
  if (!src) return [];
  const byName = new Map(rows.map((r) => [r.name, r]));
  return src.foods.flatMap((name, i) => {
    const row = byName.get(name);
    return row ? [{ row, strong: i < src.strong }] : [];
  });
}

// The families of a kitchen: what a dish is built from. Seasonings, oils and sauces are not counted.
const FAMILIES: readonly { key: string; title: string; one: string; has: (r: CatalogRow) => boolean; offer: (rows: readonly CatalogRow[]) => CatalogRow[] }[] = [
  { key: "proteins", title: "Protein variety", one: "protein", has: isProteinRow, offer: (rows) => mixedProteins(rows.filter((r) => r.groupKey === "proteins" || isProteinRow(r))) },
  { key: "produce", title: "Vegetable and fruit variety", one: "vegetable or fruit", has: (r) => r.groupKey === "produce", offer: (rows) => ranked(PRODUCE_FIRST)(rows.filter((r) => r.groupKey === "produce")) },
  { key: "grains", title: "Grain and carb variety", one: "grain or carb", has: (r) => r.groupKey === "grains", offer: (rows) => ranked(GRAINS_FIRST)(rows.filter((r) => r.groupKey === "grains")) },
];

/** What kind of food a row is, so a short list is not three kinds of rice or two of pasta: the protein's key, else the name's last word. */
const kindOf = (r: CatalogRow): string => {
  const k = proteinKind(r.name);
  if (k && k.cls !== "dairy") return k.key.startsWith("ground ") ? k.key.slice(7) : k.key;
  if (/\b(spaghetti|penne|pasta|noodles?)\b/i.test(r.name)) return "pasta";
  return (r.name.trim().toLowerCase().split(/\s+/).pop() ?? "").replace(/(es|s)$/, "");
};

/** Favourites first, then the order given; one of each kind; at most `max`. */
function pick(rows: readonly CatalogRow[], max: number): GroceryItem[] {
  const seen = new Set<string>();
  const out: GroceryItem[] = [];
  for (const r of [...rows.filter((x) => x.favorite), ...rows.filter((x) => !x.favorite)]) {
    const kind = kindOf(r);
    if (seen.has(kind)) continue;
    seen.add(kind);
    out.push({ id: r.id, name: r.name, favorite: r.favorite });
    if (out.length >= max) break;
  }
  return out;
}

/** "Fibre" → "fibre", "Vitamin C" → "vitamin C", "Omega-3" → "omega-3". */
const lowerFirst = (name: string) => name.charAt(0).toLowerCase() + name.slice(1);

export const SMALL_SOURCES_NOTE = "Nothing your diet allows is a strong source of it. These give a little; fortified foods or a supplement are the usual way, and a doctor or pharmacist can say what suits you.";
const SALTY = new Set(["Shredded cheddar", "Canned tuna", "Sliced bread", "Feta cheese", "Grated parmesan", "Bacon", "Shredded mozzarella"]);
export const NO_FOOD_NOTE = "Nothing your diet allows is a good source of it. Fortified foods or a supplement are the usual way; a doctor or pharmacist can say what suits you.";

/**
 * The list. `rows` is the whole catalog the diet allows, with the person's marks.
 *  - A level group appears only when no REAL source of that level is at home. Its foods are the real
 *    sources they may eat, favourites first. When their diet leaves none, the group is still shown,
 *    with a note in place of foods (a vegan low on B12 is not passed over in silence).
 *  - At most five level groups with foods, in the Numbers list's order; none for a level whose
 *    real source is already on the list in a group above.
 *  - A variety group when the family has fewer than two foods at home, unless the level groups
 *    above already list two foods of that family.
 *  - A food is listed once, in the first group that names it.
 */
export function groceryGroups(a: { rows: readonly CatalogRow[]; week: readonly SteerRow[]; picture: PictureLevels | null }): GroceryGroup[] {
  // Someone who already gets a lot of sodium is not sent to buy the salty sources.
  const tooMuchSodium = a.week.some((r) => r.key === "sodium" && (r.word === "a lot" || r.word === "more than needed")) || (a.picture?.aLot ?? []).includes("sodium");
  const allowed = (r: CatalogRow) => !(tooMuchSodium && SALTY.has(r.name));
  /** Which group lists each food, for "also covers". */
  const groupOf = new Map<string, GroceryGroup>();
  const groups: GroceryGroup[] = [];
  const listed = new Map<string, CatalogRow>();
  const take = (rows: readonly CatalogRow[], max: number) => {
    const fresh = rows.filter((r) => !r.atHome && !listed.has(r.id) && allowed(r));
    const items = pick(fresh, max);
    for (const i of items) listed.set(i.id, fresh.find((r) => r.id === i.id)!);
    return items;
  };

  let withFoods = 0;
  for (const low of lowLevels(a.week, a.picture)) {
    const rich = richRows(low.key, a.rows);
    if (rich.some((x) => x.strong && x.row.atHome)) continue; // Clara already has a real source to cook with.
    const lower = lowerFirst(low.name);
    const opening = low.why === "week" ? `You've had little ${lower} this week` : `From your answers you probably get little ${lower}`;
    const strong = rich.filter((x) => x.strong).map((x) => x.row);
    if (strong.length === 0) {
      // Nothing they eat is a real source: say so, and list the small sources they may eat, if any.
      const small = take(rich.map((x) => x.row), MAX_VARIETY_ITEMS);
      const g: GroceryGroup = { key: `level:${low.key}`, kind: "level", title: `For ${lower}`, reason: `${opening}.`, items: small, note: small.length > 0 ? SMALL_SOURCES_NOTE : NO_FOOD_NOTE };
      for (const i of small) groupOf.set(i.id, g);
      groups.push(g);
      continue;
    }
    // A real source of it is already on the list, in a group above (the salmon under vitamin D is the
    // B12 too): no group of its own, but that group names it, so no low nutrient goes unsaid.
    const covering = strong.find((r) => listed.has(r.id));
    if (covering) {
      const g = groupOf.get(covering.id);
      if (g) g.also = [...(g.also ?? []), { level: lower, food: covering.name }];
      continue;
    }
    if (withFoods >= MAX_LEVEL_GROUPS) continue;
    const items = take(strong, MAX_LEVEL_ITEMS);
    if (items.length === 0) continue; // Every real source they may buy is ruled out (too salty for them).
    withFoods++;
    const g: GroceryGroup = { key: `level:${low.key}`, kind: "level", title: `For ${lower}`, reason: `${opening}, and you have no strong source of it at home.`, items };
    for (const i of items) groupOf.set(i.id, g);
    groups.push(g);
  }

  for (const f of FAMILIES) {
    const have = a.rows.filter((r) => r.atHome && f.has(r));
    // Two kinds, not two foods: jasmine and basmati are one rice.
    if (new Set(have.map(kindOf)).size >= MIN_FAMILY_AT_HOME) continue;
    // The groups above already offer two foods of this family: buying from them fixes it.
    if (new Set([...listed.values()].filter(f.has).map(kindOf)).size >= MIN_FAMILY_AT_HOME) continue;
    // Not another of what they already have (a second rice is no variety).
    const haveKinds = new Set(have.map(kindOf));
    const items = take(f.offer(a.rows).filter((r) => !haveKinds.has(kindOf(r))), MAX_VARIETY_ITEMS);
    if (items.length === 0) continue;
    groups.push({
      key: `variety:${f.key}`,
      kind: "variety",
      title: f.title,
      reason: have.length === 0
        ? `You have no ${f.one} marked at home. Clara needs at least one, and a second gives her different dishes to make.`
        : `You have only one kind of ${f.one} at home: ${have[0].name}. A second gives Clara different dishes to make.`,
      items,
    });
  }
  return groups;
}
