import Link from "next/link";

const trustBadges = [
  {
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    label: "Secure billing",
  },
  {
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    label: "Cancel anytime",
  },
  {
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    label: "Setup in 3 min",
  },
];

export default function CTASection() {
  return (
    <section
      className="relative py-24 px-5 sm:px-8 overflow-hidden"
      style={{ background: "linear-gradient(135deg, #0d1a10 0%, #0f172a 50%, #0a1628 100%)" }}
    >
      {/* Glowing orbs */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[200px] rounded-full blur-[100px] pointer-events-none" style={{ background: "rgba(74, 222, 128, 0.12)" }} />
      <div className="absolute bottom-0 left-1/4 w-64 h-64 rounded-full blur-[80px] pointer-events-none" style={{ background: "rgba(74, 222, 128, 0.07)" }} />
      <div className="absolute bottom-0 right-1/4 w-48 h-48 rounded-full blur-[80px] pointer-events-none" style={{ background: "rgba(99, 102, 241, 0.08)" }} />

      <div className="relative max-w-3xl mx-auto text-center">
        <p className="text-[#4ade80] text-sm font-semibold uppercase tracking-widest mb-4">
          Start today
        </p>
        <h2 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-tight mb-4">
          Ready to eat better, feel better?
        </h2>
        <p className="text-white/40 text-base mb-2">
          Average member loses <span className="text-white/70 font-semibold">8.2 lbs</span> in their first month.
        </p>
        <p className="text-white/40 text-lg mb-10 max-w-xl mx-auto">
          Join thousands of people building healthier habits with Wondish. Your first 14 days are completely free.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
          <Link
            href="/register"
            className="inline-flex items-center justify-center gap-2 bg-[#4ade80] hover:bg-[#22c55e] text-[#0d1a10] px-8 py-4 rounded-xl font-semibold text-base transition-colors shadow-xl shadow-[#4ade80]/25"
          >
            Get started free
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </Link>
          <Link
            href="/dishes"
            className="inline-flex items-center justify-center gap-2 text-white/60 hover:text-white px-8 py-4 rounded-xl font-semibold text-base transition-colors border border-white/10 hover:border-white/20"
          >
            Browse the menu
          </Link>
        </div>

        {/* Trust badges */}
        <div className="flex flex-wrap items-center justify-center gap-5">
          {trustBadges.map(({ icon, label }) => (
            <div key={label} className="flex items-center gap-2 text-white/30">
              <span className="text-[#4ade80]">{icon}</span>
              <span className="text-sm">{label}</span>
            </div>
          ))}
        </div>

      </div>
    </section>
  );
}
