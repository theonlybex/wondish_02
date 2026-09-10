import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getAccount } from "@/lib/queries";
import { loadSubscriptionView } from "@/lib/billing/load-view";
import BillingPanel from "@/components/billing/BillingPanel";

export const metadata = { title: "Billing" };

export default async function MembershipPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");

  const [account, loaded] = await Promise.all([getAccount(userId), loadSubscriptionView(userId)]);
  const isAdmin = account?.roles?.some((r) => r.role.name === "SUPER") ?? false;
  const view = loaded?.view ?? {
    isPremium: false, source: null, plan: null, priceLabel: null, status: null, periodEnd: null,
    cancelAtPeriodEnd: false, canSwitchTo: null, pendingPlan: null, card: null, invoices: [],
  };
  const firstName = account?.firstName ?? "there";

  return (
    <div className="max-w-3xl mx-auto">
      <style>{`
        @keyframes ov-rise {
          from { opacity: 0; transform: translateY(18px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .ov { animation: ov-rise 0.6s cubic-bezier(0.22, 1, 0.36, 1) both; }
      `}</style>

      {/* Header */}
      <div className="ov mb-8" style={{ animationDelay: "0ms" }}>
        <p className="text-[9px] tracking-[0.28em] uppercase font-mono mb-3" style={{ color: "#B75E78" }}>
          Billing
        </p>
        <h1 className="text-3xl font-bold text-[#1E1A1A]">
          {view.isPremium || isAdmin ? `Hey ${firstName}, you're all set.` : `Hey ${firstName}.`}
        </h1>
        <div className="flex items-center gap-3 mt-4">
          <div className="h-px w-12 bg-primary/40" />
          <p className="text-xs" style={{ color: "#848181" }}>
            {isAdmin ? "Full admin access — all features unlocked." : "Manage your plan, payment method and invoices."}
          </p>
        </div>
      </div>

      <div className="ov mb-6" style={{ animationDelay: "70ms" }}>
        {isAdmin && !view.isPremium ? (
          <div className="rounded-2xl px-6 py-6 text-white" style={{ background: "linear-gradient(140deg, #5F1C35 0%, #812549 60%, #5F1C35 100%)" }}>
            <p className="text-[9px] tracking-[0.28em] uppercase font-bold mb-2" style={{ color: "rgba(255,255,255,0.55)" }}>Admin access</p>
            <p className="font-bold text-lg">All features unlocked — no restrictions apply.</p>
          </div>
        ) : (
          <BillingPanel initial={view} />
        )}
      </div>

    </div>
  );
}
