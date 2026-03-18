/**
 * Fetch nutrition data from USDA FoodData Central API for all ingredients
 * imported from the XLSX, then calculate per-recipe totals.
 *
 * Usage:
 *   node scripts/fetch-nutrition.mjs [--api-key YOUR_KEY]
 *
 * Free API key (3600 req/hour): https://fdc.nal.usda.gov/api-key-signup.html
 * DEMO_KEY (no signup, 30 req/hour): used as fallback
 *
 * USDA nutrient IDs:
 *   1008 = Energy (kcal)
 *   1003 = Protein (g)
 *   1005 = Carbohydrates (g)
 *   1004 = Total fat (g)
 *   1079 = Fiber (g)
 */

import { createRequire } from "module";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env
const envPath = join(__dirname, "../.env");
try {
  const envContent = readFileSync(envPath, "utf8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
} catch { /* no .env */ }

const { PrismaClient } = require("@prisma/client");
const xlsx = require("xlsx");

const prisma = new PrismaClient();

// API key: --api-key flag > env var > DEMO_KEY
const apiKeyFlag = process.argv.find((a) => a.startsWith("--api-key="))?.split("=")[1]
  ?? process.argv[process.argv.indexOf("--api-key") + 1];
const FDC_API_KEY = apiKeyFlag || process.env.USDA_FDC_API_KEY || "DEMO_KEY";
const FDC_BASE = "https://api.nal.usda.gov/fdc/v1";

const NUTRIENT_IDS = {
  calories: 1008,
  protein:  1003,
  carbs:    1005,
  fat:      1004,
  fiber:    1079,
};

// ── Unit → approximate grams conversion ──────────────────────────────────────
// These are rough estimates; solid foods in cups/tbsp vary by density.
const UNIT_TO_GRAMS = {
  g: 1, gr: 1, gram: 1, grams: 1,
  kg: 1000,
  oz: 28.35,
  lb: 453.59, pound: 453.59, pounds: 453.59,
  ml: 1, milliliter: 1,
  l: 1000, liter: 1000,
  cup: 240, cups: 240,
  tablespoon: 15, tbsp: 15, tbs: 15,
  teaspoon: 5, tsp: 5,
  fl_oz: 29.57, "fl oz": 29.57,
  // Size descriptors — rough median weights
  whole: 100, piece: 50,
  small: 50, medium: 100, large: 150,
  slice: 30,
  pinch: 0.35, dash: 0.6,
  clove: 5,
  sprig: 3,
  leaves: 2, leaf: 2,
  stalk: 40, spear: 30, stick: 40,
  scoop: 30,
  can: 400,
  teabag: 2,
  crackers: 15,
};

function toGrams(qty, unit) {
  if (!qty || !unit) return null;
  const key = unit.toLowerCase().trim();
  const factor = UNIT_TO_GRAMS[key];
  if (!factor) return null;
  return qty * factor;
}

// ── Parse XLSX: ingredient name → FCD ID ────────────────────────────────────
function parseFcdMap() {
  const xlsxPath = join(__dirname, "../022626 Recipes-ingredients-codes&conditions- Bex.xlsx");
  const wb = xlsx.readFile(xlsxPath);
  const ws = wb.Sheets["Recipes with codes, ingredients"];
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1 });

  const fcdByName = {}; // ingredient name → fcdId
  for (let i = 2; i < rows.length; i++) {
    const row = rows[i];
    const fcdId = row[3], name = row[4];
    if (fcdId && name) {
      const key = String(name).trim();
      if (!fcdByName[key]) fcdByName[key] = Number(fcdId);
    }
  }
  return fcdByName;
}

// ── USDA FDC batch fetch (max 20 per request) ────────────────────────────────
async function fetchNutritionBatch(fdcIds) {
  const url = `${FDC_BASE}/foods?api_key=${FDC_API_KEY}`;
  // Note: do NOT pass `nutrients` filter — it suppresses foodNutrients for Branded foods
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fdcIds }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`USDA API error ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

function extractNutrients(food) {
  const result = { calories: null, protein: null, carbs: null, fat: null, fiber: null };

  // Branded foods expose clean labelNutrients — prefer this when available
  if (food?.labelNutrients) {
    const ln = food.labelNutrients;
    return {
      calories: ln.calories?.value ?? null,
      protein:  ln.protein?.value  ?? null,
      carbs:    ln.carbohydrates?.value ?? null,
      fat:      ln.fat?.value      ?? null,
      fiber:    ln.fiber?.value    ?? null,
    };
  }

  if (!food?.foodNutrients) return result;

  // SR Legacy / Foundation foods: nutrients use { nutrient: { id }, amount }
  for (const [key, id] of Object.entries(NUTRIENT_IDS)) {
    const match = food.foodNutrients.find((n) =>
      n.nutrient?.id === id || n.nutrientId === id
    );
    if (match) {
      result[key] = match.amount ?? match.value ?? null;
    }
  }
  return result;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Using API key: ${FDC_API_KEY === "DEMO_KEY" ? "DEMO_KEY (30 req/hr limit)" : "custom key"}`);

  const fcdByName = parseFcdMap();
  console.log(`XLSX FCD map: ${Object.keys(fcdByName).length} ingredient names`);

  // Get all ingredients from DB
  const dbIngredients = await prisma.ingredient.findMany({
    select: { id: true, name: true, calories: true },
  });

  // Match DB ingredients to FCD IDs
  const toFetch = []; // { id, name, fdcId }
  for (const ing of dbIngredients) {
    if (ing.calories != null) continue; // already has nutrition
    const fdcId = fcdByName[ing.name];
    if (fdcId) toFetch.push({ id: ing.id, name: ing.name, fdcId });
  }

  console.log(`Ingredients needing nutrition: ${toFetch.length}`);
  if (toFetch.length === 0) {
    console.log("All ingredients already have nutrition data.");
  } else {
    // Batch into groups of 20
    const BATCH = 20;
    let updated = 0;
    let failed = 0;

    for (let i = 0; i < toFetch.length; i += BATCH) {
      const batch = toFetch.slice(i, i + BATCH);
      const fdcIds = batch.map((b) => b.fdcId);

      try {
        const foods = await fetchNutritionBatch(fdcIds);
        const foodMap = Object.fromEntries(foods.map((f) => [f.fdcId, f]));

        for (const item of batch) {
          const food = foodMap[item.fdcId];
          if (!food) { failed++; continue; }

          const nutrients = extractNutrients(food);
          // USDA values are per 100g — store as-is (per 100g)
          await prisma.ingredient.update({
            where: { id: item.id },
            data: {
              calories: nutrients.calories,
              protein:  nutrients.protein,
              carbs:    nutrients.carbs,
              fat:      nutrients.fat,
            },
          });
          updated++;
        }

        process.stdout.write(`\r  Fetched ${Math.min(i + BATCH, toFetch.length)}/${toFetch.length} ingredients…`);

        // Rate limit: DEMO_KEY = 30/hr → ~8s between batches
        if (FDC_API_KEY === "DEMO_KEY" && i + BATCH < toFetch.length) {
          await new Promise((r) => setTimeout(r, 8000));
        } else if (i + BATCH < toFetch.length) {
          await new Promise((r) => setTimeout(r, 300)); // 300ms between batches
        }
      } catch (err) {
        console.error(`\nBatch ${i}-${i + BATCH} failed:`, err.message);
        failed += batch.length;
      }
    }

    console.log(`\nIngredients updated: ${updated}, failed: ${failed}`);
  }

  // ── Calculate recipe nutrition from ingredients ──────────────────────────
  console.log("\nCalculating recipe nutrition…");

  const recipes = await prisma.recipe.findMany({
    where: { calories: null },
    include: {
      ingredients: {
        include: { ingredient: true },
      },
    },
  });

  let recipesUpdated = 0;
  let recipesSkipped = 0;

  for (const recipe of recipes) {
    let cal = 0, prot = 0, carb = 0, fat = 0;
    let hasData = false;

    for (const ri of recipe.ingredients) {
      const ing = ri.ingredient;
      if (ing.calories == null) continue;

      // USDA values are per 100g; convert ingredient quantity to grams
      const grams = toGrams(ri.quantity, ri.unit);
      if (!grams) continue;

      const factor = grams / 100;
      cal  += (ing.calories ?? 0) * factor;
      prot += (ing.protein  ?? 0) * factor;
      carb += (ing.carbs    ?? 0) * factor;
      fat  += (ing.fat      ?? 0) * factor;
      hasData = true;
    }

    if (!hasData) { recipesSkipped++; continue; }

    await prisma.recipe.update({
      where: { id: recipe.id },
      data: {
        calories: Math.round(cal),
        protein:  Math.round(prot * 10) / 10,
        carbs:    Math.round(carb * 10) / 10,
        fat:      Math.round(fat  * 10) / 10,
      },
    });
    recipesUpdated++;
  }

  console.log(`Recipes with nutrition calculated: ${recipesUpdated}, skipped (no ingredient data): ${recipesSkipped}`);
  console.log("\nAll done!");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
