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
