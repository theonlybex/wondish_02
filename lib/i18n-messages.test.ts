import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The three locale catalogs must carry the same keys. next-intl does not
// crash on a missing key — it logs and renders the key path ("dashboardHeader.
// betaBadge") in the UI — which is exactly how a badge added only to en.json
// would ship broken to a Spanish or Russian tester without anyone noticing.

const MESSAGES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "messages");
const LOCALES = ["en", "es", "ru"] as const;

type Catalog = Record<string, unknown>;

function load(locale: string): Catalog {
  return JSON.parse(readFileSync(join(MESSAGES_DIR, `${locale}.json`), "utf8")) as Catalog;
}

function flatten(obj: Catalog, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const [ck, cv] of flatten(v as Catalog, key)) out.set(ck, cv);
    } else {
      out.set(key, String(v));
    }
  }
  return out;
}

const catalogs = Object.fromEntries(LOCALES.map((l) => [l, flatten(load(l))])) as Record<(typeof LOCALES)[number], Map<string, string>>;

test("es and ru carry exactly the keys en does", () => {
  const en = [...catalogs.en.keys()].sort();
  for (const locale of ["es", "ru"] as const) {
    const other = [...catalogs[locale].keys()].sort();
    const missing = en.filter((k) => !catalogs[locale].has(k));
    const extra = other.filter((k) => !catalogs.en.has(k));
    assert.deepEqual(missing, [], `${locale}.json is missing keys present in en.json`);
    assert.deepEqual(extra, [], `${locale}.json has keys en.json does not`);
  }
});

test("the header has a badge for every plan the layout can produce (ADMIN / PREMIUM→Plus / BETA / FREE)", () => {
  for (const locale of LOCALES) {
    const c = catalogs[locale];
    for (const key of ["dashboardHeader.adminBadge", "dashboardHeader.premiumBadge", "dashboardHeader.betaBadge", "dashboardHeader.upgrade"]) {
      assert.ok(c.get(key)?.trim(), `${locale}: ${key} is missing or empty`);
    }
    // Beta must read as its own tier: not the paid badge, not the free one.
    assert.notEqual(c.get("dashboardHeader.betaBadge"), c.get("dashboardHeader.premiumBadge"), locale);
    assert.notEqual(c.get("dashboardHeader.betaBadge"), c.get("dashboardHeader.upgrade"), locale);
    assert.match(c.get("dashboardHeader.betaBadge")!, /beta|бета/i, `${locale}: the beta badge must say "beta"`);
  }
});

test("the paid tier is called Plus on screen, never Premium (the code's internal name)", () => {
  // Keys may keep the legacy name (premiumBadge, premiumF1…): they are not
  // user-visible. Values are. "premium support" in the included-food blurb is
  // the ordinary adjective, not the tier, and is the one allowed exception.
  const ALLOWED = new Set(["includedFood.body"]);
  for (const locale of LOCALES) {
    const offenders = [...catalogs[locale]]
      .filter(([k, v]) => !ALLOWED.has(k) && /premium|премиум/i.test(v))
      .map(([k, v]) => `${k} = ${JSON.stringify(v)}`);
    assert.deepEqual(offenders, [], `${locale}.json still shows "Premium" to users`);
    assert.match(catalogs[locale].get("dashboardHeader.premiumBadge")!, /Plus/, `${locale}: the paid badge must say Plus`);
    assert.match(catalogs[locale].get("pricing.premiumName")!, /Plus/, `${locale}: the pricing card must say Plus`);
  }
});

test("a coupon redemption is announced as beta access, not the paid product", () => {
  for (const locale of LOCALES) {
    for (const key of ["dashboardHeader.premiumActivatedUntil", "dashboardHeader.premiumActivated"]) {
      const v = catalogs[locale].get(key)!;
      assert.match(v, /beta|бета/i, `${locale}: ${key} = ${JSON.stringify(v)}`);
      assert.doesNotMatch(v, /plus/i, `${locale}: ${key} must not promise Plus`);
    }
  }
});
