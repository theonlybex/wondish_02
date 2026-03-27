const features = [
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <rect x="2" y="3" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M7 3V7M15 3V7M2 9H20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M7 13H7.01M11 13H11.01M15 13H15.01M7 16H7.01M11 16H11.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    title: "Smart Meal Planning",
    description:
      "Get a personalized weekly meal plan based on your caloric needs, dietary restrictions, and taste preferences. Updated automatically.",
    premium: true,
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path d="M11 2C8.24 2 6 4.24 6 7c0 3.53 4 8 5 9 1-1 5-5.47 5-9 0-2.76-2.24-5-5-5Z" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="11" cy="7" r="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M3 19c2-2 5-3 8-3s6 1 8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    title: "Health Goal Tracking",
    description:
      "Track your weight, BMI, energy levels, and mood over time. Visualize your progress with beautiful charts and journey dashboards.",
    premium: false,
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <circle cx="11" cy="11" r="9" stroke="currentColor" strokeWidth="1.5" />
        <path d="M11 7v4l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    title: "Custom Dish Preferences",
    description:
      "Tell us what you love, what you avoid, and your allergies. We'll build a plan around your unique palate — no unwanted surprises.",
    premium: true,
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path d="M3 6h4l2 5h6l2-5h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="8" cy="16" r="1.5" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="16" cy="16" r="1.5" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
    title: "Custom Ingredients",
    description:
      "Add your own ingredients with exact nutritional values. Build recipes tailored to your kitchen and local grocery store.",
    premium: true,
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path d="M4 17L8 9l4 5 3-3 3 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="2" y="2" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
    title: "Nutrition Analytics",
    description:
      "Get detailed breakdowns of your macro and micronutrient intake. Understand the science behind your meals with clarity.",
    premium: false,
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path d="M11 2l2.09 6.26H20l-5.46 3.97 2.09 6.26L11 14.52l-5.63 3.97 2.09-6.26L2 8.26h6.91z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    ),
    title: "Weight Loss Plans",
    description:
      "Curated low-calorie meal programs designed for healthy, sustainable weight loss — included in the free plan.",
    premium: false,
  },
];

const [featured, ...rest] = features;

export default function Features() {
  return (
    <section className="bg-white py-24 px-5 sm:px-8">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="max-w-2xl mb-16">
          <p className="text-primary text-sm font-semibold uppercase tracking-widest mb-4">
            Everything you need
          </p>
          <h2 className="text-4xl sm:text-5xl font-bold text-[#25293C] leading-tight mb-4">
            Nutrition that works for your life
          </h2>
          <p className="text-[#8A8D93] text-lg leading-relaxed">
            Whether you&apos;re looking to lose weight, build muscle, or simply eat
            more mindfully — Wondish gives you the tools to succeed.
          </p>
        </div>

        {/* Featured card */}
        <div className="relative bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border border-primary/20 rounded-2xl p-8 sm:p-10 mb-6 overflow-hidden">
          <div className="absolute -top-16 -right-16 w-64 h-64 rounded-full bg-primary/8 pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-48 h-48 rounded-full bg-primary/5 blur-[60px] pointer-events-none" />

          <div className="relative max-w-2xl">
            {featured.premium && (
              <span className="inline-block text-[10px] font-semibold text-primary bg-primary/10 px-2.5 py-1 rounded-full mb-4">
                Premium
              </span>
            )}
            <div className="w-12 h-12 rounded-xl bg-primary/15 text-primary flex items-center justify-center mb-5">
              {featured.icon}
            </div>
            <h3 className="text-[#25293C] font-bold text-2xl sm:text-3xl mb-3">
              {featured.title}
            </h3>
            <p className="text-[#5A5E6C] text-base leading-relaxed max-w-lg">
              {featured.description}
            </p>
          </div>
        </div>

        {/* Rest of features grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {rest.map((f) => (
            <div
              key={f.title}
              className="group relative bg-[#F8F7FA] hover:bg-white border border-[#E8E7EA] hover:border-primary/20 rounded-2xl p-6 transition-all duration-200 hover:shadow-lg hover:shadow-primary/5"
            >
              {f.premium && (
                <span className="absolute top-4 right-4 text-[10px] font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                  Premium
                </span>
              )}
              <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-4 group-hover:bg-primary group-hover:text-white transition-all duration-200">
                {f.icon}
              </div>
              <h3 className="text-[#25293C] font-semibold text-lg mb-2">
                {f.title}
              </h3>
              <p className="text-[#8A8D93] text-sm leading-relaxed">
                {f.description}
              </p>
            </div>
          ))}
        </div>

      </div>
    </section>
  );
}
