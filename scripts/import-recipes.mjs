/**
 * Import 296 real recipes from the legacy XLSX into the Prisma database.
 * Run with: node scripts/import-recipes.mjs
 * Requires: DATABASE_URL in .env (uses prisma client)
 */

import { createRequire } from "module";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

// Load env manually (Next.js doesn't auto-load it for scripts)
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
} catch {
  console.warn("No .env file found — using process environment");
}

// Use direct connection for scripts (bypasses pgbouncer pooler)
if (process.env.DATABASE_URL_UNPOOLED) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED;
}

const { PrismaClient } = require("@prisma/client");
const xlsx = require("xlsx");

const prisma = new PrismaClient();

// ── Meal type inference ───────────────────────────────────────────────────────
const MEAL_TYPE_KEYWORDS = {
  Breakfast: [
    "oatmeal", "pancake", "waffle", "french toast", "granola", "parfait",
    "smoothie bowl", "scrambled", "omelette", "omelet", "hash brown",
    "banana bread", "porridge", "cereal", "muffin", "crepe",
    "breakfast", "morning",
  ],
  Snack: [
    "trail mix", "protein bar", "granola bar", "cracker", "hummus",
    "cashew parmesan", "snack",
  ],
  Lunch: [
    "salad", "wrap", "sandwich", "soup", "slaw", "lettuce wrap",
  ],
  Dinner: [
    "stir-fry", "stir fry", "roast", "pot roast", "casserole",
    "pasta", "curry", "stroganoff", "grill", "bake", "baked",
    "steak", "chili", "fajita", "taco", "burrito", "rice bowl",
  ],
};

function inferMealType(name) {
  const lower = name.toLowerCase();
  for (const [mealType, keywords] of Object.entries(MEAL_TYPE_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) return mealType;
  }
  return null; // will be left unassigned — admin can categorize
}

// ── Parse XLSX ────────────────────────────────────────────────────────────────
function parseXlsx() {
  const xlsxPath = join(__dirname, "../022626 Recipes-ingredients-codes&conditions- Bex.xlsx");
  const wb = xlsx.readFile(xlsxPath);

  // Recipes sheet
  const ws1 = wb.Sheets["Recipes with codes, ingredients"];
  const rows = xlsx.utils.sheet_to_json(ws1, { header: 1 });

  const recipeMap = {};
  let current = null;

  for (let i = 2; i < rows.length; i++) {
    const row = rows[i];
    const name = row[0];
    const fcdId = row[3];
    const ingredientName = row[4];
    const qty = row[5];
    const unit = row[6];
    const instructions = row[8];

    if (name) {
      current = String(name).trim();
      recipeMap[current] = {
        name: current,
        // Store cooking instructions in description (closest field available)
        description: instructions ? String(instructions).trim() : null,
        ingredients: [],
      };
    }
    if (current && ingredientName) {
      recipeMap[current].ingredients.push({
        fcdId: fcdId ? Number(fcdId) : null,
        name: String(ingredientName).trim(),
        qty: qty != null ? Number(qty) : null,
        unit: unit ? String(unit).trim() : null,
      });
    }
  }

  return Object.values(recipeMap);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("Parsing XLSX…");
  const recipes = parseXlsx();
  console.log(`Found ${recipes.length} recipes`);

  // Ensure meal types exist
  const mealTypeNames = ["Breakfast", "Lunch", "Dinner", "Snack"];
  for (const name of mealTypeNames) {
    await prisma.mealType.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
  const mealTypes = await prisma.mealType.findMany();
  const mealTypeMap = Object.fromEntries(mealTypes.map((m) => [m.name, m.id]));

  // Collect all unique ingredient names
  const allIngredientNames = new Set();
  for (const r of recipes) {
    for (const ing of r.ingredients) {
      allIngredientNames.add(ing.name);
    }
  }
  console.log(`Upserting ${allIngredientNames.size} unique ingredients…`);

  // Batch create all ingredients, skip existing ones
  await prisma.ingredient.createMany({
    data: [...allIngredientNames].map((name) => ({ name })),
    skipDuplicates: true,
  });

  // Build ingredient name → id map
  const dbIngredients = await prisma.ingredient.findMany({
    select: { id: true, name: true },
  });
  const ingredientMap = Object.fromEntries(dbIngredients.map((i) => [i.name, i.id]));

  // Import recipes
  console.log("Importing recipes…");
  let created = 0;
  let skipped = 0;

  for (const recipe of recipes) {
    const mealTypeName = inferMealType(recipe.name);
    const mealTypeId = mealTypeName ? mealTypeMap[mealTypeName] : null;

    // Skip if already exists
    const existing = await prisma.recipe.findFirst({
      where: { name: recipe.name },
    });
    if (existing) {
      skipped++;
      continue;
    }

    // Deduplicate ingredients: same name may appear twice in XLSX — sum quantities
    const deduped = new Map();
    for (const ing of recipe.ingredients) {
      if (!ingredientMap[ing.name]) continue;
      const id = ingredientMap[ing.name];
      if (deduped.has(id)) {
        const existing = deduped.get(id);
        if (existing.quantity != null && ing.qty != null) existing.quantity += ing.qty;
      } else {
        deduped.set(id, { ingredientId: id, quantity: ing.qty, unit: ing.unit });
      }
    }

    await prisma.recipe.create({
      data: {
        name: recipe.name,
        description: recipe.description,
        mealTypeId,
        isPublic: true,
        ingredients: {
          create: [...deduped.values()],
        },
      },
    });
    created++;

    if (created % 50 === 0) {
      console.log(`  ${created} recipes created…`);
    }
  }

  console.log(`\nDone! Created: ${created}, Skipped (already existed): ${skipped}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
