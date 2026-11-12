// The starting picture: which levels a person has probably had little of, or a
// lot of, from their "usual eating" answers and the pills they take.
// Pure. The phone carries the same rules (both test files hold the same five
// vectors). Wording elsewhere is intake, never body state.

import type { FullLevelKey, PillName } from "./level-catalogue";

/** 0 rarely, 1 some days, 2 most days, null unanswered. */
export type Answer = 0 | 1 | 2 | null;

export const USUAL_EATING_KEYS = [
  "veg", "fruit", "beans", "grains", "fish", "meat", "dairy", "packaged", "sweet",
] as const;
export type UsualEatingKey = (typeof USUAL_EATING_KEYS)[number];
export type UsualEating = Record<UsualEatingKey, Answer>;

export interface StartingPicture {
  little: FullLevelKey[];
  aLot: FullLevelKey[];
}

type Num = number | null;
const sum = (...xs: Num[]): number | null =>
  xs.some((x) => x === null) ? null : (xs as number[]).reduce((a, b) => a + b, 0);

export function startingPicture(v: UsualEating, pills: PillName[]): StartingPicture {
  const has = (p: PillName) => pills.includes(p);
  const multi = has("Multivitamin");
  // A rule fires only when every answer it reads is non-null.
  const le = (n: number | null, max: number) => n !== null && n <= max;
  const eq = (n: Num, x: number) => n !== null && n === x;
  const lt = (n: Num, x: number) => n !== null && n < x;

  const little: FullLevelKey[] = [];
  if (le(sum(v.veg, v.fruit, v.beans, v.grains), 3)) little.push("fibre");
  if (le(sum(v.beans, v.meat), 1) && !has("Iron")) little.push("iron");
  if (le(sum(v.veg, v.fruit, v.beans), 2)) little.push("potassium");
  if (eq(v.dairy, 0) && !has("Calcium")) little.push("calcium");
  if (eq(v.fish, 0) && !has("Omega-3")) little.push("omega3");
  if (lt(v.fish, 2) && !has("Vitamin D") && !multi) little.push("vitaminD");
  if (eq(v.meat, 0) && eq(v.dairy, 0) && !has("Vitamin B12") && !multi) little.push("vitaminB12");
  if (le(sum(v.veg, v.fruit), 1) && !multi) little.push("vitaminC");
  if (le(sum(v.beans, v.grains, v.veg), 1) && !has("Magnesium")) little.push("magnesium");

  const aLot: FullLevelKey[] = [];
  if (eq(v.packaged, 2)) aLot.push("sodium");
  if (eq(v.sweet, 2)) aLot.push("addedSugar");
  if (eq(v.meat, 2) && eq(v.dairy, 2)) aLot.push("saturatedFat");

  return { little, aLot };
}
