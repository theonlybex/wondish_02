type NodeSize = "large" | "medium" | "small";
interface SvgNode {
  x: number;
  y: number;
  label: string;
  size: NodeSize;
  highlight?: boolean;
}

const CX = 390;
const CY = 300;

const NODES: SvgNode[] = [
  // ── Large category anchors ──────────────────────────────
  { x: 60,  y: 100, label: "Your Profile",   size: "large", highlight: true  },
  { x: 672, y: 82,  label: "Calorie Engine", size: "large", highlight: true  },
  { x: 752, y: 300, label: "Safety Filters", size: "large", highlight: true  },
  { x: 672, y: 518, label: "Dish Builder",   size: "large", highlight: true  },
  { x: 60,  y: 500, label: "35-Day Plan",    size: "large", highlight: true  },

  // ── Medium supporting concepts ──────────────────────────
  { x: 200, y: 62,  label: "BMR",            size: "medium" },
  { x: 390, y: 40,  label: "Activity Level", size: "medium" },
  { x: 118, y: 192, label: "Goal Weight",    size: "medium" },
  { x: 105, y: 410, label: "Conditions",     size: "medium" },
  { x: 188, y: 530, label: "Allergies",      size: "medium" },
  { x: 382, y: 568, label: "Preferences",    size: "medium" },
  { x: 545, y: 548, label: "Avoidances",     size: "medium" },
  { x: 668, y: 178, label: "Meal Budget",    size: "medium" },
  { x: 722, y: 128, label: "Breakfast",      size: "medium" },
  { x: 772, y: 238, label: "Lunch",          size: "medium" },
  { x: 772, y: 368, label: "Dinner",         size: "medium" },
  { x: 710, y: 468, label: "Snack",          size: "medium" },

  // ── Small detail nodes ──────────────────────────────────
  { x: 218, y: 138, label: "Age · Sex",        size: "small" },
  { x: 72,  y: 298, label: "Height · Weight",  size: "small" },
  { x: 292, y: 50,  label: "Timeline",         size: "small" },
  { x: 222, y: 555, label: "Motivation",       size: "small" },
  { x: 558, y: 68,  label: "Protein",          size: "small" },
  { x: 722, y: 215, label: "Carbs",            size: "small" },
  { x: 748, y: 338, label: "Fats",             size: "small" },
  { x: 700, y: 430, label: "Sides · Dessert",  size: "small" },
  { x: 510, y: 572, label: "Deduplication",    size: "small" },
];

const FEATURES = [
  {
    phase: "Phase 1–2",
    title: "Calorie Engine",
    desc: "Harris-Benedict BMR × your activity multiplier produces your exact daily calorie target — then distributed across every meal of the day.",
  },
  {
    phase: "Phase 3",
    title: "Safety Filters",
    desc: "Allergies, medical conditions, and personal avoidances are merged into one banned-ingredient set. Every dish is checked before it reaches your plan.",
  },
  {
    phase: "Phase 4–5",
    title: "Dish Builder",
    desc: "Complete meals — main, sides, and dessert — picked for variety and motivation. Deduplication guarantees 35 days with zero repeated meals.",
  },
];

export default function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="overflow-hidden"
      style={{ background: "#0a1509" }}
    >
      <style>{`
        @keyframes hiw-node-pulse {
          0%, 100% { opacity: 0.13; }
          50%       { opacity: 0.22; }
        }
        @keyframes hiw-center-breathe {
          0%, 100% { r: 46; }
          50%       { r: 49; }
        }
        @keyframes hiw-orbit-spin {
          from { transform: rotate(0deg);   transform-origin: ${CX}px ${CY}px; }
          to   { transform: rotate(360deg); transform-origin: ${CX}px ${CY}px; }
        }
        @keyframes hiw-dot-pulse {
          0%, 100% { opacity: 0.4; transform: scale(1);   }
          50%       { opacity: 1;   transform: scale(1.5); }
        }
        .hiw-line { animation: hiw-node-pulse 5s ease-in-out infinite; }
        .hiw-orbit { animation: hiw-orbit-spin 90s linear infinite; }
        .hiw-card-inner:hover {
          background: rgba(74,222,128,0.07) !important;
          border-color: rgba(74,222,128,0.22) !important;
        }
      `}</style>

      <div className="max-w-7xl mx-auto px-6 sm:px-10 py-24 lg:py-32">
        <div className="grid lg:grid-cols-[5fr_7fr] gap-14 xl:gap-20 items-center">

          {/* ── Left: text panel ──────────────────────────────────── */}
          <div>
            <p
              className="text-[11px] font-bold uppercase tracking-[0.28em] mb-5"
              style={{ color: "#4ade80" }}
            >
              The Algorithm
            </p>
            <h2
              className="font-extrabold leading-[1.07] mb-5"
              style={{
                fontSize: "clamp(2rem, 3.4vw, 3rem)",
                color: "#f0fdf4",
                letterSpacing: "-0.03em",
              }}
            >
              How your meal plan<br />is built
            </h2>
            <p
              className="text-sm leading-relaxed mb-12"
              style={{ color: "rgba(240,253,244,0.38)", maxWidth: 420 }}
            >
              A five-stage pipeline translates your body data and dietary
              profile into a precise, personalised 35-day daily menu.
            </p>

            <div className="flex flex-col gap-4">
              {FEATURES.map((f) => (
                <div
                  key={f.phase}
                  className="hiw-card-inner rounded-2xl p-5 transition-all duration-200 cursor-default"
                  style={{
                    background: "rgba(74,222,128,0.03)",
                    border: "1px solid rgba(74,222,128,0.09)",
                  }}
                >
                  <div>
                    <span
                      className="text-[10px] font-bold uppercase tracking-[0.2em] mb-1 block"
                      style={{ color: "#4ade80" }}
                    >
                      {f.phase}
                    </span>
                    <h3
                      className="font-bold text-sm mb-1.5 leading-snug"
                      style={{ color: "#f0fdf4" }}
                    >
                      {f.title}
                    </h3>
                    <p
                      className="text-[13px] leading-relaxed"
                      style={{ color: "rgba(240,253,244,0.38)" }}
                    >
                      {f.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Right: radial constellation ───────────────────────── */}
          <div className="relative select-none">
            <svg
              viewBox="0 0 820 620"
              width="100%"
              style={{ overflow: "visible" }}
              aria-label="Wondish algorithm constellation"
            >
              {/* Atmospheric glow behind centre */}
              <radialGradient id="hiw-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%"   stopColor="#4ade80" stopOpacity="0.07" />
                <stop offset="100%" stopColor="#4ade80" stopOpacity="0"    />
              </radialGradient>
              <ellipse cx={CX} cy={CY} rx={260} ry={230} fill="url(#hiw-glow)" />

              {/* Slow-spinning dashed orbit ring */}
              <circle
                cx={CX} cy={CY} r={195}
                fill="none"
                stroke="rgba(74,222,128,0.06)"
                strokeWidth="1"
                strokeDasharray="4 10"
                className="hiw-orbit"
              />

              {/* Lines from centre to each node */}
              {NODES.map((n) => (
                <line
                  key={`line-${n.label}`}
                  x1={CX} y1={CY}
                  x2={n.x} y2={n.y}
                  stroke={n.highlight ? "rgba(74,222,128,0.22)" : "rgba(74,222,128,0.11)"}
                  strokeWidth={n.highlight ? "1" : "0.75"}
                  className="hiw-line"
                  style={{ animationDelay: `${Math.random() * 4}s` }}
                />
              ))}

              {/* Dot at each node position */}
              {NODES.map((n) => (
                <circle
                  key={`dot-${n.label}`}
                  cx={n.x} cy={n.y} r={n.size === "large" ? 3.5 : 2.2}
                  fill={n.highlight ? "#4ade80" : "rgba(74,222,128,0.45)"}
                />
              ))}

              {/* Centre: double ring + logo */}
              <circle
                cx={CX} cy={CY} r={62}
                fill="rgba(74,222,128,0.05)"
                stroke="rgba(74,222,128,0.18)"
                strokeWidth="1"
              />
              <circle
                cx={CX} cy={CY} r={50}
                fill="rgba(10,21,9,0.9)"
                stroke="rgba(74,222,128,0.1)"
                strokeWidth="0.75"
              />
              <text
                x={CX} y={CY - 6}
                textAnchor="middle"
                fontSize="15"
                fontWeight="800"
                fill="rgba(240,253,244,0.9)"
                letterSpacing="-0.04em"
              >
                won
              </text>
              <text
                x={CX} y={CY + 13}
                textAnchor="middle"
                fontSize="15"
                fontWeight="800"
                fill="#4ade80"
                letterSpacing="-0.04em"
              >
                dish
              </text>

              {/* Node labels */}
              {NODES.map((n) => {
                const fs =
                  n.size === "large" ? 16 : n.size === "medium" ? 13.5 : 11.5;
                const fw = n.size === "large" ? "700" : "500";
                const fill = n.highlight
                  ? "rgba(240,253,244,0.82)"
                  : n.size === "medium"
                  ? "rgba(240,253,244,0.42)"
                  : "rgba(240,253,244,0.24)";
                return (
                  <text
                    key={`text-${n.label}`}
                    x={n.x}
                    y={n.y}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={fs}
                    fontWeight={fw}
                    fill={fill}
                  >
                    {n.label}
                  </text>
                );
              })}
            </svg>
          </div>

        </div>
      </div>
    </section>
  );
}
