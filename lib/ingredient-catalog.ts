// Curated, human-authored ingredient catalog (the "Master Cooking Ingredients
// List"). The ONLY source for the taste selector and the pantry/shopping
// category sections — never derive selectable ingredients from recipe rows.
// `taste: true` categories are the favorite-able food groups shown in the taste
// selector (proteins first); every category is shown on the pantry screens.

export interface CatalogCategory {
  key: string;
  title: string;
  taste: boolean;
  items: string[];
}

export const INGREDIENT_CATALOG: CatalogCategory[] = [
  {
    key: "proteins",
    title: "Proteins & Plant-Based",
    taste: true,
    items: ["Boneless chicken breasts", "Chicken thighs", "Ground turkey", "Ground beef", "Sirloin steak", "Ribeye steak", "Pork chops", "Bacon", "Salmon fillets", "Shrimp", "Extra-firm tofu"],
  },
  {
    key: "produce",
    title: "Vegetables & Fruits",
    taste: true,
    items: ["Bell peppers", "Broccoli", "Carrots", "Celery", "Zucchini", "Spinach", "Kale", "Green cabbage", "Napa cabbage", "Avocados", "Roma tomatoes", "Cherry tomatoes", "Russet potatoes", "Yukon Gold potatoes", "Sweet potatoes", "Lemons", "Limes"],
  },
  {
    key: "grains",
    title: "Grains, Carbs & Bread",
    taste: true,
    items: ["Jasmine rice", "Basmati rice", "Brown rice", "Arborio rice", "Spaghetti", "Penne", "Quinoa", "Rolled oats", "Flour tortillas", "Corn tortillas", "Sliced bread"],
  },
  {
    key: "dairy",
    title: "Dairy & Refrigerated",
    taste: true,
    items: ["Unsalted butter", "Large eggs", "Whole milk", "Almond milk", "Oat milk", "Heavy cream", "Shredded cheddar", "Shredded mozzarella", "Grated parmesan", "Feta cheese", "Plain Greek yogurt", "Sour cream"],
  },
  {
    key: "aromatics",
    title: "Aromatics & Herbs",
    taste: false,
    items: ["Yellow onions", "Red onions", "White onions", "Shallots", "Garlic", "Fresh ginger", "Green onions", "Fresh cilantro", "Fresh parsley", "Fresh basil", "Fresh rosemary", "Fresh thyme", "Jalapeño peppers"],
  },
  {
    key: "canned",
    title: "Canned Goods & Broths",
    taste: false,
    items: ["Black beans", "Garbanzo beans", "White beans", "Green lentils", "Red lentils", "Diced tomatoes", "Crushed tomatoes", "Tomato paste", "Coconut milk", "Chicken broth", "Vegetable broth", "Beef broth", "Chipotle peppers in adobo"],
  },
  {
    key: "oils",
    title: "Oils, Vinegars & Baking",
    taste: false,
    items: ["Extra virgin olive oil", "Avocado oil", "Canola oil", "Toasted sesame oil", "Rice vinegar", "Apple cider vinegar", "Balsamic vinegar", "Red wine vinegar", "All-purpose flour", "Cornstarch", "Granulated sugar", "Brown sugar", "Baking powder", "Baking soda"],
  },
  {
    key: "sauces",
    title: "Sauces & Condiments",
    taste: false,
    items: ["Soy sauce", "Sriracha", "Thai curry paste", "Salsa roja", "Salsa verde", "Mayonnaise", "Dijon mustard", "Ketchup", "Honey", "Maple syrup", "Pesto"],
  },
  {
    key: "spices",
    title: "Spices & Seasonings",
    taste: false,
    items: ["Kosher salt", "Black peppercorns", "Garlic powder", "Onion powder", "Ground cumin", "Chili powder", "Smoked paprika", "Dried oregano", "Dried thyme", "Ground cinnamon", "Crushed red pepper flakes", "Bay leaves"],
  },
];

// Taste selector shows the favorite-able food groups, proteins first.
const TASTE_ORDER = ["proteins", "produce", "grains", "dairy"];
export function tasteLevels(): CatalogCategory[] {
  return INGREDIENT_CATALOG.filter((c) => c.taste).sort(
    (a, b) => TASTE_ORDER.indexOf(a.key) - TASTE_ORDER.indexOf(b.key)
  );
}

export function catalogItemNames(): string[] {
  return Array.from(new Set(INGREDIENT_CATALOG.flatMap((c) => c.items)));
}
