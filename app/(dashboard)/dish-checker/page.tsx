import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getAccount } from "@/lib/queries";
import DishCheckerClient from "@/components/dish-checker/DishCheckerClient";

export const metadata = { title: "Check your Dishes" };

export default async function DishCheckerPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");

  const account = await getAccount(userId);
  if (!account) redirect("/login");
  if (!account.onboardingComplete) redirect("/profile?onboarding=true");

  return (
    <div className="h-full flex flex-col">
      <style>{`
        @keyframes dc-rise {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .dc { animation: dc-rise 0.55s cubic-bezier(0.22, 1, 0.36, 1) both; }
      `}</style>

      <div className="dc flex-shrink-0 mb-6" style={{ animationDelay: "0ms" }}>
        <p
          className="text-[9px] tracking-[0.28em] uppercase font-mono mb-2"
          style={{ color: "#7DB87D" }}
        >
          Premium · AI Advisor
        </p>
        <h1 className="text-3xl font-bold text-[#0d1f10]">Check your Dishes</h1>
        <p className="text-xs mt-1.5" style={{ color: "#9EA8A0" }}>
          Your personal AI food advisor
        </p>
      </div>

      <div className="dc flex-1 min-h-0" style={{ animationDelay: "80ms" }}>
        <DishCheckerClient firstName={account.firstName ?? ""} />
      </div>
    </div>
  );
}
