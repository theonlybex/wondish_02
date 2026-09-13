"use client";

import { useEffect } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";

export default function SectionError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
    console.error("Page error:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center px-6">
      <h1 className="text-xl font-bold text-navy">Something went wrong</h1>
      <p className="mt-2 max-w-md text-sm text-[#848181]">
        We hit an unexpected error loading this page. You can retry or head back home.
      </p>
      {error.digest && <p className="mt-2 text-xs text-[#ABA6A6]">Error ID: {error.digest}</p>}
      <div className="mt-8 flex items-center gap-3">
        <button
          onClick={() => reset()}
          className="bg-primary hover:bg-primary-dark text-white px-6 py-2.5 rounded-full text-sm font-semibold"
        >
          Try again
        </button>
        <Link href="/" className="px-6 py-2.5 rounded-full text-sm font-semibold text-[#848181] hover:text-navy">
          Back home
        </Link>
      </div>
    </div>
  );
}
