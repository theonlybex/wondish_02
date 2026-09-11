import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import TrialsClient from "@/components/trials/TrialsClient";

export const metadata = { title: "Trigger trials" };

// Only users with an eligible condition (one that has trigger rules) or any
// past trial get this page; everyone else is sent to their Journey.
export default async function TrialsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");
  const patient = await prisma.patient.findFirst({
    where: { account: { clerkId: userId } },
    select: {
      _count: { select: { triggerTrials: true } },
      healthConditions: { select: { condition: { select: { _count: { select: { triggerRules: true } } } } } },
    },
  });
  const eligible = patient?.healthConditions.some((hc) => hc.condition._count.triggerRules > 0) ?? false;
  if (!patient || (!eligible && patient._count.triggerTrials === 0)) redirect("/journey");

  return (
    <div className="max-w-4xl mx-auto pb-8">
      <div className="mb-6">
        <p className="text-[9px] tracking-[0.28em] uppercase font-mono mb-2" style={{ color: "#B75E78" }}>Trigger trials</p>
        <h1 className="text-3xl font-bold text-[#1E1A1A]">Find your food triggers</h1>
        <p className="text-xs mt-1.5" style={{ color: "#848181" }}>
          A structured 34-day elimination and reintroduction, one trigger at a time, measured by your daily symptom log.
        </p>
      </div>
      <TrialsClient />
    </div>
  );
}
