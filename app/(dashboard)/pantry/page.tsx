import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import PantryClient from "@/components/pantry/PantryClient";

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
            Tap what you have to get dish suggestions, or switch to what to buy for this week&apos;s plan.
          </p>
        </div>
      </div>

      <div className="ov" style={{ animationDelay: "80ms" }}>
        <PantryClient isOnboarding={isOnboarding} initialTab={initialTab} />
      </div>
    </div>
  );
}
