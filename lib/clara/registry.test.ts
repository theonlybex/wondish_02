import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveActiveSkills, buildToolDefs, buildSystemPrompt, findTool } from "./registry";
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
  assert.match(prompt, /actual data rather than general knowledge/i);
});
