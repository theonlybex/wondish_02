/**
 * Pilot seed: creates the 5 REAL Stockton pilot restaurants (Dumpling U +
 * 4 Miracle Mile / Pacific Ave restaurants) with their real menus, for the
 * Cycle 3 Engine Task E5 restaurant onboarding pilot (Wondish ops uses the
 * admin screen for everything after this; this script just gets a real,
 * researched starting fixture set into a dev/staging DB).
 *
 * Idempotent: upserts each restaurant by slug, then replaces (delete +
 * create) its dishes/ingredients every run, so re-running always converges
 * to the same end state rather than duplicating rows.
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

    const restaurant = await prisma.restaurant.upsert({
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
        status: "PUBLISHED",
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

    // Replace-all: delete existing dishes (cascades to their ingredients) and
    // recreate from the fixture above, so re-running this script always
    // converges to the same menu rather than accumulating duplicates.
    await prisma.restaurantDish.deleteMany({ where: { restaurantId: restaurant.id } });

    for (const dish of r.dishes) {
      await prisma.restaurantDish.create({
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
      totalDishes += 1;
    }

    console.log(`✓ Seeded restaurant "${restaurant.name}" (${restaurant.slug}) with ${r.dishes.length} dishes.`);
  }

  console.log(`✓ Done: ${RESTAURANTS.length} restaurants, ${totalDishes} dishes total.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
