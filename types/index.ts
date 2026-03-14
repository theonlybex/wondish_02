export type MealTypeKey = "breakfast" | "lunch" | "dinner" | "snack";

export interface Dish {
  id: number;
  name: string;
  description: string;
  mealType: MealTypeKey;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  prepTime: number;
  cookTime: number;
  servings: number;
  tags: string[];
  emoji: string;
  featured?: boolean;
}

export interface PricingPlan {
  id: string;
  name: string;
  price: number | null;
  interval: "month" | "year" | null;
  description: string;
  features: string[];
  limitations: string[];
  highlighted: boolean;
  cta: string;
  trialDays?: number;
}

export type SubscriptionPlan = "FREE" | "PREMIUM";
export type SubscriptionStatus =
  | "ACTIVE"
  | "CANCELED"
  | "PAST_DUE"
  | "TRIALING"
  | "INCOMPLETE";

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  plan: SubscriptionPlan;
}

// ─── Recipe & Menu DTOs ────────────────────────────────────────────────────

export interface RecipeDTO {
  id: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  emoji?: string | null;
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  fiber?: number | null;
  prepTime?: number | null;
  cookTime?: number | null;
  servings?: number | null;
  tags: string[];
  mealTypeId?: string | null;
  mealType?: { id: string; name: string } | null;
  dishTypeId?: string | null;
  dishType?: { id: string; name: string } | null;
  ethnicId?: string | null;
  ethnic?: { id: string; name: string } | null;
  ingredients: {
    ingredientId: string;
    ingredient: { id: string; name: string; unit?: string | null };
    quantity?: number | null;
    unit?: string | null;
  }[];
}

export interface MenuEntry {
  id: string;
  date: string;
  mealTypeId?: string | null;
  mealType?: { id: string; name: string } | null;
  recipe: RecipeDTO;
}

// ─── Journal DTOs ─────────────────────────────────────────────────────────

export interface JournalMealDTO {
  id: string;
  mealType: string;
  preparation?: string | null;
  recipeId?: string | null;
  skipped: boolean;
  rating?: number | null;
}

export interface JournalEntryDTO {
  id: string;
  date: string;
  mood?: string | null;
  weight?: number | null;
  energyLevel?: string | null;
  activityLevel?: string | null;
  notes?: string | null;
  meals: JournalMealDTO[];
}

// ─── Grocery ──────────────────────────────────────────────────────────────

export interface GroceryItem {
  ingredientId: string;
  name: string;
  totalQuantity: number;
  unit?: string | null;
}

// ─── Journey / Stats ──────────────────────────────────────────────────────

export interface JourneyStats {
  avgMood: number;
  avgEnergy: number;
  avgWeight: number | null;
  engagementPercent: number;
  mealSourceBreakdown: {
    cooked: number;
    skipped: number;
    readyToEat: number;
    restaurant: number;
  };
  dailyMoods: { date: string; mood: number }[];
  dailyWeights: { date: string; weight: number }[];
}

// ─── Patient Profile ──────────────────────────────────────────────────────

export interface PatientProfile {
  id: string;
  accountId: string;
  birthday?: string | null;
  genderId?: string | null;
  weight?: number | null;
  weightUnit?: string | null;
  height?: number | null;
  heightUnit?: string | null;
  bmi?: number | null;
  physicalActivityId?: string | null;
  goalWeight?: number | null;
  weeklyGoal?: number | null;
  mealPlanStartDate?: string | null;
  motivationIds: string[];
  healthConditionIds: string[];
  foodPreferenceIds: string[];
  foodToAvoidIds: string[];
  foodAllergyIds: string[];
  account: {
    firstName: string;
    lastName: string;
    email: string;
  };
}

// ─── Orders ───────────────────────────────────────────────────────────────

export interface OrderDTO {
  id: string;
  status: string;
  totalAmount?: number | null;
  createdAt: string;
  items: {
    id: string;
    name: string;
    quantity: number;
    price?: number | null;
  }[];
}
