// Ingredient alias map: fold recipe ingredient-name variants ("yellow onion",
// "virgin olive oil", "boneless skinless chicken breast") onto the curated
// catalog ("Onion", "Olive oil", "Chicken breast") so DB dishes speak the same
// ingredient vocabulary as the basket, taste picks and shopping list.
//
//   build           one Haiku pass over the off-catalog names → data/ingredient-aliases.json
//                   (review the file; edit by hand where Clara got it wrong)
//   apply           dry-run: report what would be remapped
//   apply --apply   re-point RecipeIngredient rows at the catalog Ingredient
//
// Run with env loaded:  set -a; source .env.local; set +a; npx tsx scripts/ingredient-aliases.ts build
//
// Cost guard: `build` aborts before any call that would push spend past MAX_USD.

import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { PrismaClient } from "@prisma/client";
import { catalogItemNames } from "../lib/ingredient-catalog";

const prisma = new PrismaClient();
const ALIAS_FILE = path.join(process.cwd(), "data", "ingredient-aliases.json");
const MODEL = "claude-haiku-4-5";
const MAX_USD = 0.2;
const CHUNK = 220;
// Haiku 4.5 list price per 1M tokens.
const IN_PER_M = 1, OUT_PER_M = 5;

type AliasFile = {
  generatedAt: string;
  model: string;
  // variant (lowercase) → catalog item name, or null when nothing in the catalog fits
  aliases: Record<string, string | null>;
  // how many recipe rows each variant appears in (review aid only)
  counts: Record<string, number>;
  // variant → dish-level detail that the fold would otherwise lose
  // ("egg whites only", "dried form in the original"); written to RecipeIngredient.note
  notes?: Record<string, string>;
};

async function offCatalogNames() {
  const catalog = new Set(catalogItemNames().map((n) => n.toLowerCase()));
  const rows = await prisma.recipeIngredient.findMany({
    where: { recipe: { isPublic: true } },
    select: { ingredient: { select: { name: true } } },
  });
  const counts = new Map<string, number>();
  for (const r of rows) {
    const n = r.ingredient.name.trim().toLowerCase();
    if (!catalog.has(n)) counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

async function build() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not loaded");
  const catalog = catalogItemNames();
  const names = await offCatalogNames();
  console.log(`off-catalog names: ${names.length}, catalog items: ${catalog.length}`);

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const aliases: Record<string, string | null> = {};
  let spent = 0;
  const catalogLower = new Map(catalog.map((c) => [c.toLowerCase(), c]));

  for (let i = 0; i < names.length; i += CHUNK) {
    const chunk = names.slice(i, i + CHUNK).map(([n]) => n);
    // Worst-case estimate for this call: ~15 tokens per name in, ~12 out.
    const est = (chunk.length * 15 + catalog.length * 4 + 300) * IN_PER_M / 1e6 + chunk.length * 12 * OUT_PER_M / 1e6;
    if (spent + est > MAX_USD) throw new Error(`cost guard: $${spent.toFixed(3)} spent, next call ~$${est.toFixed(3)} would exceed $${MAX_USD}`);

    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system:
        "You normalise recipe ingredient names onto a fixed catalog. For each variant, pick the catalog item it is a form of " +
        "(different cut, prep, size, colour, brand wording, 'fresh/dried/cooked/frozen', plural, 'boneless skinless', etc. all count as the same item). " +
        "Use null when NO catalog item is the same food (e.g. walnuts when the catalog has no nuts). Never map to a merely similar food " +
        "(do not map lime to lemon, turkey to chicken, quinoa to rice, egg whites to egg is OK). " +
        "Reply with ONLY a JSON object: { \"<variant>\": \"<catalog item exactly as given>\" | null, ... } covering every variant.",
      messages: [
        {
          role: "user",
          content: `CATALOG:\n${catalog.join("\n")}\n\nVARIANTS:\n${chunk.join("\n")}`,
        },
      ],
    });
    const usage = msg.usage;
    spent += usage.input_tokens * IN_PER_M / 1e6 + usage.output_tokens * OUT_PER_M / 1e6;
    console.log(`chunk ${i / CHUNK + 1}: in=${usage.input_tokens} out=${usage.output_tokens} spent=$${spent.toFixed(4)}`);

    const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    const parsed = JSON.parse(json) as Record<string, string | null>;
    for (const n of chunk) {
      const target = parsed[n];
      if (typeof target === "string") {
        const canon = catalogLower.get(target.trim().toLowerCase());
        aliases[n] = canon ?? null;
        if (!canon) console.warn(`  ! "${n}" → "${target}" is not a catalog item; set to null`);
      } else {
        aliases[n] = null;
      }
    }
  }

  const out: AliasFile = {
    generatedAt: new Date().toISOString(),
    model: MODEL,
    aliases,
    counts: Object.fromEntries(names),
  };
  fs.mkdirSync(path.dirname(ALIAS_FILE), { recursive: true });
  fs.writeFileSync(ALIAS_FILE, JSON.stringify(out, null, 2) + "\n");

  const mapped = names.filter(([n]) => aliases[n]);
  const unmapped = names.filter(([n]) => !aliases[n]);
  const mappedRows = mapped.reduce((s, [, c]) => s + c, 0);
  const unmappedRows = unmapped.reduce((s, [, c]) => s + c, 0);
  console.log(`\nmapped: ${mapped.length} names / ${mappedRows} rows`);
  console.log(`no catalog match: ${unmapped.length} names / ${unmappedRows} rows`);
  console.log(`total spend: $${spent.toFixed(4)}`);
  console.log(`\nwrote ${ALIAS_FILE}`);
}

async function apply(write: boolean) {
  const file = JSON.parse(fs.readFileSync(ALIAS_FILE, "utf8")) as AliasFile;
  const recipes = await prisma.recipe.findMany({
    where: { isPublic: true },
    select: { id: true, name: true, ingredients: { select: { ingredientId: true, ingredient: { select: { name: true } } } } },
  });

  // Resolve every catalog target to an Ingredient id (find-or-create, exact catalog casing).
  const targets = new Set(Object.values(file.aliases).filter((v): v is string => !!v));
  const idByTarget = new Map<string, string>();
  for (const name of targets) {
    const existing = await prisma.ingredient.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { id: true } });
    if (existing) { idByTarget.set(name, existing.id); continue; }
    if (!write) { idByTarget.set(name, `(new) ${name}`); continue; }
    const created = await prisma.ingredient.create({ data: { name }, select: { id: true } });
    idByTarget.set(name, created.id);
  }

  let updated = 0, merged = 0, dishesTouched = 0;
  const ops: (() => Promise<unknown>)[] = [];
  // Rollback log: every row we change, with its original ingredient id.
  const log: { recipeId: string; from: string; to: string; action: "update" | "delete" }[] = [];
  for (const r of recipes) {
    const present = new Set(r.ingredients.map((ri) => ri.ingredientId));
    let touched = false;
    for (const ri of r.ingredients) {
      const variant = ri.ingredient.name.trim().toLowerCase();
      const target = file.aliases[variant];
      if (!target) continue;
      const note = file.notes?.[variant];
      const targetId = idByTarget.get(target)!;
      if (targetId === ri.ingredientId) continue;
      touched = true;
      if (present.has(targetId)) {
        // Dish already lists the catalog item (e.g. "red bell pepper" + "red bell peppers") — drop the variant row.
        merged++;
        log.push({ recipeId: r.id, from: ri.ingredientId, to: targetId, action: "delete" });
        ops.push(() => prisma.recipeIngredient.delete({ where: { recipeId_ingredientId: { recipeId: r.id, ingredientId: ri.ingredientId } } }));
      } else {
        updated++;
        present.add(targetId);
        log.push({ recipeId: r.id, from: ri.ingredientId, to: targetId, action: "update" });
        ops.push(() =>
          prisma.recipeIngredient.update({
            where: { recipeId_ingredientId: { recipeId: r.id, ingredientId: ri.ingredientId } },
            data: { ingredientId: targetId, ...(note ? { note } : {}) },
          })
        );
      }
    }
    if (touched) dishesTouched++;
  }

  console.log(`${write ? "APPLYING" : "DRY RUN"}: ${updated} rows re-pointed, ${merged} duplicate rows removed, ${dishesTouched}/${recipes.length} dishes touched`);

  // Patient-side rows point at the same variant Ingredient rows (baskets were
  // built from recipe names before the catalog existed). Fold them the same way,
  // or a basket of "olive oil" no longer covers a dish that now says
  // "Extra virgin olive oil".
  const pantry = await prisma.patientPantryItem.findMany({ select: { patientId: true, ingredientId: true, ingredient: { select: { name: true } } } });
  const prefs = await prisma.patientIngredientPreference.findMany({ select: { id: true, patientId: true, ingredientId: true, liked: true, ingredient: { select: { name: true } } } });
  const pantryHas = new Set(pantry.map((p) => `${p.patientId}|${p.ingredientId}`));
  const prefHas = new Set(prefs.map((p) => `${p.patientId}|${p.ingredientId}`));
  let pantryMoved = 0, pantryMerged = 0, prefMoved = 0, prefMerged = 0;
  for (const p of pantry) {
    const target = file.aliases[p.ingredient.name.trim().toLowerCase()];
    if (!target) continue;
    const targetId = idByTarget.get(target)!;
    if (targetId === p.ingredientId) continue;
    const where = { patientId_ingredientId: { patientId: p.patientId, ingredientId: p.ingredientId } };
    if (pantryHas.has(`${p.patientId}|${targetId}`)) {
      pantryMerged++;
      ops.push(() => prisma.patientPantryItem.delete({ where }));
    } else {
      pantryMoved++;
      pantryHas.add(`${p.patientId}|${targetId}`);
      ops.push(() => prisma.patientPantryItem.update({ where, data: { ingredientId: targetId } }));
    }
  }
  for (const p of prefs) {
    const target = file.aliases[p.ingredient.name.trim().toLowerCase()];
    if (!target) continue;
    const targetId = idByTarget.get(target)!;
    if (targetId === p.ingredientId) continue;
    if (prefHas.has(`${p.patientId}|${targetId}`)) {
      prefMerged++;
      ops.push(() => prisma.patientIngredientPreference.delete({ where: { id: p.id } }));
    } else {
      prefMoved++;
      prefHas.add(`${p.patientId}|${targetId}`);
      ops.push(() => prisma.patientIngredientPreference.update({ where: { id: p.id }, data: { ingredientId: targetId } }));
    }
  }
  console.log(`pantry: ${pantryMoved} re-pointed, ${pantryMerged} duplicates removed (of ${pantry.length}); favorites: ${prefMoved} re-pointed, ${prefMerged} duplicates removed (of ${prefs.length})`);
  if (!write) return;
  const logPath = process.env.ALIAS_ROLLBACK_LOG ?? path.join(process.cwd(), `ingredient-alias-rollback-${Date.now()}.json`);
  fs.writeFileSync(logPath, JSON.stringify(log));
  console.log(`rollback log: ${logPath}`);
  // Batches keep each transaction small; the remap is idempotent so a rerun is safe.
  for (let i = 0; i < ops.length; i += 200) {
    await prisma.$transaction(ops.slice(i, i + 200).map((f) => f() as never));
    console.log(`  ${Math.min(i + 200, ops.length)}/${ops.length}`);
  }
  console.log("done");
}

const [cmd, flag] = process.argv.slice(2);
(cmd === "build" ? build() : cmd === "apply" ? apply(flag === "--apply") : Promise.reject(new Error("usage: build | apply [--apply]")))
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
