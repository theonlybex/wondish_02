"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import "./globals.css";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Last-resort boundary: the root layout itself failed.
    Sentry.captureException(error);
    console.error("Global error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main className="min-h-screen flex flex-col items-center justify-center bg-surface px-6 text-center font-sans">
          <h1 className="text-2xl font-bold text-forest-deeper">
            Something went wrong
          </h1>
          <p className="mt-2 max-w-md text-sm text-forest/70">
            An unexpected error occurred. Please try again — if it keeps
            happening, refresh the page or come back in a moment.
          </p>
          {error.digest && (
            <p className="mt-2 text-xs text-forest/40">Error ID: {error.digest}</p>
          )}
          <button
            onClick={() => reset()}
            className="mt-8 bg-primary hover:bg-primary-dark text-white px-6 py-2.5 rounded-full transition-all duration-150 text-sm font-semibold shadow-lg shadow-primary/20"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
