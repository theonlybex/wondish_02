import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";

// Last-resort JSON 500 for route handlers. A bare `throw err` at the end of
// a handler produces a Next.js HTML error page: the web client falls back
// to a generic string, the iOS client throws on JSON parse. Always answer
// JSON, always log, always report.
export function internalError(
  tag: string,
  err: unknown,
  message = "Something went wrong — please try again."
): NextResponse {
  console.error(`[${tag}]`, err);
  Sentry.captureException(err, { tags: { route: tag } });
  return NextResponse.json({ error: message }, { status: 500 });
}
