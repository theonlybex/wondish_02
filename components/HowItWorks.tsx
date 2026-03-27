const steps = [
  {
    number: "01",
    emoji: "👤",
    title: "Create your profile",
    description:
      "Tell us about your health goals, dietary restrictions, allergies, and food preferences. Takes less than 3 minutes.",
  },
  {
    number: "02",
    emoji: "🥗",
    title: "Get your meal plan",
    description:
      "Receive a personalized weekly plan with recipes tailored to your caloric needs and tastes — curated by nutritionists.",
  },
  {
    number: "03",
    emoji: "📈",
    title: "Track your journey",
    description:
      "Log meals, mood, weight, and energy. Watch your health improve week over week with our analytics dashboard.",
  },
];

export default function HowItWorks() {
  return (
    <section className="bg-[#F8F7FA] py-24 px-5 sm:px-8">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="max-w-xl mb-16">
          <p className="text-primary text-sm font-semibold uppercase tracking-widest mb-4">
            Simple process
          </p>
          <h2 className="text-4xl sm:text-5xl font-bold text-[#25293C] leading-tight">
            Up and running in minutes
          </h2>
        </div>

        {/* Steps */}
        <div className="grid sm:grid-cols-3 gap-8">
          {steps.map((step, i) => (
            <div key={step.number} className="relative">
              {/* Connector line */}
              {i < steps.length - 1 && (
                <div className="hidden sm:block absolute top-7 left-[calc(100%+1rem)] right-[-1rem] h-px bg-primary/25" />
              )}

              {/* Step number ring */}
              <div className="flex items-center gap-3 mb-5">
                <div className="w-12 h-12 rounded-full border-2 border-primary/30 bg-primary/10 flex items-center justify-center">
                  <span className="text-primary font-bold text-sm">{step.number}</span>
                </div>
                <span className="text-2xl">{step.emoji}</span>
              </div>

              <h3 className="text-[#25293C] font-semibold text-xl mb-3">
                {step.title}
              </h3>
              <p className="text-[#8A8D93] text-sm leading-relaxed">
                {step.description}
              </p>
            </div>
          ))}
        </div>

      </div>
    </section>
  );
}
