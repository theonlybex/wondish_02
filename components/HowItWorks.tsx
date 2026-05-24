const STAGES = [
  {
    num: "01",
    phase: "Inputs",
    title: "Your Profile",
    points: [
      "Age · sex · height · weight",
      "Physical activity level",
      "Goal weight & motivations",
      "Health conditions & allergies",
      "Food preferences & avoidances",
    ],
  },
  {
    num: "02",
    phase: "Phase 1",
    title: "Caloric Engine",
    points: [
      "Harris-Benedict BMR",
      "× Activity multiplier",
      "Daily calorie target",
      "1200–1500 kcal minimum floor",
      "Meal budget computed",
    ],
  },
  {
    num: "03",
    phase: "Phase 2",
    title: "Safety Filters",
    points: [
      "Allergy-derived bans",
      "Condition restrictions",
      "Preference exclusions",
      "Personal avoidances",
      "One merged banned set",
    ],
  },
  {
    num: "04",
    phase: "Phase 3",
    title: "Dish Builder",
    points: [
      "Complete meal or main dish",
      "+ Veggie · starchy · fruity sides",
      "+ Dessert at lunch if needed",
      "Weekly family deduplication",
      "Motivation-scored picks",
    ],
  },
  {
    num: "05",
    phase: "Output",
    title: "35-Day Plan",
    points: [
      "Breakfast · 20%",
      "Lunch · 35%",
      "Dinner · 30%",
      "Snack · 15%",
    ],
    isOutput: true,
  },
] as const;

const DELAYS = ["0s", "0.8s", "1.6s", "2.4s", "3.2s"];
const CONN_DELAYS = ["0s", "0.6s", "1.2s", "1.8s"];

export default function HowItWorks() {
  return (
    <section
      style={{
        background: "#060c07",
        backgroundImage:
          "linear-gradient(rgba(74,222,128,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(74,222,128,0.025) 1px, transparent 1px)",
        backgroundSize: "44px 44px",
      }}
      className="py-24 px-5 sm:px-8 overflow-hidden"
    >
      <style>{`
        @keyframes hiw-line-flow {
          0%   { background-position: 200% center; }
          100% { background-position: -200% center; }
        }
        @keyframes hiw-dot-travel {
          0%   { left: 0%;   opacity: 0; }
          8%   { opacity: 1; }
          92%  { opacity: 1; }
          100% { left: 100%; opacity: 0; }
        }
        @keyframes hiw-card-breath {
          0%, 100% { box-shadow: 0 0 0 1px rgba(74,222,128,0.10), 0 8px 32px rgba(0,0,0,0.4); }
          50%      { box-shadow: 0 0 0 1px rgba(74,222,128,0.22), 0 8px 40px rgba(74,222,128,0.06); }
        }
        @keyframes hiw-output-pulse {
          0%, 100% {
            box-shadow: 0 0 0 1px rgba(74,222,128,0.40),
                        0 0 40px rgba(74,222,128,0.12),
                        inset 0 0 40px rgba(74,222,128,0.03);
          }
          50% {
            box-shadow: 0 0 0 1px rgba(74,222,128,0.65),
                        0 0 64px rgba(74,222,128,0.22),
                        inset 0 0 40px rgba(74,222,128,0.07);
          }
        }
        @keyframes hiw-num-glow {
          0%, 100% { text-shadow: 0 0 6px rgba(74,222,128,0.25); }
          50%      { text-shadow: 0 0 18px rgba(74,222,128,0.80), 0 0 36px rgba(74,222,128,0.30); }
        }
        @keyframes hiw-header-fade-in {
          from { opacity: 0; transform: translateY(18px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .hiw-card {
          animation: hiw-card-breath 4s ease-in-out infinite;
        }
        .hiw-output {
          animation: hiw-output-pulse 3s ease-in-out infinite;
        }
        .hiw-num {
          animation: hiw-num-glow 3s ease-in-out infinite;
        }
        .hiw-line {
          height: 1px;
          background: linear-gradient(
            90deg,
            transparent 0%,
            rgba(74,222,128,0.10) 10%,
            rgba(74,222,128,0.75) 40%,
            rgba(74,222,128,1.00) 50%,
            rgba(74,222,128,0.75) 60%,
            rgba(74,222,128,0.10) 90%,
            transparent 100%
          );
          background-size: 300% 100%;
          animation: hiw-line-flow 2.4s linear infinite;
          box-shadow: 0 0 6px rgba(74,222,128,0.35);
        }
        .hiw-dot {
          position: absolute;
          top: -3px;
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #4ade80;
          box-shadow: 0 0 10px #4ade80, 0 0 22px rgba(74,222,128,0.55);
          animation: hiw-dot-travel 2.4s linear infinite;
        }
        .hiw-header {
          animation: hiw-header-fade-in 0.7s cubic-bezier(0.22,1,0.36,1) both;
        }
      `}</style>

      <div className="max-w-7xl mx-auto">
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="hiw-header mb-16 max-w-2xl">
          <p
            className="text-[10px] font-bold uppercase tracking-[0.28em] mb-5"
            style={{ color: "#4ade80" }}
          >
            The Algorithm
          </p>
          <h2
            className="font-extrabold leading-[1.08] mb-5"
            style={{
              fontSize: "clamp(2rem, 4vw, 3.25rem)",
              color: "#f0fdf4",
              letterSpacing: "-0.02em",
            }}
          >
            How your meal plan
            <br />
            is built
          </h2>
          <p className="text-sm leading-relaxed" style={{ color: "#3d6b42" }}>
            A five-stage pipeline that translates your body data and dietary
            profile into a precise, personalised 35-day daily menu.
          </p>
        </div>

        {/* ── Desktop: horizontal pipeline ───────────────────────────── */}
        <div className="hidden lg:flex items-start">
          {STAGES.map((stage, i) => (
            <div key={stage.num} className="flex items-start flex-1">
              {/* Node card */}
              <div
                className={`relative rounded-2xl p-5 flex-1 min-w-0 ${
                  stage.isOutput ? "hiw-output" : "hiw-card"
                }`}
                style={{
                  animationDelay: DELAYS[i],
                  background: stage.isOutput
                    ? "linear-gradient(145deg, rgba(74,222,128,0.09) 0%, rgba(74,222,128,0.04) 100%)"
                    : "rgba(255,255,255,0.025)",
                  border: stage.isOutput
                    ? "1px solid rgba(74,222,128,0.38)"
                    : "1px solid rgba(255,255,255,0.065)",
                }}
              >
                {/* Phase tag */}
                <span
                  className="inline-block text-[9px] font-bold uppercase tracking-[0.2em] px-2 py-0.5 rounded mb-3"
                  style={{
                    background: stage.isOutput
                      ? "rgba(74,222,128,0.18)"
                      : "rgba(74,222,128,0.08)",
                    color: "rgba(74,222,128,0.75)",
                  }}
                >
                  {stage.phase}
                </span>

                {/* Number */}
                <div
                  className="hiw-num font-black mb-1 leading-none"
                  style={{
                    animationDelay: DELAYS[i],
                    fontSize: "clamp(1.6rem, 2.2vw, 2.25rem)",
                    color: "#4ade80",
                    letterSpacing: "-0.04em",
                  }}
                >
                  {stage.num}
                </div>

                {/* Title */}
                <h3
                  className="font-bold mb-4 leading-tight"
                  style={{
                    fontSize: "clamp(0.8rem, 1vw, 0.95rem)",
                    color: stage.isOutput ? "#a3f0b8" : "#d1fae5",
                    letterSpacing: "-0.01em",
                  }}
                >
                  {stage.title}
                </h3>

                {/* Divider */}
                <div
                  className="mb-4"
                  style={{
                    height: "1px",
                    background: stage.isOutput
                      ? "rgba(74,222,128,0.25)"
                      : "rgba(255,255,255,0.06)",
                  }}
                />

                {/* Detail points */}
                <ul className="space-y-2">
                  {stage.points.map((pt) => (
                    <li
                      key={pt}
                      className="flex items-start gap-2 leading-snug"
                      style={{
                        fontSize: "0.68rem",
                        color: stage.isOutput
                          ? "rgba(74,222,128,0.75)"
                          : "rgba(209,250,229,0.38)",
                      }}
                    >
                      <span
                        className="mt-[4px] shrink-0 rounded-full"
                        style={{
                          width: 3,
                          height: 3,
                          background: stage.isOutput
                            ? "rgba(74,222,128,0.8)"
                            : "rgba(74,222,128,0.3)",
                        }}
                      />
                      {pt}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Connector (not after last node) */}
              {i < STAGES.length - 1 && (
                <div
                  className="shrink-0 flex items-center"
                  style={{ width: 32, paddingTop: 60 }}
                >
                  <div className="relative w-full">
                    {/* Glowing animated line */}
                    <div
                      className="hiw-line"
                      style={{ animationDelay: CONN_DELAYS[i] }}
                    />
                    {/* Travelling dot */}
                    <div
                      className="hiw-dot"
                      style={{ animationDelay: CONN_DELAYS[i] }}
                    />
                    {/* Arrowhead */}
                    <div
                      className="absolute right-0 top-1/2 -translate-y-1/2"
                      style={{
                        width: 0,
                        height: 0,
                        borderTop: "3.5px solid transparent",
                        borderBottom: "3.5px solid transparent",
                        borderLeft: "5px solid rgba(74,222,128,0.55)",
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* ── Mobile: vertical pipeline ───────────────────────────────── */}
        <div className="lg:hidden space-y-0">
          {STAGES.map((stage, i) => (
            <div key={stage.num}>
              <div
                className={`rounded-2xl p-5 ${stage.isOutput ? "hiw-output" : "hiw-card"}`}
                style={{
                  animationDelay: DELAYS[i],
                  background: stage.isOutput
                    ? "linear-gradient(145deg, rgba(74,222,128,0.09) 0%, rgba(74,222,128,0.04) 100%)"
                    : "rgba(255,255,255,0.025)",
                  border: stage.isOutput
                    ? "1px solid rgba(74,222,128,0.38)"
                    : "1px solid rgba(255,255,255,0.065)",
                }}
              >
                <div className="flex items-center gap-3 mb-3">
                  <span
                    className="font-black"
                    style={{
                      fontSize: "1.75rem",
                      color: "#4ade80",
                      letterSpacing: "-0.04em",
                      lineHeight: 1,
                    }}
                  >
                    {stage.num}
                  </span>
                  <div>
                    <span
                      className="inline-block text-[9px] font-bold uppercase tracking-[0.2em] px-1.5 py-0.5 rounded mb-0.5"
                      style={{
                        background: "rgba(74,222,128,0.08)",
                        color: "rgba(74,222,128,0.7)",
                      }}
                    >
                      {stage.phase}
                    </span>
                    <p
                      className="font-bold leading-tight"
                      style={{
                        fontSize: "0.88rem",
                        color: stage.isOutput ? "#a3f0b8" : "#d1fae5",
                      }}
                    >
                      {stage.title}
                    </p>
                  </div>
                </div>
                <div
                  className="mb-3"
                  style={{
                    height: "1px",
                    background: "rgba(255,255,255,0.06)",
                  }}
                />
                <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                  {stage.points.map((pt) => (
                    <span
                      key={pt}
                      className="text-[11px]"
                      style={{
                        color: stage.isOutput
                          ? "rgba(74,222,128,0.75)"
                          : "rgba(209,250,229,0.4)",
                      }}
                    >
                      {pt}
                    </span>
                  ))}
                </div>
              </div>

              {i < STAGES.length - 1 && (
                <div className="flex justify-center py-0.5">
                  <div className="relative" style={{ width: 1, height: 28 }}>
                    <div
                      className="absolute inset-0"
                      style={{
                        background:
                          "linear-gradient(180deg, rgba(74,222,128,0.7) 0%, rgba(74,222,128,0.15) 100%)",
                        boxShadow: "0 0 6px rgba(74,222,128,0.3)",
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
