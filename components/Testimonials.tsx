const testimonials = [
  {
    initials: "S.M.",
    name: "Sarah M.",
    goal: "Weight loss",
    color: "bg-violet-500",
    quote:
      "The prediction feature blew my mind. It told me 52 days and I hit my goal in 49. The meal plan makes it so easy — I don't even think about what to eat anymore.",
    stars: 5,
  },
  {
    initials: "J.K.",
    name: "James K.",
    goal: "Muscle gain",
    color: "bg-sky-500",
    quote:
      "I've tried every meal app out there. Wondish is the only one that actually factors in my grocery store and my schedule. The grocery list alone saves me two hours a week.",
    stars: 5,
  },
  {
    initials: "A.R.",
    name: "Amara R.",
    goal: "Maintenance",
    color: "bg-emerald-500",
    quote:
      "My dietitian recommended it. I was sceptical but the nutrition analytics convinced me on day one. I finally understand what I'm eating and why it matters.",
    stars: 5,
  },
];

export default function Testimonials() {
  return (
    <section className="bg-white py-24 px-5 sm:px-8">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="max-w-xl mb-16">
          <p className="text-primary text-sm font-semibold uppercase tracking-widest mb-4">
            What members say
          </p>
          <h2 className="text-4xl sm:text-5xl font-bold text-[#25293C] leading-tight">
            Real people, real results
          </h2>
        </div>

        {/* Cards */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {testimonials.map((t) => (
            <div
              key={t.name}
              className="bg-[#F8F7FA] border border-[#E8E7EA] rounded-2xl p-6 flex flex-col"
            >
              {/* Stars */}
              <div className="flex text-yellow-400 text-sm mb-4">
                {"★".repeat(t.stars)}
              </div>

              {/* Quote */}
              <p className="text-[#4A4E5C] text-sm leading-relaxed flex-1 mb-6">
                &ldquo;{t.quote}&rdquo;
              </p>

              {/* Author */}
              <div className="flex items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-full ${t.color} flex items-center justify-center text-white text-sm font-bold flex-shrink-0`}
                >
                  {t.initials}
                </div>
                <div>
                  <p className="text-[#25293C] font-semibold text-sm">{t.name}</p>
                  <p className="text-[#8A8D93] text-xs">{t.goal}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

      </div>
    </section>
  );
}
