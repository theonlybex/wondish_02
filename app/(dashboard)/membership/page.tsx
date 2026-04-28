import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getAccount } from "@/lib/queries";
import Link from "next/link";

export const metadata = { title: "Membership" };

const PREMIUM_BENEFITS = [
  {
    icon: "🍽",
    title: "Personalized Meal Plans",
    description: "Weekly plans built around your caloric needs, dietary restrictions, and taste preferences — updated automatically.",
  },
  {
    icon: "📅",
    title: "Full Weekly Schedule",
    description: "See your entire 7-day plan at a glance. Swap meals, adjust portions, and stay on track every day.",
  },
  {
    icon: "🛒",
    title: "Smart Grocery List",
    description: "Auto-generated shopping list from your weekly plan. Organised by category, ready to use in the store.",
  },
  {
    icon: "🎯",
    title: "Your Prediction",
    description: "See the exact number of days to reach your goal weight based on your profile and weekly pace.",
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

  const account = await getAccount(userId);

  const isAdmin = account?.roles?.some((r) => r.role.name === "SUPER") ?? false;
  const sub = account?.subscription;
  const isPremium =
    isAdmin ||
    (sub?.plan === "PREMIUM" && ["ACTIVE", "TRIALING", "INCOMPLETE"].includes(sub?.status ?? ""));

  if (!isPremium) redirect("/pricing");

  const firstName = account?.firstName ?? "there";
  const isTrialing = sub?.status === "TRIALING";
  const trialEnd = (sub as { trialEndsAt?: Date | null } | null)?.trialEndsAt ?? null;
  const periodEnd = sub?.stripeCurrentPeriodEnd ?? null;

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
        <p
          className="text-[9px] tracking-[0.28em] uppercase font-mono mb-3"
          style={{ color: "#7DB87D" }}
        >
          Membership
        </p>
        <h1 className="text-3xl font-bold text-[#0d1f10]">
          Hey {firstName}, you&apos;re all set.
        </h1>
        <div className="flex items-center gap-3 mt-4">
          <div className="h-px w-12 bg-primary/40" />
          <p className="text-xs" style={{ color: "#9EA8A0" }}>
            {isAdmin
              ? "Full admin access — all features unlocked."
              : "You have full access to everything Wondish has to offer."}
          </p>
        </div>
      </div>

      {/* Hero plan card */}
      <div
        className="ov relative rounded-2xl overflow-hidden mb-6"
        style={{
          animationDelay: "70ms",
          background: "linear-gradient(140deg, #0a1509 0%, #162a18 60%, #0d1f10 100%)",
          boxShadow: "0 8px 32px rgba(13,31,16,0.25)",
        }}
      >
        <div
          className="absolute top-0 right-0 w-80 h-80 rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(74,222,128,0.10) 0%, transparent 65%)", transform: "translate(35%, -35%)" }}
        />
        <div className="relative px-8 py-8 flex items-center gap-6">
          <div className="w-14 h-14 rounded-2xl bg-primary/20 flex items-center justify-center flex-shrink-0 text-2xl">
            {isAdmin ? "🛡" : "⭐"}
          </div>
          <div className="flex-1">
            <p className="text-[9px] tracking-[0.28em] uppercase font-bold mb-2" style={{ color: "rgba(74,222,128,0.5)" }}>
              {isAdmin ? "Admin Access" : "Premium Member"}
            </p>
            <p className="text-white font-bold text-lg leading-snug">
              {isAdmin
                ? "All features unlocked — no restrictions apply."
                : "Everything Wondish offers, fully unlocked."}
            </p>
            {!isAdmin && (
              <div className="flex flex-wrap gap-3 mt-4">
                {isTrialing && trialEnd && (
                  <div
                    className="rounded-xl px-4 py-2 text-sm"
                    style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(74,222,128,0.2)" }}
                  >
                    <span style={{ color: "rgba(255,255,255,0.4)" }}>Trial ends </span>
                    <span className="text-white font-semibold">
                      {trialEnd.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                    </span>
                  </div>
                )}
                {!isTrialing && periodEnd && (
                  <div
                    className="rounded-xl px-4 py-2 text-sm"
                    style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.08)" }}
                  >
                    <span style={{ color: "rgba(255,255,255,0.4)" }}>Renews </span>
                    <span className="text-white font-semibold">
                      {periodEnd.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                    </span>
                  </div>
                )}
                <div
                  className="rounded-xl px-4 py-2 text-sm"
                  style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.08)" }}
                >
                  <span style={{ color: "rgba(255,255,255,0.4)" }}>Status </span>
                  <span className="text-primary font-semibold capitalize">
                    {sub?.status?.toLowerCase() ?? "active"}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Benefits grid */}
      <div className="ov mb-6" style={{ animationDelay: "140ms" }}>
        <p
          className="text-[9px] tracking-[0.28em] uppercase font-bold mb-5"
          style={{ color: "#ADBDAD" }}
        >
          Everything included
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {PREMIUM_BENEFITS.map((b, i) => (
            <div
              key={b.title}
              className="bg-white rounded-2xl p-5 group cursor-default select-none relative overflow-hidden"
              style={{
                boxShadow: "0 1px 3px rgba(13,31,16,0.07), 0 0 0 1px rgba(13,31,16,0.04)",
                animationDelay: `${140 + i * 30}ms`,
              }}
            >
              <div className="text-2xl mb-3">{b.icon}</div>
              <h3 className="text-[#0d1f10] font-semibold text-sm mb-1">{b.title}</h3>
              <p className="text-xs leading-relaxed" style={{ color: "#ADBDAD" }}>
                {b.description}
              </p>
              <div
                className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                style={{ background: "radial-gradient(ellipse at 90% 110%, rgba(74,222,128,0.06) 0%, transparent 60%)" }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Quick links */}
      <div
        className="ov rounded-2xl p-6"
        style={{
          animationDelay: "420ms",
          background: "#FAFCFA",
          boxShadow: "0 0 0 1px rgba(13,31,16,0.04)",
        }}
      >
        <p
          className="text-[9px] tracking-[0.28em] uppercase font-bold mb-4"
          style={{ color: "#ADBDAD" }}
        >
          Jump right in
        </p>
        <div className="grid sm:grid-cols-3 gap-3">
          {[
            { href: "/meal-plan", label: "My Meal Plan", icon: "🍽" },
            { href: "/prediction", label: "My Prediction", icon: "🎯" },
            { href: "/journey", label: "My Journey", icon: "📈" },
          ].map(({ href, label, icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 bg-white hover:border-primary/30 rounded-xl px-4 py-3 text-sm font-medium text-[#0d1f10] hover:text-primary transition-colors"
              style={{ boxShadow: "0 1px 3px rgba(13,31,16,0.07), 0 0 0 1px rgba(13,31,16,0.04)" }}
            >
              <span>{icon}</span>
              {label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
