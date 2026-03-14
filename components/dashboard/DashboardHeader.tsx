"use client";

import { useState } from "react";
import Link from "next/link";

interface DashboardHeaderProps {
  email?: string | null;
  name?: string | null;
  plan: string;
  onMenuToggle?: () => void;
}

export default function DashboardHeader({
  email,
  name,
  plan,
  onMenuToggle,
}: DashboardHeaderProps) {
  return (
    <header className="h-16 bg-white border-b border-[#E8E7EA] flex items-center justify-between px-5 sm:px-8">
      {/* Mobile hamburger */}
      <button
        className="lg:hidden flex flex-col gap-1.5 p-1"
        onClick={onMenuToggle}
        aria-label="Toggle menu"
      >
        <span className="w-5 h-0.5 bg-[#25293C] block" />
        <span className="w-5 h-0.5 bg-[#25293C] block" />
        <span className="w-5 h-0.5 bg-[#25293C] block" />
      </button>

      <div className="flex-1" />

      {/* Right side */}
      <div className="flex items-center gap-3">
        <span className="text-[#8A8D93] text-sm hidden sm:block">{email}</span>
        <span
          className={`text-xs font-bold px-2.5 py-1 rounded-full ${
            plan === "PREMIUM"
              ? "bg-primary/10 text-primary"
              : "bg-[#F3F2FF] text-[#8A8D93]"
          }`}
        >
          {plan === "PREMIUM" ? "Premium" : "Free"}
        </span>
        <Link
          href="/profile"
          className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-semibold text-sm"
        >
          {name?.charAt(0).toUpperCase() ?? "?"}
        </Link>
      </div>
    </header>
  );
}
