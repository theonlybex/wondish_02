import Hero from "@/components/Hero";
import SocialProofBar from "@/components/SocialProofBar";
import Features from "@/components/Features";
import PredictionTeaser from "@/components/PredictionTeaser";
import HowItWorks from "@/components/HowItWorks";
import DishesPreview from "@/components/DishesPreview";
import PricingSection from "@/components/PricingSection";
import CTASection from "@/components/CTASection";

export default function HomePage() {
  return (
    <>
      <Hero />
      <SocialProofBar />
      <Features />
      <PredictionTeaser />
      <HowItWorks />
      <DishesPreview />
      <PricingSection />
      <CTASection />
    </>
  );
}
