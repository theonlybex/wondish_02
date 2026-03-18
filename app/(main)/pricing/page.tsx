import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import PricingSection from "@/components/PricingSection";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Simple, transparent pricing. Start free, upgrade to Premium for $15/month with a 14-day free trial.",
};

const faqs = [
  {
    q: "Do I need a credit card to start?",
    a: "No. The Free plan requires no payment information. You only need a card when upgrading to Premium.",
  },
  {
    q: "How does the 14-day free trial work?",
    a: "When you choose the Premium plan, you get full access for 14 days at no charge. Your card is only charged after the trial ends. Cancel anytime before then.",
  },
  {
    q: "Can I cancel my Premium subscription?",
    a: "Yes, anytime. You'll retain Premium access until the end of your billing period, then automatically switch to the Free plan.",
  },
  {
    q: "What happens to my data if I downgrade?",
    a: "All your meal history, journal entries, and profile data are preserved. Premium-only features (like the full planner) will be locked but your data stays safe.",
  },
  {
    q: "Is there a family or team plan?",
    a: "Not yet — but we're working on it. Join our newsletter to be notified when it launches.",
  },
];

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ upgrade?: string }>;
}) {
  const { userId } = await auth();
  const { upgrade } = await searchParams;
  const showUpgradeBanner = upgrade === "1";

  let isLoggedIn = !!userId;

  if (userId) {
    const account = await prisma.account.findUnique({
      where: { clerkId: userId },
      include: { subscription: true },
    });
    // Active premium users go straight to their dashboard
    const sub = account?.subscription;
    if (sub?.plan === "PREMIUM" && ["ACTIVE", "TRIALING"].includes(sub.status ?? "")) {
      redirect("/overview");
    }
    isLoggedIn = !!account;
  }

  return (
    <div className="min-h-screen pt-16">
      {showUpgradeBanner && (
        <div className="bg-primary text-white text-center py-3 px-5 text-sm font-medium">
          A Premium subscription is required to access the dashboard. Start your 14-day free trial below.
        </div>
      )}
      <PricingSection isLoggedIn={isLoggedIn} />

      {/* FAQ */}
      <section className="bg-white py-24 px-5 sm:px-8">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold text-[#25293C] mb-10 text-center">
            Frequently asked questions
          </h2>
          <dl className="space-y-6">
            {faqs.map(({ q, a }) => (
              <div key={q} className="border-b border-[#E8E7EA] pb-6 last:border-0">
                <dt className="text-[#25293C] font-semibold mb-2">{q}</dt>
                <dd className="text-[#8A8D93] text-sm leading-relaxed">{a}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-12 text-center">
            <p className="text-[#8A8D93] text-sm mb-4">Still have questions?</p>
            <Link
              href="mailto:support@wondish.io"
              className="text-primary hover:text-primary-dark font-semibold text-sm"
            >
              Contact support →
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
