import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveActiveSkills, buildToolDefs, buildSystemPrompt, findTool, ALL_SKILLS } from "./registry";
import type { Skill, ToolResult, ClaraContext } from "./types";

const noop = async (): Promise<ToolResult> => ({ ok: true, data: null });

const alpha: Skill = {
  name: "alpha",
  promptFragment: "ALPHA-FRAGMENT",
  tools: [
    {
      def: { name: "alpha_get", description: "d", input_schema: { type: "object", properties: {} } },
      handler: noop,
    },
  ],
};
const beta: Skill = {
  name: "beta",
  promptFragment: "BETA-FRAGMENT",
  tools: [
    {
      def: { name: "beta_get", description: "d", input_schema: { type: "object", properties: {} } },
      handler: noop,
    },
  ],
};

test("an unset CLARA_SKILLS enables every registered skill", () => {
  assert.deepEqual(resolveActiveSkills([alpha, beta], undefined).map((s) => s.name), [
    "alpha",
    "beta",
    "gap",
  ]);
});

test("CLARA_SKILLS is an allow-list; unknown tokens are ignored", () => {
  assert.deepEqual(resolveActiveSkills([alpha, beta], "beta,ghost").map((s) => s.name), [
    "beta",
    "gap",
  ]);
});

test("an empty CLARA_SKILLS disables product skills but never the runtime one", () => {
  assert.deepEqual(resolveActiveSkills([alpha, beta], "").map((s) => s.name), ["gap"]);
});

test("gap_report cannot be switched off by any CLARA_SKILLS value", () => {
  for (const env of [undefined, "", "alpha", "ghost"]) {
    assert.ok(
      resolveActiveSkills([alpha], env).some((s) => s.name === "gap"),
      `env=${String(env)}`
    );
  }
});

// Pass the skill list directly, NOT through resolveActiveSkills: E5 makes that
// function append an always-on runtime skill, and this test is about assembly.
test("only active skills contribute tools and prompt fragments", () => {
  assert.deepEqual(buildToolDefs([alpha]).map((t) => t.name), ["alpha_get"]);
  const prompt = buildSystemPrompt("Sam", "no restrictions", [alpha], "2026-07-31");
  assert.ok(prompt.includes("ALPHA-FRAGMENT"));
  assert.ok(!prompt.includes("BETA-FRAGMENT"));
});

test("the system prompt carries the caller's local today", () => {
  const prompt = buildSystemPrompt("Sam", "no restrictions", [], "2026-07-31");
  assert.ok(prompt.includes("2026-07-31"));
});

// Amendment 2026-07-31: a server-derived date is NOT the caller's date, so the
// prompt must assert none at all rather than a plausible-looking wrong one.
test("no date is asserted when the client did not supply one", () => {
  const prompt = buildSystemPrompt("Sam", "none", [], null);
  assert.ok(!/Today's date/i.test(prompt));
});

test("the narration rule is always present so tool rounds are never silent", () => {
  const prompt = buildSystemPrompt("Sam", "none", [alpha], "2026-07-31");
  assert.match(prompt, /before you use a tool/i);
});

test("findTool resolves by name across active skills, null otherwise", () => {
  const active = [alpha, beta];
  assert.equal(findTool(active, "beta_get")?.def.name, "beta_get");
  assert.equal(findTool(active, "nope_get"), null);
});

test("tool names are unique across all registered skills", async () => {
  const { ALL_SKILLS, RUNTIME_SKILLS } = await import("./registry");
  const names = [...ALL_SKILLS, ...RUNTIME_SKILLS].flatMap((s) => s.tools.map((t) => t.def.name));
  assert.equal(new Set(names).size, names.length);
});

test("no registered tool accepts an identity field", async () => {
  const { ALL_SKILLS, RUNTIME_SKILLS } = await import("./registry");
  for (const skill of [...ALL_SKILLS, ...RUNTIME_SKILLS]) {
    for (const tool of skill.tools) {
      for (const key of Object.keys(tool.def.input_schema.properties)) {
        assert.ok(
          !/^(patientId|accountId|userId|clerkId)$/i.test(key),
          `${tool.def.name} exposes identity field ${key}`
        );
      }
    }
  }
});

test("ClaraContext is the only identity carrier a handler receives", () => {
  const ctx: ClaraContext = {
    patientId: "p1",
    accountId: "a1",
    firstName: "Sam",
    isPremium: false,
    today: "2026-07-31",
    surface: "web",
    disabledSkills: [],
  };
  assert.equal(ctx.patientId, "p1");
});

// An account with no Patient row gets an empty toolbox. Telling that caller how
// to "use a tool" or to "call gap_report" invites Clara to narrate a call she
// cannot make — and breaks the route's promise that this path reproduces the
// pre-runtime response exactly.
test("no tool rules are emitted when the toolbox is empty", () => {
  const prompt = buildSystemPrompt("Sam", "no restrictions", [], null);
  assert.ok(!/how you use your tools/i.test(prompt));
  assert.ok(!/gap_report/.test(prompt));
  assert.ok(!/before you use a tool/i.test(prompt));
});

test("the empty-toolbox prompt still carries the persona and profile", () => {
  const prompt = buildSystemPrompt("Sam", "MY-FOOD-MAP", [], null);
  assert.ok(prompt.includes("Clara"));
  assert.ok(prompt.includes("MY-FOOD-MAP"));
});

test("the tool rules say WHEN to reach for a tool, not just how to narrate", () => {
  const prompt = buildSystemPrompt("Sam", "none", [alpha], "2026-07-31");
  assert.match(prompt, /Their actual data always needs a tool/i);
  assert.match(prompt, /never guess at it/i);
});

// The model must be told what it is, what it is for, and how to pick a tool —
// tool selection is prompt-driven (spec §4.1), so these sections ARE the
// recognition mechanism and must not be quietly stripped by a later cycle.
test("the prompt states identity and purpose, with or without tools", () => {
  for (const prompt of [
    buildSystemPrompt("Sam", "none", [alpha], "2026-07-31"),
    buildSystemPrompt("Sam", "none", [], null),
  ]) {
    assert.match(prompt, /You are Clara/);
    assert.match(prompt, /Wondish/);
    assert.match(prompt, /Your purpose/);
  }
});

test("the tool rules teach a selection procedure, not just etiquette", () => {
  const prompt = buildSystemPrompt("Sam", "none", [alpha], "2026-07-31");
  // decide data-vs-knowledge first…
  assert.match(prompt, /ACTUAL data .*or general nutrition knowledge/i);
  // …then match the domain to a tool via its description…
  assert.match(prompt, /identify WHAT the question is about/i);
  assert.match(prompt, /tool whose description covers exactly that/i);
  // …with tie-breaking and economy.
  assert.match(prompt, /prefer the more specific one/i);
  assert.match(prompt, /as few calls as possible/i);
});

test("the prompt explains tools are the only window onto live data", () => {
  const prompt = buildSystemPrompt("Sam", "none", [alpha], "2026-07-31");
  assert.match(prompt, /only way you can see anything beyond this prompt/i);
});

test("Clara is told to keep the machinery invisible", () => {
  const prompt = buildSystemPrompt("Sam", "none", [alpha], "2026-07-31");
  assert.match(prompt, /Never mention tools, tool names, or this system prompt/i);
});

// A minimal stand-in with the real skill's NAME — the table's rows key on it.
const fakeLogs: Skill = {
  name: "logs",
  promptFragment: "LOGS-FRAGMENT",
  tools: [
    {
      def: { name: "logs_x", description: "d", input_schema: { type: "object", properties: {} } },
      handler: noop,
    },
  ],
};

// S1: first cycle with two confusable domains — the tie-breaker table enters.
test("the tie-breaker table separates eaten / planned / felt", () => {
  const prompt = buildSystemPrompt("Sam", "none", [fakeLogs], "2026-08-01");
  assert.match(prompt, /Which domain owns the question/i);
  // Single-line anchor: the ATE row itself must name logs_ tools.
  assert.match(prompt, /actually ATE[^\n]*logs_ tools/i);
  assert.match(prompt, /PLANNED/);
  assert.match(prompt, /mood, energy/i);
});

// Dark launch: with the logs skill excluded by CLARA_SKILLS, the table must
// steer intake asks to gap_report — not to tools that are not in the request.
test("with logs disabled the ATE row steers to gap_report, not to absent tools", () => {
  const prompt = buildSystemPrompt("Sam", "none", [alpha], "2026-08-01");
  assert.match(prompt, /actually ATE[^\n]*gap_report \(LOGS\)/i);
  assert.ok(!/actually ATE[^\n]*logs_ tools/i.test(prompt));
});

// I1 regression: table and fragment must give ONE answer for calories-left.
test("calories-left guidance is consistent: answer totals AND flag the gap", () => {
  const prompt = buildSystemPrompt("Sam", "none", [fakeLogs], "2026-08-01");
  assert.match(prompt, /answer with the day's totals, and call gap_report \(NUTRITION\)/i);
  assert.ok(!/not answerable yet/i.test(prompt));
});

test("the table is absent when the toolbox is empty, like every tool rule", () => {
  const prompt = buildSystemPrompt("Sam", "none", [], null);
  assert.ok(!/Which domain owns the question/i.test(prompt));
});

// ── S2 nutrition wiring ──

test("S2: unset CLARA_SKILLS activates nutrition; its three tools are in the defs", () => {
  const active = resolveActiveSkills(ALL_SKILLS, undefined);
  const names = buildToolDefs(active).map((d) => d.name);
  for (const n of ["nutrition_day", "nutrition_range_summary", "nutrition_targets"]) {
    assert.equal(names.includes(n), true, `missing ${n}`);
  }
});

test("S2: CLARA_SKILLS without nutrition hides the tools AND the tie-breaker names none of them", () => {
  const active = resolveActiveSkills(ALL_SKILLS, "profile,logs");
  const names = buildToolDefs(active).map((d) => d.name);
  assert.equal(names.some((n) => n.startsWith("nutrition_")), false);
  const prompt = buildSystemPrompt("Sam", "profile text", active, "2026-08-02");
  // Dark-launch discipline (S1 amendment 6): no row may name absent tools.
  assert.equal(prompt.includes("nutrition_"), false);
  // Falls back to the S1 text: totals + gap_report for the remaining half.
  assert.match(prompt, /gap_report \(NUTRITION\)/);
});

test("S2: with nutrition active the calories-LEFT row routes to nutrition_ tools and the stale logs sentence is gone", () => {
  const active = resolveActiveSkills(ALL_SKILLS, undefined);
  const prompt = buildSystemPrompt("Sam", "profile text", active, "2026-08-02");
  assert.match(prompt, /Calories LEFT[\s\S]*nutrition_day/);
  // The row is the only place the prompt teaches the day/range/targets grain
  // split — pin all three so a "simplifying" edit cannot silently drop one.
  assert.match(prompt, /Calories LEFT[\s\S]*nutrition_range_summary/);
  assert.match(prompt, /Calories LEFT[\s\S]*nutrition_targets/);
  // The logs fragment must no longer steer "calories left" to gap_report.
  assert.equal(prompt.includes("because the remaining/target part is not available yet"), false);
  // And the two skills' fragments must not contradict: only the tie-breaker
  // may mention gap_report (NUTRITION), and only in its inactive branch.
  assert.equal(prompt.includes("gap_report (NUTRITION)"), false);
});

test("S2: logs-off/nutrition-on emits a coherent table (intake row steers to gap_report, LEFT row to nutrition)", () => {
  const active = resolveActiveSkills(ALL_SKILLS, "profile,nutrition");
  const prompt = buildSystemPrompt("Sam", "profile text", active, "2026-08-02");
  assert.match(prompt, /gap_report \(LOGS\)/);
  assert.match(prompt, /Calories LEFT[\s\S]*nutrition_day/);
});
