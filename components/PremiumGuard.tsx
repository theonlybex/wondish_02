"use client";

import { usePathname } from "next/navigation";
import PremiumGate from "./PremiumGate";

// Routes free users can access without a subscription
const FREE_ROUTES = ["/profile", "/prediction", "/membership"];

interface PremiumGuardProps {
  children: React.ReactNode;
  isPremium: boolean;
  isAdmin: boolean;
}

export default function PremiumGuard({ children, isPremium, isAdmin }: PremiumGuardProps) {
  const pathname = usePathname();
  const isFreeRoute = FREE_ROUTES.some((r) => pathname.startsWith(r));

  if (!isAdmin && !isPremium && !isFreeRoute) {
    return <PremiumGate />;
  }

  return <>{children}</>;
}
