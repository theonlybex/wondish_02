// The Grocery list of the Clara app (owner, 2026-11-22): what to buy, chosen in
// code, never by the model. Two kinds of group:
//  - one per nutrient the person is low on, when nothing they have at home helps
//    with it: foods from the catalog that are rich in it ("For fibre");
//  - one per food family that is thin at home, fewer than two foods of it
//    ("Protein variety").
// Favourites come first in a group. Foods the diet bans never reach here (the
// catalog rows are already filtered). Pure: no database, no model client.
import { LEVELS, type FullLevelKey } from "@/lib/level-catalogue";
import { proteinKind } from "./dish-protein";
import { foodMatches, type CatalogRow } from "./kept-foods";
import { RICH_FOODS, type PictureLevels, type SteerRow } from "./level-steer";

export interface GroceryItem { id: string; name: string; favorite: boolean }
export interface GroceryGroup {
  /** "level:fibre" or "variety:proteins". */
  key: string;
  kind: "level" | "variety";
  title: string;
  /** One plain sentence saying why the group is on the list. */
  reason: string;
  items: GroceryItem[];
}

export const MAX_GROCERY_ITEMS = 5;
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

/** Protein foods are a catalog group, not a word list ("meat" names no row). */
const isProteinRow = (r: CatalogRow) => {
  const k = proteinKind(r.name);
  return k !== null && k.cls !== "dairy";
};

/** The catalog foods rich in a level. */
export function richRows(key: FullLevelKey, rows: readonly CatalogRow[]): CatalogRow[] {
  if (key === "protein") return rows.filter(isProteinRow);
  const examples = RICH_FOODS[key].split(", ").flatMap((e) => e.split(" or "));
  return rows.filter((r) => examples.some((e) => foodMatches(e, r.name)));
}

// A mixed first offer for proteins (the catalog lists the poultry and red meats first): a bird, a fish, a red meat, a plant protein, a pulse.
const PROTEIN_FIRST = ["Boneless chicken breasts", "Salmon fillets", "Ground beef", "Extra-firm tofu", "Black beans", "Large eggs", "Canned tuna", "Shrimp", "Ground turkey", "Green lentils"];
const proteinRank = (r: CatalogRow) => { const i = PROTEIN_FIRST.indexOf(r.name); return i < 0 ? PROTEIN_FIRST.length : i; };
const mixedProteins = (rows: CatalogRow[]) => rows.map((r, i) => ({ r, i })).sort((x, y) => proteinRank(x.r) - proteinRank(y.r) || x.i - y.i).map((x) => x.r);

// The families of a kitchen: what a dish is built from. Seasonings, oils and sauces are not counted.
const FAMILIES: readonly { key: string; title: string; one: string; has: (r: CatalogRow) => boolean; offer: (r: CatalogRow) => boolean }[] = [
  { key: "proteins", title: "Protein variety", one: "protein", has: isProteinRow, offer: (r) => r.groupKey === "proteins" || isProteinRow(r) },
  { key: "produce", title: "Vegetable and fruit variety", one: "vegetable or fruit", has: (r) => r.groupKey === "produce", offer: (r) => r.groupKey === "produce" },
  { key: "grains", title: "Grain and carb variety", one: "grain or carb", has: (r) => r.groupKey === "grains", offer: (r) => r.groupKey === "grains" },
];

/** What kind of food a row is, so a short list is not five kinds of rice: the protein's key, else the name's last word. */
const kindOf = (r: CatalogRow): string => {
  const k = proteinKind(r.name);
  if (k && k.cls !== "dairy") return k.key.startsWith("ground ") ? k.key.slice(7) : k.key;
  return (r.name.trim().toLowerCase().split(/\s+/).pop() ?? "").replace(/(es|s)$/, "");
};

const pick = (rows: readonly CatalogRow[]): GroceryItem[] => {
  // Favourites first, then the catalog's own order (its most common foods lead each group); one of each kind.
  const seen = new Set<string>();
  const out: GroceryItem[] = [];
  for (const r of [...rows.filter((x) => x.favorite), ...rows.filter((x) => !x.favorite)]) {
    const kind = kindOf(r);
    if (seen.has(kind)) continue;
    seen.add(kind);
    out.push({ id: r.id, name: r.name, favorite: r.favorite });
    if (out.length >= MAX_GROCERY_ITEMS) break;
  }
  return out;
};

/**
 * The list. `rows` is the whole catalog the diet allows, with the person's marks.
 * A level group appears only when no food at home is rich in that level; a
 * variety group when the family has fewer than two foods at home. A food is
 * listed once, in the first group that names it.
 */
export function groceryGroups(a: { rows: readonly CatalogRow[]; week: readonly SteerRow[]; picture: PictureLevels | null }): GroceryGroup[] {
  const groups: GroceryGroup[] = [];
  const listed = new Set<string>();
  const take = (rows: CatalogRow[]) => {
    const items = pick(rows.filter((r) => !r.atHome && !listed.has(r.id)));
    for (const i of items) listed.add(i.id);
    return items;
  };

  for (const low of lowLevels(a.week, a.picture)) {
    const rich = richRows(low.key, a.rows);
    if (rich.some((r) => r.atHome)) continue; // Clara already has something to cook with for it.
    const items = take(low.key === "protein" ? mixedProteins(rich) : rich);
    if (items.length === 0) continue;
    const lower = low.name.toLowerCase();
    groups.push({
      key: `level:${low.key}`,
      kind: "level",
      title: `For ${lower}`,
      reason: low.why === "week"
        ? `You've had little ${lower} this week, and nothing at home is rich in it.`
        : `From your answers you probably get little ${lower}, and nothing at home is rich in it.`,
      items,
    });
  }

  for (const f of FAMILIES) {
    const have = a.rows.filter((r) => r.atHome && f.has(r));
    if (have.length >= MIN_FAMILY_AT_HOME) continue;
    // Not another of what they already have (a second rice is no variety).
    const haveKinds = new Set(have.map(kindOf));
    const offered = a.rows.filter((r) => f.offer(r) && !haveKinds.has(kindOf(r)));
    const items = take(f.key === "proteins" ? mixedProteins(offered) : offered);
    if (items.length === 0) continue;
    groups.push({
      key: `variety:${f.key}`,
      kind: "variety",
      title: f.title,
      reason: have.length === 0
        ? `You have no ${f.one} marked at home. Two or more give Clara different dishes to make.`
        : `You have only one ${f.one} at home: ${have[0].name}. A second gives Clara different dishes to make.`,
      items,
    });
  }
  return groups;
}
