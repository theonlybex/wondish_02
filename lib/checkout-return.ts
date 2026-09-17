// The login page's "Confirming your payment…" state (app/(auth)/login).
//
// After Stripe Checkout the browser lands on /billing/success by a cross-site
// navigation. Chromium withholds SameSite=Strict cookies on that hop, Clerk's
// middleware cannot see a session, and our middleware bounces to
// /login?redirect_url=/billing/success?session_id=… . clerk-js then loads on
// /login, finds the session client-side, and sends the user on — but for a
// moment the user who has just paid is looking at a sign-in form, which reads
// as a failed payment. On a development instance (pk_test_, http://localhost)
// this is certain (reason dev-browser-missing); on production the handshake
// most likely resolves before /login is reached, in which case this state is
// simply never shown.
//
// This is presentation only: /login stays public, nothing here authenticates
// anyone, and no account data is rendered. If Clerk finishes loading and the
// visitor is NOT signed in, the page shows the ordinary sign-in form.

/**
 * The same-origin /billing/success path the sign-in page should return to,
 * or null when this is an ordinary sign-in. Only the redirect_url query
 * param is consulted; it must be a relative path under /billing/success
 * (a "//host" or "/\host" value would resolve to a foreign origin).
 */
export function checkoutReturnPath(search: string): string | null {
  let target: string | null;
  try {
    target = new URLSearchParams(search).get("redirect_url");
  } catch {
    return null;
  }
  if (!target) return null;
  if (!target.startsWith("/") || target.startsWith("//") || target.startsWith("/\\")) return null;
  if (!(target === "/billing/success" || target.startsWith("/billing/success?") || target.startsWith("/billing/success/"))) return null;
  return target;
}
