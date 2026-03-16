import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { subDays } from "date-fns";
import { prisma } from "@/lib/db";
import { computeJourneyStats } from "@/lib/journey";
import JourneyDashboard from "@/components/journey/JourneyDashboard";

export const metadata = { title: "My Journey" };

export default async function JourneyPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");
  const account = await prisma.account.findUnique({ where: { clerkId: userId } });
  if (!account) redirect("/login");
  if (!account.onboardingComplete) redirect("/profile?onboarding=true");

  const patient = await prisma.patient.findUnique({
    where: { accountId: account.id },
  });

  const to = new Date();
  const from = subDays(to, 29);
  to.setHours(23, 59, 59, 999);
  from.setHours(0, 0, 0, 0);

  const entries = patient
    ? await prisma.journalEntry.findMany({
        where: {
          patientId: patient.id,
          date: { gte: from, lte: to },
        },
        include: { meals: true },
        orderBy: { date: "asc" },
      })
    : [];

  const stats = computeJourneyStats(entries);

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-navy">My Journey</h1>
        <p className="text-[#8A8D93] text-sm mt-1">
          Your health progress over time
        </p>
      </div>

      <JourneyDashboard initialStats={stats} />
    </div>
  );
}
