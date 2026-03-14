import Link from "next/link";
import CheckoutButton from "./CheckoutButton";

const freeFeatures = [
  "Weight loss meal templates",
  "BMI & calorie calculator",
  "Basic recipe access (50+ dishes)",
  "Daily nutrition overview",
  "Mood & weight journal",
  "Community recipes",
];

const premiumFeatures = [
  "Everything in Free",
  "Full personalized meal planner",
  "Custom dish preferences",
  "Add custom ingredients",
  "500+ curated recipes",
  "Weekly & daily plan builder",
  "Grocery & ingredient lists",
  "Health journey dashboard",
  "Advanced nutrition analytics",
  "Priority support",
];

function Check({ color = "text-success" }: { color?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={`mt-0.5 flex-shrink-0 ${color}`}>
      <path d="M3 8l4 4 6-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function PricingSection({ isLoggedIn = false }: { isLoggedIn?: boolean }) {
  return (
    <section className="bg-[#F8F7FA] py-24 px-5 sm:px-8">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="text-center max-w-xl mx-auto mb-14">
          <p className="text-primary text-sm font-semibold uppercase tracking-widest mb-4">
            Pricing
          </p>
          <h2 className="text-4xl sm:text-5xl font-bold text-[#25293C] leading-tight mb-4">
            Simple, honest pricing
          </h2>
          <p className="text-[#8A8D93] text-lg">
            Start free. Upgrade when you&apos;re ready. No hidden fees.
          </p>
        </div>

        {/* Cards */}
        <div className="grid sm:grid-cols-2 gap-6 max-w-3xl mx-auto">

          {/* Free */}
          <div className="bg-white border border-[#E8E7EA] rounded-2xl p-8 flex flex-col">
            <div className="mb-6">
              <h3 className="text-[#25293C] font-bold text-xl mb-1">Free</h3>
              <p className="text-[#8A8D93] text-sm">Start your nutrition journey at no cost.</p>
            </div>
            <div className="mb-8">
              <span className="text-4xl font-bold text-[#25293C]">$0</span>
              <span className="text-[#8A8D93] text-sm ml-2">/ month</span>
            </div>
            <ul className="space-y-3 mb-8 flex-1">
              {freeFeatures.map((f) => (
                <li key={f} className="flex items-start gap-3 text-sm text-[#8A8D93]">
                  <Check />
                  {f}
                </li>
              ))}
            </ul>
            {isLoggedIn ? (
              <Link
                href="/dashboard"
                className="w-full text-center py-3 rounded-xl font-semibold text-sm border border-[#E8E7EA] text-[#25293C] hover:bg-[#F8F7FA] transition-all duration-150"
              >
                Continue with Free →
              </Link>
            ) : (
              <Link
                href="/register"
                className="w-full text-center py-3 rounded-xl font-semibold text-sm border border-[#E8E7EA] text-[#25293C] hover:bg-[#F8F7FA] transition-all duration-150"
              >
                Get started free
              </Link>
            )}
          </div>

          {/* Premium */}
          <div className="relative bg-navy rounded-2xl p-8 flex flex-col overflow-hidden">
            <div className="absolute top-0 right-0 w-48 h-48 bg-primary/20 rounded-full blur-3xl pointer-events-none" />

            <div className="absolute top-5 right-5">
              <span className="bg-primary/20 text-primary text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide">
                14-day free trial
              </span>
            </div>

            <div className="mb-6 relative">
              <h3 className="text-white font-bold text-xl mb-1">Premium</h3>
              <p className="text-white/50 text-sm">The full Wondish experience.</p>
            </div>

            <div className="mb-8 relative">
              <span className="text-4xl font-bold text-white">$15</span>
              <span className="text-white/40 text-sm ml-2">/ month</span>
              <p className="text-white/40 text-xs mt-1">
                Free for the first 14 days. Cancel anytime.
              </p>
            </div>

            <ul className="space-y-3 mb-8 flex-1 relative">
              {premiumFeatures.map((f) => (
                <li key={f} className="flex items-start gap-3 text-sm text-white/70">
                  <Check color="text-primary" />
                  {f}
                </li>
              ))}
            </ul>

            <CheckoutButton className="relative w-full text-center py-3 rounded-xl font-semibold text-sm bg-primary hover:bg-primary-dark disabled:opacity-60 disabled:cursor-not-allowed text-white transition-all duration-150 shadow-xl shadow-primary/30">
              Start free trial
            </CheckoutButton>
          </div>
        </div>

        <p className="text-center text-[#8A8D93] text-sm mt-8">
          No credit card required for the free plan · Cancel premium anytime · Secure billing via Stripe
        </p>
      </div>
    </section>
  );
}
