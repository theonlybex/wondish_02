import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAccount } from "@/lib/queries";
import JournalForm from "@/components/journal/JournalForm";

export const metadata = { title: "Journal" };

export default async function JournalPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");
  const account = await getAccount(userId);
  if (!account) redirect("/login");
  if (!account.onboardingComplete) redirect("/profile?onboarding=true");

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayEnd = new Date(today);
  todayEnd.setHours(23, 59, 59, 999);

  const [menus, journalEntry] = await Promise.all([
    prisma.menu.findMany({
      where: {
        patient: { account: { clerkId: userId } },
        date: { gte: today, lte: todayEnd },
      },
      include: { recipe: true, mealType: true },
      orderBy: { mealType: { name: "asc" } },
    }),
    prisma.journalEntry.findFirst({
      where: {
        patient: { account: { clerkId: userId } },
        date: { gte: today, lte: todayEnd },
      },
      include: { meals: true },
    }),
  ]);

  return (
    <div className="max-w-2xl mx-auto pb-8">
      <style>{`
        @keyframes jn-rise {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .jn { animation: jn-rise 0.55s cubic-bezier(0.22, 1, 0.36, 1) both; }
      `}</style>

      <div className="jn mb-8" style={{ animationDelay: "0ms" }}>
        <p className="text-[9px] tracking-[0.28em] uppercase font-mono mb-2" style={{ color: "#7DB87D" }}>
          {today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
        </p>
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-3xl font-bold text-[#0d1f10]">Journal</h1>
            <p className="text-xs mt-1.5" style={{ color: "#9EA8A0" }}>Log your meals, mood, and health metrics</p>
          </div>
          {journalEntry && (
            <span
              className="text-[9px] font-bold tracking-[0.18em] uppercase px-2.5 py-1 rounded-full mb-1"
              style={{ background: "rgba(74,222,128,0.1)", color: "#4ade80" }}
            >
              Entry saved
            </span>
          )}
        </div>
      </div>

      <div className="jn" style={{ animationDelay: "120ms" }}>
        <JournalForm
          initialDate={today}
          initialMenus={menus as never}
          initialEntry={journalEntry as never}
        />
      </div>
    </div>
  );
}
