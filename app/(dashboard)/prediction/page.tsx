import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAccount } from "@/lib/queries";
import PredictionView from "@/components/prediction/PredictionView";
import { computeAllMetrics, estimateDaysToGoalWeight, type CaloricProfileInput, type Sex } from "@/lib/caloric-engine";

export const metadata = { title: "Your Prediction" };

function resolveSex(sexAtBirth: string | null | undefined): Sex | null {
  const s = (sexAtBirth ?? "").toLowerCase();
  if (s === "male") return "male";
  if (s === "female") return "female";
  return null;
}

export default async function PredictionPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");

  const [account, patient] = await Promise.all([
    getAccount(userId),
    prisma.patient.findFirst({
      where: { account: { clerkId: userId } },
      select: {
        weight: true, weightUnit: true,
        goalWeight: true, goalWeightUnit: true,
        height: true, heightUnit: true,
        birthday: true, sexAtBirth: true,
        physicalActivity: { select: { level: true } },
      },
    }),
  ]);

  const isPremium =
    account?.subscription?.plan === "PREMIUM" &&
    ["ACTIVE", "TRIALING", "INCOMPLETE"].includes(account?.subscription?.status ?? "");

  let data = null;

  if (patient?.weight && patient?.goalWeight && patient.weight > patient.goalWeight) {
    const sex = resolveSex(patient.sexAtBirth);
    let cbmiClass: "underweight" | "healthy" | "overweight" | "obese" = "healthy";
    let profile: ReturnType<typeof computeAllMetrics> | null = null;

    if (sex && patient.height && patient.birthday && patient.physicalActivity?.level) {
      const pi: CaloricProfileInput = {
        sex,
        birthday:    new Date(patient.birthday),
        heightValue: patient.height,
        heightUnit:  patient.heightUnit === "in" ? "in" : "cm",
        cbwValue:    patient.weight,
        cbwUnit:     (patient.weightUnit === "lbs" ? "lbs" : "kg") as "kg" | "lbs",
        activityLevel: patient.physicalActivity.level,
        utbwValue: patient.goalWeight,
        utbwUnit:  (patient.goalWeightUnit === "lbs" ? "lbs" : "kg") as "kg" | "lbs" | null,
      };
      profile = computeAllMetrics(pi);
      cbmiClass = profile.cbmiClass;
    }

    if ((cbmiClass === "overweight" || cbmiClass === "obese") && profile) {
      // Convert weight to kg for the calculation
      const toKg = (v: number, unit: string | null) => unit === "lbs" ? v * 0.453592 : v;
      const weightToLoseKg = toKg(patient.weight, patient.weightUnit) - toKg(patient.goalWeight, patient.goalWeightUnit ?? patient.weightUnit);

      // Estimate using the gradual cumulative deficit schedule
      const days = estimateDaysToGoalWeight(
        profile.tdeeCBW,
        Math.round(profile.targetCalories),
        weightToLoseKg,
        cbmiClass,
        profile.minCaloriesValue,
      );

      // Average weekly loss over the whole journey
      const weeklyLossKg = days > 0 ? weightToLoseKg / (days / 7) : 0;

      // Convert weekly loss back to user's display unit
      const weeklyGoalDisplay = patient.weightUnit === "lbs"
        ? parseFloat((weeklyLossKg / 0.453592).toFixed(2))
        : parseFloat(weeklyLossKg.toFixed(2));

      data = {
        days,
        currentWeight: patient.weight,
        goalWeight: patient.goalWeight,
        weightToLose: patient.weightUnit === "lbs"
          ? parseFloat((weightToLoseKg / 0.453592).toFixed(1))
          : parseFloat(weightToLoseKg.toFixed(1)),
        weeklyGoal: weeklyGoalDisplay,
        weightUnit: patient.weightUnit ?? "lbs",
      };
    }
  }

  return <PredictionView data={data} isPremium={isPremium} />;
}
