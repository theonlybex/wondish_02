"use client";

import { useEffect } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
    console.error("Dashboard error:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <h1 className="text-xl font-bold text-forest-deeper">
        Something went wrong
      </h1>
      <p className="mt-2 max-w-md text-sm text-forest/70">
        We hit an unexpected error loading this page. You can retry or head back
        to your dashboard.
      </p>
      {error.digest && (
        <p className="mt-2 text-xs text-forest/40">Error ID: {error.digest}</p>
      )}
      <div className="mt-8 flex items-center gap-3">
        <button
          onClick={() => reset()}
          className="bg-primary hover:bg-primary-dark text-forest-deeper px-6 py-2.5 rounded-full transition-all duration-150 text-sm font-semibold shadow-lg shadow-primary/20"
        >
          Try again
        </button>
        <Link
          href="/overview"
          className="px-6 py-2.5 rounded-full text-sm font-semibold text-forest/70 hover:text-forest-deeper transition-colors"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
