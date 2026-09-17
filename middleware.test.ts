import { test } from "node:test";
import assert from "node:assert/strict";
import { config, loginRedirectUrl, wantsJson401 } from "./middleware";

// The default export (the middleware handler) is intentionally NOT tested:
// it is created by clerkMiddleware() and requires a live Clerk auth context
// and NextRequest machinery to exercise. The exported `config` matcher,
// however, is plain data whose regex decides which requests get auth
// middleware at all — a silent mistake there either strips auth from API
// routes or runs Clerk on every static asset. `wantsJson401` is the pure
// decision the handler delegates to for choosing a JSON 401 vs. an HTML
// redirect on the unauthenticated path, and IS unit-tested directly below.

test("config.matcher covers app pages and api/trpc routes", () => {
  assert.ok(Array.isArray(config.matcher));
  assert.equal(config.matcher.length, 2);
  // Second entry guarantees ALL /api and /trpc routes pass through auth
  // middleware regardless of the asset-exclusion rules in the first entry.
  assert.equal(config.matcher[1], "/(api|trpc)(.*)");
});

// The first matcher entry is a path-to-regexp pattern of the form
// "/(<regex>)". Next.js anchors the inner regex against the pathname after
// the leading slash; we approximate that compilation here ("^(?:<regex>)$"
// against the path without its leading "/") to pin the exclusion behavior.
function matcherRegex(): RegExp {
  const pattern = config.matcher[0] as string;
  assert.ok(pattern.startsWith("/(") && pattern.endsWith(")"),
    "matcher[0] must stay in '/(<regex>)' form for this test to be valid");
  return new RegExp(`^(?:${pattern.slice(2, -1)})$`);
}

test("matcher runs middleware on normal app pages", () => {
  const re = matcherRegex();
  for (const path of ["", "overview", "meal-plan", "login", "pricing", "dishes/pasta", "journal/2026-06-30"]) {
    assert.ok(re.test(path), `expected middleware to run on "/${path}"`);
  }
});

test("matcher skips _next internals and static assets", () => {
  const re = matcherRegex();
  const excluded = [
    "_next/static/chunks/main.js",
    "_next/image",
    "logo.png",
    "img/photo.jpg",
    "img/photo.jpeg",
    "img/photo.webp",
    "img/anim.gif",
    "icons/menu.svg",
    "styles/app.css",
    "js/app.js",
    "fonts/inter.woff",
    "fonts/inter.woff2",
    "fonts/inter.ttf",
    "favicon.ico",
    "index.html",
    "index.htm",
    "export/data.csv",
    "docs/guide.doc",
    "docs/guide.docx",
    "sheets/report.xls",
    "sheets/report.xlsx",
    "downloads/bundle.zip",
    "manifest.webmanifest",
  ];
  for (const path of excluded) {
    assert.equal(re.test(path), false, `expected middleware to SKIP "/${path}"`);
  }
});

test("the js(?!on) lookahead keeps .json paths under middleware", () => {
  const re = matcherRegex();
  // ".js" is excluded but ".json" must NOT be — JSON routes/data still need auth.
  assert.equal(re.test("app.js"), false);
  assert.ok(re.test("app.json"));
  assert.ok(re.test("api/data.json"));
});

test("_next is only excluded at the start of the path, anchored to a path segment", () => {
  const re = matcherRegex();
  assert.equal(re.test("_next/data/build/page.json"), false);
  // A page that merely contains "_next" deeper in the path is still covered.
  assert.ok(re.test("docs/_next-steps"));
  assert.ok(re.test("next-steps"));
  // A top-level path merely PREFIXED with "_next" (not followed by "/" or
  // end-of-path) is a real page route and must still hit auth middleware.
  assert.ok(re.test("_next-steps"));
});

test("extension exclusion only applies at the end of the path", () => {
  const re = matcherRegex();
  // A path that genuinely ENDS with an asset extension is treated as a
  // static asset by design.
  assert.equal(re.test("blog/why-node.js"), false);
  // Extension exclusion must not match mid-path: these are page routes with
  // an excluded-looking extension segment followed by more path, not actual
  // static assets, so they must still hit auth middleware.
  assert.ok(re.test("some.js/route"));
  assert.ok(re.test("release-v1.zip/notes"));
});

test("extension matching is case-sensitive: uppercase assets still hit middleware", () => {
  const re = matcherRegex();
  // The alternation has no /i flag, so "/logo.PNG" runs Clerk middleware.
  // Harmless (extra latency on oddly-cased assets, not an auth gap) but
  // pinned so adding case-insensitivity is a visible change.
  assert.ok(re.test("logo.PNG"));
  assert.ok(re.test("fonts/Inter.WOFF2"));
});

test("extension near-misses: prefix extensions and truncations are both covered", () => {
  const re = matcherRegex();
  // The extension alternation is anchored to end-of-path, so an extension
  // that merely STARTS with an excluded one is a distinct extension and
  // must still hit auth middleware — ".jsx" (not just "js(?!on)") and
  // ".csvx" (not just "csv").
  assert.ok(re.test("app.jsx"));
  assert.ok(re.test("data.csvx"));
  // A truncation of an excluded extension is NOT excluded: middleware runs.
  assert.ok(re.test("file.pn")); // prefix of "png", matches no alternative
  assert.ok(re.test("archive.zi")); // prefix of "zip"
});

// ── wantsJson401 ────────────────────────────────────────────────────────────
// Unauthenticated requests to /api/* must get a JSON 401 instead of the
// 307-to-/login redirect (iOS Bearer clients can't act on an HTML redirect).
// Page requests keep redirecting to /login.

test("api paths want a JSON 401", () => {
  assert.equal(wantsJson401("/api/meal-log"), true);
  assert.equal(wantsJson401("/api/journal"), true);
  assert.equal(wantsJson401("/api"), true);
  assert.equal(wantsJson401("/api/"), true);
});

test("page paths do not want a JSON 401 (they redirect instead)", () => {
  assert.equal(wantsJson401("/overview"), false);
  assert.equal(wantsJson401("/journal/2026-06-30"), false);
  assert.equal(wantsJson401("/"), false);
});

test("path segments that merely start with 'api' are not /api routes", () => {
  // Anchored to a real path segment — "/apiary" is a page, not API surface.
  assert.equal(wantsJson401("/apiary"), false);
  assert.equal(wantsJson401("/api-docs"), false);
});

// ── loginRedirectUrl ────────────────────────────────────────────────────────
// The unauthenticated-page redirect must carry the request's own path + query
// as `redirect_url` so Clerk's <SignIn> returns the user there — the Stripe
// Checkout return (/billing/success?session_id=…) previously bounced to a
// bare /login and the user landed on /overview with no confirmation.

const ORIGIN = "http://localhost:3000";

function loginFor(path: string): URL {
  const u = new URL(path, ORIGIN);
  return loginRedirectUrl(u.href, { pathname: u.pathname, search: u.search });
}

test("preserves the destination path and query string as redirect_url", () => {
  const out = loginFor("/billing/success?session_id=cs_test_123&x=1");
  assert.equal(out.origin, ORIGIN);
  assert.equal(out.pathname, "/login");
  assert.equal(out.searchParams.get("redirect_url"), "/billing/success?session_id=cs_test_123&x=1");
  // Exactly the shape the Stripe success_url produces (lib/stripe.ts).
  assert.equal(out.href, `${ORIGIN}/login?redirect_url=%2Fbilling%2Fsuccess%3Fsession_id%3Dcs_test_123%26x%3D1`);
});

test("a destination without a query string gets a bare path", () => {
  assert.equal(loginFor("/meal-plan").searchParams.get("redirect_url"), "/meal-plan");
});

test("redirect_url is relative and always resolves to the request's own origin", () => {
  for (const path of [
    "/overview",
    "/billing/success?session_id=cs_test_123",
    // A crafted INBOUND redirect_url is just part of the preserved query —
    // nested inside a same-origin path, never reflected out on its own.
    "/overview?redirect_url=https://evil.example/",
    "/overview?redirect_url=%2F%2Fevil.example%2F",
    "/journal/2026-06-30?next=//evil.example",
  ]) {
    const value = loginFor(path).searchParams.get("redirect_url");
    assert.ok(value && value.startsWith("/"), `expected a path-relative value for ${path}, got ${value}`);
    assert.equal(new URL(value, ORIGIN).origin, ORIGIN, `resolved off-origin for ${path}`);
    // The foreign host only ever appears encoded inside the query, never as
    // the host of the resolved target.
    assert.equal(new URL(value, ORIGIN).hostname, "localhost");
  }
});

test("a pathname that would resolve to a foreign host is dropped, not reflected", () => {
  // Next normalises "//host" and "/\host" with a 308 before middleware runs,
  // but the guard must not depend on that: a protocol-relative or
  // backslash pathname resolves to a foreign origin under WHATWG URL rules.
  for (const pathname of ["//evil.example/x", "/\\evil.example/x", "//evil.example"]) {
    const out = loginRedirectUrl(`${ORIGIN}/`, { pathname, search: "?session_id=1" });
    assert.equal(out.origin, ORIGIN);
    assert.equal(out.pathname, "/login");
    assert.equal(out.searchParams.get("redirect_url"), null, `must not emit redirect_url for ${pathname}`);
  }
});

test("the login URL itself is built on the request origin only", () => {
  const out = loginRedirectUrl("https://app.wondish.io/overview?a=1", { pathname: "/overview", search: "?a=1" });
  assert.equal(out.origin, "https://app.wondish.io");
  assert.equal(out.pathname, "/login");
  assert.equal(out.searchParams.get("redirect_url"), "/overview?a=1");
});

test("API/XHR callers stay on the JSON 401 branch: no login redirect is built for them", () => {
  // The handler checks wantsJson401 BEFORE building the login redirect; pin
  // that ordering by asserting the classification for the routes iOS uses.
  for (const p of ["/api/meal-log", "/api/billing/checkout", "/api/journal"]) {
    assert.equal(wantsJson401(p), true, `${p} must get a JSON 401, never a 307`);
  }
});
