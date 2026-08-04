/**
 * Pilot seed: creates the 5 REAL Stockton pilot restaurants (Dumpling U +
 * 4 Miracle Mile / Pacific Ave restaurants) with their real menus, for the
 * Cycle 3 Engine Task E5 restaurant onboarding pilot (Wondish ops uses the
 * admin screen for everything after this; this script just gets a real,
 * researched starting fixture set into a dev/staging DB).
 *
 * Idempotent AND non-destructive (2026-07-24 audit Task 17): upserts each
 * restaurant by slug (status only set on create — an admin archive is never
 * overridden), then reconciles dishes by (section, name): matched dishes
 * update display scalars only (ingredients/status stay admin-owned per
 * D-INGREDIENTS), missing dishes are created, and existing dishes are never
 * deleted — post-seed admin edits and MealLog provenance survive re-runs.
 * Each restaurant reconciles inside one transaction (no mid-run
 * empty/partial menu window).
 *
 * ── DATA PROVENANCE / SAFETY CAVEATS ──────────────────────────────────────
 * All restaurant/dish data below is EMBEDDED (translated into typed
 * literals) from the research output at
 * .superpowers/sdd/stockton-pilot-data.json — that file is NOT read at
 * runtime; it exists only as the source-of-record for how each field below
 * was derived (source URLs, per-dish `ingredientsInferred` flag, and a
 * `menuFreshness` note per restaurant).
 *
 *   - INGREDIENTS ARE AI-INFERRED. Most dish ingredient lists were inferred
 *     by an AI from public menu names/descriptions, NOT confirmed by the
 *     restaurants themselves (see `ingredientsInferred: true` per dish in
 *     the JSON; a few dishes with allergen tags/explicit menu wording — e.g.
 *     Thai Me Up's (G)/(V) marks — are `ingredientsInferred: false`, but
 *     even those are not a restaurant-confirmed allergen statement). Per the
 *     D-INGREDIENTS rule (docs/restaurants/overview.md / phase-1.md),
 *     structured ingredient lists are supposed to be human-owned and are the
 *     sole source of truth for allergy verdicts — AI inference must never
 *     sit in the matching/verdict path for real users. These lists are a
 *     PILOT-ONLY convenience fixture and MUST be human-verified with each
 *     restaurant (ideally against a physical/current menu, or by phone —
 *     see per-restaurant `sourceUrls` in the JSON) before any real
 *     allergy-sensitive user is shown a verdict computed against them.
 *   - NUTRITION IS AI-ESTIMATED (2026-08-04). Whole-dish calories/macros
 *     were estimated from menu names/descriptions and typical recipes —
 *     none are restaurant-provided. They exist so demo dishes price
 *     correctly in the meal-log / plan-exchange flows; restaurant-verify
 *     before presenting as authoritative nutrition facts.
 *   - PRICES MAY BE STALE. Freshness varies by restaurant/source — Thai Me
 *     Up and La Palma prices came from the restaurants' own websites
 *     (freshest); Dumpling U from an active BeyondMenu ordering listing;
 *     Cocoro Bistro and Manny's California Fresh Cafe prices came from
 *     third-party AllMenus caches and are explicitly flagged in the JSON as
 *     likely stale (Manny's especially — several items look years out of
 *     date). See each restaurant's `menuFreshness` note in the JSON.
 *
 * Live-smoke fixture (phase-1 "done" check, see
 * docs/superpowers/plans/2026-07-22-ios-restaurants-tab.md): Thai Me Up's
 * "Pad Thai" (slug thai-me-up) carries "Ground peanuts" in its ingredient
 * list — this is the menu-explicit (ingredientsInferred: false) peanut dish
 * chosen as the peanut-allergy smoke fixture (see lib/restaurants.test.ts /
 * lib/diet-match.ts peanut-allergy fixture). Do not rename/remove "Ground
 * peanuts" from that dish without checking that verification checklist.
 *
 * NOT executed in this environment (no DATABASE_URL configured here). Run it
 * yourself once a DATABASE_URL exists:
 *
 *   npx tsx scripts/seed-restaurants.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

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
  price: string | null;
  currency?: string;
  isRecommended?: boolean;
  // Whole-dish macros (RestaurantDish convention — NOT per-serving).
  // AI-ESTIMATED from menu names/descriptions/typical recipes, same pilot
  // provenance caveat as the inferred ingredient lists: restaurant-verify
  // before treating as authoritative.
  nutrition?: { calories: number; protein: number; carbs: number; fat: number; fiber: number };
  ingredients: SeedIngredient[];
}

interface SeedRestaurant {
  slug: string;
  name: string;
  description: string;
  cuisine: string; // Ethnic.name FK
  addressLine: string;
  city: string;
  state: string;
  postalCode: string;
  neighborhood: string;
  dishes: SeedDish[];
}

const RESTAURANTS: SeedRestaurant[] = [
  {
    slug: "dumpling-u",
    name: "Dumpling U",
    description:
      "Shanghai-style soup dumpling shop in Stockton's Lincoln Village making all dumplings, buns, and noodles fresh in-house.",
    cuisine: "Chinese",
    addressLine: "1217 W March Ln",
    city: "Stockton",
    state: "CA",
    postalCode: "95207",
    neighborhood: "Lincoln Village",
    dishes: [
      {
        name: "A1 House Special Pork Filled Dumplings (8)",
        description: "Handcrafted soup dumplings filled with seasoned pork, made fresh in-house.",
        section: "Handcrafted",
        sortOrder: 1,
        price: "15.07",
        isRecommended: true,
        nutrition: { calories: 560, protein: 28, carbs: 62, fat: 22, fiber: 3 },
        ingredients: [
          { name: "Pork" },
          { name: "Wheat flour wrapper" },
          { name: "Ginger" },
          { name: "Scallion" },
          { name: "Soy sauce" },
          { name: "Sesame oil" },
          { name: "Pork broth aspic" },
        ],
      },
      {
        name: "A2 Shrimp & Pork Filled Dumplings (8)",
        description: "Soup dumplings filled with a shrimp and pork blend.",
        section: "Handcrafted",
        sortOrder: 2,
        price: "17.23",
        nutrition: { calories: 520, protein: 30, carbs: 60, fat: 18, fiber: 3 },
        ingredients: [
          { name: "Shrimp" },
          { name: "Pork" },
          { name: "Wheat flour wrapper" },
          { name: "Ginger" },
          { name: "Scallion" },
          { name: "Sesame oil" },
        ],
      },
      {
        name: "A9 Sichuan Style Wontons (12)",
        description: "Wontons served in a spicy Sichuan chili oil sauce.",
        section: "Handcrafted",
        sortOrder: 3,
        price: "13.50",
        nutrition: { calories: 640, protein: 26, carbs: 58, fat: 34, fiber: 3 },
        ingredients: [
          { name: "Pork" },
          { name: "Wheat flour wrapper" },
          { name: "Chili oil" },
          { name: "Garlic" },
          { name: "Sichuan peppercorn" },
          { name: "Soy sauce" },
          { name: "Sugar" },
        ],
      },
      {
        name: "A13 Cheese Rangoon (6)",
        description: "Deep-fried wontons filled with cream cheese.",
        section: "Handcrafted",
        sortOrder: 4,
        price: "9.67",
        nutrition: { calories: 460, protein: 10, carbs: 38, fat: 30, fiber: 2 },
        ingredients: [
          { name: "Cream cheese" },
          { name: "Wonton wrapper (wheat, egg)" },
          { name: "Scallion" },
          { name: "Garlic powder" },
          { name: "Frying oil" },
        ],
      },
      {
        name: "B1 Cucumber Salad",
        description: "Chilled smashed cucumber salad tossed in a garlic-vinegar dressing.",
        section: "Appetizer",
        sortOrder: 1,
        price: "9.67",
        nutrition: { calories: 120, protein: 3, carbs: 12, fat: 7, fiber: 2 },
        ingredients: [
          { name: "Cucumber" },
          { name: "Garlic" },
          { name: "Rice vinegar" },
          { name: "Sesame oil" },
          { name: "Sugar" },
          { name: "Chili flakes" },
        ],
      },
      {
        name: "B5 Shanghai Style Fried Porkchop (3)",
        description: "Crispy fried pork chops, Shanghai style.",
        section: "Appetizer",
        sortOrder: 2,
        price: "15.07",
        nutrition: { calories: 620, protein: 42, carbs: 28, fat: 38, fiber: 2 },
        ingredients: [
          { name: "Pork chop" },
          { name: "Wheat flour batter" },
          { name: "Egg" },
          { name: "Soy sauce" },
          { name: "Shaoxing wine" },
          { name: "Frying oil" },
        ],
      },
      {
        name: "D9 Garlic Noodles",
        description: "Wheat noodles tossed in a garlicky sauce.",
        section: "Noodles and Rice",
        sortOrder: 1,
        price: "15.07",
        nutrition: { calories: 560, protein: 14, carbs: 88, fat: 16, fiber: 4 },
        ingredients: [
          { name: "Wheat noodles" },
          { name: "Garlic" },
          { name: "Soy sauce" },
          { name: "Scallion" },
          { name: "Vegetable oil" },
          { name: "Sugar" },
        ],
      },
      {
        name: "D12 Braised Beef Noodles",
        description: "Wheat noodles in a slow-braised beef broth.",
        section: "Noodles and Rice",
        sortOrder: 2,
        price: "16.15",
        nutrition: { calories: 680, protein: 38, carbs: 78, fat: 22, fiber: 5 },
        ingredients: [
          { name: "Beef" },
          { name: "Wheat noodles" },
          { name: "Beef broth" },
          { name: "Star anise" },
          { name: "Soy sauce" },
          { name: "Scallion" },
          { name: "Cilantro" },
        ],
      },
      {
        name: "E6 Honey Walnut Shrimp",
        description: "Crispy shrimp tossed in a sweet mayo sauce with candied walnuts.",
        section: "Main Course",
        sortOrder: 1,
        price: "18.90",
        nutrition: { calories: 780, protein: 28, carbs: 60, fat: 48, fiber: 3 },
        ingredients: [
          { name: "Shrimp" },
          { name: "Walnuts" },
          { name: "Mayonnaise" },
          { name: "Condensed milk" },
          { name: "Honey" },
          { name: "Cornstarch" },
          { name: "Frying oil" },
        ],
      },
    ],
  },
  {
    slug: "la-palma-mexican-cuisine",
    name: "La Palma Mexican Cuisine",
    description:
      "Family-owned authentic Mexican restaurant on the Miracle Mile with a full tequila bar, run by Mexico City natives Rafael and Judith Duarte.",
    cuisine: "Mexican",
    addressLine: "2301 Pacific Ave",
    city: "Stockton",
    state: "CA",
    postalCode: "95204",
    neighborhood: "Miracle Mile",
    dishes: [
      {
        name: "Fish Tacos",
        description: "Three breaded tilapia tacos with cheese, lettuce, tomatoes, and house tartar sauce.",
        section: "Seafood | Mariscos",
        sortOrder: 1,
        price: "18.50",
        isRecommended: true,
        nutrition: { calories: 720, protein: 38, carbs: 68, fat: 32, fiber: 6 },
        ingredients: [
          { name: "Tilapia" },
          { name: "Breading (wheat flour)" },
          { name: "Corn tortilla" },
          { name: "Cheese" },
          { name: "Lettuce" },
          { name: "Tomato" },
          { name: "Tartar sauce (egg, mayonnaise)" },
        ],
      },
      {
        name: "Camarones A La Diabla",
        description: "Slow cooked shrimp in a red, hot chili pepper sauce.",
        section: "Seafood | Mariscos",
        sortOrder: 2,
        price: "19.50",
        nutrition: { calories: 480, protein: 36, carbs: 20, fat: 28, fiber: 4 },
        ingredients: [
          { name: "Shrimp" },
          { name: "Dried chili peppers" },
          { name: "Garlic" },
          { name: "Onion" },
          { name: "Tomato" },
          { name: "Butter" },
        ],
      },
      {
        name: "Nachos with Carne Asada",
        description: "Corn chips with cheese, jalapeños, guacamole, sour cream, beans, tomatoes, and grilled steak.",
        section: "Appetizers | Botana",
        sortOrder: 1,
        price: "13.95",
        nutrition: { calories: 980, protein: 45, carbs: 78, fat: 54, fiber: 10 },
        ingredients: [
          { name: "Corn tortilla chips" },
          { name: "Carne asada (beef)" },
          { name: "Cheese" },
          { name: "Jalapeño" },
          { name: "Guacamole (avocado)" },
          { name: "Sour cream (dairy)" },
          { name: "Refried beans" },
          { name: "Tomato" },
        ],
      },
      {
        name: "Molé Poblano",
        description: "Chicken in a dark, creamy molé sauce made with chocolate and peanuts.",
        section: "La Palma Platters | Platillos a La Palma",
        sortOrder: 1,
        price: "17.95",
        nutrition: { calories: 850, protein: 48, carbs: 72, fat: 40, fiber: 10 },
        ingredients: [
          { name: "Chicken" },
          { name: "Dried chili peppers" },
          { name: "Chocolate" },
          { name: "Peanuts" },
          { name: "Sesame seed" },
          { name: "Tomato" },
          { name: "Spanish rice" },
          { name: "Beans" },
        ],
      },
      {
        name: "Queso Birria Tacos",
        description: "Two soft corn tortillas with cheese and beef birria, served with consommé.",
        section: "La Palma Platters | Platillos a La Palma",
        sortOrder: 2,
        price: "14.95",
        isRecommended: true,
        nutrition: { calories: 750, protein: 42, carbs: 52, fat: 40, fiber: 4 },
        ingredients: [
          { name: "Beef birria" },
          { name: "Corn tortilla" },
          { name: "Cheese (dairy)" },
          { name: "Onion" },
          { name: "Cilantro" },
          { name: "Chili consommé" },
        ],
      },
      {
        name: "Sizzlin' Fajitas with Chicken or Beef",
        description: "Grilled chicken or beef fajitas served sizzling with peppers and onions.",
        section: "La Palma Platters | Platillos a La Palma",
        sortOrder: 3,
        price: "17.95",
        nutrition: { calories: 780, protein: 48, carbs: 62, fat: 34, fiber: 8 },
        ingredients: [
          { name: "Chicken or beef" },
          { name: "Bell pepper" },
          { name: "Onion" },
          { name: "Flour tortilla (gluten)" },
          { name: "Lime" },
          { name: "Garlic" },
        ],
      },
      {
        name: "Huevos Rancheros",
        description: "Two over-easy eggs on a corn tortilla topped with bistec ranchero, served with Spanish rice and beans.",
        section: "Breakfast | Desayuno",
        sortOrder: 1,
        price: "13.95",
        nutrition: { calories: 740, protein: 34, carbs: 70, fat: 36, fiber: 10 },
        ingredients: [
          { name: "Eggs" },
          { name: "Corn tortilla" },
          { name: "Beef" },
          { name: "Tomato sauce" },
          { name: "Onion" },
          { name: "Bell pepper" },
          { name: "Spanish rice" },
          { name: "Beans" },
        ],
      },
      {
        name: "Chile Verde",
        description: "Tender pork chunks simmered in a salsa verde sauce.",
        section: "La Palma Platters | Platillos a La Palma",
        sortOrder: 4,
        price: "15.95",
        nutrition: { calories: 760, protein: 44, carbs: 62, fat: 36, fiber: 9 },
        ingredients: [
          { name: "Pork" },
          { name: "Tomatillo" },
          { name: "Jalapeño" },
          { name: "Cilantro" },
          { name: "Garlic" },
          { name: "Onion" },
          { name: "Spanish rice" },
          { name: "Beans" },
        ],
      },
    ],
  },
  {
    slug: "thai-me-up",
    name: "Thai Me Up",
    description:
      "Authentic Thai and Lao restaurant on the Miracle Mile serving classic curries, papaya salads, and noodle dishes with vegan/gluten-free options marked.",
    cuisine: "Thai",
    addressLine: "2125 Pacific Ave",
    city: "Stockton",
    state: "CA",
    postalCode: "95204",
    neighborhood: "Miracle Mile",
    dishes: [
      {
        // Live-smoke fixture (see header): menu-explicit peanut dish, not AI-inferred.
        name: "Pad Thai",
        description:
          "Stir-fried rice noodles with choice of protein, tofu, egg, bean sprouts, and ground peanuts. Marked (G) on menu.",
        section: "Noodle Dishes",
        sortOrder: 1,
        price: "18.99",
        isRecommended: true,
        nutrition: { calories: 800, protein: 32, carbs: 95, fat: 30, fiber: 5 },
        ingredients: [
          { name: "Rice noodles" },
          { name: "Choice of protein" },
          { name: "Tofu" },
          { name: "Egg" },
          { name: "Bean sprouts" },
          { name: "Green onion" },
          { name: "Ground peanuts" },
          { name: "Lime" },
          { name: "Tamarind sauce" },
        ],
      },
      {
        name: "Green Curry",
        description: "Classic Thai green curry with coconut milk. Marked (G)(V) on menu.",
        section: "Curries",
        sortOrder: 1,
        price: "18.99",
        nutrition: { calories: 550, protein: 28, carbs: 22, fat: 40, fiber: 5 },
        ingredients: [
          { name: "Green curry paste" },
          { name: "Coconut milk" },
          { name: "Thai basil" },
          { name: "Bamboo shoots" },
          { name: "Bell pepper" },
          { name: "Choice of protein" },
          { name: "Fish sauce" },
        ],
      },
      {
        name: "Larb Waterfall Beef",
        description: "Minced/sliced beef salad in the larb style with herbs and toasted rice powder.",
        section: "Salads",
        sortOrder: 1,
        price: "19.50",
        nutrition: { calories: 420, protein: 34, carbs: 16, fat: 24, fiber: 3 },
        ingredients: [
          { name: "Beef" },
          { name: "Toasted rice powder" },
          { name: "Lime juice" },
          { name: "Fish sauce" },
          { name: "Mint" },
          { name: "Cilantro" },
          { name: "Shallot" },
          { name: "Chili flakes" },
        ],
      },
      {
        name: "Thai Grilled Beef Salad",
        description: "Grilled beef salad tossed with a spicy lime dressing. Marked (G) on menu.",
        section: "Salads",
        sortOrder: 2,
        price: "18.50",
        nutrition: { calories: 380, protein: 34, carbs: 14, fat: 20, fiber: 3 },
        ingredients: [
          { name: "Grilled beef" },
          { name: "Cucumber" },
          { name: "Tomato" },
          { name: "Lime juice" },
          { name: "Fish sauce" },
          { name: "Chili" },
          { name: "Cilantro" },
        ],
      },
      {
        name: "Shrimp Cakes",
        description: "Fried shrimp cakes served as a starter.",
        section: "Appetizers",
        sortOrder: 1,
        price: "17.50",
        nutrition: { calories: 480, protein: 24, carbs: 32, fat: 28, fiber: 2 },
        ingredients: [
          { name: "Shrimp" },
          { name: "Red curry paste" },
          { name: "Egg" },
          { name: "Breadcrumbs (gluten)" },
          { name: "Green beans" },
          { name: "Frying oil" },
        ],
      },
      {
        name: "Panang Curry",
        description: "Rich, thick peanut-infused Thai curry with coconut milk. Marked (G)(V) on menu.",
        section: "Curries",
        sortOrder: 2,
        price: "18.99",
        nutrition: { calories: 620, protein: 30, carbs: 24, fat: 46, fiber: 5 },
        ingredients: [
          { name: "Panang curry paste" },
          { name: "Coconut milk" },
          { name: "Peanuts" },
          { name: "Kaffir lime leaf" },
          { name: "Choice of protein" },
          { name: "Fish sauce" },
        ],
      },
      {
        name: "Tofu Triangles",
        description: "Fried tofu triangles served as a starter, typically with a dipping sauce.",
        section: "Appetizers",
        sortOrder: 2,
        price: "12.50",
        nutrition: { calories: 380, protein: 16, carbs: 30, fat: 22, fiber: 3 },
        ingredients: [
          { name: "Tofu (soy)" },
          { name: "Cornstarch" },
          { name: "Frying oil" },
          { name: "Sweet chili dipping sauce" },
          { name: "Crushed peanuts" },
        ],
      },
      {
        name: "Mango Sticky Rice",
        description: "Sweet sticky rice served with fresh mango and coconut milk.",
        section: "Desserts",
        sortOrder: 1,
        price: "13.00",
        nutrition: { calories: 520, protein: 7, carbs: 92, fat: 14, fiber: 4 },
        ingredients: [
          { name: "Sticky rice" },
          { name: "Mango" },
          { name: "Coconut milk" },
          { name: "Sugar" },
          { name: "Sesame seeds" },
        ],
      },
    ],
  },
  {
    slug: "cocoro-bistro-sushi-bar",
    name: "Cocoro Bistro Sushi Bar",
    description:
      "Japanese bistro and sushi bar on the Miracle Mile offering sushi, sashimi, rolls, ramen, and donburi rice bowls with indoor and outdoor seating.",
    cuisine: "Japanese",
    addressLine: "2105 Pacific Ave",
    city: "Stockton",
    state: "CA",
    postalCode: "95204",
    neighborhood: "Miracle Mile",
    dishes: [
      {
        name: "Spicy Tuna Roll",
        description: "Tuna tartar with spicy sauce.",
        section: "Sushi Rolls",
        sortOrder: 1,
        price: "10.50",
        isRecommended: true,
        nutrition: { calories: 300, protein: 14, carbs: 38, fat: 10, fiber: 2 },
        ingredients: [
          { name: "Tuna" },
          { name: "Sushi rice" },
          { name: "Nori (seaweed)" },
          { name: "Spicy mayo" },
          { name: "Sriracha" },
          { name: "Green onion" },
        ],
      },
      {
        name: "California Roll",
        description: "Imitation crab, avocado and cucumber roll.",
        section: "Sushi Rolls",
        sortOrder: 2,
        price: "7.50",
        nutrition: { calories: 260, protein: 8, carbs: 38, fat: 8, fiber: 3 },
        ingredients: [
          { name: "Imitation crab" },
          { name: "Avocado" },
          { name: "Cucumber" },
          { name: "Sushi rice" },
          { name: "Nori (seaweed)" },
        ],
      },
      {
        name: "Spider Roll",
        description: "Deep-fried soft-shell crab with lettuce, avocado, and three kinds of fish roe.",
        section: "Sushi Rolls",
        sortOrder: 3,
        price: "12.00",
        nutrition: { calories: 400, protein: 16, carbs: 46, fat: 17, fiber: 3 },
        ingredients: [
          { name: "Soft-shell crab (shellfish)" },
          { name: "Lettuce" },
          { name: "Avocado" },
          { name: "Fish roe" },
          { name: "Sushi rice" },
          { name: "Nori (seaweed)" },
          { name: "Frying batter (gluten)" },
        ],
      },
      {
        name: "Rainbow Roll",
        description: "California roll topped with assorted fresh fish.",
        section: "Sushi Rolls",
        sortOrder: 4,
        price: "15.00",
        nutrition: { calories: 380, protein: 22, carbs: 42, fat: 12, fiber: 3 },
        ingredients: [
          { name: "Imitation crab" },
          { name: "Avocado" },
          { name: "Cucumber" },
          { name: "Assorted sashimi (tuna, salmon, yellowtail)" },
          { name: "Sushi rice" },
          { name: "Nori (seaweed)" },
        ],
      },
      {
        name: "Parmesan Spring Roll",
        description: "Parmesan cheese with bay shrimp, rolled and fried.",
        section: "Appetizers",
        sortOrder: 1,
        price: "6.00",
        nutrition: { calories: 280, protein: 12, carbs: 20, fat: 17, fiber: 1 },
        ingredients: [
          { name: "Parmesan cheese (dairy)" },
          { name: "Bay shrimp (shellfish)" },
          { name: "Spring roll wrapper (gluten)" },
          { name: "Frying oil" },
        ],
      },
      {
        name: "Vegetable Tempura",
        description: "Seasonal vegetables with tempura sauce.",
        section: "Appetizers",
        sortOrder: 2,
        price: "12.00",
        nutrition: { calories: 420, protein: 8, carbs: 46, fat: 23, fiber: 4 },
        ingredients: [
          { name: "Seasonal vegetables" },
          { name: "Tempura batter (wheat, egg)" },
          { name: "Tempura dipping sauce (soy)" },
          { name: "Frying oil" },
        ],
      },
      {
        name: "Chicken Teriyaki Don",
        description: "Grilled chicken sauteed with onion and mushroom over rice.",
        section: "Donburi (Rice Bowls)",
        sortOrder: 1,
        price: "10.00",
        nutrition: { calories: 650, protein: 38, carbs: 88, fat: 14, fiber: 3 },
        ingredients: [
          { name: "Chicken" },
          { name: "Onion" },
          { name: "Mushroom" },
          { name: "Teriyaki sauce (soy)" },
          { name: "Steamed rice" },
        ],
      },
      {
        name: "Unagi Don",
        description: "Broiled unagi (eel) with teriyaki sauce over rice.",
        section: "Donburi (Rice Bowls)",
        sortOrder: 2,
        price: "14.00",
        nutrition: { calories: 700, protein: 32, carbs: 96, fat: 20, fiber: 3 },
        ingredients: [
          { name: "Unagi (eel)" },
          { name: "Teriyaki sauce (soy)" },
          { name: "Steamed rice" },
          { name: "Nori (seaweed)" },
          { name: "Sansho pepper" },
        ],
      },
    ],
  },
  {
    slug: "mannys-california-fresh-cafe",
    name: "Manny's California Fresh Cafe",
    description:
      "Family-owned Miracle Mile diner-style cafe open since 1955, known for its burgers, deli sandwiches, and fried seafood.",
    cuisine: "American",
    addressLine: "1612 Pacific Ave",
    city: "Stockton",
    state: "CA",
    postalCode: "95204",
    neighborhood: "Miracle Mile",
    dishes: [
      {
        name: "Manny's Burger",
        description:
          "Two beef patties with lettuce, pickle, tomato, onion, melted cheese and special sauce. Local favorite.",
        section: "From the Grill",
        sortOrder: 1,
        price: "5.75",
        isRecommended: true,
        nutrition: { calories: 820, protein: 45, carbs: 44, fat: 50, fiber: 3 },
        ingredients: [
          { name: "Ground chuck beef" },
          { name: "Cheese (dairy)" },
          { name: "Lettuce" },
          { name: "Tomato" },
          { name: "Onion" },
          { name: "Pickle" },
          { name: "Special sauce (mayonnaise)" },
          { name: "Bun (gluten)" },
        ],
      },
      {
        name: "Carmel Sandwich",
        description:
          "Mayo, avocado, tomato, onion, sprouts, and jack or Swiss cheese on honey wheat berry bread. Local favorite.",
        section: "Sandwiches",
        sortOrder: 1,
        price: "4.25",
        nutrition: { calories: 520, protein: 18, carbs: 44, fat: 31, fiber: 8 },
        ingredients: [
          { name: "Honey wheat bread (gluten)" },
          { name: "Mayonnaise (egg)" },
          { name: "Avocado" },
          { name: "Tomato" },
          { name: "Onion" },
          { name: "Sprouts" },
          { name: "Jack or Swiss cheese (dairy)" },
        ],
      },
      {
        name: "Monterey Jack Sandwich",
        description: "Melted jack cheese, tuna, sprouts, onions, avocado and tomato on sourdough with a Vienna pickle.",
        section: "Sandwiches",
        sortOrder: 2,
        price: "5.75",
        nutrition: { calories: 560, protein: 32, carbs: 42, fat: 28, fiber: 6 },
        ingredients: [
          { name: "Sourdough bread (gluten)" },
          { name: "Tuna (fish)" },
          { name: "Jack cheese (dairy)" },
          { name: "Sprouts" },
          { name: "Onion" },
          { name: "Avocado" },
          { name: "Tomato" },
        ],
      },
      {
        name: "BLT Sandwich",
        description: "Apple smoked bacon, lettuce, tomato, and mayo on toasted honey wheat berry bread.",
        section: "Sandwiches",
        sortOrder: 3,
        price: "5.75",
        nutrition: { calories: 460, protein: 16, carbs: 40, fat: 26, fiber: 5 },
        ingredients: [
          { name: "Apple smoked bacon" },
          { name: "Lettuce" },
          { name: "Tomato" },
          { name: "Mayonnaise (egg)" },
          { name: "Honey wheat bread (gluten)" },
        ],
      },
      {
        name: "Oyster Dinner",
        description: "Fresh deep fried blue Pacific oysters and chips.",
        section: "From the Sea",
        sortOrder: 1,
        price: "10.95",
        nutrition: { calories: 720, protein: 22, carbs: 68, fat: 40, fiber: 4 },
        ingredients: [
          { name: "Pacific oysters (shellfish)" },
          { name: "Batter (wheat flour, egg)" },
          { name: "Frying oil" },
          { name: "Potato chips" },
          { name: "Tartar sauce" },
        ],
      },
      {
        name: "Fish Sandwich",
        description: "Fresh Pacific red snapper on a sourdough bun with tartar sauce.",
        section: "From the Sea",
        sortOrder: 2,
        price: "5.25",
        nutrition: { calories: 440, protein: 28, carbs: 42, fat: 18, fiber: 3 },
        ingredients: [
          { name: "Red snapper (fish)" },
          { name: "Sourdough bun (gluten)" },
          { name: "Tartar sauce (egg, mayonnaise)" },
          { name: "Lettuce" },
        ],
      },
      {
        name: "Chili Burger",
        description: "Ground chuck beef patty topped with homemade Texas-style chili, lettuce, onions, and pickle.",
        section: "From the Grill",
        sortOrder: 2,
        price: "5.50",
        nutrition: { calories: 680, protein: 40, carbs: 48, fat: 36, fiber: 7 },
        ingredients: [
          { name: "Ground chuck beef" },
          { name: "Homemade chili (beef, beans)" },
          { name: "Lettuce" },
          { name: "Onion" },
          { name: "Pickle" },
          { name: "Bun (gluten)" },
        ],
      },
      {
        name: "Chef's Salad",
        description: "Lettuce, sprouts, onions, tomatoes, avocado, turkey, ham, salami, and jack cheese.",
        section: "Salads",
        sortOrder: 1,
        price: "7.95",
        nutrition: { calories: 480, protein: 34, carbs: 14, fat: 32, fiber: 6 },
        ingredients: [
          { name: "Lettuce" },
          { name: "Sprouts" },
          { name: "Onion" },
          { name: "Tomato" },
          { name: "Avocado" },
          { name: "Turkey" },
          { name: "Ham" },
          { name: "Salami" },
          { name: "Jack cheese (dairy)" },
        ],
      },
    ],
  },
];

async function main() {
  // Resolve/create the Ethnic (cuisine) rows this pilot set needs, following
  // the existing seed convention of get-or-create by unique name.
  const cuisineNames = Array.from(new Set(RESTAURANTS.map((r) => r.cuisine)));
  const ethnicByName = new Map<string, string>();
  for (const name of cuisineNames) {
    const ethnic = await prisma.ethnic.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    ethnicByName.set(name, ethnic.id);
  }

  let totalDishes = 0;

  for (const r of RESTAURANTS) {
    const ethnicId = ethnicByName.get(r.cuisine);
    if (!ethnicId) {
      throw new Error(`No Ethnic resolved for cuisine "${r.cuisine}" (restaurant ${r.slug})`);
    }

    // Non-destructive reconcile (2026-07-24 audit Task 17). The previous
    // deleteMany+recreate was destructive on re-run against a live DB: it
    // wiped every post-seed admin menu edit, severed MealLog.restaurantDishId
    // provenance (onDelete: SetNull), force-published archived restaurants,
    // and exposed a mid-run empty-menu window. Now, per restaurant, inside
    // one transaction:
    //   - restaurant fields update on match, but status is only set on
    //     CREATE (an admin's archive decision is never overridden);
    //   - dishes match by (section, name): matched dishes update display
    //     scalars ONLY — ingredients and status stay admin-owned
    //     (D-INGREDIENTS: human-verified lists are ground truth, a re-seed
    //     must never overwrite corrections); missing dishes are created in
    //     full; unmatched existing dishes are NEVER deleted.
    const seededCount = await prisma.$transaction(async (tx) => {
      const restaurant = await tx.restaurant.upsert({
        where: { slug: r.slug },
        update: {
          name: r.name,
          description: r.description,
          neighborhood: r.neighborhood,
          city: r.city,
          state: r.state,
          postalCode: r.postalCode,
          addressLine: r.addressLine,
          ethnicId,
        },
        create: {
          name: r.name,
          slug: r.slug,
          description: r.description,
          neighborhood: r.neighborhood,
          city: r.city,
          state: r.state,
          postalCode: r.postalCode,
          addressLine: r.addressLine,
          ethnicId,
          status: "PUBLISHED",
        },
      });

      const existingDishes = await tx.restaurantDish.findMany({
        where: { restaurantId: restaurant.id },
        select: { id: true, section: true, name: true },
      });
      const dishKey = (section: string, name: string) => `${section} ${name}`;
      const existingByKey = new Map(existingDishes.map((d) => [dishKey(d.section, d.name), d.id]));

      let count = 0;
      for (const dish of r.dishes) {
        const matchedId = existingByKey.get(dishKey(dish.section, dish.name));
        if (matchedId) {
          await tx.restaurantDish.update({
            where: { id: matchedId },
            data: {
              description: dish.description,
              sortOrder: dish.sortOrder,
              price: dish.price,
              currency: dish.currency ?? "USD",
              isRecommended: dish.isRecommended ?? false,
              // Macros are display scalars (same re-seed posture as price):
              // updated on match so a re-run backfills dishes seeded before
              // nutrition existed (2026-08-04).
              calories: dish.nutrition?.calories ?? null,
              protein: dish.nutrition?.protein ?? null,
              carbs: dish.nutrition?.carbs ?? null,
              fat: dish.nutrition?.fat ?? null,
              fiber: dish.nutrition?.fiber ?? null,
            },
          });
        } else {
          await tx.restaurantDish.create({
            data: {
              restaurantId: restaurant.id,
              name: dish.name,
              description: dish.description,
              section: dish.section,
              sortOrder: dish.sortOrder,
              price: dish.price,
              currency: dish.currency ?? "USD",
              status: "PUBLISHED",
              isRecommended: dish.isRecommended ?? false,
              available: true,
              calories: dish.nutrition?.calories ?? null,
              protein: dish.nutrition?.protein ?? null,
              carbs: dish.nutrition?.carbs ?? null,
              fat: dish.nutrition?.fat ?? null,
              fiber: dish.nutrition?.fiber ?? null,
              ingredients: dish.ingredients.length
                ? {
                    create: dish.ingredients.map((i) => ({
                      name: i.name,
                      quantity: i.quantity ?? null,
                      unit: i.unit ?? null,
                    })),
                  }
                : undefined,
            },
          });
        }
        count += 1;
      }
      return count;
    });
    totalDishes += seededCount;

    console.log(`✓ Reconciled restaurant "${r.name}" (${r.slug}) — ${r.dishes.length} fixture dishes.`);
  }

  console.log(`✓ Done: ${RESTAURANTS.length} restaurants, ${totalDishes} dishes total.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
