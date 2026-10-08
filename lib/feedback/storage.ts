// Why a screenshot was not stored. Local dev has no AWS credentials (expected,
// quiet); anything else is a real outage and is logged (deferred minor).
export function screenshotFailure(err: unknown): { note: string; log: boolean } {
  const msg = err instanceof Error ? err.message : String(err);
  if (/credentials are not configured/i.test(msg)) return { note: "not stored: storage not configured", log: false };
  return { note: "not stored: upload failed", log: true };
}
