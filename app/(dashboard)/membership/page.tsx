import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getAccount } from "@/lib/queries";
import Link from "next/link";

export const metadata = { title: "My Membership" };

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
    description: "Auto-generated shopping list from your weekly plan. Organized by category, ready to use in the store.",
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
  const isPremium = isAdmin || (sub?.plan === "PREMIUM" && ["ACTIVE", "TRIALING", "INCOMPLETE"].includes(sub?.status ?? ""));

  if (!isPremium) redirect("/pricing");

  const firstName = account?.firstName ?? "there";
  const isTrialing = sub?.status === "TRIALING";
  const trialEnd = (sub as { trialEndsAt?: Date | null } | null)?.trialEndsAt ?? null;
  const periodEnd = sub?.stripeCurrentPeriodEnd ?? null;

  return (
    <div className="max-w-3xl mx-auto">

      {/* Hero */}
      <div className="relative bg-gradient-to-br from-primary/15 via-primary/8 to-transparent border border-primary/20 rounded-3xl p-8 sm:p-10 mb-8 overflow-hidden">
        <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-primary/10 pointer-events-none" />
        <div className="relative">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-2xl">⭐</span>
            <span className="text-primary text-sm font-bold uppercase tracking-widest">
              {isAdmin ? "Admin Access" : "Premium Member"}
            </span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-navy mb-2">
            Hey {firstName}, you&apos;re all set.
          </h1>
          <p className="text-[#5A5E6C] text-base max-w-lg">
            {isAdmin
              ? "You have full admin access — all features are unlocked and no restrictions apply."
              : "You have full access to everything Wondish has to offer. Here's what's included in your plan."}
          </p>

          {/* Subscription status */}
          {!isAdmin && (
            <div className="mt-6 flex flex-wrap gap-3">
              {isTrialing && trialEnd && (
                <div className="bg-white border border-primary/20 rounded-xl px-4 py-2.5 text-sm">
                  <span className="text-[#8A8D93]">Free trial ends </span>
                  <span className="text-navy font-semibold">
                    {trialEnd.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                  </span>
                </div>
              )}
              {!isTrialing && periodEnd && (
                <div className="bg-white border border-[#E8E7EA] rounded-xl px-4 py-2.5 text-sm">
                  <span className="text-[#8A8D93]">Renews </span>
                  <span className="text-navy font-semibold">
                    {periodEnd.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                  </span>
                </div>
              )}
              <div className="bg-white border border-[#E8E7EA] rounded-xl px-4 py-2.5 text-sm">
                <span className="text-[#8A8D93]">Status </span>
                <span className="text-emerald-600 font-semibold capitalize">{sub?.status?.toLowerCase() ?? "active"}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Value callout */}
      {!isAdmin && (
        <div className="bg-navy rounded-2xl p-6 mb-8 flex items-center gap-5">
          <div className="flex-shrink-0 w-14 h-14 rounded-2xl bg-primary/20 flex items-center justify-center">
            <span className="text-2xl">💎</span>
          </div>
          <div>
            <p className="text-white/50 text-xs uppercase tracking-widest font-semibold mb-0.5">Your Premium Plan — $15/month</p>
            <p className="text-white font-bold text-base">Here&apos;s everything you&apos;re getting for your $15</p>
            <p className="text-white/60 text-sm mt-0.5">9 powerful features, 500+ recipes, full analytics & more — all unlocked.</p>
          </div>
        </div>
      )}

      {/* Benefits grid */}
      <div className="mb-8">
        <h2 className="text-navy font-bold text-lg mb-5">Everything included in your plan</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {PREMIUM_BENEFITS.map((b) => (
            <div key={b.title} className="bg-white border border-[#E8E7EA] rounded-2xl p-5">
              <div className="text-2xl mb-3">{b.icon}</div>
              <h3 className="text-navy font-semibold text-sm mb-1">{b.title}</h3>
              <p className="text-[#8A8D93] text-xs leading-relaxed">{b.description}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Quick links */}
      <div className="bg-[#F8F7FA] border border-[#E8E7EA] rounded-2xl p-6">
        <h2 className="text-navy font-bold text-sm mb-4">Jump right in</h2>
        <div className="grid sm:grid-cols-3 gap-3">
          {[
            { href: "/meal-plan", label: "My Meal Plan", icon: "🍽" },
            { href: "/prediction", label: "My Prediction", icon: "🎯" },
            { href: "/journey", label: "My Journey", icon: "📈" },
          ].map(({ href, label, icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 bg-white border border-[#E8E7EA] hover:border-primary/30 rounded-xl px-4 py-3 text-sm font-medium text-navy hover:text-primary transition-colors"
            >
              <span>{icon}</span> {label}
            </Link>
          ))}
        </div>
      </div>

    </div>
  );
}
