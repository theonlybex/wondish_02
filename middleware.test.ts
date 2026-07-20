import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "./middleware";

// The default export (the middleware handler) is intentionally NOT tested:
// it is created by clerkMiddleware() and requires a live Clerk auth context
// and NextRequest machinery to exercise. The exported `config` matcher,
// however, is plain data whose regex decides which requests get auth
// middleware at all — a silent mistake there either strips auth from API
// routes or runs Clerk on every static asset.

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
