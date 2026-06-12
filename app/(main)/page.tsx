import Hero from "@/components/Hero";
import HowItWorks from "@/components/HowItWorks";
import Benefits from "@/components/Benefits";
import DishesPreview from "@/components/DishesPreview";
import Conditions from "@/components/Conditions";
import Testimonials from "@/components/Testimonials";
import PricingSection from "@/components/PricingSection";
import CTASection from "@/components/CTASection";

export default function HomePage() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <Benefits />
      <DishesPreview />
      <Conditions />
      <Testimonials />
      <PricingSection />
      <CTASection />
    </>
  );
}
