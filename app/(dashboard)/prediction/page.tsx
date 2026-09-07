import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

// Prediction feature commented out (2026-09-07). The standalone /prediction
// page is disabled — any stray link redirects to the meal plan. The original
// implementation (PredictionView + computePredictionEstimate) is left in the
// codebase, just not routed. Restore by reverting this file.
export const metadata = { title: "Meal Plan" };

export default async function PredictionPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");
  redirect("/meal-plan");
}
