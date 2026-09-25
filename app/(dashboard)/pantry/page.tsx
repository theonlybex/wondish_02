import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import PantryClient from "@/components/pantry/PantryClient";
import { allowanceFrequency, resolveAiTier } from "@/lib/ai-budget";

export const metadata = { title: "Ingredients" };

export default async function PantryPage({
  searchParams,
}: {
  searchParams: { onboarding?: string; tab?: string };
}) {
  const { userId } = await auth();
  if (!userId) redirect("/login");

  const patient = await prisma.patient.findFirst({
    where: { account: { clerkId: userId } },
    select: { id: true },
  });
  if (!patient) redirect("/profile?onboarding=true");

  // The cook-my-day card states how often the feature can be used, and the
  // number differs by tier (free 1, beta 2, Plus 3). Read from the same table
  // the guard enforces rather than written into the copy.
  const cookDayFrequency = allowanceFrequency("cookDay", await resolveAiTier(userId));

  const isOnboarding = searchParams.onboarding === "1";
  const initialTab = searchParams.tab === "buy" ? "buy" : "have";

  return (
    <div className="max-w-3xl mx-auto pb-8">
      <style>{`
        @keyframes ov-rise {
          from { opacity: 0; transform: translateY(18px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .ov { animation: ov-rise 0.6s cubic-bezier(0.22, 1, 0.36, 1) both; }
      `}</style>

      <div className="ov mb-8" style={{ animationDelay: "0ms" }}>
        <p className="text-[9px] tracking-[0.28em] uppercase font-mono mb-3" style={{ color: "#B75E78" }}>
          {isOnboarding ? "One last thing" : "Ingredients"}
        </p>
        <h1 className="text-3xl font-bold text-[#1E1A1A]">Ingredients</h1>
        <div className="flex items-center gap-3 mt-4">
          <p className="text-xs" style={{ color: "#848181" }}>
            {/* "What to buy for this week's plan" promised a shopping list for
                the generated week. Two of the three lenses are not that: "By
                value" ranks the whole catalog by how many library dishes each
                ingredient would unlock, and "By cuisine" stocks a cuisine.
                Only the per-item amounts come from the plan. A QA run followed
                the promise and got brown rice, quinoa, coffee and cocoa powder
                — none of them in the week (2026-09-24). */}
            Tap what you have to get dish suggestions, or switch to what to buy next.
          </p>
        </div>
      </div>

      <div className="ov" style={{ animationDelay: "80ms" }}>
        <PantryClient isOnboarding={isOnboarding} initialTab={initialTab} cookDayFrequency={cookDayFrequency} />
      </div>
    </div>
  );
}
