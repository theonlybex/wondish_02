import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST() {
  try {
    // ── Reference data ──────────────────────────────────────────────────────

    await prisma.gender.createMany({
      data: [
        { name: "Male" },
        { name: "Female" },
        { name: "Non-binary" },
        { name: "Prefer not to say" },
      ],
      skipDuplicates: true,
    });

    await prisma.physicalActivity.createMany({
      data: [
        { name: "Sedentary", level: 1 },
        { name: "Lightly Active", level: 2 },
        { name: "Moderately Active", level: 3 },
        { name: "Very Active", level: 4 },
        { name: "Extremely Active", level: 5 },
      ],
      skipDuplicates: true,
    });

    await prisma.mealType.createMany({
      data: [
        { name: "Breakfast" },
        { name: "Lunch" },
        { name: "Dinner" },
        { name: "Snack" },
      ],
      skipDuplicates: true,
    });

    await prisma.dishType.createMany({
      data: [
        { name: "Main Course" },
        { name: "Side Dish" },
        { name: "Salad" },
        { name: "Soup" },
        { name: "Dessert" },
        { name: "Beverage" },
        { name: "Bread" },
        { name: "Appetizer" },
      ],
      skipDuplicates: true,
    });

    await prisma.ethnic.createMany({
      data: [
        { name: "Mediterranean" },
        { name: "Asian" },
        { name: "Mexican" },
        { name: "American" },
        { name: "Indian" },
        { name: "Middle Eastern" },
        { name: "European" },
        { name: "African" },
      ],
      skipDuplicates: true,
    });

    await prisma.motivation.createMany({
      data: [
        { name: "Lose weight" },
        { name: "Build muscle" },
        { name: "Improve energy" },
        { name: "Manage a health condition" },
        { name: "Eat healthier" },
        { name: "Save time on meal planning" },
      ],
      skipDuplicates: true,
    });

    await prisma.foodPreference.createMany({
      data: [
        { name: "Vegetarian" },
        { name: "Vegan" },
        { name: "Pescatarian" },
        { name: "Paleo" },
        { name: "Keto" },
        { name: "Gluten-free" },
        { name: "Dairy-free" },
        { name: "Low-carb" },
        { name: "High-protein" },
        { name: "Mediterranean" },
      ],
      skipDuplicates: true,
    });

    await prisma.foodToAvoid.createMany({
      data: [
        { name: "Red meat" },
        { name: "Pork" },
        { name: "Shellfish" },
        { name: "Processed foods" },
        { name: "Fried foods" },
        { name: "Added sugars" },
        { name: "Alcohol" },
        { name: "Caffeine" },
        { name: "Spicy foods" },
        { name: "Raw foods" },
      ],
      skipDuplicates: true,
    });

    await prisma.foodAllergy.createMany({
      data: [
        { name: "Peanuts" },
        { name: "Tree nuts" },
        { name: "Milk" },
        { name: "Eggs" },
        { name: "Wheat / Gluten" },
        { name: "Soy" },
        { name: "Fish" },
        { name: "Shellfish" },
        { name: "Sesame" },
      ],
      skipDuplicates: true,
    });

    await prisma.healthCondition.createMany({
      data: [
        { name: "Type 2 Diabetes" },
        { name: "Hypertension" },
        { name: "High Cholesterol" },
        { name: "Celiac Disease" },
        { name: "IBS / IBD" },
        { name: "Thyroid Disorder" },
        { name: "Heart Disease" },
        { name: "Kidney Disease" },
      ],
      skipDuplicates: true,
    });

    // ── 20 Sample recipes ────────────────────────────────────────────────────

    const mealTypes = await prisma.mealType.findMany();
    const byName = (name: string) =>
      mealTypes.find((m) => m.name === name)?.id;

    const recipes = [
      // Breakfast (5)
      {
        name: "Oatmeal with Berries",
        emoji: "🫐",
        calories: 320,
        protein: 10,
        carbs: 58,
        fat: 6,
        mealTypeId: byName("Breakfast"),
        tags: ["healthy", "quick"],
      },
      {
        name: "Avocado Toast",
        emoji: "🥑",
        calories: 380,
        protein: 12,
        carbs: 42,
        fat: 18,
        mealTypeId: byName("Breakfast"),
        tags: ["trendy", "vegetarian"],
      },
      {
        name: "Greek Yogurt Parfait",
        emoji: "🍓",
        calories: 290,
        protein: 18,
        carbs: 38,
        fat: 5,
        mealTypeId: byName("Breakfast"),
        tags: ["protein", "quick"],
      },
      {
        name: "Scrambled Eggs & Spinach",
        emoji: "🍳",
        calories: 270,
        protein: 20,
        carbs: 6,
        fat: 18,
        mealTypeId: byName("Breakfast"),
        tags: ["keto", "protein"],
      },
      {
        name: "Banana Smoothie Bowl",
        emoji: "🍌",
        calories: 350,
        protein: 8,
        carbs: 64,
        fat: 7,
        mealTypeId: byName("Breakfast"),
        tags: ["vegan", "quick"],
      },
      // Lunch (5)
      {
        name: "Grilled Chicken Salad",
        emoji: "🥗",
        calories: 420,
        protein: 38,
        carbs: 18,
        fat: 22,
        mealTypeId: byName("Lunch"),
        tags: ["high-protein", "low-carb"],
      },
      {
        name: "Lentil Soup",
        emoji: "🍲",
        calories: 340,
        protein: 18,
        carbs: 48,
        fat: 6,
        mealTypeId: byName("Lunch"),
        tags: ["vegan", "fiber"],
      },
      {
        name: "Turkey & Veggie Wrap",
        emoji: "🌯",
        calories: 450,
        protein: 32,
        carbs: 46,
        fat: 14,
        mealTypeId: byName("Lunch"),
        tags: ["balanced"],
      },
      {
        name: "Quinoa Power Bowl",
        emoji: "🥣",
        calories: 480,
        protein: 22,
        carbs: 56,
        fat: 16,
        mealTypeId: byName("Lunch"),
        tags: ["vegetarian", "balanced"],
      },
      {
        name: "Tuna Nicoise Salad",
        emoji: "🐟",
        calories: 390,
        protein: 34,
        carbs: 22,
        fat: 18,
        mealTypeId: byName("Lunch"),
        tags: ["omega-3", "mediterranean"],
      },
      // Dinner (5)
      {
        name: "Baked Salmon with Vegetables",
        emoji: "🐠",
        calories: 520,
        protein: 42,
        carbs: 24,
        fat: 28,
        mealTypeId: byName("Dinner"),
        tags: ["omega-3", "gluten-free"],
      },
      {
        name: "Chicken Stir Fry",
        emoji: "🍜",
        calories: 490,
        protein: 38,
        carbs: 42,
        fat: 16,
        mealTypeId: byName("Dinner"),
        tags: ["asian", "quick"],
      },
      {
        name: "Vegetable Curry",
        emoji: "🍛",
        calories: 420,
        protein: 14,
        carbs: 52,
        fat: 18,
        mealTypeId: byName("Dinner"),
        tags: ["vegan", "indian"],
      },
      {
        name: "Beef & Broccoli",
        emoji: "🥦",
        calories: 560,
        protein: 46,
        carbs: 28,
        fat: 26,
        mealTypeId: byName("Dinner"),
        tags: ["high-protein"],
      },
      {
        name: "Mediterranean Pasta",
        emoji: "🍝",
        calories: 580,
        protein: 24,
        carbs: 72,
        fat: 20,
        mealTypeId: byName("Dinner"),
        tags: ["mediterranean", "vegetarian"],
      },
      // Snack (5)
      {
        name: "Apple with Almond Butter",
        emoji: "🍎",
        calories: 210,
        protein: 6,
        carbs: 28,
        fat: 10,
        mealTypeId: byName("Snack"),
        tags: ["quick", "healthy"],
      },
      {
        name: "Hummus & Veggie Sticks",
        emoji: "🥕",
        calories: 180,
        protein: 8,
        carbs: 22,
        fat: 7,
        mealTypeId: byName("Snack"),
        tags: ["vegan", "fiber"],
      },
      {
        name: "Protein Bar",
        emoji: "🍫",
        calories: 240,
        protein: 20,
        carbs: 26,
        fat: 8,
        mealTypeId: byName("Snack"),
        tags: ["protein", "convenient"],
      },
      {
        name: "Trail Mix",
        emoji: "🥜",
        calories: 280,
        protein: 8,
        carbs: 30,
        fat: 16,
        mealTypeId: byName("Snack"),
        tags: ["quick", "energy"],
      },
      {
        name: "Cottage Cheese Bowl",
        emoji: "🧀",
        calories: 200,
        protein: 24,
        carbs: 10,
        fat: 6,
        mealTypeId: byName("Snack"),
        tags: ["protein", "low-carb"],
      },
    ];

    await prisma.recipe.createMany({
      data: recipes.map((r) => ({ ...r, isPublic: true })),
      skipDuplicates: true,
    });

    return NextResponse.json({ ok: true, message: "Seed complete" });
  } catch (error) {
    console.error("Seed error:", error);
    return NextResponse.json(
      { error: "Seed failed", detail: String(error) },
      { status: 500 }
    );
  }
}
