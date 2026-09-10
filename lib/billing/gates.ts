// Free-mode switch. Every premium gate asks this instead of being commented
// out, so turning billing on is a config change (PREMIUM_GATES=on), not a
// ten-file edit. Default OFF: a missing var never locks users out.
export function premiumGatesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.PREMIUM_GATES === "on";
}
