import Link from "next/link";

const FLOATING_EMOJIS = [
  { emoji: "🥑", top: "12%", left: "4%",   size: "2rem",   opacity: 0.35, delay: "0s",    dur: "5.2s"  },
  { emoji: "🍋", top: "70%", left: "6%",   size: "1.6rem", opacity: 0.25, delay: "1.4s",  dur: "6s"    },
  { emoji: "🫐", top: "20%", right: "5%",  size: "1.8rem", opacity: 0.30, delay: "0.6s",  dur: "4.8s"  },
  { emoji: "🍅", top: "75%", right: "7%",  size: "1.6rem", opacity: 0.25, delay: "2s",    dur: "5.6s"  },
  { emoji: "🥦", top: "45%", left: "2%",   size: "1.5rem", opacity: 0.20, delay: "0.9s",  dur: "7s"    },
  { emoji: "🧄", top: "38%", right: "3%",  size: "1.5rem", opacity: 0.20, delay: "1.8s",  dur: "5.8s"  },
];

export default function DishTinderPromo() {
  return (
    <section className="relative bg-[#0a1509] min-h-[110vh] py-20 px-5 sm:px-8 overflow-hidden flex items-center">
      <style>{`
        @keyframes floatEmoji   { 0%,100%{transform:translateY(0)}   50%{transform:translateY(-14px)} }
        @keyframes floatCard    { 0%,100%{transform:translateY(0) rotate(0deg)}   50%{transform:translateY(-10px) rotate(0.5deg)} }
        @keyframes swayBack1    { 0%,100%{transform:rotate(-6deg) translateY(10px)} 50%{transform:rotate(-8deg) translateY(4px)} }
        @keyframes swayBack2    { 0%,100%{transform:rotate(8deg)  translateY(14px)} 50%{transform:rotate(10deg) translateY(6px)} }
        @keyframes pulsePass    { 0%,100%{opacity:0.04} 50%{opacity:0.07} }
        @keyframes pulseTry     { 0%,100%{opacity:0.05} 50%{opacity:0.09} }
      `}</style>

      {/* Atmospheric split halos */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-y-0 left-0 w-1/2"
          style={{ background: "radial-gradient(ellipse at 10% 50%, rgba(220,50,50,0.07) 0%, transparent 65%)" }} />
        <div className="absolute inset-y-0 right-0 w-1/2"
          style={{ background: "radial-gradient(ellipse at 90% 50%, rgba(74,222,128,0.09) 0%, transparent 65%)" }} />
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(74,222,128,0.06) 0%, transparent 70%)" }} />
      </div>

      {/* Ghost TRY / it text */}
      <span className="absolute left-[2%] top-1/2 -translate-y-1/2 text-[14vw] sm:text-[10vw] font-black text-[#4ade80] select-none pointer-events-none leading-none tracking-tighter"
        style={{ opacity: 0.06, animation: "pulseTry 4s ease-in-out infinite" }}>
        TRY
      </span>
      <span className="absolute right-[2%] top-1/2 -translate-y-1/2 text-[14vw] sm:text-[10vw] font-black text-[#4ade80] select-none pointer-events-none leading-none tracking-tighter"
        style={{ opacity: 0.06, animation: "pulseTry 4s ease-in-out 0.5s infinite" }}>
        it
      </span>

      {/* Floating emojis */}
      {FLOATING_EMOJIS.map(({ emoji, top, left, right, size, opacity, delay, dur }, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="absolute pointer-events-none select-none"
          style={{
            top, left, right,
            fontSize: size,
            opacity,
            animation: `floatEmoji ${dur} ease-in-out ${delay} infinite`,
          }}
        >
          {emoji}
        </span>
      ))}

      {/* Content */}
      <div className="relative z-10 w-full max-w-6xl mx-auto flex flex-col items-center text-center">

        {/* Eyebrow */}
        <div className="flex items-center gap-3 mb-4">
          <div className="h-px w-10 bg-[#4ade80]/30" />
          <span className="text-[#4ade80]/60 text-[11px] font-semibold uppercase tracking-[0.22em]">
            Taste Profile
          </span>
          <div className="h-px w-10 bg-[#4ade80]/30" />
        </div>

        <h2 className="text-4xl sm:text-5xl font-bold text-white leading-[1.07] mb-4">
          Swipe dishes.
          <br />
          <span className="text-[#4ade80]" style={{ textShadow: "0 0 60px rgba(74,222,128,0.3)" }}>
            We learn what you love.
          </span>
        </h2>
        <p className="text-white/35 text-base sm:text-lg max-w-md leading-relaxed mb-8">
          Rate 50+ dishes in minutes. Your meal plan instantly reflects your taste — no guessing, no foods you hate.
        </p>

        {/* Card stack */}
        <div className="relative w-[280px] sm:w-[300px] mb-7">

          {/* Back card 2 */}
          <div
            className="absolute inset-x-3 top-4 bottom-0 rounded-3xl border border-white/[0.06] bg-white/[0.04]"
            style={{ animation: "swayBack2 6s ease-in-out 0.2s infinite" }}
          />
          {/* Back card 1 */}
          <div
            className="absolute inset-x-1.5 top-2 bottom-0 rounded-3xl border border-white/[0.08] bg-white/[0.06]"
            style={{ animation: "swayBack1 5.5s ease-in-out 0s infinite" }}
          />

          {/* Front card */}
          <div
            className="relative rounded-3xl overflow-hidden border border-white/10"
            style={{
              animation: "floatCard 4.5s ease-in-out 0.5s infinite",
              boxShadow: "0 0 0 1px rgba(74,222,128,0.15), 0 0 60px rgba(74,222,128,0.12), 0 32px 64px rgba(0,0,0,0.6)",
              background: "#ffffff",
            }}
          >
            {/* Progress */}
            <div className="px-5 pt-5 pb-0 bg-white">
              <div className="flex items-center gap-2.5">
                <div className="flex-1 h-1 bg-[#F0EFF5] rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full w-[22%]" />
                </div>
                <span className="text-[10px] text-[#8A8D93] tabular-nums">12 / 54</span>
              </div>
            </div>

            {/* Dish hero */}
            <div className="bg-gradient-to-br from-primary/10 to-primary/5 mx-4 mt-3 rounded-2xl px-6 pt-8 pb-5 text-center">
              <span className="text-7xl leading-none select-none" aria-hidden="true">🥗</span>
              <h3 className="text-base font-bold text-[#25293C] mt-4 leading-snug">
                Mediterranean Quinoa Bowl
              </h3>
              <div className="flex items-center justify-center gap-2 mt-2.5">
                <span className="text-[9px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full uppercase tracking-wide">
                  Lunch
                </span>
                <span className="text-[9px] font-semibold text-[#8A8D93] bg-white/80 border border-[#E8E7EA] px-2 py-0.5 rounded-full">
                  Mediterranean
                </span>
              </div>
              <p className="text-[#8A8D93] text-[11px] mt-2.5 leading-relaxed max-w-[200px] mx-auto">
                Fresh quinoa with roasted veg, olives, and feta.
              </p>
              <p className="text-[10px] text-[#8A8D93]/60 mt-1.5">420 kcal</p>
            </div>

            {/* Buttons */}
            <div className="px-4 py-3.5 flex gap-2.5 bg-white">
              <div className="flex-1 py-3.5 rounded-2xl bg-red-50 border-2 border-red-200 text-red-500 font-bold text-xs text-center select-none">
                ✕ Not Gonna Try
              </div>
              <div className="flex-1 py-3.5 rounded-2xl bg-emerald-50 border-2 border-emerald-200 text-emerald-700 font-bold text-xs text-center select-none">
                ✓ Would Try
              </div>
            </div>
            <div className="pb-4 bg-white text-center">
              <span className="text-[11px] text-[#C0BFB8]">Skip this dish →</span>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="relative inline-flex">
          <div className="absolute inset-0 rounded-xl bg-[#4ade80]"
            style={{ animation: "pulseTry 2.2s ease-out infinite", opacity: 0 }} />
          <Link
            href="/try"
            className="relative inline-flex items-center gap-2 bg-[#4ade80] hover:bg-[#22c55e] text-[#0a1509] px-8 py-4 rounded-xl font-bold text-sm transition-colors shadow-lg shadow-[#4ade80]/20"
          >
            Start swiping — it&rsquo;s free
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        </div>

        <p className="text-white/20 text-xs mt-4">No account needed to explore the dishes</p>

      </div>
    </section>
  );
}
