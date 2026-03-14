import Link from "next/link";

export default function Hero() {
  return (
    <section className="relative min-h-screen bg-hero-pattern flex items-center overflow-hidden">
      {/* Ambient glow effects */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-primary/15 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-1/4 w-72 h-72 bg-primary/10 rounded-full blur-[80px] pointer-events-none" />

      {/* Subtle grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.3) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      <div className="relative max-w-6xl mx-auto px-5 sm:px-8 pt-24 pb-16 w-full">
        <div className="max-w-3xl mx-auto text-center">

          {/* Badge */}
          <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 text-primary px-4 py-1.5 rounded-full text-sm font-medium mb-8">
            <span className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
            Personalized nutrition, built for you
          </div>

          {/* Headline */}
          <h1 className="text-5xl sm:text-6xl lg:text-[72px] font-bold text-white leading-[1.1] tracking-tight mb-6">
            Eat smarter.
            <br />
            <span className="text-primary">Feel better.</span>
          </h1>

          {/* Subheadline */}
          <p className="text-lg sm:text-xl text-white/55 leading-relaxed max-w-2xl mx-auto mb-10">
            Your AI-powered meal planning platform that adapts to your dietary
            preferences, health goals, and lifestyle — and helps you build
            lasting habits, one meal at a time.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-16">
            <Link
              href="/register"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-primary hover:bg-primary-dark text-white px-7 py-3.5 rounded-xl font-semibold text-base transition-all duration-150 shadow-xl shadow-primary/30"
            >
              Start free trial
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                className="mt-0.5"
              >
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
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 text-white/70 hover:text-white px-7 py-3.5 rounded-xl font-semibold text-base transition-all duration-150 border border-white/10 hover:border-white/20 hover:bg-white/[0.04]"
            >
              Browse dishes
            </Link>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-6 max-w-sm mx-auto">
            {[
              { value: "500+", label: "Recipes" },
              { value: "10k+", label: "Members" },
              { value: "14 days", label: "Free trial" },
            ].map(({ value, label }) => (
              <div key={label} className="text-center">
                <p className="text-2xl font-bold text-white">{value}</p>
                <p className="text-sm text-white/40 mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Preview card */}
        <div className="mt-20 max-w-3xl mx-auto">
          <div className="bg-navy-surface/60 backdrop-blur border border-white/[0.08] rounded-2xl p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-5">
              <div className="flex gap-1.5">
                <span className="w-3 h-3 rounded-full bg-white/10" />
                <span className="w-3 h-3 rounded-full bg-white/10" />
                <span className="w-3 h-3 rounded-full bg-white/10" />
              </div>
              <div className="h-5 bg-white/[0.06] rounded-md flex-1" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { emoji: "🌅", label: "Breakfast", cal: "380 kcal", dish: "Avocado Toast" },
                { emoji: "☀️", label: "Lunch", cal: "450 kcal", dish: "Quinoa Bowl" },
                { emoji: "🌙", label: "Dinner", cal: "520 kcal", dish: "Baked Salmon" },
                { emoji: "🍎", label: "Snack", cal: "200 kcal", dish: "Apple & Almond" },
              ].map(({ emoji, label, cal, dish }) => (
                <div
                  key={label}
                  className="bg-white/[0.04] border border-white/[0.06] rounded-xl p-4"
                >
                  <div className="text-2xl mb-2">{emoji}</div>
                  <p className="text-[11px] text-white/40 font-medium uppercase tracking-wider mb-1">
                    {label}
                  </p>
                  <p className="text-white text-sm font-medium leading-snug mb-1">
                    {dish}
                  </p>
                  <p className="text-primary text-xs font-semibold">{cal}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
