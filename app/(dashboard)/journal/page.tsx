import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import JournalForm from "@/components/journal/JournalForm";

export const metadata = { title: "My Journal" };

export default async function JournalPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");
  const account = await prisma.account.findUnique({ where: { clerkId: userId } });
  if (!account) redirect("/login");
  if (!account.onboardingComplete) redirect("/profile?onboarding=true");

  const patient = await prisma.patient.findUnique({
    where: { accountId: account.id },
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayEnd = new Date(today);
  todayEnd.setHours(23, 59, 59, 999);

  const [menus, journalEntry] = await Promise.all([
    patient
      ? prisma.menu.findMany({
          where: {
            patientId: patient.id,
            date: { gte: today, lte: todayEnd },
          },
          include: {
            recipe: true,
            mealType: true,
          },
          orderBy: { mealType: { name: "asc" } },
        })
      : Promise.resolve([]),
    patient
      ? prisma.journalEntry.findFirst({
          where: {
            patientId: patient.id,
            date: { gte: today, lte: todayEnd },
          },
          include: { meals: true },
        })
      : Promise.resolve(null),
  ]);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-navy">My Journal</h1>
        <p className="text-[#8A8D93] text-sm mt-1">
          Log your meals, mood, and health metrics daily
        </p>
      </div>

      <JournalForm
        initialDate={today}
        initialMenus={menus as never}
        initialEntry={journalEntry as never}
      />
    </div>
  );
}
