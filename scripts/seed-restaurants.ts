/**
 * Pilot seed: creates ONE published Miracle Mile restaurant with a realistic
 * multi-section menu, for the Cycle 3 Engine Task E5 restaurant onboarding
 * pilot (Wondish ops uses the admin screen for everything after this; this
 * script just gets a believable starting fixture into a dev/staging DB).
 *
 * Idempotent: upserts the restaurant by slug, then replaces (delete + create)
 * its dishes/ingredients every run, so re-running always converges to the
 * same end state rather than duplicating rows.
 *
 * Includes the phase-1 "done" live-smoke fixture: a pad-thai-style dish whose
 * ingredients list "Peanuts" (see lib/restaurants.test.ts / lib/diet-match.ts
 * peanut-allergy fixture) — do not rename/remove that ingredient without
 * checking the docs/superpowers/plans/2026-07-22-ios-restaurants-tab.md
 * verification checklist.
 *
 * NOT executed in this environment (no DATABASE_URL configured here). Run it
 * yourself once a DATABASE_URL exists:
 *
 *   npx tsx scripts/seed-restaurants.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const RESTAURANT_SLUG = "miracle-mile-kitchen";

interface SeedIngredient {
  name: string;
  quantity?: number;
  unit?: string;
}

interface SeedDish {
  name: string;
  description: string;
  section: string;
  sortOrder: number;
  price: string;
  currency?: string;
  status: "DRAFT" | "PUBLISHED";
  isRecommended?: boolean;
  available?: boolean;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  ingredients: SeedIngredient[];
}

const DISHES: SeedDish[] = [
  {
    name: "Garden Spring Rolls",
    description: "Fresh rice-paper rolls with crunchy vegetables and mint.",
    section: "Starters",
    sortOrder: 0,
    price: "8.50",
    status: "PUBLISHED",
    calories: 180,
    protein: 5,
    carbs: 28,
    fat: 5,
    fiber: 3,
    ingredients: [
      { name: "Rice paper", unit: "sheet", quantity: 3 },
      { name: "Carrot", unit: "g", quantity: 40 },
      { name: "Cabbage", unit: "g", quantity: 40 },
      { name: "Mint", unit: "g", quantity: 5 },
      { name: "Vermicelli noodles", unit: "g", quantity: 30 },
    ],
  },
  {
    name: "Chicken Pad Thai",
    description: "The house classic — stir-fried rice noodles, chicken, egg, and crushed peanuts.",
    section: "Mains",
    sortOrder: 0,
    price: "16.00",
    status: "PUBLISHED",
    isRecommended: true,
    calories: 620,
    protein: 34,
    carbs: 68,
    fat: 22,
    fiber: 4,
    ingredients: [
      { name: "Rice noodles", unit: "g", quantity: 200 },
      { name: "Chicken breast", unit: "g", quantity: 120 },
      { name: "Egg", unit: "unit", quantity: 1 },
      { name: "Bean sprouts", unit: "g", quantity: 40 },
      { name: "Peanuts", unit: "g", quantity: 20 },
      { name: "Tamarind sauce", unit: "tbsp", quantity: 2 },
      { name: "Scallion", unit: "g", quantity: 10 },
      { name: "Lime", unit: "wedge", quantity: 1 },
    ],
  },
  {
    name: "Grilled Salmon Bowl",
    description: "Grilled salmon over brown rice with charred broccoli and sesame-ginger glaze.",
    section: "Mains",
    sortOrder: 1,
    price: "19.50",
    status: "PUBLISHED",
    calories: 540,
    protein: 38,
    carbs: 46,
    fat: 20,
    fiber: 6,
    ingredients: [
      { name: "Salmon", unit: "g", quantity: 170 },
      { name: "Brown rice", unit: "g", quantity: 150 },
      { name: "Broccoli", unit: "g", quantity: 100 },
      { name: "Sesame oil", unit: "tbsp", quantity: 1 },
      { name: "Ginger", unit: "g", quantity: 5 },
    ],
  },
  {
    name: "Miracle Mile Cobb Salad",
    description: "Grilled chicken, avocado, bacon, egg, and blue cheese over romaine.",
    section: "Mains",
    sortOrder: 2,
    price: "15.00",
    status: "PUBLISHED",
    calories: 480,
    protein: 32,
    carbs: 14,
    fat: 32,
    fiber: 5,
    ingredients: [
      { name: "Romaine lettuce", unit: "g", quantity: 100 },
      { name: "Grilled chicken", unit: "g", quantity: 120 },
      { name: "Avocado", unit: "g", quantity: 60 },
      { name: "Bacon", unit: "g", quantity: 20 },
      { name: "Blue cheese", unit: "g", quantity: 25 },
      { name: "Tomato", unit: "g", quantity: 50 },
      { name: "Egg", unit: "unit", quantity: 1 },
    ],
  },
  {
    name: "Vegan Buddha Bowl",
    description: "Quinoa, roasted sweet potato, chickpeas, and kale with a tahini dressing.",
    section: "Bowls",
    sortOrder: 0,
    price: "14.50",
    status: "PUBLISHED",
    isRecommended: true,
    calories: 460,
    protein: 16,
    carbs: 58,
    fat: 18,
    fiber: 11,
    ingredients: [
      { name: "Quinoa", unit: "g", quantity: 120 },
      { name: "Chickpeas", unit: "g", quantity: 100 },
      { name: "Kale", unit: "g", quantity: 60 },
      { name: "Sweet potato", unit: "g", quantity: 100 },
      { name: "Tahini", unit: "tbsp", quantity: 2 },
    ],
  },
  {
    name: "Mango Sticky Rice",
    description: "Warm coconut sticky rice with fresh mango and toasted sesame seeds.",
    section: "Desserts",
    sortOrder: 0,
    price: "9.00",
    status: "PUBLISHED",
    calories: 380,
    protein: 5,
    carbs: 72,
    fat: 9,
    fiber: 3,
    ingredients: [
      { name: "Sticky rice", unit: "g", quantity: 120 },
      { name: "Mango", unit: "g", quantity: 150 },
      { name: "Coconut milk", unit: "ml", quantity: 100 },
      { name: "Sesame seeds", unit: "g", quantity: 5 },
    ],
  },
  {
    name: "Seasonal Soup (coming soon)",
    description: "Chef is still finalizing this one for next month's rotation.",
    section: "Starters",
    sortOrder: 1,
    price: "7.00",
    status: "DRAFT",
    available: false,
    ingredients: [],
  },
];

async function main() {
  const asian = await prisma.ethnic.upsert({
    where: { name: "Asian" },
    update: {},
    create: { name: "Asian" },
  });

  const restaurant = await prisma.restaurant.upsert({
    where: { slug: RESTAURANT_SLUG },
    update: {
      name: "Miracle Mile Kitchen",
      description: "A neighborhood favorite on Miracle Mile serving a modern pan-Asian menu.",
      neighborhood: "Miracle Mile",
      city: "Los Angeles",
      state: "CA",
      postalCode: "90036",
      addressLine: "5505 Wilshire Blvd",
      ethnicId: asian.id,
      status: "PUBLISHED",
      phone: "(323) 555-0142",
      website: "https://example.com/miracle-mile-kitchen",
    },
    create: {
      name: "Miracle Mile Kitchen",
      slug: RESTAURANT_SLUG,
      description: "A neighborhood favorite on Miracle Mile serving a modern pan-Asian menu.",
      neighborhood: "Miracle Mile",
      city: "Los Angeles",
      state: "CA",
      postalCode: "90036",
      addressLine: "5505 Wilshire Blvd",
      ethnicId: asian.id,
      status: "PUBLISHED",
      phone: "(323) 555-0142",
      website: "https://example.com/miracle-mile-kitchen",
    },
  });

  // Replace-all: delete existing dishes (cascades to their ingredients) and
  // recreate from the fixture above, so re-running this script always
  // converges to the same menu rather than accumulating duplicates.
  await prisma.restaurantDish.deleteMany({ where: { restaurantId: restaurant.id } });

  for (const dish of DISHES) {
    await prisma.restaurantDish.create({
      data: {
        restaurantId: restaurant.id,
        name: dish.name,
        description: dish.description,
        section: dish.section,
        sortOrder: dish.sortOrder,
        price: dish.price,
        currency: dish.currency ?? "USD",
        status: dish.status,
        isRecommended: dish.isRecommended ?? false,
        available: dish.available ?? true,
        calories: dish.calories ?? null,
        protein: dish.protein ?? null,
        carbs: dish.carbs ?? null,
        fat: dish.fat ?? null,
        fiber: dish.fiber ?? null,
        ingredients: dish.ingredients.length
          ? { create: dish.ingredients.map((i) => ({ name: i.name, quantity: i.quantity ?? null, unit: i.unit ?? null })) }
          : undefined,
      },
    });
  }

  console.log(`✓ Seeded restaurant "${restaurant.name}" (${restaurant.slug}) with ${DISHES.length} dishes.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
