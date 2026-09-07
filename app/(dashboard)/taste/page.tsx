import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import IngredientTinder from "@/components/taste/IngredientTinder";

export const metadata = { title: "Favorite Ingredients" };

// DISHES-RETIRED (2026-09-07): the old dish-swipe "Taste Profile" (affinity map
// from liked dishes, journal likes, dish tinder) is retired. This screen now
// captures favorite INGREDIENTS. `?edit=1` re-opens it to change past picks.
export default async function TasteProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const { edit } = await searchParams;
  const { userId } = await auth();
  if (!userId) redirect("/login");

  const patient = await prisma.patient.findFirst({ where: { account: { clerkId: userId } } });
  if (!patient) redirect("/profile?onboarding=true");

  const mode = edit === "1" ? "edit" : "onboarding";

  return (
    <div className="max-w-lg mx-auto py-4">
      <IngredientTinder mode={mode} />
    </div>
  );
}
