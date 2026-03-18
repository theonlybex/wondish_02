/**
 * One-time patch: assign mealTypeId to all recipes that currently have none.
 * Run with: node scripts/patch-meal-types.mjs
 */

import { createRequire } from "module";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

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
const prisma = new PrismaClient();

// ── Rules (evaluated in order — first match wins) ────────────────────────────
// Each rule: { type: "Breakfast"|"Lunch"|"Dinner"|"Snack", patterns: string[] }
const RULES = [
  {
    type: "Snack",
    patterns: [
      // Single fruits
      "banana", "apple", "grapes", "berries", "watermelon", "orange",
      "papaya", "peach", "pineapple", "kiwi", "melon", "mango", "strawberr",
      "blueberr", "pitted prune", "dried fig", "green grape", "red grape",
      // Nuts
      "almonds", "walnuts", "cashew nut", "hazelnuts", "pecans", "pistachios",
      "peanuts",
      // Beverages / drinks
      "latte", "black tea", "herbal tea", "black coffee", "kombucha",
      "cocoa", "chocolate", "almond milk", "soy milk", "oat milk",
      "mineral water", "sparkling water",
      // Snack foods
      "chia pudding", "cucumber yogurt dip", "hummus",
      "granola bar", "protein bar", "trail mix",
    ],
  },
  {
    type: "Breakfast",
    patterns: [
      "frittata", "quiche", "eggs over", "eggs foo young", "plant-based eggs",
      "broccoli frittata", "garden frittata",
      "multigrain", "gluten-free.*bread", "oat milk.*gluten",
      "dutch apple yogurt", "berries chia", "blueberries chia",
      "applesauce",
      "corn pancake", "hash brown", "pancake", "waffle", "french toast",
      "oatmeal", "granola", "parfait", "smoothie bowl",
    ],
  },
  {
    type: "Lunch",
    patterns: [
      "salad", "wrap", "sandwich", "tabbouleh", "sloppy joe",
      "cheese and corn chowder", "chowder",
      "brown rice tabbouleh",
      "mexican bowl", "bulgur with chickpeas",
    ],
  },
  {
    type: "Dinner",
    patterns: [
      // Cooking methods that imply a main dish
      "stew", "creole", "brunswick", "ratatouille", "stroganoff",
      "stir.fry", "stir fry", "fried rice", "fried barley",
      "roast", "pot roast", "braised", "broiled", "seared",
      "casserole", "curry", "curried",
      // Fish/meat mains
      "salmon", "tilapia", "catfish", "sardine", "tuna.*loft", "dilled fish",
      "fish creole", "fish.*spinach",
      "chicken.*mushroom", "chicken.*spinach", "chicken.*brussels",
      "chicken.*zoodle", "chicken.*rice", "chicken.*ratatouille",
      "chicken.*stew", "chicken.*thigh",
      "beef.*supper", "beef.*cabbage", "beef.*greens", "beef.*sauerkraut",
      "beef.*vegetables", "beef.*rice",
      "pork.*stew", "pork.*greens",
      "turkey stew", "vegan stew",
      "stuffed potato", "leafy tofu",
      // Sides that default to Dinner context
      "succotash", "sauté", "fryer vegetable", "air fryer",
      "zesty lemon fish", "zesty lemon salmon",
      "mustard.*salmon", "smoky mustard",
      "salmon burger", "salmon loaf",
      "apricot.*lemon",
      "tofu.*rice", "tofu.*potato",
      "butternut squash", "chickpeas and spinach",
      "brussels sprouts with mushroom",
      "cauliflower shells",
      "beets.*beans.*greens",
    ],
  },
];

function inferMealType(name) {
  const lower = name.toLowerCase();
  for (const { type, patterns } of RULES) {
    for (const p of patterns) {
      if (new RegExp(p).test(lower)) return type;
    }
  }
  return null;
}

async function main() {
  const mealTypes = await prisma.mealType.findMany();
  const mealTypeMap = Object.fromEntries(mealTypes.map((m) => [m.name, m.id]));

  const unassigned = await prisma.recipe.findMany({
    where: { mealTypeId: null },
    select: { id: true, name: true },
  });

  console.log(`Unassigned recipes: ${unassigned.length}`);

  let updated = 0;
  let stillNull = 0;
  const stillNullNames = [];

  for (const recipe of unassigned) {
    const mealTypeName = inferMealType(recipe.name);
    if (!mealTypeName) {
      stillNull++;
      stillNullNames.push(recipe.name);
      continue;
    }
    const mealTypeId = mealTypeMap[mealTypeName];
    if (!mealTypeId) continue;
    await prisma.recipe.update({
      where: { id: recipe.id },
      data: { mealTypeId },
    });
    updated++;
  }

  console.log(`Updated: ${updated}, still unassigned: ${stillNull}`);
  if (stillNullNames.length > 0) {
    console.log("\nStill unassigned (defaulting to Dinner):");
    stillNullNames.forEach((n) => console.log(" -", n));

    // Default remaining unassigned → Dinner
    const dinnerIds = stillNullNames.map(() => null); // placeholder
    const dinnerId = mealTypeMap["Dinner"];
    await prisma.recipe.updateMany({
      where: { mealTypeId: null },
      data: { mealTypeId: dinnerId },
    });
    console.log(`Defaulted ${stillNull} recipes to Dinner.`);
  }

  // Print final distribution
  const grouped = await prisma.recipe.groupBy({ by: ["mealTypeId"], _count: true });
  console.log("\nFinal distribution:");
  grouped.forEach((g) => console.log(" ", mealTypes.find((m) => m.id === g.mealTypeId)?.name ?? "null", ":", g._count));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
