import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Wondish — Personalized Nutrition & Meal Planning",
    template: "%s | Wondish",
  },
  description:
    "Your AI-powered meal planning platform. Personalized recipes, nutrition tracking, and health dashboards tailored to your goals.",
  keywords: [
    "meal planning",
    "nutrition",
    "healthy eating",
    "recipes",
    "weight loss",
    "diet",
    "meal prep",
  ],
  openGraph: {
    title: "Wondish — Personalized Nutrition & Meal Planning",
    description:
      "Your AI-powered meal planning platform. Personalized recipes, nutrition tracking, and health dashboards tailored to your goals.",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Wondish — Personalized Nutrition & Meal Planning",
    description:
      "Your AI-powered meal planning platform tailored to your goals.",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
