import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAccount } from "@/lib/queries";
import PredictionView from "@/components/prediction/PredictionView";

export const metadata = { title: "Your Prediction" };

export default async function PredictionPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");

  const [account, patient] = await Promise.all([
    getAccount(userId),
    prisma.patient.findFirst({
      where: { account: { clerkId: userId } },
      select: { weight: true, goalWeight: true, weeklyGoal: true, weightUnit: true },
    }),
  ]);

  const isPremium =
    account?.subscription?.plan === "PREMIUM" &&
    ["ACTIVE", "TRIALING", "INCOMPLETE"].includes(account?.subscription?.status ?? "");

  let data = null;

  if (
    patient?.weight &&
    patient?.goalWeight &&
    patient?.weeklyGoal &&
    patient.weight > patient.goalWeight &&
    patient.weeklyGoal > 0
  ) {
    const weightToLose = patient.weight - patient.goalWeight;
    const days = Math.round((weightToLose / patient.weeklyGoal) * 7);

    data = {
      days,
      currentWeight: patient.weight,
      goalWeight: patient.goalWeight,
      weightToLose,
      weeklyGoal: patient.weeklyGoal,
      weightUnit: patient.weightUnit ?? "kg",
    };
  }

  return <PredictionView data={data} isPremium={isPremium} />;
}
