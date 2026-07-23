import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getAccount, getPredictionProfileInput } from "@/lib/queries";
import PredictionView from "@/components/prediction/PredictionView";
import { computePredictionEstimate } from "@/lib/prediction-data";
import { accountHasActivePremium } from "@/lib/auth";

export const metadata = { title: "Your Prediction" };

export default async function PredictionPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");

  const [account, input] = await Promise.all([
    getAccount(userId),
    getPredictionProfileInput(userId),
  ]);

  const isPremium = accountHasActivePremium(account?.subscriptions ?? []);

  const data = input ? computePredictionEstimate(input) : null;

  return <PredictionView data={data} isPremium={isPremium} />;
}
