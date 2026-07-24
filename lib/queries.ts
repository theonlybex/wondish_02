import { cache } from "react";
import { prisma } from "./db";
import { type PredictionProfileInput } from "./prediction-data";
import { normalizePredictionPatient } from "./prediction-profile";

// Per-request cached account fetch. React.cache() deduplicates calls with the
// same userId within one server render, so layout + page share one DB round trip.
export const getAccount = cache((userId: string) =>
  prisma.account.findUnique({
    where: { clerkId: userId },
    include: { subscriptions: true, roles: { include: { role: true } } },
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
        gender: { select: { name: true } },
        physicalActivity: { select: { level: true } },
      },
    });

    return patient ? normalizePredictionPatient(patient) : null;
  }
);
