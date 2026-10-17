import Hero from "@/components/Hero";
import HowItWorks from "@/components/HowItWorks";
import Benefits from "@/components/Benefits";
import DishesPreview from "@/components/DishesPreview";
import Conditions from "@/components/Conditions";
import CTASection from "@/components/CTASection";
// Pricing is off the landing page (2026-10-17, user-directed: prices up front
// spoil the pitch). /pricing still renders it; to bring it back here,
// uncomment this import and <PricingSection /> below, and the navbar link.
// import PricingSection from "@/components/PricingSection";

export default function HomePage() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <Benefits />
      <DishesPreview />
      <Conditions />
      {/* <PricingSection /> */}
      <CTASection />
    </>
  );
}
