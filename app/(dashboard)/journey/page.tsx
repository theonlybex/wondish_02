import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { subDays } from "date-fns";
import { prisma } from "@/lib/db";
import { getAccount } from "@/lib/queries";
import { computeJourneyStats } from "@/lib/journey";
import JourneyDashboard from "@/components/journey/JourneyDashboard";

export const metadata = { title: "My Journey" };

export default async function JourneyPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");
  const account = await getAccount(userId);
  if (!account) redirect("/login");
  if (!account.onboardingComplete) redirect("/profile?onboarding=true");

  const to = new Date();
  const from = subDays(to, 29);
  to.setHours(23, 59, 59, 999);
  from.setHours(0, 0, 0, 0);

  const entries = await prisma.journalEntry.findMany({
    where: {
      patient: { account: { clerkId: userId } },
      date: { gte: from, lte: to },
    },
    include: { meals: true },
    orderBy: { date: "asc" },
  });

  const stats = computeJourneyStats(entries);

  const rangeLabel = `${from.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${to.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;

  return (
    <div className="max-w-4xl mx-auto pb-8">
      <style>{`
        @keyframes jy-rise {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .jy { animation: jy-rise 0.55s cubic-bezier(0.22, 1, 0.36, 1) both; }
      `}</style>

      <div className="jy mb-8" style={{ animationDelay: "0ms" }}>
        <p className="text-[9px] tracking-[0.28em] uppercase font-mono mb-2" style={{ color: "#7DB87D" }}>
          {rangeLabel}
        </p>
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-3xl font-bold text-[#0d1f10]">My Journey</h1>
            <p className="text-xs mt-1.5" style={{ color: "#9EA8A0" }}>Your health progress over the last 30 days</p>
          </div>
          <span
            className="text-[9px] font-bold tracking-[0.18em] uppercase px-2.5 py-1 rounded-full mb-1"
            style={{ background: "rgba(74,222,128,0.1)", color: "#4ade80" }}
          >
            30 days
          </span>
        </div>
      </div>

      <div className="jy" style={{ animationDelay: "120ms" }}>
        <JourneyDashboard initialStats={stats} />
      </div>
    </div>
  );
}
