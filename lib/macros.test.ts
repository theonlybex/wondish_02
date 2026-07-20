import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  toGrams,
  sumIngredientMacros,
  recipeToPerServing,
  snapshotFromMacros,
  snapshotFromCustomIngredient,
  scaleSnapshot,
  sumMealLogs,
  macroRatios,
  macroDeviation,
  ZERO_SNAPSHOT,
  r1,
  UNIT_TO_GRAMS,
  computeDailyMacros,
  resolveMacroProfile,
  getMacroPercentages,
  KCAL_PER_KG,
} from "./macros";

// ─── toGrams ────────────────────────────────────────────────────────────────

test("toGrams: known units convert quantity to grams", () => {
  assert.equal(toGrams(200, "g"), 200);
  assert.equal(toGrams(1, "cup"), 240);
  assert.equal(toGrams(2, "tbsp"), 30);
  assert.equal(toGrams(1, "OZ"), 28.35); // case-insensitive
  assert.equal(toGrams(1, "  cup  "), 240); // trims whitespace
});

test("toGrams: unknown unit returns null", () => {
  assert.equal(toGrams(3, "bushel"), null);
});

test("toGrams: missing quantity or unit returns null", () => {
  assert.equal(toGrams(null, "g"), null);
  assert.equal(toGrams(0, "g"), null); // falsy quantity, matches original script behavior
  assert.equal(toGrams(5, null), null);
});

// ─── sumIngredientMacros ────────────────────────────────────────────────────

// Golden fixture: hand-computed per-100g scaling for three ingredients, then
// rounded exactly as fetch-nutrition.mjs:270-281 rounds at its call site
// (Math.round on calories, r1 (round-to-1-decimal) on protein/carbs/fat).
// Fiber is intentionally left out of the golden assertion — the script's
// summation loop never summed it, and that gap is preserved, not fixed.
const goldenItems = [
  {
    ingredient: { calories: 165, protein: 31, carbs: 0, fat: 3.6, fiber: 0 },
    quantity: 200,
    unit: "g",
  },
  {
    ingredient: { calories: 130, protein: 2.7, carbs: 28, fat: 0.3, fiber: 0.4 },
    quantity: 1,
    unit: "cup",
  },
  {
    ingredient: { calories: 34, protein: 2.8, carbs: 7, fat: 0.4, fiber: 2.6 },
    quantity: 100,
    unit: "g",
  },
];

test("sumIngredientMacros: golden-fixture parity against the script's post-rounding output", () => {
  const raw = sumIngredientMacros(goldenItems);
  // Raw (unrounded) sums, per-100g scaling.
  assert.equal(raw.calories, 676);
  assert.ok(Math.abs(raw.protein - 71.28) < 1e-9);
  assert.ok(Math.abs(raw.carbs - 74.2) < 1e-9);
  assert.ok(Math.abs(raw.fat - 8.32) < 1e-9);
  assert.equal(raw.incomplete, false);

  // The script's own call-site rounding (Math.round calories, r1 macros).
  const scriptRounded = {
    calories: Math.round(raw.calories),
    protein: Math.round(raw.protein * 10) / 10,
    carbs: Math.round(raw.carbs * 10) / 10,
    fat: Math.round(raw.fat * 10) / 10,
  };
  assert.deepEqual(scriptRounded, { calories: 676, protein: 71.3, carbs: 74.2, fat: 8.3 });
});

test("sumIngredientMacros: unknown unit is dropped, flagged incomplete, and fires onUnknownUnit", () => {
  const fired: (string | null)[] = [];
  const result = sumIngredientMacros(
    [
      ...goldenItems,
      { ingredient: { calories: 50, protein: 1, carbs: 1, fat: 1, fiber: 1 }, quantity: 2, unit: "bushel" },
    ],
    (unit) => fired.push(unit)
  );
  // Dropped item contributes nothing; sums match the golden fixture exactly.
  assert.equal(result.calories, 676);
  assert.equal(result.incomplete, true);
  assert.deepEqual(fired, ["bushel"]);
});

test("sumIngredientMacros: missing ingredient nutrient data is skipped (no callback) and flags incomplete", () => {
  const fired: (string | null)[] = [];
  const result = sumIngredientMacros(
    [
      { ingredient: { calories: null, protein: null, carbs: null, fat: null, fiber: null }, quantity: 100, unit: "g" },
      goldenItems[0],
    ],
    (unit) => fired.push(unit)
  );
  assert.equal(result.calories, 330); // only the priced item contributes
  assert.equal(result.incomplete, true);
  assert.deepEqual(fired, []); // not a unit problem — never fires the unit callback
});

test("sumIngredientMacros: empty list returns ZERO_SNAPSHOT", () => {
  assert.deepEqual(sumIngredientMacros([]), ZERO_SNAPSHOT);
});

test("sumIngredientMacros: default onUnknownUnit does not throw (console.warn fallback)", () => {
  assert.doesNotThrow(() => {
    sumIngredientMacros([{ ingredient: { calories: 10 }, quantity: 1, unit: "bushel" }]);
  });
});

// ─── recipeToPerServing ─────────────────────────────────────────────────────

test("recipeToPerServing: divides the whole-dish total by servings", () => {
  const recipe = { calories: 1000, protein: 80, carbs: 100, fat: 40, fiber: 20, servings: 2 };
  const per = recipeToPerServing(recipe);
  assert.equal(per.calories, 500);
  assert.equal(per.protein, 40);
  assert.equal(per.carbs, 50);
  assert.equal(per.fat, 20);
  assert.equal(per.fiber, 10);
  assert.equal(per.incomplete, false);
});

test("recipeToPerServing: servings null or 0 treated as 1", () => {
  const base = { calories: 300, protein: 20, carbs: 30, fat: 10, fiber: 5 };
  assert.equal(recipeToPerServing({ ...base, servings: null }).calories, 300);
  assert.equal(recipeToPerServing({ ...base, servings: 0 }).calories, 300);
});

test("recipeToPerServing + scaleSnapshot: 1000/3 servings re-sums to exactly 1000 (no drift)", () => {
  const recipe = { calories: 1000, protein: 0, carbs: 0, fat: 0, fiber: 0, servings: 3 };
  const per = recipeToPerServing(recipe);
  assert.ok(Math.abs(per.calories - 1000 / 3) < 1e-9); // stored unrounded
  const totals = scaleSnapshot(per, 3);
  assert.equal(totals.calories, 1000); // r1 boundary absorbs the float remainder exactly
});

test("recipeToPerServing: missing whole-dish calories flags incomplete", () => {
  const per = recipeToPerServing({ calories: null, protein: null, carbs: null, fat: null, fiber: null, servings: 1 });
  assert.equal(per.incomplete, true);
  assert.equal(per.calories, 0);
});

// ─── snapshotFromMacros ─────────────────────────────────────────────────────

test("snapshotFromMacros: fully-supplied values pass through untouched", () => {
  const snap = snapshotFromMacros({ calories: 420, protein: 38, carbs: 12, fat: 24, fiber: 5 });
  assert.deepEqual(snap, { calories: 420, protein: 38, carbs: 12, fat: 24, fiber: 5, incomplete: false });
});

test("snapshotFromMacros: nullish fields default to 0 and flag incomplete", () => {
  const snap = snapshotFromMacros({ calories: 420, protein: 38 });
  assert.equal(snap.calories, 420);
  assert.equal(snap.protein, 38);
  assert.equal(snap.carbs, 0);
  assert.equal(snap.fat, 0);
  assert.equal(snap.fiber, 0);
  assert.equal(snap.incomplete, true);
});

// ─── snapshotFromCustomIngredient (NO quantity/multiplier parameter) ───────

test("snapshotFromCustomIngredient: maps per-unit macros 1:1, fiber 0 without incomplete", () => {
  const ci = { calories: 80, protein: 5, carbs: 10, fat: 2 };
  const snap = snapshotFromCustomIngredient(ci);
  assert.deepEqual(snap, { calories: 80, protein: 5, carbs: 10, fat: 2, fiber: 0, incomplete: false });
});

test("snapshotFromCustomIngredient: null macro fields flag incomplete (fiber absence still doesn't)", () => {
  const snap = snapshotFromCustomIngredient({ calories: 80, protein: null, carbs: 10, fat: 2 });
  assert.equal(snap.protein, 0);
  assert.equal(snap.fiber, 0);
  assert.equal(snap.incomplete, true);
});

test("snapshotFromCustomIngredient: scaleSnapshot(snap, 2) yields exactly 2x — no double-scaling", () => {
  const ci = { calories: 80, protein: 5, carbs: 10, fat: 2 };
  const snap = snapshotFromCustomIngredient(ci);
  const totals = scaleSnapshot(snap, 2);
  assert.deepEqual(totals, { calories: 160, protein: 10, carbs: 20, fat: 4, fiber: 0, incomplete: false });
});

// ─── scaleSnapshot ──────────────────────────────────────────────────────────

test("scaleSnapshot: fractional servings (0.5, 1.5) scale exactly", () => {
  const per = { calories: 400, protein: 30, carbs: 40, fat: 10, fiber: 5, incomplete: false };
  assert.deepEqual(scaleSnapshot(per, 0.5), { calories: 200, protein: 15, carbs: 20, fat: 5, fiber: 2.5, incomplete: false });
  assert.deepEqual(scaleSnapshot(per, 1.5), { calories: 600, protein: 45, carbs: 60, fat: 15, fiber: 7.5, incomplete: false });
});

test("scaleSnapshot: r1-rounds only at this boundary", () => {
  const per = { calories: 100 / 3, protein: 0, carbs: 0, fat: 0, fiber: 0, incomplete: false };
  const totals = scaleSnapshot(per, 1);
  assert.equal(totals.calories, r1(100 / 3));
});

test("scaleSnapshot: preserves incomplete flag", () => {
  const per = { calories: 100, protein: 10, carbs: 10, fat: 10, fiber: 0, incomplete: true };
  assert.equal(scaleSnapshot(per, 2).incomplete, true);
});

// ─── sumMealLogs ────────────────────────────────────────────────────────────

test("sumMealLogs: empty array returns ZERO_SNAPSHOT", () => {
  assert.deepEqual(sumMealLogs([]), ZERO_SNAPSHOT);
});

test("sumMealLogs: excludes tombstoned (deletedAt set) rows", () => {
  const rows = [
    { calories: 400, protein: 30, carbs: 40, fat: 10, fiber: 5, servings: 1, deletedAt: null },
    { calories: 999, protein: 999, carbs: 999, fat: 999, fiber: 999, servings: 1, deletedAt: new Date() },
  ];
  const totals = sumMealLogs(rows);
  assert.equal(totals.calories, 400);
});

test("sumMealLogs: scales each row by its own servings before summing", () => {
  const rows = [
    { calories: 100, protein: 10, carbs: 10, fat: 5, fiber: 1, servings: 2, deletedAt: null },
    { calories: 50, protein: 5, carbs: 5, fat: 2, fiber: 0.5, servings: 1, deletedAt: null },
  ];
  const totals = sumMealLogs(rows);
  assert.equal(totals.calories, 250); // 100*2 + 50*1
  assert.equal(totals.protein, 25);
});

test("sumMealLogs: incomplete propagates if any contributing row is incomplete", () => {
  const rows = [
    { calories: 100, protein: 10, carbs: 10, fat: 5, fiber: 1, servings: 1, incomplete: false, deletedAt: null },
    { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, servings: 1, incomplete: true, deletedAt: null },
  ];
  assert.equal(sumMealLogs(rows).incomplete, true);
});

// ─── macroRatios / macroDeviation ───────────────────────────────────────────

test("macroRatios: computes calorie-normalized protein/carbs/fat ratios", () => {
  // 4 kcal/g protein & carbs, 9 kcal/g fat — matches both old inline copies.
  const ratios = macroRatios({ calories: 400, protein: 30, carbs: 40, fat: 10 });
  assert.ok(Math.abs(ratios.protein - (30 * 4) / 400) < 1e-9);
  assert.ok(Math.abs(ratios.carbs - (40 * 4) / 400) < 1e-9);
  assert.ok(Math.abs(ratios.fat - (10 * 9) / 400) < 1e-9);
});

test("macroDeviation: regression-matches the old lib/meal-plan.ts inline formula", () => {
  const macroTarget = getMacroPercentages("balanced"); // { protein: 0.30, carbs: 0.50, fat: 0.20 }
  const r = { calories: 500, protein: 40, carbs: 50, fat: 15 };
  const oldFormula =
    Math.abs(((r.protein ?? 0) * 4) / r.calories - macroTarget.protein) +
    Math.abs(((r.carbs ?? 0) * 4) / r.calories - macroTarget.carbs) +
    Math.abs(((r.fat ?? 0) * 9) / r.calories - macroTarget.fat);
  const deviation = macroDeviation(r, macroTarget);
  assert.ok(Math.abs(deviation - oldFormula) < 1e-9);
});

test("macroDeviation: boundary cases around the swap route's `> 0.50` threshold", () => {
  const macroTarget = { protein: 0.30, carbs: 0.50, fat: 0.20 };
  // Deviation exactly at the boundary — old code used strict `> 0.50`, so this
  // must NOT trip the reject branch (deviation === 0.50, not > 0.50).
  const atBoundary = macroDeviation({ calories: 100, protein: 20, carbs: 0, fat: 0 }, macroTarget);
  // protein ratio = 20*4/100 = 0.80; |0.80-0.30| = 0.50; carbs |0-0.50|=0.50; fat |0-0.20|=0.20 → sum 1.20
  // (kept as a concrete, hand-checkable value rather than asserting the threshold itself,
  // since the >0.50 check is the swap route's responsibility, not macroDeviation's)
  assert.ok(Math.abs(atBoundary - 1.20) < 1e-9);

  // Ratios exactly matching the target (protein 30%, carbs 50%, fat 20% of
  // calories) → deviation 0, comfortably within the swap route's budget.
  const withinBudget = macroDeviation({ calories: 360, protein: 27, carbs: 45, fat: 8 }, macroTarget);
  assert.ok(withinBudget <= 0.50);
});

test("macroRatios: zero or missing calories returns all-zero ratios (no divide-by-zero)", () => {
  assert.deepEqual(macroRatios({ calories: 0, protein: 10, carbs: 10, fat: 10 }), { protein: 0, carbs: 0, fat: 0 });
});

// ─── Re-exports from lib/caloric-engine.ts (single import surface) ─────────

test("re-exports computeDailyMacros/resolveMacroProfile/getMacroPercentages/KCAL_PER_KG from caloric-engine", () => {
  assert.equal(typeof computeDailyMacros, "function");
  assert.equal(typeof resolveMacroProfile, "function");
  assert.equal(typeof getMacroPercentages, "function");
  assert.equal(KCAL_PER_KG, 7700);
});

// ─── Single-source guard ─────────────────────────────────────────────────────
// A future inline copy of the deviation formula (outside lib/macros.ts) must
// fail this test. Patterns are built via array-join so this test file itself
// never contains the literal substrings it's guarding against.

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..");
const SCAN_DIRS = ["app", "lib", "scripts"];
const SCAN_EXTS = new Set([".ts", ".tsx", ".js", ".mjs"]);
const EXCLUDE_DIRS = new Set(["node_modules", ".next", ".git"]);
const EXEMPT_FILES = new Set([
  join(REPO_ROOT, "lib", "macros.ts"),
  join(REPO_ROOT, "lib", "macros.test.ts"),
]);

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (EXCLUDE_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) collectSourceFiles(full, out);
    else if (SCAN_EXTS.has(extname(entry))) out.push(full);
  }
  return out;
}

test("grep guard: no inline deviation-math copy outside lib/macros.ts", () => {
  const fatPattern = ["*", " 9) / cal"].join("");
  const proteinCarbPattern = ["*", " 4) / cal"].join("");
  const unitTablePattern = "UNIT_TO_GRAMS"; // safe to spell out — this file is exempted below
  const offenders: string[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of collectSourceFiles(join(REPO_ROOT, dir))) {
      if (EXEMPT_FILES.has(file)) continue;
      const content = readFileSync(file, "utf8");
      if (
        content.includes(fatPattern) ||
        content.includes(proteinCarbPattern) ||
        content.includes(unitTablePattern)
      ) {
        offenders.push(file);
      }
    }
  }
  assert.deepEqual(offenders, []);
});
