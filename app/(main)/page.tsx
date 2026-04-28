import Hero from "@/components/Hero";
import CustomizationLayers from "@/components/CustomizationLayers";
import DishTinderPromo from "@/components/DishTinderPromo";
import PredictionTeaser from "@/components/PredictionTeaser";
import HowItWorks from "@/components/HowItWorks";
import DishesPreview from "@/components/DishesPreview";
import PricingSection from "@/components/PricingSection";
import CTASection from "@/components/CTASection";

export default function HomePage() {
  return (
    <>
      <Hero />
      <CustomizationLayers />
      <DishTinderPromo />
      <DishesPreview />
      <PredictionTeaser />
      <HowItWorks />
      <PricingSection />
      <CTASection />
    </>
  );
}
