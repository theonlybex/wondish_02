// fetch() for same-origin API calls from client components, with ONE retry
// after a 401: Clerk session tokens are short-lived (~60s) and refreshed in
// the background, so a request fired right after a long idle/generation
// wait can carry a just-expired token. Refreshing via Clerk's client
// (getToken with skipCache) rotates the session cookie, then we retry once.
// Anything else — a real 401, a second 401 — is returned untouched.
type ClerkGlobal = { Clerk?: { session?: { getToken?: (o?: { skipCache?: boolean }) => Promise<string | null> } | null } };

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status !== 401 || typeof window === "undefined") return res;
  try {
    const clerk = (window as unknown as ClerkGlobal).Clerk;
    if (!clerk?.session?.getToken) return res;
    const token = await clerk.session.getToken({ skipCache: true });
    if (!token) return res;
  } catch {
    return res;
  }
  return fetch(input, init);
}
