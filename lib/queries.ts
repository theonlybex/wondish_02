import { cache } from "react";
import { prisma } from "./db";
import { resolveSex, toKg, fromKg, type PredictionProfileInput } from "./prediction-data";

// Per-request cached account fetch. React.cache() deduplicates calls with the
// same userId within one server render, so layout + page share one DB round trip.
export const getAccount = cache((userId: string) =>
  prisma.account.findUnique({
    where: { clerkId: userId },
    include: { subscription: true, roles: { include: { role: true } } },
  })
);

// Fetches the patient keyed directly by clerkId so it can run in parallel
// with getAccount — no need to wait for account.id first.
export const getOverviewPatient = cache((userId: string) => {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  return prisma.patient.findFirst({
    where: { account: { clerkId: userId } },
    include: {
      journalEntries: {
        orderBy: { date: "desc" },
        take: 7,
        include: { meals: true },
      },
      menus: {
        where: { date: { gte: todayStart, lt: todayEnd } },
        include: { recipe: true, mealType: true },
      },
    },
  });
});

// Loads the profile fields the weight-loss prediction needs and normalizes
// them into a serializable input for computePredictionEstimate(). Returns
// null when the profile is incomplete or the goal isn't below current weight.
export const getPredictionProfileInput = cache(
  async (userId: string): Promise<PredictionProfileInput | null> => {
    const patient = await prisma.patient.findFirst({
      where: { account: { clerkId: userId } },
      select: {
        weight: true, weightUnit: true,
        goalWeight: true, goalWeightUnit: true,
        height: true, heightUnit: true,
        birthday: true, sexAtBirth: true,
        physicalActivity: { select: { level: true } },
      },
    });

    if (!patient?.weight || !patient.goalWeight || !patient.height || !patient.birthday) return null;
    const sex = resolveSex(patient.sexAtBirth);
    const activityLevel = patient.physicalActivity?.level;
    if (!sex || !activityLevel) return null;

    const weightUnit: "kg" | "lbs" = patient.weightUnit === "lbs" ? "lbs" : "kg";
    const goalUnit: "kg" | "lbs" =
      (patient.goalWeightUnit ?? patient.weightUnit) === "lbs" ? "lbs" : "kg";
    const goalWeight =
      goalUnit === weightUnit
        ? patient.goalWeight
        : fromKg(toKg(patient.goalWeight, goalUnit), weightUnit);
    if (goalWeight >= patient.weight) return null;

    return {
      sex,
      birthday: patient.birthday.toISOString(),
      heightValue: patient.height,
      heightUnit: patient.heightUnit === "in" ? "in" : "cm",
      weightValue: patient.weight,
      weightUnit,
      goalWeight: parseFloat(goalWeight.toFixed(1)),
      activityLevel,
    };
  }
);
