const steps = [
  {
    number: "01",
    title: "Create your profile",
    description:
      "Tell us about your health goals, dietary restrictions, allergies, and food preferences. Takes less than 3 minutes.",
  },
  {
    number: "02",
    title: "Get your meal plan",
    description:
      "Receive a personalized weekly plan with recipes tailored to your caloric needs and tastes — curated by nutritionists.",
  },
  {
    number: "03",
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
                <div className="hidden sm:block absolute top-8 left-[calc(100%+1rem)] right-[-1rem] h-px bg-gradient-to-r from-primary/30 to-transparent" />
              )}

              <div className="mb-5">
                <span className="text-5xl font-bold text-primary/15 font-mono">
                  {step.number}
                </span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
                <div className="w-3 h-3 rounded-full bg-primary" />
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
