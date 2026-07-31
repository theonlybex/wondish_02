/**
 * Retention for the Clara capability-gap ledger.
 *
 * Spec §5.1 commits to 180 days. That commitment was documented in the schema
 * and nowhere else until this file existed — a stated policy rather than an
 * enforced one. Gap summaries are model-written text derived from users'
 * health and dietary questions, which is exactly the category that should not
 * accumulate indefinitely.
 */

export const GAP_RETENTION_DAYS = 180;

/** The cutoff instant: rows created strictly before this are past retention. */
export function gapRetentionCutoff(now: Date, days: number = GAP_RETENTION_DAYS): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

/**
 * Constant-time-ish bearer check for the cron endpoint. Returns false when the
 * secret is unset so an unconfigured deploy refuses to run rather than exposing
 * an unauthenticated delete.
 */
export function isAuthorizedCron(authorizationHeader: string | null, secret: string | undefined) {
  if (!secret) return false;
  return authorizationHeader === `Bearer ${secret}`;
}
