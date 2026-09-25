import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// ── No paywall. Allowances, decided 2026-09-25 ───────────────────────────────
//
// The product rule, in the user's words: never show a user blocked screens the
// way it used to, and never push them to buy by blocking. Instead push softly —
// lock a FEATURE once its allowance runs out, and offer Plus at that moment.
//
// That is a shape the code can hold rather than a note in a doc, and it has two
// halves:
//
//   1. Nothing wraps the dashboard's children in a gate. A screen-level guard is
//      how the old paywall worked, and restoring one would be a single JSX edit
//      in app/(dashboard)/layout.tsx — so this test watches that file.
//   2. Every feature metered by guardAiSpend refuses with the upgrade offer.
//      The refusal is the ONLY moment the app can mention Plus, because it never
//      blocks a screen; a surface that renders the sentence without the link
//      turns a soft push into a dead end. /pantry's cook-my-day did exactly that
//      until 2026-09-25 — "You've used your 1 cook-my-day plan for today" with
//      nothing to click.
//
// What this does NOT prove: that the link is visible, that /pricing converts, or
// that the allowances are the right numbers. It makes the two ways this rule
// gets broken silently impossible to land.

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LAYOUT = join(REPO_ROOT, "app", "(dashboard)", "layout.tsx");

/** Components whose whole job is to gate a screen. None may wrap `children`. */
const SCREEN_GATES = ["PremiumGuard", "Paywall", "UpgradeWall", "SubscriptionGate", "PremiumGate"];

function parse(path: string): ts.SourceFile {
  const src = readFileSync(path, "utf8");
  return ts.createSourceFile(path, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function walk(node: ts.Node, fn: (n: ts.Node) => void): void {
  fn(node);
  ts.forEachChild(node, (c) => walk(c, fn));
}

function collect<T extends ts.Node>(root: ts.Node, pred: (n: ts.Node) => n is T): T[] {
  const out: T[] = [];
  walk(root, (n) => {
    if (pred(n)) out.push(n);
  });
  return out;
}

test("the dashboard renders its children ungated — no screen-level paywall", () => {
  const sf = parse(LAYOUT);
  const rel = relative(REPO_ROOT, LAYOUT);

  // Any JSX element in the live tree whose tag is a known screen gate. Comments
  // are not part of the AST, so the parked restore instructions in that file are
  // invisible here — which is the point: a comment cannot block a screen, and an
  // element can.
  const gates = collect(sf, (n): n is ts.JsxOpeningElement | ts.JsxSelfClosingElement =>
    (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && SCREEN_GATES.includes(n.tagName.getText())
  );
  assert.deepEqual(
    gates.map((g) => {
      const { line } = sf.getLineAndCharacterOfPosition(g.getStart(sf));
      return `${rel}:${line + 1}  <${g.tagName.getText()}>`;
    }),
    [],
    "A screen-level gate is rendered in the dashboard layout.\n\n" +
      "Wondish has no paywall by decision (2026-09-25): signing in gets you the whole app, and " +
      "free users meet a per-feature allowance instead (lib/ai-budget.ts). Locking whole screens " +
      "is the behaviour that was removed. If this is deliberate, that decision has changed — say " +
      "so out loud and update this test in the same commit."
  );

  // …and `children` is rendered directly, not behind a conditional that could
  // swap in a gate later.
  const rendersChildren = collect(sf, ts.isJsxExpression).some(
    (e) => e.expression !== undefined && ts.isIdentifier(e.expression) && e.expression.text === "children"
  );
  assert.ok(rendersChildren, `${rel} must render {children} directly inside <main>`);
});

test("PremiumGuard is not imported anywhere — the screen wall has no callers", () => {
  const guard = join(REPO_ROOT, "components", "PremiumGuard.tsx");
  if (!existsSync(guard)) return; // deleted entirely; nothing to check
  // The component may still exist as parked code (a prior decision kept the
  // premium-gate code commented rather than deleted). What must not exist is a
  // live import of it.
  for (const file of [LAYOUT]) {
    const sf = parse(file);
    const imports = collect(sf, ts.isImportDeclaration).filter((d) =>
      d.moduleSpecifier.getText().includes("PremiumGuard")
    );
    assert.deepEqual(
      imports.map((i) => `${relative(REPO_ROOT, file)}: ${i.getText()}`),
      [],
      "PremiumGuard is imported again. See the test above: screens are never blocked."
    );
  }
});

// ── Every metered feature offers the upgrade ─────────────────────────────────
//
// Keyed on the surfaces, not on a grep for "upgrade": a file that mentions the
// word in a comment would pass a grep and still leave the user stuck.
const METERED_SURFACES: { file: string; why: string }[] = [
  { file: "components/meal-plan/DailyMealPlanView.tsx", why: "new weeks, plan setup, day rebuilds" },
  { file: "components/meal-plan/SwapMealModal.tsx", why: "dish swaps" },
  { file: "components/dish-checker/DishCheckerClient.tsx", why: "Clara chat and the dish checker" },
  { file: "components/pantry/PantryClient.tsx", why: "cook-my-day" },
];

test("every surface that spends an allowance offers Plus when it runs out", () => {
  const missing: string[] = [];
  for (const { file, why } of METERED_SURFACES) {
    const path = join(REPO_ROOT, file);
    assert.ok(existsSync(path), `${file} is gone — update METERED_SURFACES in this test`);
    const sf = parse(path);

    // Either the shared component, or an own link to /pricing. Both are real
    // answers; what is refused is neither.
    const usesShared = collect(sf, (n): n is ts.JsxOpeningElement | ts.JsxSelfClosingElement =>
      (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && n.tagName.getText() === "QuotaError"
    ).length > 0;

    const ownLink = collect(sf, (n): n is ts.JsxOpeningElement | ts.JsxSelfClosingElement =>
      ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)
    ).some((el) => {
      if (!["a", "Link"].includes(el.tagName.getText())) return false;
      return el.attributes.properties.filter(ts.isJsxAttribute).some((a) => {
        const name = ts.isIdentifier(a.name) ? a.name.text : a.name.getText();
        if (name !== "href") return false;
        const init = a.initializer;
        if (init && ts.isStringLiteral(init)) return init.text === "/pricing";
        if (init && ts.isJsxExpression(init) && init.expression && ts.isStringLiteralLike(init.expression)) {
          return init.expression.text === "/pricing";
        }
        return false;
      });
    });

    // And the flag must come from the response, not be assumed: lib/ai-budget.ts
    // sets upgrade:true only when a paid tier would actually grant more, so a
    // beta tester at the premium ceiling is never shown a pointless upsell.
    const readsFlag = collect(sf, ts.isPropertyAccessExpression).some((p) => p.name.text === "upgrade");

    if (!usesShared && !ownLink) {
      missing.push(`  ${file} (${why}) — spends an allowance and offers no way to get more`);
    } else if (!readsFlag) {
      missing.push(`  ${file} (${why}) — offers an upgrade without reading the response's \`upgrade\` flag`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `Metered features whose refusal is a dead end:\n${missing.join("\n")}\n\n` +
      "The app never blocks a screen, so a spent allowance is the only moment it can mention Plus. " +
      "Render <QuotaError message={…} upgrade={…} /> (components/ui/QuotaError.tsx)."
  );
});
