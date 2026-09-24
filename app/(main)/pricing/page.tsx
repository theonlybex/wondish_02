import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { hasPaidPremium } from "@/lib/coupon";
import PricingSection from "@/components/PricingSection";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Simple, transparent pricing. Start free, upgrade to Wondish Plus for $20/month or Wondish Chef for $100 per 6 months.",
};

const faqs = [
  {
    q: "Do I need a credit card to start?",
    a: "No. Free needs no payment information, and it is not a trial — it is the whole app with smaller allowances. You only need a card when you want Plus's higher limits.",
  },
  {
    q: "Can I cancel my Plus subscription?",
    a: "Yes, anytime. You'll retain Plus access until the end of your billing period, then automatically switch to the Free plan.",
  },
  {
    q: "What happens to my data if I downgrade?",
    a: "Everything is preserved — meal history, journal entries, profile. And no feature disappears: Free has the same app, at Free's weekly and daily allowances. You keep the planner, Clara and your grocery lists; you just get fewer new weeks and messages.",
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
  // A coupon holder is NOT a paying customer and not a free user; this page is
  // the destination of their own "Beta → Plus" badge, so it has to say where
  // they stand and when their access ends.
  let betaAccessUntil: Date | null = null;

  if (userId) {
    const account = await prisma.account.findUnique({
      where: { clerkId: userId },
      include: { subscriptions: true, roles: { include: { role: true } } },
    });
    // Paid premium (and admins) manage their plan on /membership. Coupon-only
    // premium may still buy: the coupon ends on a date, a subscription doesn't.
    const isAdmin = account?.roles?.some((r: { role: { name: string } }) => r.role.name === "SUPER") ?? false;
    if (isAdmin || hasPaidPremium(account?.subscriptions ?? [])) {
      redirect("/membership");
    }
    isLoggedIn = !!account;
    const coupon = (account?.subscriptions ?? [])
      .filter((s) => s.source === "COUPON" && s.plan === "PREMIUM" && s.status === "ACTIVE")
      .map((s) => s.stripeCurrentPeriodEnd)
      .filter((d): d is Date => d instanceof Date)
      .sort((a, b) => b.getTime() - a.getTime());
    betaAccessUntil = coupon[0] ?? null;
  }

  return (
    <div className="min-h-screen pt-16">
      {showUpgradeBanner && (
        <div className="bg-primary text-white text-center py-3 px-5 text-sm font-medium">
          {/* ?upgrade=1 is linked from a quota refusal, not from a locked
              dashboard — the paywall was removed on 2026-09-17 and no
              subscription is required to reach any screen. */}
          You&apos;ve used up an allowance for now. Plus raises every limit — or wait for the reset, nothing is locked.
        </div>
      )}
      <PricingSection isLoggedIn={isLoggedIn} betaAccessUntil={betaAccessUntil} />

      {/* FAQ */}
      <section className="bg-white py-24 px-5 sm:px-8">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold text-[#1E1A1A] mb-10 text-center">
            Frequently asked questions
          </h2>
          <dl className="space-y-6">
            {faqs.map(({ q, a }) => (
              <div key={q} className="border-b border-[#EAE4CA] pb-6 last:border-0">
                <dt className="text-[#1E1A1A] font-semibold mb-2">{q}</dt>
                <dd className="text-[#848181] text-sm leading-relaxed">{a}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-12 text-center">
            <p className="text-[#848181] text-sm mb-4">Still have questions?</p>
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
