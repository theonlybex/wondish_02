// Post-build guard: fail the build if the minifier has mangled a regex escape.
//
// On 2026-09-26 the first production build of this app 500'd /api/pantry/
// cookable and /api/pantry/to-buy: SWC inlined template-literal constants and
// re-escaped "\\b" as "\\\b" — backslash + BACKSPACE — which is an invalid
// escape under the RegExp "u" flag, so the matchers threw at runtime. The dev
// server is not minified and never showed it. This scans the compiled server
// and client code for that sequence so a deploy fails loudly instead.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = [".next/server", ".next/static/chunks"];
const bad = [];
const walk = (dir) => {
  let entries = [];
  try { entries = readdirSync(dir); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".js")) {
      const src = readFileSync(p, "utf8");
      // A template literal holding \\\b: two escaped backslashes' worth of
      // literal backslash followed by the \b (backspace) escape.
      const i = src.indexOf("\\\\\\b");
      if (i !== -1) bad.push(`${p}: …${src.slice(Math.max(0, i - 60), i + 20)}…`);
    }
  }
};
roots.forEach(walk);
if (bad.length) {
  console.error(`check-build: ${bad.length} file(s) carry a minifier-mangled regex escape (\\\\\\b):\n` + bad.join("\n"));
  process.exit(1);
}
console.log("check-build: no mangled regex escapes");
