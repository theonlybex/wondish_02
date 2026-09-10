import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getAccount } from "@/lib/queries";
import { loadSubscriptionView } from "@/lib/billing/load-view";
import BillingPanel from "@/components/billing/BillingPanel";

export const metadata = { title: "Billing" };

const PREMIUM_BENEFITS = [
  {
    icon: "🍽",
    title: "Personalized Meal Plans",
    description: "Weekly plans built around your caloric needs, dietary restrictions, and taste preferences — updated automatically.",
  },
  {
    icon: "📅",
    title: "Full Weekly Schedule",
    description: "See your entire 35-day plan week by week. Swap meals, adjust portions, and stay on track every day.",
  },
  {
    icon: "🛒",
    title: "Smart Grocery List",
    description: "Auto-generated shopping list from your weekly plan. Organised by category, ready to use in the store.",
  },
  {
    icon: "📊",
    title: "Nutrition Analytics",
    description: "Detailed macro and micronutrient breakdowns for every meal. Understand the science behind what you eat.",
  },
  {
    icon: "🔄",
    title: "Meal Swapping",
    description: "Don't like a meal? Swap it instantly for something else that fits your plan — same calories, different taste.",
  },
  {
    icon: "🥘",
    title: "Custom Ingredients",
    description: "Add your own ingredients with exact nutritional values. Tailor recipes to your kitchen and local store.",
  },
  {
    icon: "📓",
    title: "Journal & Tracking",
    description: "Log your meals, mood, weight, and energy. Track your health journey with beautiful analytics.",
  },
  {
    icon: "500+",
    title: "Full Recipe Library",
    description: "Access all 500+ recipes across every cuisine, dietary style, and meal type — no limits.",
  },
];

export default async function MembershipPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");

  const [account, loaded] = await Promise.all([getAccount(userId), loadSubscriptionView(userId)]);
  const isAdmin = account?.roles?.some((r) => r.role.name === "SUPER") ?? false;
  const view = loaded?.view ?? {
    isPremium: false, source: null, plan: null, priceLabel: null, status: null, periodEnd: null,
    cancelAtPeriodEnd: false, canSwitchTo: null, card: null, invoices: [],
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

      {/* Benefits grid */}
      <div className="ov mb-6" style={{ animationDelay: "140ms" }}>
        <p className="text-[9px] tracking-[0.28em] uppercase font-bold mb-5" style={{ color: "#ABA6A6" }}>
          {view.isPremium || isAdmin ? "Everything included" : "What Premium includes"}
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {PREMIUM_BENEFITS.map((b, i) => (
            <div
              key={b.title}
              className="bg-white rounded-2xl p-5 group cursor-default select-none relative overflow-hidden"
              style={{
                boxShadow: "0 1px 3px rgba(30,26,26,0.07), 0 0 0 1px rgba(30,26,26,0.04)",
                animationDelay: `${140 + i * 30}ms`,
              }}
            >
              <div className="text-2xl mb-3">{b.icon}</div>
              <h3 className="text-[#1E1A1A] font-semibold text-sm mb-1">{b.title}</h3>
              <p className="text-xs leading-relaxed" style={{ color: "#ABA6A6" }}>
                {b.description}
              </p>
              <div
                className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                style={{ background: "radial-gradient(ellipse at 90% 110%, rgba(129,37,73,0.06) 0%, transparent 60%)" }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
