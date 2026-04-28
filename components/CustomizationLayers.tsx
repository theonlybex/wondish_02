const LAYERS = [
  {
    number: "01",
    emoji: "🎯",
    title: "Your Goals",
    description:
      "Enter your current weight, target, and timeline. We calculate your exact daily calorie needs and build everything else from there.",
    tag: "Free",
  },
  {
    number: "02",
    emoji: "🥗",
    title: "Your Preferences",
    description:
      "Vegan, keto, Mediterranean — or just 'no mushrooms'. Set dietary styles, allergies, and foods to avoid. Your plan never ignores this.",
    tag: "Free",
  },
  {
    number: "03",
    emoji: "🛒",
    title: "Your Ingredients",
    description:
      "Add ingredients from your kitchen and local store with exact nutritional values. We plan around what you actually have.",
    tag: "Premium",
  },
  {
    number: "04",
    emoji: "📅",
    title: "Your Meal Plan",
    description:
      "A full personalized weekly plan generated from all your inputs. Recipes, portions, and prep times — ready every week, updated as you progress.",
    tag: "Premium",
  },
  {
    number: "05",
    emoji: "📈",
    title: "Your Progress",
    description:
      "Log meals, weight, energy, and mood. Watch trends emerge and know exactly what's working — and what isn't.",
    tag: "Free",
  },
  {
    number: "06",
    emoji: "🔬",
    title: "Your Analytics",
    description:
      "Full macro and micronutrient breakdowns for every meal. The science behind your food, explained simply.",
    tag: "Free",
  },
];

export default function CustomizationLayers() {
  return (
    <section className="bg-[#F4F3EF] min-h-screen py-12 px-5 sm:px-8 flex items-center">
      <div className="w-full max-w-6xl mx-auto">

        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-end gap-6 lg:gap-24 mb-8">
          <div className="lg:flex-1">
            <p className="text-[#4ade80] text-[11px] font-semibold uppercase tracking-[0.22em] mb-5">
              How it works
            </p>
            <h2 className="text-4xl sm:text-5xl font-bold text-[#0d1a10] leading-[1.08]">
              Built in layers.
              <br />
              <span className="text-[#0d1a10]/30 font-normal italic">Each one adds up.</span>
            </h2>
          </div>
          <p className="lg:flex-1 text-[#5C5B52] text-base leading-relaxed lg:pb-1 max-w-md">
            Most meal apps hand you a generic plan. Wondish gives you a system — six layers of
            customization that learn, adapt, and improve the longer you use it.
          </p>
        </div>

        {/* Rows */}
        <div className="border-t border-[#D6D4CE]">
          {LAYERS.map((layer) => (
            <div
              key={layer.number}
              className="group flex items-start gap-5 sm:gap-8 py-3 sm:py-4 border-b border-[#D6D4CE] -mx-3 px-3 sm:-mx-5 sm:px-5 rounded-xl hover:bg-[#0d1a10]/[0.03] transition-colors duration-200 cursor-default"
            >
              {/* Number */}
              <span className="flex-shrink-0 font-black text-[3rem] sm:text-[3.5rem] leading-none text-[#0d1a10]/[0.08] group-hover:text-[#4ade80]/50 transition-colors duration-300 w-14 sm:w-16 text-right tabular-nums select-none">
                {layer.number}
              </span>

              {/* Body */}
              <div className="flex-1 min-w-0 pt-1">
                <div className="flex items-center gap-2.5 mb-2">
                  <span className="text-lg leading-none">{layer.emoji}</span>
                  <h3 className="text-[#0d1a10] font-bold text-base sm:text-lg">{layer.title}</h3>
                </div>
                <p className="text-[#6B6A61] text-sm sm:text-[15px] leading-relaxed">
                  {layer.description}
                </p>
              </div>

              {/* Badge */}
              <span
                className={`flex-shrink-0 self-center text-[11px] font-semibold px-2.5 py-1 rounded-full tracking-wide ${
                  layer.tag === "Free"
                    ? "bg-[#4ade80]/15 text-[#1a6b38]"
                    : "bg-[#0d1a10]/[0.07] text-[#0d1a10]/40"
                }`}
              >
                {layer.tag}
              </span>
            </div>
          ))}
        </div>

      </div>
    </section>
  );
}
