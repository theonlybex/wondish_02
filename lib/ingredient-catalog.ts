// Curated, human-authored ingredient catalog for the taste selector — grouped
// by category, then by kind (Beef → ground beef, steaks; Chicken → breast,
// thighs…). This is the ONLY source for the selector: never derive selectable
// ingredients from recipe rows (they contain messy/one-off items like "mustard"
// mis-shown as a protein). Each item resolves to a real Ingredient at runtime.

import type { CategoryKey } from "@/lib/ingredient-categories";

export interface CatalogGroup {
  label: string;
  items: string[];
}
export interface CatalogLevel {
  key: CategoryKey;
  title: string;
  groups: CatalogGroup[];
}

export const INGREDIENT_CATALOG: CatalogLevel[] = [
  {
    key: "protein",
    title: "Proteins",
    groups: [
      { label: "Beef", items: ["Ground beef", "Ribeye steak", "Sirloin steak", "Beef stew meat"] },
      { label: "Chicken", items: ["Chicken breast", "Chicken thighs", "Chicken wings", "Whole chicken"] },
      { label: "Pork", items: ["Pork chops", "Ground pork", "Bacon", "Ham"] },
      { label: "Fish & seafood", items: ["Salmon", "Tuna", "Cod", "Tilapia", "Shrimp"] },
      { label: "Plant & eggs", items: ["Eggs", "Tofu", "Tempeh", "Black beans", "Lentils", "Chickpeas"] },
    ],
  },
  {
    key: "carb",
    title: "Grains & Carbs",
    groups: [
      { label: "Grains", items: ["White rice", "Brown rice", "Quinoa", "Oats", "Couscous"] },
      { label: "Pasta & bread", items: ["Pasta", "Bread", "Tortilla", "Bagel"] },
      { label: "Starchy", items: ["Potato", "Sweet potato"] },
    ],
  },
  {
    key: "vegetable",
    title: "Vegetables",
    groups: [
      { label: "Leafy greens", items: ["Spinach", "Kale", "Lettuce", "Cabbage"] },
      { label: "Cruciferous", items: ["Broccoli", "Cauliflower", "Brussels sprouts"] },
      { label: "Aromatics", items: ["Onion", "Garlic", "Scallion"] },
      { label: "Everyday", items: ["Tomato", "Bell pepper", "Mushroom", "Carrot", "Zucchini", "Cucumber", "Corn"] },
    ],
  },
  {
    key: "fruit",
    title: "Fruits",
    groups: [
      { label: "Common", items: ["Apple", "Banana", "Orange", "Grapes"] },
      { label: "Berries", items: ["Strawberry", "Blueberry", "Raspberry"] },
      { label: "Tropical", items: ["Mango", "Pineapple", "Avocado"] },
      { label: "Citrus", items: ["Lemon", "Lime"] },
    ],
  },
  {
    key: "dairy",
    title: "Dairy",
    groups: [
      { label: "Milk & yogurt", items: ["Milk", "Greek yogurt", "Heavy cream"] },
      { label: "Cheese", items: ["Cheddar", "Mozzarella", "Parmesan", "Feta"] },
      { label: "Other", items: ["Butter", "Cottage cheese"] },
    ],
  },
  {
    key: "fat",
    title: "Fats & Flavor",
    groups: [
      { label: "Oils", items: ["Olive oil", "Avocado oil", "Sesame oil"] },
      { label: "Nuts & seeds", items: ["Almonds", "Walnuts", "Peanuts", "Chia seeds"] },
      { label: "Spreads", items: ["Peanut butter", "Tahini"] },
    ],
  },
];

// Every distinct catalog item name (for id resolution).
export function catalogItemNames(): string[] {
  return Array.from(new Set(INGREDIENT_CATALOG.flatMap((l) => l.groups.flatMap((g) => g.items))));
}
