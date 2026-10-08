// Where "Save Profile" takes the user: back to the page they opened the
// profile from (same-origin, not the profile itself, not a sign-in or
// onboarding page), otherwise Overview. Saving used to leave them on the
// profile with a banner (QA 2026-10-07: "saving should close the profile").
const NOT_A_RETURN = /^\/(profile|login|sign-in|sign-up|signup|onboarding|prediction)(\/|$|\?)/;

// `previous` is a same-app path ("/meal-plan") or a full URL. In-app
// navigation does not update document.referrer, so the dashboard records the
// last page in sessionStorage (LAST_PAGE_KEY) and the form passes that.
export const LAST_PAGE_KEY = "wondish:last-page";

export function profileExitPath(previous: string | null | undefined, origin: string): string {
  if (!previous) return "/overview";
  let url: URL;
  try {
    url = new URL(previous, origin);
  } catch {
    return "/overview";
  }
  if (url.origin !== origin) return "/overview";
  const path = url.pathname + url.search;
  if (path === "/" || NOT_A_RETURN.test(url.pathname)) return "/overview";
  return path;
}
