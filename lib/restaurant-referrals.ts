// Phase 3 — pure rules behind QR attribution and the ops reporting screen
// (docs/restaurants/phase-3.md §5). Kept out of routes and JSX so the numbers
// ops judges the pilot on are unit-tested.

export type ReferralFunnelState = "signed_up" | "profile_complete";

/// Derived, never stored: a stored copy would drift from the account.
export function referralFunnelState(account: { onboardingComplete: boolean }): ReferralFunnelState {
  return account.onboardingComplete ? "profile_complete" : "signed_up";
}

/// null means "no data" — a code nobody has scanned has no conversion rate,
/// and rendering 0% for it would read as a code that is failing.
export function conversionRate(scans: number, signups: number): number | null {
  if (!Number.isFinite(scans) || !Number.isFinite(signups)) return null;
  if (scans <= 0) return null;
  if (signups <= 0) return 0;
  // Counters are bumped by separate paths (scan on /r/[token], signup on
  // claim); a lost scan must not surface as an impossible >100% rate.
  return Math.min(signups / scans, 1);
}

export function formatConversionRate(rate: number | null): string {
  if (rate === null) return "—";
  return `${Math.round(rate * 100)}%`;
}

export const QR_TOKEN_LENGTH = 12;

const TOKEN_RE = /^[A-Za-z0-9]+$/;

/// The token arrives from a URL under a stranger's control. Validate shape
/// before it reaches a query.
export function isValidQrToken(raw: unknown): raw is string {
  return typeof raw === "string" && raw.length === QR_TOKEN_LENGTH && TOKEN_RE.test(raw);
}
