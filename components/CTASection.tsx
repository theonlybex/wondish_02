import Link from "next/link";

export default function CTASection() {
  return (
    <section className="bg-navy py-24 px-5 sm:px-8 relative overflow-hidden">
      <div className="absolute inset-0 bg-primary/5" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-48 bg-primary/20 rounded-full blur-[80px] pointer-events-none" />

      <div className="relative max-w-3xl mx-auto text-center">
        <h2 className="text-4xl sm:text-5xl font-bold text-white leading-tight mb-6">
          Ready to eat better, feel better?
        </h2>
        <p className="text-white/50 text-lg mb-10 max-w-xl mx-auto">
          Join thousands of people building healthier habits with Wondish. Your first 14 days are completely free.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/register"
            className="inline-flex items-center justify-center gap-2 bg-primary hover:bg-primary-dark text-white px-8 py-4 rounded-xl font-semibold text-base transition-all duration-150 shadow-xl shadow-primary/30"
          >
            Start free trial
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M3 8h10M9 4l4 4-4 4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
          <Link
            href="/dishes"
            className="inline-flex items-center justify-center gap-2 text-white/60 hover:text-white px-8 py-4 rounded-xl font-semibold text-base transition-all duration-150 border border-white/10 hover:border-white/20"
          >
            Browse the menu
          </Link>
        </div>
      </div>
    </section>
  );
}
