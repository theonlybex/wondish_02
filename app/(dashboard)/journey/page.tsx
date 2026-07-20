import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { subDays } from "date-fns";
import { prisma } from "@/lib/db";
import { getAccount, getPredictionProfileInput } from "@/lib/queries";
import { computeJourneyStats, computeMacroStats } from "@/lib/journey";
import { getJourneyPayload, type JourneyPayload } from "@/lib/journey-data";
import JourneyDashboard from "@/components/journey/JourneyDashboard";
import PredictionWhatIf from "@/components/journey/PredictionWhatIf";

export const metadata = { title: "Journey" };

export default async function JourneyPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");
  const account = await getAccount(userId);
  if (!account) redirect("/login");

  const to = new Date();
  const from = subDays(to, 29);
  to.setHours(23, 59, 59, 999);
  from.setHours(0, 0, 0, 0);

  // One fetch path shared with app/api/journey/route.ts (lib/journey-data.ts).
  // A missing patient row previously just yielded an empty entry list, so it
  // degrades the same way here: empty stats, never a redirect.
  const patient = await prisma.patient.findFirst({
    where: { account: { clerkId: userId } },
    select: { id: true },
  });
  const totalDays = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86400000));
  const emptyPayload: JourneyPayload = {
    stats: computeJourneyStats([], totalDays),
    macroStats: computeMacroStats([], null),
    entries: [],
  };
  const [payload, predictionInput] = await Promise.all([
    patient ? getJourneyPayload(patient.id, from, to) : Promise.resolve(emptyPayload),
    getPredictionProfileInput(userId),
  ]);
  const { stats, macroStats } = payload;

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
        <p className="text-[9px] tracking-[0.28em] uppercase font-mono mb-2" style={{ color: "#B75E78" }}>
          {rangeLabel}
        </p>
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-3xl font-bold text-[#1E1A1A]">Journey</h1>
            <p className="text-xs mt-1.5" style={{ color: "#848181" }}>Your health progress over the last 30 days</p>
          </div>
          <span
            className="text-[9px] font-bold tracking-[0.18em] uppercase px-2.5 py-1 rounded-full mb-1"
            style={{ background: "rgba(129,37,73,0.1)", color: "#812549" }}
          >
            30 days
          </span>
        </div>
      </div>

      <div className="jy" style={{ animationDelay: "120ms" }}>
        <JourneyDashboard initialStats={stats} initialMacroStats={macroStats} />
      </div>

      {/* Prediction what-if card */}
      <div className="jy mt-8 max-w-md mx-auto" style={{ animationDelay: "240ms" }}>
        <PredictionWhatIf input={predictionInput} />
      </div>
    </div>
  );
}
