import {
  calcBMR,
  calcTDEE,
  getActivityMultiplier,
  convertWeight,
  feetInchesToCm,
} from "./caloric-engine";
import type { Sex } from "./caloric-engine";

export type { Sex };
export type ActivityLevel = 1 | 2 | 3 | 4;
export type WeightUnit = "lbs" | "kg";
export type HeightUnit = "ft" | "cm";

export interface QuizAnswers {
  sex: Sex;
  age: number;
  heightCm: number;
  currentWeightLbs: number;
  goalWeightLbs: number;
  activityLevel: ActivityLevel;
  weeklyPaceLbs: number;
}

export interface PredictionResult {
  days: number;
  currentWeightLbs: number;
  goalWeightLbs: number;
  weeklyPaceLbs: number;
}

export function suggestWeeklyPaceLbs(
  sex: Sex,
  age: number,
  heightCm: number,
  currentWeightLbs: number,
  activityLevel: ActivityLevel
): number {
  const { kg: weightKg } = convertWeight(currentWeightLbs, "lbs");
  const bmr = calcBMR(weightKg, heightCm, age, sex);
  const tdee = calcTDEE(bmr, getActivityMultiplier(activityLevel));
  const dailyDeficit = Math.min(tdee * 0.2, 1000);
  const weeklyLossLbs = (dailyDeficit * 7) / 3500;
  return Math.min(Math.max(Math.round(weeklyLossLbs * 10) / 10, 0.5), 2.0);
}

export function calculatePrediction(answers: QuizAnswers): PredictionResult {
  const weightToLoseLbs = answers.currentWeightLbs - answers.goalWeightLbs;
  const days = Math.round((weightToLoseLbs / answers.weeklyPaceLbs) * 7);
  return {
    days,
    currentWeightLbs: answers.currentWeightLbs,
    goalWeightLbs: answers.goalWeightLbs,
    weeklyPaceLbs: answers.weeklyPaceLbs,
  };
}

export { feetInchesToCm, convertWeight };
