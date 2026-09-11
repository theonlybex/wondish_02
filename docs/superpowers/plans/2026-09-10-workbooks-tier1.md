# Workbooks Tier 1 — Ingredient IDs, Author Recipes, Grocery Quantities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the dietitian's data package into the app without changing what users see until it's verified: give every ingredient its `ingredient_form_id` and classification (01), restore the author's own cooking instructions, quantities and full nutrition on the 953 library dishes (02), make allergen filtering component-based via the Big-9 rules (03), and put real amounts on the What-to-buy list (06).

**Architecture:** Additive schema (new nullable columns + one new table), one idempotent import script with a dry-run report and post-import invariants, and three small consumers (diet-match, the to-buy API, the pantry UI). Clara-generated dishes are never touched. The word-boundary allergen matcher stays; the component groups are OR'd in, so the filter can only get stricter. Workbooks are read with the `xlsx` package already in `node_modules`; they stay gitignored and are referenced by path.

**Tech Stack:** Next.js 14, Prisma + Neon, `xlsx@0.18` (present), `node --import tsx --test`.

**Spec:** The analysis in this session (2026-09-10) of `Wondish_01…06_081826.xlsx` plus the integrity check below. There is no separate spec document.

## Global Constraints

- **Never modify recipes tagged `clara`** (`Recipe.tags` contains `"clara"`). Only library rows (imported variants) are enriched.
- **Never rename an `Ingredient`** or change `Ingredient.name` uniqueness semantics; we only attach ids/attributes. New ingredients are created only when a workbook form has no name match (85 known).
- **Author steps replace Clara steps only when the author has ≥2 steps**; otherwise keep the existing steps. Record which is which in `Recipe.stepsSource` (`"author" | "clara"`).
- **Calories/protein/carbs/fat on existing rows are NOT overwritten** (the calorie engine and existing plans depend on them). Only the new columns (sodium, saturatedFat, sugars, addedSugars) are filled.
- **Conversions with `LOW` confidence (222 of 470) display as approximate** ("≈"); they never block a list.
- Workbook rows with `status_code`/`review_status` other than `ACTIVE`/`APPROVED`/`DIRECT_*` are imported as data but nothing in this tier *enforces* them; enforcement is Tier 2.
- Import is idempotent and dry-run by default (`--apply` to write); every write is logged with counts; a rollback JSON is written before applying.
- Migration pattern: `prisma migrate dev --create-only` → review SQL (additive only) → `prisma migrate deploy` → `prisma generate` → **restart the dev server**.
- Tests: `node --import tsx --test` via `npm test`; pure logic gets unit tests with inline fixtures (no workbook reads in tests).

## Integrity check results (2026-09-10, read-only) — why this is safe to import

| Check | Result |
|---|---|
| 01: 958 forms, duplicate ids / blank names / invisible chars | **0 / 0 / 0** |
| 02: 4,902 rows with a form id that resolves in 01 | **4,902 / 4,902** |
| 03: 4,708 health rules referencing unknown forms | **0** |
| 06: (form id, recipe unit) pairs in 02 covered by a conversion | **470 / 470** (116 HIGH, 132 MEDIUM, 222 LOW) |
| 02 recipes present in the DB library (by base name) | **291 / 292** — missing: "Chicken Brunswick Stew & Brown Rice" |
| 02 ingredient names matching a DB `Ingredient` | 252 of 337 direct; **85 need creating** (e.g. "cream of chicken soup", "fresh chives", "rice flour") |
| 02 recipes with author instructions | 268 (avg 5 steps, min 1, max 12); 7 duplicate names (portion variants), 7 without calories |
| Our 35 health conditions vs workbook names | 27 match by name; **8 need a manual mapping** (Hypertension, Thyroid Disorder, Kidney Disease stage 1-2, Foggy brain, PCOS, Recovering after illness/surgery, IBD – active / in remission) — Tier 2 concern |
| Data bug found in OUR DB | `FoodAllergy` name **"Wheat "** has a trailing space |

Nothing in the package conflicts with existing keys; every change below is additive.

---

### Task 1: Schema — ingredient identity, conversions, recipe nutrition

**Files:**
- Modify: `prisma/schema.prisma` (`model Ingredient` ~line 392, `model Recipe` ~line 358)
- Create: `prisma/migrations/<ts>_workbooks_tier1/migration.sql` (generated)

**Interfaces:**
- Produces (Prisma): `Ingredient.formId String? @unique`, `Ingredient.canonicalId String?`, `Ingredient.groceryCategory String?`, `Ingredient.components String[] @default([])`, `Ingredient.allergenGroups String[] @default([])`; `model IngredientUnitConversion { id, ingredientId, unit, baseQuantity Float, baseUnit String, confidence String, @@unique([ingredientId, unit]) }`; `Recipe.sodium Float?`, `Recipe.saturatedFat Float?`, `Recipe.sugars Float?`, `Recipe.addedSugars Float?`, `Recipe.sourceRow Int?`, `Recipe.stepsSource String?`.

- [ ] **Step 1: Edit the schema**

In `model Ingredient` add after `fat Float?`:

```prisma
  // Wondish 01 identity + classification (nullable: Clara-created and
  // user-added ingredients have none). formId is the join key to every
  // workbook; components/allergenGroups drive component-based allergen bans.
  formId          String?  @unique
  canonicalId     String?
  groceryCategory String?
  components      String[] @default([])
  allergenGroups  String[] @default([]) // e.g. "BIG9-COW-MILK" (Wondish 03)
  conversions     IngredientUnitConversion[]
```

Add the model:

```prisma
// Wondish 06: recipe unit → base amount for one ingredient form.
model IngredientUnitConversion {
  id           String     @id @default(cuid())
  ingredientId String
  ingredient   Ingredient @relation(fields: [ingredientId], references: [id], onDelete: Cascade)
  unit         String     // recipe unit as written ("tablespoon", "cup", "oz")
  baseQuantity Float      // amount of baseUnit per 1 recipe unit
  baseUnit     String     // "g" | "mL"
  confidence   String     // HIGH | MEDIUM | LOW (Wondish 06 confidence_code)

  @@unique([ingredientId, unit])
}
```

In `model Recipe` add after `fiber Float?`:

```prisma
  sodium       Float?
  saturatedFat Float?
  sugars       Float?
  addedSugars  Float?
  // Wondish 02 lineage + provenance of `steps`.
  sourceRow    Int?
  stepsSource  String? // "author" | "clara"
```

- [ ] **Step 2: Create the migration without applying**

Run: `set -a; source .env.local; set +a; npx prisma migrate dev --create-only --name workbooks_tier1`
Expected SQL: only `ALTER TABLE ... ADD COLUMN`, one `CREATE TABLE "IngredientUnitConversion"`, one unique index on `("ingredientId","unit")`, one unique index on `Ingredient.formId`. **If any `DROP` appears, stop.**

- [ ] **Step 3: Apply, regenerate, typecheck**

Run: `set -a; source .env.local; set +a; npx prisma migrate deploy && npx prisma generate && npx tsc --noEmit -p .`
Expected: "All migrations have been successfully applied", no type errors. Restart `next dev`.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(data): ingredient form ids, unit conversions, recipe nutrition columns (workbooks tier 1)"
```

---

### Task 2: Workbook readers (pure) + normalisers with tests

**Files:**
- Create: `lib/workbooks/read.ts` (xlsx I/O only)
- Create: `lib/workbooks/normalize.ts` (pure)
- Test: `lib/workbooks/normalize.test.ts`
- Modify: `package.json:11` (add `lib/workbooks/*.test.ts` to the test glob)

**Interfaces:**
- `read.ts`: `readForms(path): FormRow[]`, `readRecipeRows(path): RecipeRow[]`, `readBig9(path): Big9Row[]`, `readConversions(path): ConversionRow[]` — thin `xlsx.utils.sheet_to_json` wrappers with typed rows; `findWorkbook(prefix: "Wondish_01" | "Wondish_02" | "Wondish_03" | "Wondish_06", dir = process.cwd()): string`.
- `normalize.ts`:
  - `type FormRow = { formId: string; canonicalId: string; canonicalName: string; groceryCategory: string; components: string[] }`
  - `type RecipeRow = { sourceRow: number; recipeName: string | null; servings: number | null; quantity: number | null; unit: string; formId: string; ingredientName: string; instructions: string; calories: number | null; sodium: number | null; saturatedFat: number | null; sugars: number | null; addedSugars: number | null }`
  - `groupRecipeRows(rows: RecipeRow[]): WorkbookRecipe[]` where `WorkbookRecipe = { name: string; sourceRow: number; servings: number | null; calories: number | null; sodium/saturatedFat/sugars/addedSugars: number | null; steps: string[]; ingredients: { formId: string; name: string; quantity: number | null; unit: string }[] }` — a row with a name starts a recipe; rows with a blank name belong to the current one.
  - `splitSteps(instructions: string): string[]` — split on newlines, strip leading `1.` numbering, drop blanks.
  - `parseComponents(s: string): string[]` — split `"milk - casein - whey"` on ` - `, trim, lowercase, dedupe.
  - `normName(s: string): string` — trim, lowercase, collapse spaces.
  - `matchVariant(dbRows: { id: string; name: string; calories: number | null; servings: number | null }[], recipe: WorkbookRecipe): string | null` — among DB rows whose `displayDishName` equals the recipe name, pick the one whose calories are closest to the recipe's (ties → same servings → first); `null` if none within 35%.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/workbooks/normalize.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupRecipeRows, splitSteps, parseComponents, matchVariant, type RecipeRow } from "./normalize";

const row = (o: Partial<RecipeRow>): RecipeRow => ({
  sourceRow: 0, recipeName: null, servings: null, quantity: null, unit: "", formId: "", ingredientName: "",
  instructions: "", calories: null, sodium: null, saturatedFat: null, sugars: null, addedSugars: null, ...o,
});

test("groupRecipeRows: a named row starts a recipe, blank-name rows attach to it", () => {
  const recipes = groupRecipeRows([
    row({ sourceRow: 3, recipeName: "2-Step Chicken", servings: 1, quantity: 0.5, unit: "tablespoon", formId: "2022929", ingredientName: "Avocado oil", instructions: "1. Heat oil.\r\n2. Add chicken.", calories: 214, sodium: 300 }),
    row({ sourceRow: 4, quantity: 4, unit: "oz", formId: "2110156", ingredientName: "Boneless skinless chicken breast" }),
    row({ sourceRow: 8, recipeName: "2-Step Chicken", servings: 1, quantity: 0.5, unit: "tablespoon", formId: "2022929", ingredientName: "Avocado oil", instructions: "1. Heat oil.", calories: 265 }),
  ]);
  assert.equal(recipes.length, 2);
  assert.deepEqual(recipes[0].ingredients.map((i) => i.formId), ["2022929", "2110156"]);
  assert.deepEqual(recipes[0].steps, ["Heat oil.", "Add chicken."]);
  assert.equal(recipes[0].sodium, 300);
  assert.equal(recipes[1].calories, 265); // same name, different portion variant
});

test("splitSteps strips numbering and CRLF; parseComponents splits ' - '", () => {
  assert.deepEqual(splitSteps("1. Heat oil in a skillet.\r\n2) Add chicken.\n\n3. Serve."), ["Heat oil in a skillet.", "Add chicken.", "Serve."]);
  assert.deepEqual(parseComponents("milk - casein -whey - Milk"), ["milk", "casein", "whey"]);
  assert.deepEqual(parseComponents(""), []);
});

test("matchVariant picks the DB portion variant with the closest calories", () => {
  const db = [
    { id: "a", name: "Scrambled Eggs, V1S- 1 egg", calories: 102, servings: 1 },
    { id: "b", name: "Scrambled Eggs, V1M- 2 eggs", calories: 163, servings: 1 },
    { id: "c", name: "Green Apple", calories: 115, servings: 1 },
  ];
  const rec = { name: "Scrambled Eggs", sourceRow: 1, servings: 1, calories: 160, sodium: null, saturatedFat: null, sugars: null, addedSugars: null, steps: [], ingredients: [] };
  assert.equal(matchVariant(db, rec), "b");
  assert.equal(matchVariant(db, { ...rec, calories: 500 }), null); // >35% off every variant
  assert.equal(matchVariant(db, { ...rec, name: "Nope" }), null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test lib/workbooks/normalize.test.ts` → `Cannot find module './normalize'`.

- [ ] **Step 3: Implement `normalize.ts`**

```ts
// lib/workbooks/normalize.ts — pure transforms over workbook rows (no I/O).
import { displayDishName } from "@/lib/dish-name";

export type FormRow = { formId: string; canonicalId: string; canonicalName: string; groceryCategory: string; components: string[] };
export type RecipeRow = {
  sourceRow: number; recipeName: string | null; servings: number | null; quantity: number | null; unit: string;
  formId: string; ingredientName: string; instructions: string; calories: number | null;
  sodium: number | null; saturatedFat: number | null; sugars: number | null; addedSugars: number | null;
};
export type WorkbookRecipe = {
  name: string; sourceRow: number; servings: number | null; calories: number | null;
  sodium: number | null; saturatedFat: number | null; sugars: number | null; addedSugars: number | null;
  steps: string[]; ingredients: { formId: string; name: string; quantity: number | null; unit: string }[];
};

export const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export function splitSteps(instructions: string): string[] {
  return instructions.split(/\r?\n/).map((s) => s.replace(/^\s*\d+[.)]\s*/, "").trim()).filter(Boolean);
}

export function parseComponents(s: string): string[] {
  const out: string[] = [];
  for (const part of s.split(/\s*-\s*/)) { const p = normName(part); if (p && !out.includes(p)) out.push(p); }
  return out;
}

export function groupRecipeRows(rows: RecipeRow[]): WorkbookRecipe[] {
  const out: WorkbookRecipe[] = [];
  let cur: WorkbookRecipe | null = null;
  for (const r of rows) {
    if (r.recipeName) {
      cur = { name: r.recipeName.trim(), sourceRow: r.sourceRow, servings: r.servings, calories: r.calories, sodium: r.sodium, saturatedFat: r.saturatedFat, sugars: r.sugars, addedSugars: r.addedSugars, steps: splitSteps(r.instructions), ingredients: [] };
      out.push(cur);
    }
    if (cur && r.formId) cur.ingredients.push({ formId: r.formId, name: r.ingredientName.trim(), quantity: r.quantity, unit: r.unit.trim() });
  }
  return out;
}

export function matchVariant(
  dbRows: { id: string; name: string; calories: number | null; servings: number | null }[],
  recipe: WorkbookRecipe
): string | null {
  const target = normName(recipe.name);
  const candidates = dbRows.filter((d) => normName(displayDishName(d.name)) === target);
  if (candidates.length === 0) return null;
  if (recipe.calories == null) return candidates[0].id;
  let best: { id: string; diff: number } | null = null;
  for (const c of candidates) {
    if (c.calories == null) continue;
    const diff = Math.abs(c.calories - recipe.calories) / Math.max(1, recipe.calories);
    if (diff <= 0.35 && (!best || diff < best.diff || (diff === best.diff && c.servings === recipe.servings))) best = { id: c.id, diff };
  }
  return best?.id ?? null;
}
```

- [ ] **Step 4: Implement `read.ts`**

```ts
// lib/workbooks/read.ts — the only file that touches xlsx.
import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";
import { parseComponents, type FormRow, type RecipeRow } from "./normalize";

export type Big9Row = { formId: string; allergenGroup: string; action: string; status: string };
export type ConversionRow = { formId: string; unit: string; baseQuantity: number; baseUnit: string; confidence: string };

export function findWorkbook(prefix: "Wondish_01" | "Wondish_02" | "Wondish_03" | "Wondish_06", dir = process.cwd()): string {
  const f = fs.readdirSync(dir).find((n) => n.startsWith(prefix) && n.endsWith(".xlsx"));
  if (!f) throw new Error(`${prefix}*.xlsx not found in ${dir}`);
  return path.join(dir, f);
}
const rows = (file: string, sheet: string) => XLSX.utils.sheet_to_json<Record<string, unknown>>(XLSX.readFile(file).Sheets[sheet], { defval: "" });
const s = (v: unknown) => String(v ?? "").trim();
const n = (v: unknown) => { const x = typeof v === "number" ? v : parseFloat(String(v)); return Number.isFinite(x) ? x : null; };

export const readForms = (file: string): FormRow[] =>
  rows(file, "Ingredient Form Master").map((r) => ({ formId: s(r.ingredient_form_id), canonicalId: s(r.canonical_id), canonicalName: s(r.canonical_name), groceryCategory: s(r.grocery_category), components: parseComponents(s(r.restriction_relevant_components)) })).filter((r) => r.formId);

export const readRecipeRows = (file: string): RecipeRow[] =>
  rows(file, "Recipe Ingredient Rows").map((r) => ({
    sourceRow: Number(r.source_row_number) || 0, recipeName: s(r["Recipe Name"]) || null, servings: n(r["Number of Servings"]),
    quantity: n(r.Quantity), unit: s(r.Unit), formId: s(r["Ingredient Form ID"]), ingredientName: s(r["Ingredient Name"]),
    instructions: s(r["Instructions to cook at home"]), calories: n(r["Calories per serving"]), sodium: n(r["Sodium/ mg"]),
    saturatedFat: n(r["Saturated Fat/ g"]), sugars: n(r["Total sugars/g"]), addedSugars: n(r["Added sugars included/g"]),
  }));

export const readBig9 = (file: string): Big9Row[] =>
  rows(file, "Allergy Rules Big 9").map((r) => ({ formId: s(r.ingredient_form_id), allergenGroup: s(r.allergen_group_code), action: s(r.action_code), status: s(r.status_code) })).filter((r) => r.formId && r.status === "ACTIVE");

export const readConversions = (file: string): ConversionRow[] =>
  rows(file, "Ingredient Unit Conversions").map((r) => ({ formId: s(r.ingredient_form_id), unit: s(r.recipe_unit).toLowerCase(), baseQuantity: n(r.base_quantity_per_recipe_unit) ?? 0, baseUnit: s(r.base_unit), confidence: s(r.confidence_code) })).filter((r) => r.formId && r.unit && r.baseQuantity > 0);
```

- [ ] **Step 5: Tests + glob + commit**

Add ` lib/workbooks/*.test.ts` to the test script. Run: `npm test` → all pass.

```bash
git add lib/workbooks package.json
git commit -m "feat(data): workbook readers + pure normalisers for Wondish 01/02/03/06"
```

---

### Task 3: Import phase A — ingredients (ids, classification, allergen groups, conversions)

**Files:**
- Create: `scripts/import-workbooks.ts` (phases A and B; `--apply` to write; `--phase a|b|all`)
- Create: `lib/workbooks/ingredient-plan.ts` (+ test) — pure planner

**Interfaces:**
- `planIngredientUpdates(args: { forms: FormRow[]; recipeRows: RecipeRow[]; big9: Big9Row[]; conversions: ConversionRow[]; dbIngredients: { id: string; name: string; formId: string | null }[]; aliases: Record<string, string | null> }): IngredientPlan` where `IngredientPlan = { attach: { ingredientId: string; formId: string; canonicalId: string; groceryCategory: string; components: string[]; allergenGroups: string[] }[]; create: { name: string; formId: string; canonicalId: string; groceryCategory: string; components: string[]; allergenGroups: string[] }[]; conversions: { formId: string; unit: string; baseQuantity: number; baseUnit: string; confidence: string }[]; conflicts: { formId: string; reason: string }[] }`.
- Resolution order for a form used by 02: DB ingredient whose `name` equals the 02 `Ingredient Name` (case-insensitive) → alias map target (`data/ingredient-aliases.json`, variant → catalog name) → the 01 `canonical_name` → **create**. A DB ingredient already carrying a *different* `formId` is a `conflict` (never overwritten).

- [ ] **Step 1: Write the failing test**

```ts
// lib/workbooks/ingredient-plan.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { planIngredientUpdates } from "./ingredient-plan";

const forms = [
  { formId: "1", canonicalId: "1", canonicalName: "Boneless skinless chicken breast", groceryCategory: "MEAT & POULTRY", components: ["chicken"] },
  { formId: "2", canonicalId: "2", canonicalName: "2 % low fat milk", groceryCategory: "DAIRY & EGGS", components: ["milk", "casein", "whey"] },
  { formId: "3", canonicalId: "3", canonicalName: "Cream of chicken soup", groceryCategory: "CANNED", components: ["chicken", "wheat", "milk"] },
];
const rr = (formId: string, ingredientName: string) => ({ sourceRow: 1, recipeName: null, servings: null, quantity: 1, unit: "cup", formId, ingredientName, instructions: "", calories: null, sodium: null, saturatedFat: null, sugars: null, addedSugars: null });

test("resolves by exact name, then alias map, then canonical name; creates the rest; never overwrites a different formId", () => {
  const plan = planIngredientUpdates({
    forms, recipeRows: [rr("1", "boneless skinless chicken breast"), rr("2", "2 % low fat milk"), rr("3", "cream of chicken soup")],
    big9: [{ formId: "2", allergenGroup: "BIG9-COW-MILK", action: "STRICT_AVOID", status: "ACTIVE" }, { formId: "3", allergenGroup: "BIG9-WHEAT", action: "STRICT_AVOID", status: "ACTIVE" }],
    conversions: [{ formId: "2", unit: "cup", baseQuantity: 236.588, baseUnit: "mL", confidence: "HIGH" }],
    dbIngredients: [{ id: "chk", name: "Boneless chicken breasts", formId: null }, { id: "milk", name: "Whole milk", formId: "OTHER" }],
    aliases: { "boneless skinless chicken breast": "Boneless chicken breasts", "2 % low fat milk": "Whole milk" },
  });
  assert.deepEqual(plan.attach.map((a) => [a.ingredientId, a.formId, a.allergenGroups]), [["chk", "1", []]]);
  assert.deepEqual(plan.conflicts, [{ formId: "2", reason: "Whole milk already has formId OTHER" }]);
  assert.deepEqual(plan.create.map((c) => [c.name, c.formId, c.allergenGroups]), [["Cream of chicken soup", "3", ["BIG9-WHEAT"]]]);
  assert.deepEqual(plan.conversions, [{ formId: "2", unit: "cup", baseQuantity: 236.588, baseUnit: "mL", confidence: "HIGH" }]);
});
```

- [ ] **Step 2: Run to verify it fails** → module not found.

- [ ] **Step 3: Implement the planner**

```ts
// lib/workbooks/ingredient-plan.ts
import { normName, type FormRow, type RecipeRow } from "./normalize";
import type { Big9Row, ConversionRow } from "./read";

export type IngredientPlan = {
  attach: { ingredientId: string; formId: string; canonicalId: string; groceryCategory: string; components: string[]; allergenGroups: string[] }[];
  create: { name: string; formId: string; canonicalId: string; groceryCategory: string; components: string[]; allergenGroups: string[] }[];
  conversions: ConversionRow[];
  conflicts: { formId: string; reason: string }[];
};

export function planIngredientUpdates(a: {
  forms: FormRow[]; recipeRows: RecipeRow[]; big9: Big9Row[]; conversions: ConversionRow[];
  dbIngredients: { id: string; name: string; formId: string | null }[]; aliases: Record<string, string | null>;
}): IngredientPlan {
  const formById = new Map(a.forms.map((f) => [f.formId, f]));
  const groupsByForm = new Map<string, string[]>();
  for (const b of a.big9) { const g = groupsByForm.get(b.formId) ?? []; if (!g.includes(b.allergenGroup)) g.push(b.allergenGroup); groupsByForm.set(b.formId, g); }
  const dbByName = new Map(a.dbIngredients.map((d) => [normName(d.name), d]));
  const plan: IngredientPlan = { attach: [], create: [], conversions: [], conflicts: [] };
  const seen = new Set<string>();
  // Which name did 02 use for each form (first occurrence wins).
  const nameByForm = new Map<string, string>();
  for (const r of a.recipeRows) if (r.formId && !nameByForm.has(r.formId)) nameByForm.set(r.formId, r.ingredientName);

  for (const [formId, usedName] of nameByForm) {
    if (seen.has(formId)) continue; seen.add(formId);
    const form = formById.get(formId);
    if (!form) { plan.conflicts.push({ formId, reason: "not in Wondish 01" }); continue; }
    const attrs = { formId, canonicalId: form.canonicalId, groceryCategory: form.groceryCategory, components: form.components, allergenGroups: groupsByForm.get(formId) ?? [] };
    const candidates = [usedName, a.aliases[normName(usedName)] ?? "", form.canonicalName].map(normName).filter(Boolean);
    const hit = candidates.map((c) => dbByName.get(c)).find(Boolean);
    if (hit) {
      if (hit.formId && hit.formId !== formId) plan.conflicts.push({ formId, reason: `${hit.name} already has formId ${hit.formId}` });
      else if (!hit.formId) plan.attach.push({ ingredientId: hit.id, ...attrs });
    } else {
      plan.create.push({ name: form.canonicalName, ...attrs });
    }
  }
  const wanted = new Set([...nameByForm.keys()]);
  plan.conversions = a.conversions.filter((c) => wanted.has(c.formId));
  return plan;
}
```

- [ ] **Step 4: The script (phase A)**

```ts
// scripts/import-workbooks.ts
//   set -a; source .env.local; set +a
//   npx tsx scripts/import-workbooks.ts --phase a            # dry run
//   npx tsx scripts/import-workbooks.ts --phase a --apply
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import { findWorkbook, readForms, readRecipeRows, readBig9, readConversions } from "../lib/workbooks/read";
import { planIngredientUpdates } from "../lib/workbooks/ingredient-plan";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");
const phase = process.argv[process.argv.indexOf("--phase") + 1] ?? "all";

async function phaseA() {
  const forms = readForms(findWorkbook("Wondish_01"));
  const recipeRows = readRecipeRows(findWorkbook("Wondish_02"));
  const big9 = readBig9(findWorkbook("Wondish_03"));
  const conversions = readConversions(findWorkbook("Wondish_06"));
  const dbIngredients = await prisma.ingredient.findMany({ select: { id: true, name: true, formId: true } });
  const aliases = JSON.parse(fs.readFileSync("data/ingredient-aliases.json", "utf8")).aliases;
  const plan = planIngredientUpdates({ forms, recipeRows, big9, conversions, dbIngredients, aliases });
  console.log(`[A] attach=${plan.attach.length} create=${plan.create.length} conversions=${plan.conversions.length} conflicts=${plan.conflicts.length}`);
  for (const c of plan.conflicts) console.log("  conflict:", c.formId, c.reason);
  if (!apply) return;
  fs.writeFileSync(`workbooks-rollback-A-${Date.now()}.json`, JSON.stringify({ attach: plan.attach.map((x) => x.ingredientId), create: plan.create.map((x) => x.name) }));
  for (const x of plan.attach) await prisma.ingredient.update({ where: { id: x.ingredientId }, data: { formId: x.formId, canonicalId: x.canonicalId, groceryCategory: x.groceryCategory, components: x.components, allergenGroups: x.allergenGroups } });
  for (const x of plan.create) await prisma.ingredient.upsert({ where: { name: x.name }, update: { formId: x.formId, canonicalId: x.canonicalId, groceryCategory: x.groceryCategory, components: x.components, allergenGroups: x.allergenGroups }, create: { name: x.name, formId: x.formId, canonicalId: x.canonicalId, groceryCategory: x.groceryCategory, components: x.components, allergenGroups: x.allergenGroups } });
  const byForm = new Map((await prisma.ingredient.findMany({ where: { formId: { not: null } }, select: { id: true, formId: true } })).map((i) => [i.formId!, i.id]));
  for (const c of plan.conversions) {
    const ingredientId = byForm.get(c.formId); if (!ingredientId) continue;
    await prisma.ingredientUnitConversion.upsert({ where: { ingredientId_unit: { ingredientId, unit: c.unit } }, update: { baseQuantity: c.baseQuantity, baseUnit: c.baseUnit, confidence: c.confidence }, create: { ingredientId, unit: c.unit, baseQuantity: c.baseQuantity, baseUnit: c.baseUnit, confidence: c.confidence } });
  }
  console.log("[A] applied");
}

(async () => {
  if (phase === "a" || phase === "all") await phaseA();
  if (phase === "b" || phase === "all") await (await import("./import-workbooks-b")).phaseB(prisma, apply);
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
```

- [ ] **Step 5: Dry-run, review, apply**

Run: `set -a; source .env.local; set +a; npx tsx scripts/import-workbooks.ts --phase a`
Expected: `attach≈252 create≈85 conversions=470 conflicts=0`. Read the conflict list (must be empty or explained). Then `--apply`. Verify: `SELECT count(*) FROM "Ingredient" WHERE "formId" IS NOT NULL` ≈ 337 and `IngredientUnitConversion` = 470.

- [ ] **Step 6: Commit**

```bash
git add lib/workbooks/ingredient-plan.ts lib/workbooks/ingredient-plan.test.ts scripts/import-workbooks.ts
git commit -m "feat(data): import phase A — ingredient form ids, classification, Big-9 groups, unit conversions"
```

---

### Task 4: Import phase B — library recipes (quantities, author steps, nutrition, lineage)

**Files:**
- Create: `scripts/import-workbooks-b.ts` (exports `phaseB(prisma, apply)`)
- Create: `lib/workbooks/recipe-plan.ts` (+ test) — pure planner

**Interfaces:**
- `planRecipeUpdates(args: { recipes: WorkbookRecipe[]; dbRecipes: { id: string; name: string; calories: number | null; servings: number | null; tags: string[]; steps: string[]; ingredients: { ingredientId: string; formId: string | null }[] }[] }): RecipePlan` where `RecipePlan = { update: { recipeId: string; sourceRow: number; steps: string[] | null; stepsSource: "author" | null; sodium; saturatedFat; sugars; addedSugars; quantities: { ingredientId: string; quantity: number | null; unit: string }[] }[]; unmatched: string[]; skippedClara: number }`.
- Rules: skip any DB recipe with tag `clara`; match via `matchVariant`; `steps` set only when author steps ≥2 (else `null` = keep); quantities only for ingredients whose `formId` matches a 02 row of that recipe; nutrition columns always set from the workbook.

- [ ] **Step 1: Write the failing test**

```ts
// lib/workbooks/recipe-plan.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { planRecipeUpdates } from "./recipe-plan";

const wb = { name: "Scrambled Eggs", sourceRow: 40, servings: 1, calories: 160, sodium: 210, saturatedFat: 3.1, sugars: 0.5, addedSugars: 0, steps: ["Whisk eggs.", "Cook 3 min."], ingredients: [{ formId: "E1", name: "Large eggs", quantity: 2, unit: "count" }] };

test("matches the closest variant, fills quantities by formId, replaces steps only with ≥2 author steps, never touches clara rows", () => {
  const plan = planRecipeUpdates({
    recipes: [wb, { ...wb, steps: ["Just one line."], calories: 102 }],
    dbRecipes: [
      { id: "m", name: "Scrambled Eggs, V1M- 2 eggs", calories: 163, servings: 1, tags: [], steps: ["clara step"], ingredients: [{ ingredientId: "eggs", formId: "E1" }] },
      { id: "s", name: "Scrambled Eggs, V1S- 1 egg", calories: 102, servings: 1, tags: [], steps: ["clara step"], ingredients: [{ ingredientId: "eggs", formId: "E1" }] },
      { id: "c", name: "Scrambled Eggs", calories: 160, servings: 1, tags: ["clara"], steps: ["x", "y"], ingredients: [] },
    ],
  });
  const m = plan.update.find((u) => u.recipeId === "m")!;
  assert.deepEqual(m.steps, ["Whisk eggs.", "Cook 3 min."]); assert.equal(m.stepsSource, "author"); assert.equal(m.sodium, 210);
  assert.deepEqual(m.quantities, [{ ingredientId: "eggs", quantity: 2, unit: "count" }]);
  const s = plan.update.find((u) => u.recipeId === "s")!;
  assert.equal(s.steps, null); // one author line → keep existing
  assert.equal(plan.skippedClara, 1);
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement**

```ts
// lib/workbooks/recipe-plan.ts
import { matchVariant, type WorkbookRecipe } from "./normalize";

export type RecipePlan = {
  update: { recipeId: string; sourceRow: number; steps: string[] | null; stepsSource: "author" | null; sodium: number | null; saturatedFat: number | null; sugars: number | null; addedSugars: number | null; quantities: { ingredientId: string; quantity: number | null; unit: string }[] }[];
  unmatched: string[];
  skippedClara: number;
};

export function planRecipeUpdates(a: {
  recipes: WorkbookRecipe[];
  dbRecipes: { id: string; name: string; calories: number | null; servings: number | null; tags: string[]; steps: string[]; ingredients: { ingredientId: string; formId: string | null }[] }[];
}): RecipePlan {
  const skippedClara = a.dbRecipes.filter((d) => d.tags.includes("clara")).length;
  const pool = a.dbRecipes.filter((d) => !d.tags.includes("clara"));
  const plan: RecipePlan = { update: [], unmatched: [], skippedClara };
  const taken = new Set<string>();
  for (const r of a.recipes) {
    const id = matchVariant(pool.filter((p) => !taken.has(p.id)), r);
    if (!id) { plan.unmatched.push(`${r.name} (row ${r.sourceRow})`); continue; }
    taken.add(id);
    const db = pool.find((p) => p.id === id)!;
    const byForm = new Map(r.ingredients.map((i) => [i.formId, i]));
    const quantities = db.ingredients.filter((i) => i.formId && byForm.has(i.formId)).map((i) => ({ ingredientId: i.ingredientId, quantity: byForm.get(i.formId!)!.quantity, unit: byForm.get(i.formId!)!.unit }));
    const useAuthor = r.steps.length >= 2;
    plan.update.push({ recipeId: id, sourceRow: r.sourceRow, steps: useAuthor ? r.steps : null, stepsSource: useAuthor ? "author" : null, sodium: r.sodium, saturatedFat: r.saturatedFat, sugars: r.sugars, addedSugars: r.addedSugars, quantities });
  }
  return plan;
}
```

- [ ] **Step 4: Script phase B with invariants**

```ts
// scripts/import-workbooks-b.ts
import fs from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { findWorkbook, readRecipeRows } from "../lib/workbooks/read";
import { groupRecipeRows } from "../lib/workbooks/normalize";
import { planRecipeUpdates } from "../lib/workbooks/recipe-plan";

export async function phaseB(prisma: PrismaClient, apply: boolean) {
  const recipes = groupRecipeRows(readRecipeRows(findWorkbook("Wondish_02")));
  const dbRecipes = await prisma.recipe.findMany({ where: { isPublic: true }, select: { id: true, name: true, calories: true, servings: true, tags: true, steps: true, ingredients: { select: { ingredientId: true, ingredient: { select: { formId: true } } } } } });
  const plan = planRecipeUpdates({ recipes, dbRecipes: dbRecipes.map((d) => ({ ...d, ingredients: d.ingredients.map((i) => ({ ingredientId: i.ingredientId, formId: i.ingredient.formId })) })) });
  const withSteps = plan.update.filter((u) => u.steps).length;
  const qty = plan.update.reduce((s, u) => s + u.quantities.length, 0);
  console.log(`[B] matched=${plan.update.length} authorSteps=${withSteps} quantityRows=${qty} unmatched=${plan.unmatched.length} claraSkipped=${plan.skippedClara}`);
  for (const u of plan.unmatched) console.log("  unmatched:", u);
  if (!apply) return;
  // Rollback: current steps/stepsSource for every row we will touch.
  const before = await prisma.recipe.findMany({ where: { id: { in: plan.update.map((u) => u.recipeId) } }, select: { id: true, steps: true, stepsSource: true } });
  fs.writeFileSync(`workbooks-rollback-B-${Date.now()}.json`, JSON.stringify(before));
  for (const u of plan.update) {
    await prisma.recipe.update({ where: { id: u.recipeId }, data: { sourceRow: u.sourceRow, sodium: u.sodium, saturatedFat: u.saturatedFat, sugars: u.sugars, addedSugars: u.addedSugars, ...(u.steps ? { steps: u.steps, stepsSource: "author" } : {}) } });
    for (const q of u.quantities) await prisma.recipeIngredient.update({ where: { recipeId_ingredientId: { recipeId: u.recipeId, ingredientId: q.ingredientId } }, data: { quantity: q.quantity, unit: q.unit || null } });
  }
  // Invariants — abort loudly if any is violated.
  const after = await prisma.recipe.findMany({ where: { id: { in: plan.update.map((u) => u.recipeId) } }, select: { id: true, steps: true, calories: true, ingredients: { select: { ingredientId: true } } } });
  const empty = after.filter((r) => r.steps.length === 0 || r.ingredients.length === 0);
  if (empty.length) throw new Error(`INVARIANT: ${empty.length} recipes lost steps/ingredients — restore from rollback`);
  console.log("[B] applied; invariants OK");
}
```

- [ ] **Step 5: Dry-run, review, apply**

Run: `npx tsx scripts/import-workbooks.ts --phase b`
Expected: `matched≈290 authorSteps≈260 quantityRows≈4,600 unmatched≈2 claraSkipped≈150`. Review `unmatched` ("Chicken Brunswick Stew & Brown Rice" is expected). Then `--apply`.
Post-check in the app: open a library dish (e.g. "Scrambled Eggs") — steps read as the author wrote them, quantities appear next to ingredients on the dish card (the card already renders `ri.quantity`/`ri.unit`).

- [ ] **Step 6: Commit**

```bash
git add lib/workbooks/recipe-plan.ts lib/workbooks/recipe-plan.test.ts scripts/import-workbooks-b.ts
git commit -m "feat(data): import phase B — author steps, quantities, nutrition and lineage on library recipes"
```

---

### Task 5: Component-based allergen bans (additive)

**Files:**
- Modify: `lib/diet-match.ts` (`DietMatchers`, `buildDietMatchers`, `evaluateDishAgainstProfile`)
- Modify: `lib/meal-plan.ts:~300` (`recipeSelect.ingredients` → also select `allergenGroups`)
- Modify: `lib/clara/recipe-generation.ts` (`applyAllergenFilter` call sites pass groups when available — Clara dishes have none, so no change in behaviour)
- Test: `lib/diet-match.test.ts` (append)
- Data fix: `FoodAllergy` "Wheat " → "Wheat" (one-line script in Step 4)

**Interfaces:**
- Produces: `ALLERGY_GROUPS: Record<string, string[]>` mapping our `FoodAllergy` names → Wondish 03 group codes: `{ "Milk": ["BIG9-COW-MILK"], "Eggs": ["BIG9-EGG"], "Peanuts": ["BIG9-PEANUT"], "Tree nuts": ["BIG9-TREE-NUT"], "Soy": ["BIG9-SOY"], "Fish": ["BIG9-FISH"], "Shellfish": ["BIG9-CRUSTACEAN-SHELLFISH", "BIG9-MOLLUSCAN-SHELLFISH"], "Sesame": ["BIG9-SESAME"], "Wheat": ["BIG9-WHEAT"] }` (confirm the exact codes with `SELECT DISTINCT allergen_group_code` from the sheet before coding — the plan's reviewer must check this line).
- `DietMatchers` gains `bannedGroups: Set<string>`; `evaluateDishAgainstProfile(ingredientNames, matchers, ingredientGroups?: string[][])` — a dish fails when any ingredient's groups intersect `bannedGroups`, in addition to the existing name matching.

- [ ] **Step 1: Failing test** (append to `lib/diet-match.test.ts`)

```ts
test("allergen groups ban a dish even when the ingredient name doesn't mention the allergen", () => {
  const bans = derivePatientBans({ ...emptyPatient, foodAllergies: [{ food: { name: "Milk", bannedIngredients: [] } }] } as never);
  const m = buildDietMatchers(bans);
  assert.ok(m.bannedGroups.has("BIG9-COW-MILK"));
  // "Cream of chicken soup" says nothing about milk by name; its Wondish groups do.
  assert.equal(evaluateDishAgainstProfile(["Cream of chicken soup"], m, [["BIG9-COW-MILK", "BIG9-WHEAT"]]).passed, false);
  assert.equal(evaluateDishAgainstProfile(["Cream of chicken soup"], m, [[]]).passed, true);
});
```

(Use whatever fixture helper the existing test file has for a patient graph; if none, build `{ foodAllergies, foodToAvoid: [], healthConditions: [], foodPreferences: [], motivations: [] }`.)

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** — in `diet-match.ts`: add `ALLERGY_GROUPS`; in `derivePatientBans` keep output shape but also compute `allergyGroupCodes: string[]` from `foodAllergies[].food.name` (trimmed); in `buildDietMatchers` add `bannedGroups: new Set(allergyGroupCodes)`; in `evaluateDishAgainstProfile` add the optional third parameter and a group check that pushes a `Violation` with `source: "allergy"` and `term: <group code>`. In `meal-plan.ts` `recipeSelect.ingredients` select `{ ingredient: { select: { name: true, allergenGroups: true } } }` and pass `r.ingredients.map((ri) => ri.ingredient.allergenGroups)` at both `evaluateDishAgainstProfile` call sites. `PoolRecipe`/`RecipeCandidate` ingredient type gains `allergenGroups?: string[]`.

- [ ] **Step 4: Data fix + tests**

Run once: `npx tsx -e 'import("@/lib/db").then(async ({prisma})=>{console.log(await prisma.foodAllergy.updateMany({where:{name:"Wheat "},data:{name:"Wheat"}}));await prisma.$disconnect();})'` (or the equivalent tiny script from the project root). Then `npm test && npx tsc --noEmit -p .`.

- [ ] **Step 5: Commit**

```bash
git add lib/diet-match.ts lib/diet-match.test.ts lib/meal-plan.ts lib/clara/recipe-generation.ts
git commit -m "feat(safety): component-based allergen bans from Wondish 03 Big-9 groups (additive to name matching)"
```

---

### Task 6: Grocery quantities — pure engine

**Files:**
- Create: `lib/grocery-quantities.ts`
- Test: `lib/grocery-quantities.test.ts`

**Interfaces:**
- `aggregateNeeds(rows: { ingredientId: string; quantity: number | null; unit: string | null }[]): Map<string, Map<string, number>>` — ingredientId → unit → summed quantity (Wondish 06 step 2: never mix units before conversion).
- `toBase(needs, conversions: { ingredientId: string; unit: string; baseQuantity: number; baseUnit: string; confidence: string }[]): { ingredientId: string; base: number; baseUnit: "g" | "mL" | "count"; approx: boolean; unconverted: { unit: string; quantity: number }[] }[]` — `count`/`piece`/`each`/blank unit stays a count; LOW confidence ⇒ `approx: true`.
- `formatPurchase(base: number, baseUnit: "g" | "mL" | "count"): string` — Wondish 06 rounding: g → oz below 1 lb (round up to ½ oz) then lb (round up to ¼ lb); mL → fl oz below 1 L then L (¼ L); count → ceil. Examples from the sheet: `412 g → "≈ 1 lb"`, `820 mL → "≈ 1 L"`, `1.7 → "2"`.

- [ ] **Step 1: Failing tests**

```ts
// lib/grocery-quantities.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateNeeds, toBase, formatPurchase } from "./grocery-quantities";

test("aggregate keeps units apart, toBase converts and flags LOW confidence", () => {
  const needs = aggregateNeeds([{ ingredientId: "oil", quantity: 1, unit: "tablespoon" }, { ingredientId: "oil", quantity: 2, unit: "tablespoon" }, { ingredientId: "oil", quantity: 0.25, unit: "cup" }, { ingredientId: "onion", quantity: 1.7, unit: "" }]);
  assert.equal(needs.get("oil")!.get("tablespoon"), 3);
  const out = toBase(needs, [{ ingredientId: "oil", unit: "tablespoon", baseQuantity: 13.6, baseUnit: "g", confidence: "HIGH" }, { ingredientId: "oil", unit: "cup", baseQuantity: 218, baseUnit: "g", confidence: "LOW" }]);
  const oil = out.find((o) => o.ingredientId === "oil")!;
  assert.equal(Math.round(oil.base), 95); assert.equal(oil.baseUnit, "g"); assert.equal(oil.approx, true);
  const onion = out.find((o) => o.ingredientId === "onion")!;
  assert.equal(onion.baseUnit, "count"); assert.equal(onion.base, 1.7);
});

test("formatPurchase follows the Wondish 06 rounding rules", () => {
  assert.equal(formatPurchase(412, "g"), "1 lb");
  assert.equal(formatPurchase(95, "g"), "3.5 oz");
  assert.equal(formatPurchase(820, "mL"), "1 L");
  assert.equal(formatPurchase(300, "mL"), "10.5 fl oz");
  assert.equal(formatPurchase(1.7, "count"), "2");
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement**

```ts
// lib/grocery-quantities.ts — Wondish 06 engine steps 2–5, pure.
const G_PER_OZ = 28.349523125, G_PER_LB = 453.59237, ML_PER_FLOZ = 29.5735295625;
const COUNT_UNITS = new Set(["", "count", "piece", "pieces", "each", "whole", "clove", "cloves", "slice", "slices", "medium", "large", "small"]);

export function aggregateNeeds(rows: { ingredientId: string; quantity: number | null; unit: string | null }[]) {
  const m = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (r.quantity == null || r.quantity <= 0) continue;
    const u = (r.unit ?? "").trim().toLowerCase();
    const byUnit = m.get(r.ingredientId) ?? new Map<string, number>();
    byUnit.set(u, (byUnit.get(u) ?? 0) + r.quantity);
    m.set(r.ingredientId, byUnit);
  }
  return m;
}

export function toBase(needs: Map<string, Map<string, number>>, conversions: { ingredientId: string; unit: string; baseQuantity: number; baseUnit: string; confidence: string }[]) {
  const conv = new Map(conversions.map((c) => [`${c.ingredientId}|${c.unit.toLowerCase()}`, c]));
  const out: { ingredientId: string; base: number; baseUnit: "g" | "mL" | "count"; approx: boolean; unconverted: { unit: string; quantity: number }[] }[] = [];
  for (const [ingredientId, byUnit] of needs) {
    let base = 0, baseUnit: "g" | "mL" | "count" | null = null, approx = false;
    const unconverted: { unit: string; quantity: number }[] = [];
    for (const [unit, qty] of byUnit) {
      if (COUNT_UNITS.has(unit)) { if (baseUnit === null || baseUnit === "count") { baseUnit = "count"; base += qty; } else unconverted.push({ unit, quantity: qty }); continue; }
      const c = conv.get(`${ingredientId}|${unit}`);
      if (!c || (baseUnit !== null && baseUnit !== c.baseUnit)) { unconverted.push({ unit, quantity: qty }); continue; }
      baseUnit = c.baseUnit as "g" | "mL"; base += qty * c.baseQuantity; if (c.confidence === "LOW") approx = true;
    }
    if (baseUnit === null) continue;
    out.push({ ingredientId, base, baseUnit, approx, unconverted });
  }
  return out;
}

const up = (v: number, step: number) => Math.ceil(v / step - 1e-9) * step;
const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(v < 10 ? 1 : 0).replace(/\.0$/, ""));
export function formatPurchase(base: number, baseUnit: "g" | "mL" | "count"): string {
  if (baseUnit === "count") return String(Math.ceil(base - 1e-9));
  if (baseUnit === "g") return base >= G_PER_LB ? `${fmt(up(base / G_PER_LB, 0.25))} lb` : `${fmt(up(base / G_PER_OZ, 0.5))} oz`;
  return base >= 1000 ? `${fmt(up(base / 1000, 0.25))} L` : `${fmt(up(base / ML_PER_FLOZ, 0.5))} fl oz`;
}
```

- [ ] **Step 4: Tests pass; commit**

```bash
git add lib/grocery-quantities.ts lib/grocery-quantities.test.ts
git commit -m "feat(grocery): pure quantity engine — aggregate, convert, round for purchase (Wondish 06)"
```

---

### Task 7: Amounts on What-to-buy

**Files:**
- Modify: `app/api/pantry/to-buy/route.ts` (add `needed` per item for this week's plan)
- Modify: `components/pantry/PantryClient.tsx` (render the amount next to the name in "By category" and "By value")

**Interfaces:**
- API item gains `needed?: { amount: string; approx: boolean }` computed from the active plan's next 7 days: `menu.recipe.ingredients` (quantity, unit) × 1 (recipes are per-serving rows) aggregated per ingredient → `toBase` with the ingredient's `conversions` → `formatPurchase`. Items not used by the week's plan have no `needed`.

- [ ] **Step 1: Route** — after `items` are computed, load `prisma.menu.findMany({ where: { patientId, planVersion: activePlanVersion, date: { gte: today, lte: today+6 } }, select: { recipe: { select: { ingredients: { select: { ingredientId: true, quantity: true, unit: true } } } } } })`, flatten to rows, `aggregateNeeds` → `toBase` with `prisma.ingredientUnitConversion.findMany({ where: { ingredientId: { in: [...] } } })` → map `ingredientId → { amount: formatPurchase(base, baseUnit), approx }`; attach to each item by `ingredientId`. Wrap in try/catch: amounts are best-effort and must never fail the list.

- [ ] **Step 2: UI** — in the item row, after the name: `{item.needed && <span className="text-[11px] tabular-nums" style={{ color: "#848181" }}>{item.needed.approx ? "≈ " : ""}{item.needed.amount}</span>}`. Also the category accordion chips: same span inside the chip when `needed` exists for that id (build a `neededById` map from `groceryItems`).

- [ ] **Step 3: Verify** — for the test account with a generated week: `/pantry?tab=buy` shows e.g. "Boneless chicken breasts · ≈ 1.5 lb", "Yellow onions · 3". Amounts appear only for ingredients in this week's dishes. `npm test && npx tsc --noEmit -p .`.

- [ ] **Step 4: Commit**

```bash
git add app/api/pantry/to-buy/route.ts components/pantry/PantryClient.tsx
git commit -m "feat(grocery): weekly purchase amounts on What-to-buy"
```

---

### Task 8: Release gate

- [ ] `npm test && npx tsc --noEmit -p .` green.
- [ ] Dry-run both phases again: **0 attach / 0 create / 0 update** on a second run (idempotent).
- [ ] Spot-check 5 library dishes in the app: author steps present, quantities beside ingredients, calories unchanged vs. before (compare with the rollback file).
- [ ] Allergen regression: a test account with **Milk** allergy generates a week; audit script confirms no dish contains an ingredient whose `allergenGroups` includes `BIG9-COW-MILK` **and** the previous name-based check still passes.
- [ ] What-to-buy shows amounts; LOW-confidence ones carry "≈".
- [ ] Add to `BACKLOG.md`: Tier 2 = Wondish 03 deployable health rules + condition-id mapping (8 names), Tier 3 = 05 symptom journal, 04 trials. Note the rollback JSONs' location.
- [ ] Commit + push.

## Self-review

**Coverage vs. the analysis:** ids/classification (T1, T3), author steps + nutrition + quantities + lineage (T1, T4), component allergen bans (T5), amounts on What-to-buy (T6, T7), safety/idempotency/rollback (T3, T4, T8). Tier 2/3 deliberately excluded.
**Placeholders:** T5's `ALLERGY_GROUPS` codes are marked for verification against the sheet before coding — that is the one value not confirmed in this session (only `BIG9-COW-MILK` was observed). T7 describes the JSX edit rather than reproducing the 800-line component; the row markup to extend is the item row in the "By value" list and the chip in the category accordion.
**Type consistency:** `FormRow`/`RecipeRow`/`WorkbookRecipe` (T2) are the inputs of T3/T4; `ConversionRow` shape matches `IngredientUnitConversion` (T1) and `toBase`'s parameter (T6); `matchVariant` (T2) is used by T4; `allergenGroups: string[]` (T1) is what T5 reads.
