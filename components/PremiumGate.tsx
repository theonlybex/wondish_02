import Link from "next/link";

export default function PremiumGate() {
  return (
    <div className="flex-1 flex items-center justify-center min-h-[60vh]">
      <div className="text-center max-w-md px-6">
        {/* Icon */}
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
        </div>

        {/* Heading */}
        <h2 className="text-2xl font-bold text-navy mb-3">Premium Feature</h2>
        <p className="text-[#8A8D93] text-sm leading-relaxed mb-8">
          This feature is available on the Premium plan. Start your 14-day free trial — no charge until the trial ends.
        </p>

        {/* Features list */}
        <ul className="text-left space-y-2.5 mb-8">
          {[
            "Personalized meal planner",
            "500+ curated recipes with nutrition data",
            "Grocery & ingredient lists",
            "Health journey dashboard",
            "Advanced nutrition analytics",
          ].map((feature) => (
            <li key={feature} className="flex items-center gap-2.5 text-sm text-navy">
              <span className="w-4 h-4 rounded-full bg-primary/15 text-primary flex items-center justify-center shrink-0">
                <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 12 12">
                  <path d="M10 3L5 8.5 2 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                </svg>
              </span>
              {feature}
            </li>
          ))}
        </ul>

        {/* CTA */}
        <Link
          href="/pricing"
          className="inline-flex items-center justify-center w-full px-6 py-3 rounded-xl bg-primary text-white font-semibold text-sm hover:bg-primary/90 transition-colors"
        >
          Start free trial — $15/mo after 14 days
        </Link>
        <p className="text-xs text-[#8A8D93] mt-3">Cancel anytime before the trial ends.</p>
      </div>
    </div>
  );
}
