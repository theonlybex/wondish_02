import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// ── Render-site invariant for the new-week quota error ───────────────────────
//
// The bug (2026-09-17): the new-week 429 body says `upgrade: true`, the
// component stored it in `newWeekUpgrade`, and two of the three places that
// rendered `newWeekError` dropped it — the user saw "Premium gives you 5 a
// week" with nothing to click. The fix routes every surface through one
// `NewWeekError` component that owns the link.
//
// This repo has no component-testing stack (no RTL, no jsdom), so this test
// holds the invariant STRUCTURALLY: it parses the component with the
// TypeScript compiler (already a devDependency) and walks the AST. Being
// AST-based, it survives reformatting, re-indentation, attribute reordering
// and comment changes; it is only sensitive to the names listed below.
//
// What it proves:
//   1. every JSX reference to `newWeekError` is the `message` prop of
//      `<NewWeekError>` — no fourth surface can render the sentence bare;
//   2. every `<NewWeekError>` forwards `upgrade={newWeekUpgrade}` — a site
//      cannot quietly pass `upgrade={false}` or leave it off;
//   3. `NewWeekError` contains an anchor to /pricing whose rendering is
//      conditioned on its `upgrade` prop, and renders `message`;
//   4. `newWeekUpgrade` is set from the response body's `upgrade` field.
//
// What it does NOT prove: that React actually paints the link, that CSS does
// not hide it, that /pricing exists, or that the click goes anywhere. Those
// need a browser (see the QA harness) — this test only makes the 2026-09-17
// class of regression impossible to land silently.

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const COMPONENT = join(REPO_ROOT, "components", "meal-plan", "DailyMealPlanView.tsx");
const REL = relative(REPO_ROOT, COMPONENT);

// The names this test is keyed on. Renaming any of them in the component is
// fine — update these constants in the same change.
const ERROR_STATE = "newWeekError";
const UPGRADE_STATE = "newWeekUpgrade";
const UPGRADE_SETTER = "setNewWeekUpgrade";
const SURFACE = "NewWeekError";
const UPGRADE_HREF = "/pricing";
// Tags accepted for the upgrade link inside NewWeekError.
const LINK_TAGS = new Set(["a", "Link"]);

const FIX = `Render it as <${SURFACE} message={${ERROR_STATE}} upgrade={${UPGRADE_STATE}} className="…" /> — that component owns the "Upgrade for more →" link (see the comment above ${SURFACE} in ${REL}).`;

function parse(): ts.SourceFile {
  const src = readFileSync(COMPONENT, "utf8");
  const sf = ts.createSourceFile(COMPONENT, src, ts.ScriptTarget.Latest, /* setParentNodes */ true, ts.ScriptKind.TSX);
  const diags = (sf as unknown as { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics;
  assert.equal(diags.length, 0, `${REL} does not parse: ${diags.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")).join("; ")}`);
  return sf;
}

function at(sf: ts.SourceFile, node: ts.Node): string {
  const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return `${REL}:${line + 1}:${character + 1}`;
}

function walk(node: ts.Node, fn: (n: ts.Node) => void): void {
  fn(node);
  ts.forEachChild(node, (child) => walk(child, fn));
}

function collect<T extends ts.Node>(root: ts.Node, pred: (n: ts.Node) => n is T): T[] {
  const out: T[] = [];
  walk(root, (n) => {
    if (pred(n)) out.push(n);
  });
  return out;
}

function mentions(node: ts.Node, name: string): boolean {
  let found = false;
  walk(node, (n) => {
    if (ts.isIdentifier(n) && n.text === name) found = true;
  });
  return found;
}

function isOpeningLike(n: ts.Node): n is ts.JsxOpeningElement | ts.JsxSelfClosingElement {
  return ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n);
}

function tagText(el: ts.JsxOpeningElement | ts.JsxSelfClosingElement): string {
  return el.tagName.getText();
}

function attrName(a: ts.JsxAttribute): string {
  return ts.isIdentifier(a.name) ? a.name.text : a.name.getText();
}

/** The identifier an attribute's `{expr}` initializer is, or null if it is anything else. */
function attrIdentifier(a: ts.JsxAttribute): string | null {
  const init = a.initializer;
  if (!init || !ts.isJsxExpression(init) || !init.expression) return null;
  return ts.isIdentifier(init.expression) ? init.expression.text : null;
}

function attrStringValue(a: ts.JsxAttribute): string | null {
  const init = a.initializer;
  if (!init) return null;
  if (ts.isStringLiteral(init)) return init.text;
  if (ts.isJsxExpression(init) && init.expression && ts.isStringLiteralLike(init.expression)) return init.expression.text;
  return null;
}

/** Nearest ancestor satisfying `pred`, stopping at `stopAt` (exclusive). */
function ancestor<T extends ts.Node>(node: ts.Node, pred: (n: ts.Node) => n is T, stopAt?: ts.Node): T | null {
  for (let p: ts.Node | undefined = node.parent; p && p !== stopAt; p = p.parent) if (pred(p)) return p;
  return null;
}

test(`every render of ${ERROR_STATE} goes through <${SURFACE}> (no bare surface can drop the upgrade link)`, () => {
  const sf = parse();
  const refs = collect(sf, (n): n is ts.Identifier => ts.isIdentifier(n) && n.text === ERROR_STATE);

  // The useState destructure is the one non-render reference we expect.
  const declarations = refs.filter((r) => ts.isBindingElement(r.parent));
  assert.equal(
    declarations.length,
    1,
    `expected exactly one declaration of ${ERROR_STATE} (the useState destructure) in ${REL}, found ${declarations.length}. If the state was renamed, update ERROR_STATE in ${relative(REPO_ROOT, fileURLToPath(import.meta.url))}.`
  );

  const offenders: string[] = [];
  let renderSites = 0;
  for (const ref of refs) {
    if (ts.isBindingElement(ref.parent)) continue;
    // Allowed shape: <NewWeekError message={newWeekError} … />
    const attr = ancestor(ref, ts.isJsxAttribute);
    const el = attr ? ancestor(attr, isOpeningLike) : null;
    const isMessageOfSurface =
      attr !== null &&
      el !== null &&
      tagText(el) === SURFACE &&
      attrName(attr) === "message" &&
      attrIdentifier(attr) === ERROR_STATE;
    if (isMessageOfSurface) {
      renderSites++;
      continue;
    }
    // Everything else is refused, deliberately including non-JSX uses such
    // as `const msg = newWeekError` or `if (newWeekError)`: an alias is how a
    // fourth bare surface would slip past an AST check. If you need a genuine
    // non-render use, add it to this test explicitly, in the same change.
    const line = sf.text.split("\n")[sf.getLineAndCharacterOfPosition(ref.getStart(sf)).line].trim();
    offenders.push(`  ${at(sf, ref)}  ${line}`);
  }

  assert.deepEqual(
    offenders,
    [],
    `${ERROR_STATE} is used outside <${SURFACE} message={${ERROR_STATE}}> at:\n${offenders.join("\n")}\n\n` +
      `The new-week 429 body carries an upgrade hint that must appear wherever the message does. ${FIX}`
  );
  assert.ok(renderSites >= 1, `no <${SURFACE} message={${ERROR_STATE}}> render site found in ${REL} — the error is no longer shown anywhere, or the names in this test are stale.`);
});

test(`every <${SURFACE}> forwards upgrade={${UPGRADE_STATE}} (a site cannot silently pass false or omit it)`, () => {
  const sf = parse();
  const sites = collect(sf, isOpeningLike).filter((el) => tagText(el) === SURFACE);
  assert.ok(sites.length >= 1, `no <${SURFACE}> in ${REL}`);

  const problems: string[] = [];
  for (const el of sites) {
    const props = el.attributes.properties;
    if (props.some(ts.isJsxSpreadAttribute)) {
      problems.push(`  ${at(sf, el)}  uses {...spread} — pass message and upgrade explicitly so this test can see them`);
      continue;
    }
    const attrs = props.filter(ts.isJsxAttribute);
    const message = attrs.find((a) => attrName(a) === "message");
    const upgrade = attrs.find((a) => attrName(a) === "upgrade");
    if (!message || attrIdentifier(message) !== ERROR_STATE) {
      problems.push(`  ${at(sf, el)}  message must be exactly {${ERROR_STATE}}, got ${message ? message.getText() : "nothing"}`);
    }
    if (!upgrade || attrIdentifier(upgrade) !== UPGRADE_STATE) {
      problems.push(`  ${at(sf, el)}  upgrade must be exactly {${UPGRADE_STATE}}, got ${upgrade ? upgrade.getText() : "nothing"}`);
    }
  }
  assert.deepEqual(problems, [], `<${SURFACE}> sites that do not forward the quota state verbatim:\n${problems.join("\n")}\n\n${FIX}`);
});

test(`${SURFACE} renders the message and an ${UPGRADE_HREF} link gated on its upgrade prop`, () => {
  const sf = parse();

  // Accept `function NewWeekError(…)` or `const NewWeekError = (…) => …`.
  const fnDecl = collect(sf, ts.isFunctionDeclaration).find((f) => f.name?.text === SURFACE);
  const varDecl = collect(sf, ts.isVariableDeclaration).find(
    (v) => ts.isIdentifier(v.name) && v.name.text === SURFACE && v.initializer && (ts.isArrowFunction(v.initializer) || ts.isFunctionExpression(v.initializer))
  );
  const fn: ts.Node | undefined = fnDecl ?? varDecl?.initializer;
  assert.ok(fn, `no component named ${SURFACE} found in ${REL} — it must exist and own the upgrade link`);

  // (a) `message` is rendered as JSX content somewhere inside the component.
  const messageRendered = collect(fn, ts.isJsxExpression).some((e) => e.expression && mentions(e.expression, "message"));
  assert.ok(messageRendered, `${SURFACE} never renders its message prop inside JSX (${at(sf, fn)})`);

  // (b) There is a link to UPGRADE_HREF …
  const links = collect(fn, isOpeningLike).filter((el) => {
    if (!LINK_TAGS.has(tagText(el))) return false;
    const href = el.attributes.properties.filter(ts.isJsxAttribute).find((a) => attrName(a) === "href");
    return href !== undefined && attrStringValue(href) === UPGRADE_HREF;
  });
  assert.equal(
    links.length,
    1,
    `${SURFACE} must contain exactly one <a|Link href="${UPGRADE_HREF}"> (found ${links.length}). ` +
      `The upgrade link lives here and nowhere else; if the destination changed, update UPGRADE_HREF in this test and re-check the header's own upgrade link matches.`
  );

  // (c) … and it is only rendered when `upgrade` is truthy: some enclosing
  //     `upgrade && …` or `upgrade ? … : …` (the condition may be any
  //     expression that mentions `upgrade`) between the link and the
  //     component body.
  const link = links[0];
  let gated = false;
  for (let p: ts.Node | undefined = link.parent; p && p !== fn; p = p.parent) {
    if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && mentions(p.left, "upgrade")) {
      gated = true;
      break;
    }
    if (ts.isConditionalExpression(p) && mentions(p.condition, "upgrade")) {
      gated = true;
      break;
    }
  }
  assert.ok(
    gated,
    `the ${UPGRADE_HREF} link at ${at(sf, link)} is not conditioned on the upgrade prop. ` +
      `Wrap it as {upgrade && (…)} or {upgrade ? … : null}: premium users and non-quota errors must not see an upgrade offer.`
  );

  // (d) The link has visible text — an empty anchor would satisfy (b) and (c)
  //     while still giving the user nothing to click.
  const anchorEl = ts.isJsxOpeningElement(link) ? link.parent : null;
  assert.ok(anchorEl && ts.isJsxElement(anchorEl), `the ${UPGRADE_HREF} link at ${at(sf, link)} is self-closing — it needs link text`);
  const text = anchorEl.children.map((c) => c.getText()).join("").trim();
  assert.ok(text.length > 0, `the ${UPGRADE_HREF} link at ${at(sf, link)} has no text`);
});

test(`${UPGRADE_STATE} is fed from the 429 body's upgrade flag`, () => {
  const sf = parse();
  const calls = collect(sf, ts.isCallExpression).filter((c) => ts.isIdentifier(c.expression) && c.expression.text === UPGRADE_SETTER);
  assert.ok(calls.length >= 1, `${UPGRADE_SETTER}(…) is never called in ${REL}`);
  // At least one call derives its value from a `.upgrade` property on the
  // parsed response (`data?.upgrade === true`), so the flag the server sets is
  // the flag the surfaces render. Resetting to false elsewhere is fine.
  const fromBody = calls.some((c) =>
    c.arguments.some((arg) => collect(arg, ts.isPropertyAccessExpression).some((p) => p.name.text === "upgrade"))
  );
  assert.ok(
    fromBody,
    `no ${UPGRADE_SETTER}(…) call reads the response body's \`upgrade\` field. ` +
      `quotaExceededBody() sets upgrade: true exactly when premium would grant more (lib/ai-budget.ts); ` +
      `generateNewWeek must store it: ${UPGRADE_SETTER}(data?.code === "quota" && data?.upgrade === true).`
  );
});
