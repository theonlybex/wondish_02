# Clara C0 — Skill Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `POST /api/dish-checker` into a server-side agentic tool-use loop with a skill registry, a bounded round budget, and a capability-gap ledger — so every later Clara skill cycle is one new file plus one registry line.

**Architecture:** A bounded loop (`lib/clara/loop.ts`) drives repeated Anthropic calls behind a narrow `ModelClient` port, so the whole loop is unit-testable with a scripted stub and no network. Skills register tool definitions plus a prompt fragment; the registry assembles the system prompt and tool array per request and the route streams every round's text as plain `text/plain` — the wire contract is unchanged and neither client is touched. C0 ships one read-only pilot skill (profile) and the runtime-owned `gap_report` tool, whose rows drive an owner-only admin report that decides which skill cycle runs next.

**Tech Stack:** Next.js 14 App Router · TypeScript · Prisma 5 / Neon · `@anthropic-ai/sdk` ^0.96 · `node:test` + `tsx` (`npm test`) · Clerk auth · Upstash Redis rate limiting.

**Spec:** `docs/superpowers/specs/2026-07-30-clara-full-service-assistant-design.md` (program spec; §4 recognition, §5 gap ledger, §8 resolved decisions).

## AMENDMENT 2026-07-31: the date line is client-sourced or absent

**Why:** the original E2 text put `Today's date for ${firstName} is ${today}` into every
system prompt, and E1 falls back to the *server* date when the client sends none. Vercel
runs UTC, so an iOS caller (which does not send `clientDate` until S1) in a negative-offset
timezone would have Clara assert tomorrow's date all evening. C0 has no date-using skill,
but Clara would still say it in prose — a regression shipped to iOS by a cycle that claims
not to touch iOS.

**Supersedes** the E2 prompt text and the E4 route wiring:

- `buildSystemPrompt(firstName, foodMapText, active, today)` takes `today: string | null`.
  When `null`, the date sentence is **omitted entirely** — which is exactly today's
  behavior, so a client that sends nothing is unchanged rather than newly wrong.
- The route passes the date through only when it came from the caller:
  ```ts
  const resolution = resolveToday(options.clientDate, options.tzOffsetMinutes, new Date());
  const promptToday = resolution.source === "server" ? null : resolution.localDate;
  ```
  `ClaraContext.today` still carries the resolved string (handlers always need *a* date);
  only the prompt assertion is gated.
- Add to `lib/clara/registry.test.ts`:
  ```ts
  test("no date is asserted when the client did not supply one", () => {
    const prompt = buildSystemPrompt("Sam", "none", [], null);
    assert.ok(!/Today's date/i.test(prompt));
  });
  ```
- Add to `lib/clara/dates.test.ts` — the regression this prevents:
  ```ts
  test("a UTC server in the evening of a negative-offset caller is NOT their today", () => {
    // 2026-07-31T00:30Z is still 2026-07-30 for a UTC-7 caller.
    const server = resolveToday(undefined, undefined, new Date("2026-07-31T00:30:00Z"));
    assert.equal(server.source, "server"); // ⇒ prompt omits the date (see registry)
    assert.equal(resolveToday(undefined, -420, new Date("2026-07-31T00:30:00Z")).localDate, "2026-07-30");
  });
  ```

**iOS impact:** superseded by the T1 amendment below — iOS now sends the fields in this
same cycle, so it gets the date sentence and `surface: "ios"` attribution immediately. The
null-date rule stays regardless: it is the correct behavior for any client that does not
send a date (an older iOS build still in the wild, a future integration), and it is what
makes the field's absence safe rather than silently wrong.

## Global Constraints

- ~~**Engine-only cycle.**~~ **AMENDED 2026-07-31 (user-directed):** the cycle also ships **T1** in the Clara iOS repo — the three additive body fields, so iOS gets an accurate date sentence and clean gap-ledger attribution from day one. E1–E7 land in `wondish_02`; T1 lands in `~/Desktop/BeTech/Clara`. The two repos have zero file overlap, so T1 may run in parallel with E1–E3 (cycle.md §3).
- **Wire contract pinned.** For a valid existing body (`{"messages":[…]}`), the response stays `200 text/plain` with raw token deltas — no SSE, no sentinel, no JSON envelope. New body fields are **optional and additive**; absent fields must reproduce today's behavior exactly.
- **No stream framing.** Tool activity surfaces only as prose Clara writes ("Let me check your logs…"). A second stream format is out of scope for this cycle and every skill cycle after it.
- **Credit accounting.** One user message = one credit. The daily gate is checked **once**, before the first model call — `validate → gate → model call` ordering is preserved so a gated request spends zero tokens. Free accounts get `MAX_TOOL_ROUNDS_FREE = 2` tool-executing rounds, premium `MAX_TOOL_ROUNDS_PREMIUM = 5`; total model calls per turn is at most rounds + 1 (the forced final answer).
- **Model settings unchanged:** `claude-sonnet-5`, `thinking: { type: "disabled" }`, `max_tokens: 1024`, on every round.
- **Auth scope.** `patientId` is resolved from Clerk auth on the request. No tool input field may identify a user, patient, or account. This is a named review dimension for every task that adds a tool.
- **Errors after the first byte degrade to prose.** Once any text has been enqueued the response is already `200 text/plain`; failures then emit a plain apology sentence and close cleanly. Failures *before* the first byte keep today's exact JSON bodies and statuses (401/400/402/404/429/503/500).
- **Migrations are additive and authored offline** — no drops, no alters of live data; applied via `prisma migrate deploy` at the release gate, never mid-cycle.
- **Tests are pure-logic in `lib/`** (`node:test` + `node:assert/strict`), no DB and no network. Route behavior is proven through the pure helpers the route calls.
- **Frontend rule:** the admin page task (E6) MUST invoke the `ui-ux-pro-max:ui-ux-pro-max` skill before editing any `.tsx`.
- **Every task ends green:** `npm test` full suite passing, `npx tsc --noEmit` clean of *new* errors, `npm run build` green.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/clara/types.ts` | Shared types: `ToolDef`, `ToolResult`, `ClaraContext`, `Skill`, `SkillTool`, `ModelClient` port + its event/message types. No logic. |
| `lib/clara/dates.ts` | `resolveToday`, `shiftLocalDate` — the only place "today" is decided. |
| `lib/clara/request.ts` | Parses the chat body's optional additive fields (`clientDate`, `tzOffsetMinutes`, `surface`). History parsing stays in `lib/chat-history.ts`. |
| `lib/clara/registry.ts` | Skill registration, active-set resolution from `CLARA_SKILLS`, tool-array + system-prompt assembly, tool dispatch by name. |
| `lib/clara/budget.ts` | Round budget constants and `maxToolRounds(isPremium)`. |
| `lib/clara/loop.ts` | The bounded round loop over the `ModelClient` port. Knows nothing about Anthropic or Prisma. |
| `lib/clara/anthropic-client.ts` | The only Anthropic-aware file: adapts `anthropic.messages.stream` to the `ModelClient` port. |
| `lib/clara/skills/profile.ts` | Pilot skill — read-only dietary profile. |
| `lib/clara/gap.ts` | `gap_report` tool definition, input validation, and the dedupe key. Pure; the Prisma write lives in the handler factory it exports. |
| `lib/clara/admin-gaps.ts` | Pure aggregation of gap rows into the admin report shape. |
| `lib/clara/__fixtures__/routing.ts` | Utterance → expected-tool fixture, seeded by C0 and appended by every later skill cycle. |
| `app/api/dish-checker/route.ts` | **Modified** — wires auth → burst → validate → gate → registry → loop → stream. |
| `app/api/admin/clara-gaps/route.ts` | **New** — owner-only report endpoint. |
| `app/(dashboard)/admin/clara-gaps/page.tsx` | **New** — the report page. |
| `scripts/clara-routing-eval.mjs` | **New** — opt-in live recognition eval (`npm run clara:routing-eval`). |
| `prisma/schema.prisma` + `prisma/migrations/20260731000000_clara_capability_requests/migration.sql` | **New model** `ClaraCapabilityRequest` + two enums. |
| `package.json` | **Modified** — test globs extended to `lib/clara/**`; `clara:routing-eval` script added. |

**Test files:** `lib/clara/dates.test.ts`, `request.test.ts`, `registry.test.ts`, `budget.test.ts`, `loop.test.ts`, `gap.test.ts`, `admin-gaps.test.ts`, `lib/clara/skills/profile.test.ts`.

> **Note on the test glob:** `npm test` currently runs `lib/*.test.ts` — a **non-recursive** glob that would silently skip everything under `lib/clara/`. Task E1 fixes this; a task that adds tests without E1's change would appear to pass while running nothing.

---

## Task E1: Types, dates, and the test glob

**Files:**
- Create: `lib/clara/types.ts`, `lib/clara/dates.ts`
- Test: `lib/clara/dates.test.ts`
- Modify: `package.json:9` (the `test` script)

**Interfaces:**
- Consumes: `parseLocalDateStrict` from `lib/journal.ts`.
- Produces: `ToolResult`, `ToolDef`, `ClaraContext`, `Skill`, `SkillTool`, `ModelClient`, `ModelRoundEvent`, `ModelMessage`, `ModelRoundRequest` (all from `lib/clara/types.ts`); `resolveToday(clientDate, tzOffsetMinutes, now): TodayResolution` and `shiftLocalDate(localDate, days): string` from `lib/clara/dates.ts`.

- [ ] **Step 1: Fix the test glob first**

In `package.json`, replace the `test` script:

```json
"test": "node --import tsx --test lib/*.test.ts lib/clara/*.test.ts lib/clara/skills/*.test.ts data/*.test.ts middleware.test.ts",
```

- [ ] **Step 2: Run the suite to confirm it still passes**

Run: `npm test`
Expected: PASS. (`node --test` tolerates a glob that matches nothing, so the two new globs are inert until E1 adds files.)

- [ ] **Step 3: Write the failing date tests**

Create `lib/clara/dates.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveToday, shiftLocalDate } from "./dates";

test("resolveToday prefers a valid clientDate", () => {
  const r = resolveToday("2026-07-31", undefined, new Date("2026-01-01T00:00:00Z"));
  assert.deepEqual(r, { localDate: "2026-07-31", source: "client" });
});

test("resolveToday rejects garbage clientDate and falls back", () => {
  const r = resolveToday("31/07/2026", undefined, new Date("2026-07-31T12:00:00Z"));
  assert.equal(r.source, "server");
});

test("resolveToday uses tzOffsetMinutes when clientDate is absent", () => {
  // 2026-07-31T02:00Z at UTC-5 is still 2026-07-30 locally.
  const r = resolveToday(undefined, -300, new Date("2026-07-31T02:00:00Z"));
  assert.deepEqual(r, { localDate: "2026-07-30", source: "offset" });
});

test("resolveToday ignores an out-of-range offset", () => {
  const r = resolveToday(undefined, 5000, new Date("2026-07-31T02:00:00Z"));
  assert.equal(r.source, "server");
});

test("shiftLocalDate walks calendar days across a month boundary", () => {
  assert.equal(shiftLocalDate("2026-08-01", -14), "2026-07-18");
  assert.equal(shiftLocalDate("2026-02-28", 1), "2026-03-01"); // 2026 is not a leap year
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `npm test -- --test-name-pattern="resolveToday"`
Expected: FAIL — cannot find module `./dates`.

- [ ] **Step 5: Write `lib/clara/types.ts`**

```ts
// Shared vocabulary for the Clara skill runtime. No logic lives here — every
// consumer (loop, registry, skills, route) imports its shapes from this file
// so a skill cycle never has to reach into the loop's internals.

/** Typed handler outcome. Handlers NEVER throw — the model narrates these. */
export type ToolResult =
  | { ok: true; data: unknown }
  | {
      ok: false;
      reason: "NOT_FOUND" | "AMBIGUOUS" | "OUT_OF_RANGE" | "INVALID_INPUT" | "NEEDS_PREMIUM" | "FAILED";
      message: string;
    };

/** Anthropic tool definition. `input_schema` is a JSON Schema object. */
export interface ToolDef {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Everything a handler may know about the caller. `patientId` is resolved from
 * Clerk auth by the route — no tool input may carry an identity field.
 */
export interface ClaraContext {
  patientId: string;
  accountId: string;
  firstName: string;
  isPremium: boolean;
  /** "YYYY-MM-DD" — the caller's local today (lib/clara/dates.ts). */
  today: string;
  surface: "web" | "ios" | "unknown";
}

export interface SkillTool {
  def: ToolDef;
  handler: (ctx: ClaraContext, input: Record<string, unknown>) => Promise<ToolResult>;
}

export interface Skill {
  /** Registry key and CLARA_SKILLS token, e.g. "profile". */
  name: string;
  /** Appended to the system prompt only when this skill is active. */
  promptFragment: string;
  tools: SkillTool[];
}

// ─── ModelClient port ────────────────────────────────────────────────────────
// The loop talks to this, never to the Anthropic SDK, so every loop path is
// unit-testable with a scripted stub and zero network.

export type ModelContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

export interface ModelMessage {
  role: "user" | "assistant";
  content: string | ModelContentBlock[];
}

export interface ModelRoundRequest {
  system: string;
  messages: ModelMessage[];
  /** Empty array ⇒ the model cannot call tools this round (forced final answer). */
  tools: ToolDef[];
}

export type ModelRoundEvent =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

export interface ModelClient {
  /**
   * Awaiting this performs the connect (mirrors `stream.withResponse()`), so
   * round-1 connection errors surface BEFORE the route commits to a 200.
   */
  openRound(req: ModelRoundRequest): Promise<AsyncIterable<ModelRoundEvent>>;
}
```

- [ ] **Step 6: Write `lib/clara/dates.ts`**

```ts
import { parseLocalDateStrict } from "@/lib/journal";

export interface TodayResolution {
  /** "YYYY-MM-DD" */
  localDate: string;
  source: "client" | "offset" | "server";
}

function format(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Decides the caller's local "today" — the anchor every relative date phrase
 * ("two weeks ago") resolves against. Client-supplied first, matching the
 * MealLog.localDate precedent: the server does no UTC math and is immune to
 * its own deploy region.
 */
export function resolveToday(
  clientDate: unknown,
  tzOffsetMinutes: unknown,
  now: Date
): TodayResolution {
  if (typeof clientDate === "string" && parseLocalDateStrict(clientDate)) {
    return { localDate: clientDate, source: "client" };
  }
  if (
    typeof tzOffsetMinutes === "number" &&
    Number.isInteger(tzOffsetMinutes) &&
    Math.abs(tzOffsetMinutes) <= 840 // ±14h, the real-world extreme
  ) {
    const shifted = new Date(now.getTime() + tzOffsetMinutes * 60_000);
    const y = shifted.getUTCFullYear();
    const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
    const d = String(shifted.getUTCDate()).padStart(2, "0");
    return { localDate: `${y}-${m}-${d}`, source: "offset" };
  }
  return { localDate: format(now), source: "server" };
}

/** Calendar-day arithmetic on a local date string. No timezone involved. */
export function shiftLocalDate(localDate: string, days: number): string {
  const parsed = parseLocalDateStrict(localDate);
  if (!parsed) throw new Error(`shiftLocalDate: invalid date ${localDate}`);
  parsed.setDate(parsed.getDate() + days);
  return format(parsed);
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, including the 5 new date tests.

- [ ] **Step 8: Typecheck and commit**

```bash
npx tsc --noEmit
git add package.json lib/clara/types.ts lib/clara/dates.ts lib/clara/dates.test.ts
git commit -m "feat(clara): skill-runtime types + local-date resolver (C0 E1)"
```

---

## Task E2: Registry, budget, and the profile pilot skill

**Files:**
- Create: `lib/clara/registry.ts`, `lib/clara/budget.ts`, `lib/clara/skills/profile.ts`
- Test: `lib/clara/registry.test.ts`, `lib/clara/budget.test.ts`, `lib/clara/skills/profile.test.ts`

**Interfaces:**
- Consumes: everything from `lib/clara/types.ts`; `PATIENT_FOOD_MAP_INCLUDE` and `buildFoodMapText` from `lib/food-map.ts`.
- Produces: `resolveActiveSkills(all, envValue): Skill[]`, `buildToolDefs(skills): ToolDef[]`, `buildSystemPrompt(firstName, foodMapText, skills, today): string`, `findTool(skills, name): SkillTool | null`, `ALL_SKILLS: Skill[]` (registry); `maxToolRounds(isPremium): number`, `MAX_TOOL_ROUNDS_FREE`, `MAX_TOOL_ROUNDS_PREMIUM` (budget); `profileSkill: Skill` (profile).

- [ ] **Step 1: Write the failing budget test**

Create `lib/clara/budget.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { maxToolRounds, MAX_TOOL_ROUNDS_FREE, MAX_TOOL_ROUNDS_PREMIUM } from "./budget";

test("free accounts get 2 tool rounds, premium 5", () => {
  assert.equal(MAX_TOOL_ROUNDS_FREE, 2);
  assert.equal(MAX_TOOL_ROUNDS_PREMIUM, 5);
  assert.equal(maxToolRounds(false), 2);
  assert.equal(maxToolRounds(true), 5);
});
```

- [ ] **Step 2: Write the failing registry tests**

Create `lib/clara/registry.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveActiveSkills, buildToolDefs, buildSystemPrompt, findTool } from "./registry";
import type { Skill, ToolResult, ClaraContext } from "./types";

const noop = async (): Promise<ToolResult> => ({ ok: true, data: null });

const alpha: Skill = {
  name: "alpha",
  promptFragment: "ALPHA-FRAGMENT",
  tools: [{ def: { name: "alpha_get", description: "d", input_schema: { type: "object", properties: {} } }, handler: noop }],
};
const beta: Skill = {
  name: "beta",
  promptFragment: "BETA-FRAGMENT",
  tools: [{ def: { name: "beta_get", description: "d", input_schema: { type: "object", properties: {} } }, handler: noop }],
};

test("an unset CLARA_SKILLS enables every registered skill", () => {
  assert.deepEqual(resolveActiveSkills([alpha, beta], undefined).map((s) => s.name), ["alpha", "beta"]);
});

test("CLARA_SKILLS is an allow-list; unknown tokens are ignored", () => {
  assert.deepEqual(resolveActiveSkills([alpha, beta], "beta,ghost").map((s) => s.name), ["beta"]);
});

test("an empty CLARA_SKILLS disables every skill", () => {
  assert.deepEqual(resolveActiveSkills([alpha, beta], ""), []);
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
  const { ALL_SKILLS } = await import("./registry");
  const names = ALL_SKILLS.flatMap((s) => s.tools.map((t) => t.def.name));
  assert.equal(new Set(names).size, names.length);
});

test("no registered tool accepts an identity field", async () => {
  const { ALL_SKILLS } = await import("./registry");
  for (const skill of ALL_SKILLS) {
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
    patientId: "p1", accountId: "a1", firstName: "Sam",
    isPremium: false, today: "2026-07-31", surface: "web",
  };
  assert.equal(ctx.patientId, "p1");
});
```

- [ ] **Step 3: Run to verify both fail**

Run: `npm test -- --test-name-pattern="registry|tool rounds"`
Expected: FAIL — cannot find modules `./budget` and `./registry`.

- [ ] **Step 4: Write `lib/clara/budget.ts`**

```ts
// Tool-round budget. A "round" is one model turn that may execute tools; the
// loop always gets one final tools-free round on top, so total model calls per
// user message is at most maxToolRounds + 1. One user message is always ONE
// credit against CHAT_DAILY_FREE regardless of rounds (spec §8 Q2).

export const MAX_TOOL_ROUNDS_FREE = 2;
export const MAX_TOOL_ROUNDS_PREMIUM = 5;

export function maxToolRounds(isPremium: boolean): number {
  return isPremium ? MAX_TOOL_ROUNDS_PREMIUM : MAX_TOOL_ROUNDS_FREE;
}
```

- [ ] **Step 5: Write `lib/clara/registry.ts`**

```ts
import type { Skill, SkillTool, ToolDef } from "./types";
import { profileSkill } from "./skills/profile";

/**
 * Every skill that exists. A skill cycle adds exactly one import and one array
 * entry here — nothing else in the runtime changes.
 */
export const ALL_SKILLS: Skill[] = [profileSkill];

/**
 * CLARA_SKILLS is an allow-list of skill names ("profile,logs"). Unset ⇒ all
 * registered skills are active; empty string ⇒ none (kill switch). Unknown
 * tokens are ignored so a stale env value can never crash the route.
 */
export function resolveActiveSkills(all: Skill[], envValue: string | undefined): Skill[] {
  if (envValue === undefined) return all;
  const allowed = new Set(
    envValue.split(",").map((s) => s.trim()).filter((s) => s.length > 0)
  );
  return all.filter((s) => allowed.has(s.name));
}

export function buildToolDefs(active: Skill[]): ToolDef[] {
  return active.flatMap((s) => s.tools.map((t) => t.def));
}

export function findTool(active: Skill[], name: string): SkillTool | null {
  for (const skill of active) {
    const hit = skill.tools.find((t) => t.def.name === name);
    if (hit) return hit;
  }
  return null;
}

/**
 * The system prompt is rebuilt per active skill set (spec §8 Q8): base persona,
 * then the runtime's tool-use rules, then each active skill's fragment.
 */
export function buildSystemPrompt(
  firstName: string,
  foodMapText: string,
  active: Skill[],
  today: string
): string {
  const base = `You are Clara, a warm and knowledgeable personal food advisor for ${firstName}.

${firstName}'s dietary profile:
${foodMapText}

Today's date for ${firstName} is ${today}. Resolve every relative date ("yesterday", "two weeks ago") against it.

Your behavior:
1. When asked about a dish or food, assume the most common ingredients and preparation method if not specified — state your assumptions briefly before evaluating.
2. Start with what works well for ${firstName}'s goals and profile (positive first).
3. Identify every conflict with their dietary profile and explain WHY it matters to their health.
4. If the dish can be adjusted: propose specific modifications and ask if they accept.
   - If accepted → confirm ACCEPTED ✅ with modifications noted.
   - If declined → confirm REJECTED ❌, suggest an alternative dish.
5. No conflicts → confirm PASSED ✅, explain why it is a great fit for their profile.
6. After your first message, do NOT re-introduce yourself or restate their profile. Continue the conversation naturally.
7. Be warm, encouraging, and educational. Never clinical or cold.
8. Keep responses concise — 3 to 5 sentences unless the user asks for more detail.
9. If the dietary profile is empty or incomplete, still give your best nutritional advice based on general healthy eating principles.
10. Never use markdown formatting — no bold (**), no headers (#), no bullet dashes or asterisks. Write in plain, conversational prose like a knowledgeable friend texting you.`;

  const runtimeRules = `

How you use your tools:
- Always write one short sentence BEFORE you use a tool, saying what you are about to check ("Let me look at your logs…"). The user sees nothing while a tool runs, so silence reads as a freeze.
- Never invent data you did not retrieve. If a tool returns nothing, say so plainly.
- Never perform a change without asking first. Describe what you are about to do, wait for their reply, and only then use the write tool.
- If ${firstName} asks for something none of your tools can do, call gap_report once, then tell them plainly that you cannot do that yet. Never promise a date.`;

  const fragments = active.map((s) => s.promptFragment.trim()).filter(Boolean);
  return fragments.length > 0
    ? `${base}${runtimeRules}\n\n${fragments.join("\n\n")}`
    : `${base}${runtimeRules}`;
}
```

> **Deliberately absent:** spec §4.1 Layer 3 (the cross-skill tie-breaker table) is *not* in this prompt. With one product skill there is nothing to tie-break, and shipping a table that names `logs_*`/`plan_*` tools that do not exist would invite Clara to hallucinate them. It enters `buildSystemPrompt` in S1, the first cycle where two domains can be confused.

- [ ] **Step 6: Write the failing profile-skill test**

Create `lib/clara/skills/profile.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { profileSkill } from "./profile";

test("the profile skill exposes exactly one read tool", () => {
  assert.equal(profileSkill.name, "profile");
  assert.deepEqual(profileSkill.tools.map((t) => t.def.name), ["profile_get"]);
});

test("profile_get takes no input at all — nothing to spoof", () => {
  const schema = profileSkill.tools[0].def.input_schema;
  assert.deepEqual(schema.properties, {});
  assert.equal(schema.required, undefined);
});

test("its description tells Clara what it is NOT for", () => {
  assert.match(profileSkill.tools[0].def.description, /not.*(change|update|add)/i);
});
```

- [ ] **Step 7: Write `lib/clara/skills/profile.ts`**

```ts
import { prisma } from "@/lib/db";
import { PATIENT_FOOD_MAP_INCLUDE, buildFoodMapText } from "@/lib/food-map";
import type { ClaraContext, Skill, ToolResult } from "../types";

/**
 * C0 pilot skill: read-only, no input, no writes. It exists to prove the loop
 * end-to-end with zero blast radius — the dietary snapshot is already in the
 * system prompt, but reading it through a tool exercises the whole round trip.
 */
export const profileSkill: Skill = {
  name: "profile",
  promptFragment: `About profile_get: the user's dietary profile is already summarised for you above. Call profile_get only when they ask you to read it back or you need the exact current list. You cannot change the profile — if they want something added or removed, tell them it is not something you can do yet and call gap_report with category FILTERS.`,
  tools: [
    {
      def: {
        name: "profile_get",
        description:
          "Read the user's current dietary profile: allergies, foods to avoid, preferences, health conditions and motivations. Use when they ask what is on their profile. This tool is READ-ONLY — it can NOT add, change or remove anything on the profile.",
        input_schema: { type: "object", properties: {} },
      },
      handler: async (ctx: ClaraContext): Promise<ToolResult> => {
        const patient = await prisma.patient.findUnique({
          where: { id: ctx.patientId },
          include: PATIENT_FOOD_MAP_INCLUDE,
        });
        if (!patient) {
          return { ok: false, reason: "NOT_FOUND", message: "No dietary profile on file yet." };
        }
        return { ok: true, data: { profile: buildFoodMapText(patient) } };
      },
    },
  ],
};
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all budget, registry, and profile tests green.

- [ ] **Step 9: Typecheck and commit**

```bash
npx tsc --noEmit
git add lib/clara/budget.ts lib/clara/budget.test.ts lib/clara/registry.ts lib/clara/registry.test.ts lib/clara/skills/
git commit -m "feat(clara): skill registry, round budget, profile pilot skill (C0 E2)"
```

---

## Task E3: The bounded loop

**Files:**
- Create: `lib/clara/loop.ts`
- Test: `lib/clara/loop.test.ts`

**Interfaces:**
- Consumes: `ModelClient`, `ModelRoundEvent`, `ModelMessage`, `ToolDef`, `ToolResult` from `./types`.
- Produces: `startClaraLoop(params: LoopParams): Promise<AsyncGenerator<string>>` and `interface LoopParams { client, system, tools, messages, maxToolRounds, execute, onError? }` from `lib/clara/loop.ts`. `execute` has type `(name: string, input: Record<string, unknown>) => Promise<ToolResult>`.

- [ ] **Step 1: Write the failing loop tests**

Create `lib/clara/loop.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { startClaraLoop } from "./loop";
import type { ModelClient, ModelRoundEvent, ModelRoundRequest, ToolResult } from "./types";

/** Scripts one array of events per round; records what each round was asked. */
function stubClient(rounds: ModelRoundEvent[][]) {
  const seen: ModelRoundRequest[] = [];
  let i = 0;
  const client: ModelClient = {
    async openRound(req) {
      seen.push(req);
      const events = rounds[i++] ?? [];
      return (async function* () {
        for (const e of events) yield e;
      })();
    },
  };
  return { client, seen };
}

async function drain(gen: AsyncGenerator<string>): Promise<string> {
  let out = "";
  for await (const chunk of gen) out += chunk;
  return out;
}

const okTool = async (): Promise<ToolResult> => ({ ok: true, data: { hits: 1 } });

test("a text-only round streams and stops after one model call", async () => {
  const { client, seen } = stubClient([[{ type: "text", text: "Hello there." }]]);
  const out = await drain(
    await startClaraLoop({ client, system: "s", tools: [], messages: [], maxToolRounds: 2, execute: okTool })
  );
  assert.equal(out, "Hello there.");
  assert.equal(seen.length, 1);
});

test("narration text from a tool round reaches the user before the answer", async () => {
  const { client } = stubClient([
    [{ type: "text", text: "Let me check. " }, { type: "tool_use", id: "t1", name: "x_get", input: {} }],
    [{ type: "text", text: "You had ramen." }],
  ]);
  const out = await drain(
    await startClaraLoop({ client, system: "s", tools: [], messages: [], maxToolRounds: 2, execute: okTool })
  );
  assert.equal(out, "Let me check. You had ramen.");
});

test("tool results are appended as a user tool_result block for the next round", async () => {
  const { client, seen } = stubClient([
    [{ type: "tool_use", id: "t1", name: "x_get", input: { a: 1 } }],
    [{ type: "text", text: "done" }],
  ]);
  await drain(
    await startClaraLoop({ client, system: "s", tools: [], messages: [], maxToolRounds: 2, execute: okTool })
  );
  const second = seen[1].messages;
  assert.equal(second.at(-2)?.role, "assistant");
  assert.equal(second.at(-1)?.role, "user");
  const block = (second.at(-1)!.content as { type: string; tool_use_id: string }[])[0];
  assert.equal(block.type, "tool_result");
  assert.equal(block.tool_use_id, "t1");
});

test("the budget is spent on tool rounds, and the final round is offered no tools", async () => {
  const { client, seen } = stubClient([
    [{ type: "tool_use", id: "t1", name: "x_get", input: {} }],
    [{ type: "tool_use", id: "t2", name: "x_get", input: {} }],
    [{ type: "text", text: "final answer" }],
  ]);
  const tools = [{ name: "x_get", description: "d", input_schema: { type: "object" as const, properties: {} } }];
  const out = await drain(
    await startClaraLoop({ client, system: "s", tools, messages: [], maxToolRounds: 2, execute: okTool })
  );
  assert.equal(out, "final answer");
  assert.equal(seen.length, 3);
  assert.deepEqual(seen[0].tools.map((t) => t.name), ["x_get"]);
  assert.deepEqual(seen[1].tools.map((t) => t.name), ["x_get"]);
  assert.deepEqual(seen[2].tools, []); // budget spent ⇒ forced final answer
});

test("a handler failure is narrated as a typed result, not thrown", async () => {
  const { client, seen } = stubClient([
    [{ type: "tool_use", id: "t1", name: "x_get", input: {} }],
    [{ type: "text", text: "I could not find that." }],
  ]);
  const failing = async (): Promise<ToolResult> => ({ ok: false, reason: "NOT_FOUND", message: "nothing there" });
  const out = await drain(
    await startClaraLoop({ client, system: "s", tools: [], messages: [], maxToolRounds: 2, execute: failing })
  );
  assert.equal(out, "I could not find that.");
  const block = (seen[1].messages.at(-1)!.content as { content: string }[])[0];
  assert.match(block.content, /NOT_FOUND/);
});

test("an unknown tool name is reported back instead of crashing the turn", async () => {
  const { client, seen } = stubClient([
    [{ type: "tool_use", id: "t1", name: "ghost_get", input: {} }],
    [{ type: "text", text: "sorry" }],
  ]);
  const execute = async (name: string): Promise<ToolResult> =>
    name === "ghost_get" ? { ok: false, reason: "FAILED", message: "Unknown tool" } : { ok: true, data: null };
  await drain(await startClaraLoop({ client, system: "s", tools: [], messages: [], maxToolRounds: 2, execute }));
  const block = (seen[1].messages.at(-1)!.content as { content: string }[])[0];
  assert.match(block.content, /Unknown tool/);
});

test("a round-1 connect failure rejects before any text is produced", async () => {
  const client: ModelClient = { async openRound() { throw new Error("connect failed"); } };
  await assert.rejects(
    startClaraLoop({ client, system: "s", tools: [], messages: [], maxToolRounds: 2, execute: okTool }),
    /connect failed/
  );
});

test("a mid-stream failure after text degrades to prose instead of throwing", async () => {
  let i = 0;
  const client: ModelClient = {
    async openRound() {
      if (i++ === 0) {
        return (async function* () {
          yield { type: "text", text: "Checking. " } as ModelRoundEvent;
          yield { type: "tool_use", id: "t1", name: "x_get", input: {} } as ModelRoundEvent;
        })();
      }
      throw new Error("round 2 exploded");
    },
  };
  const out = await drain(
    await startClaraLoop({
      client, system: "s", tools: [], messages: [], maxToolRounds: 2, execute: okTool,
      onError: () => {},
    })
  );
  assert.match(out, /^Checking\. /);
  assert.match(out, /lost my train of thought/i);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- --test-name-pattern="loop|round|narration|tool_result"`
Expected: FAIL — cannot find module `./loop`.

- [ ] **Step 3: Write `lib/clara/loop.ts`**

```ts
import type {
  ModelClient,
  ModelContentBlock,
  ModelMessage,
  ToolDef,
  ToolResult,
} from "./types";

export interface LoopParams {
  client: ModelClient;
  system: string;
  tools: ToolDef[];
  /** The sanitized conversation so far. Never contains tool blocks. */
  messages: ModelMessage[];
  maxToolRounds: number;
  execute: (name: string, input: Record<string, unknown>) => Promise<ToolResult>;
  /** Server-side observability for mid-stream failures. */
  onError?: (err: unknown) => void;
}

/** What the user sees when a round fails after the response already started. */
export const MID_STREAM_FALLBACK =
  " Sorry — I lost my train of thought there. Could you ask me that again?";

/**
 * Runs Clara's bounded tool-use loop.
 *
 * Round 1 is opened eagerly (awaited) so a connect failure rejects BEFORE the
 * route commits to a 200 text/plain response — that is what preserves today's
 * JSON error bodies for 429/503/500. Every later round runs inside the
 * generator, where the response is already streaming and failures can only be
 * narrated as prose.
 *
 * Budget: `maxToolRounds` rounds may call tools. When it is spent the loop runs
 * one more round with an empty tools array, so the model must answer with what
 * it has instead of dangling on a tool call it cannot make.
 */
export async function startClaraLoop(params: LoopParams): Promise<AsyncGenerator<string>> {
  const messages: ModelMessage[] = [...params.messages];
  const firstRound = await params.client.openRound({
    system: params.system,
    messages,
    tools: params.tools,
  });

  async function* run(): AsyncGenerator<string> {
    let stream = firstRound;
    let toolRoundsUsed = 0;

    for (;;) {
      const assistant: ModelContentBlock[] = [];
      const calls: { id: string; name: string; input: Record<string, unknown> }[] = [];

      try {
        for await (const event of stream) {
          if (event.type === "text") {
            assistant.push({ type: "text", text: event.text });
            yield event.text;
          } else {
            assistant.push({ type: "tool_use", id: event.id, name: event.name, input: event.input });
            calls.push({ id: event.id, name: event.name, input: event.input });
          }
        }
      } catch (err) {
        params.onError?.(err);
        yield MID_STREAM_FALLBACK;
        return;
      }

      if (calls.length === 0) return;

      messages.push({ role: "assistant", content: assistant });

      const results: ModelContentBlock[] = [];
      for (const call of calls) {
        let result: ToolResult;
        try {
          result = await params.execute(call.name, call.input);
        } catch (err) {
          params.onError?.(err);
          result = { ok: false, reason: "FAILED", message: "The tool did not respond." };
        }
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: JSON.stringify(result),
        });
      }
      messages.push({ role: "user", content: results });

      toolRoundsUsed += 1;
      const toolsForNextRound = toolRoundsUsed >= params.maxToolRounds ? [] : params.tools;

      try {
        stream = await params.client.openRound({
          system: params.system,
          messages,
          tools: toolsForNextRound,
        });
      } catch (err) {
        params.onError?.(err);
        yield MID_STREAM_FALLBACK;
        return;
      }
    }
  }

  return run();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 8 loop tests green.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add lib/clara/loop.ts lib/clara/loop.test.ts
git commit -m "feat(clara): bounded tool-use loop with forced final round (C0 E3)"
```

---

## Task E4: Anthropic adapter, request parsing, route integration

**Files:**
- Create: `lib/clara/anthropic-client.ts`, `lib/clara/request.ts`
- Test: `lib/clara/request.test.ts`
- Modify: `app/api/dish-checker/route.ts` (whole POST handler)

**Interfaces:**
- Consumes: `startClaraLoop`, `resolveActiveSkills`/`buildToolDefs`/`buildSystemPrompt`/`findTool`/`ALL_SKILLS`, `maxToolRounds`, `resolveToday`, `sanitizeChatHistory` (`lib/chat-history.ts`), `getAccountWithSubscription`/`accountHasActivePremium` (`lib/auth.ts`), `rateLimit` (`lib/rate-limit.ts`), freemium constants.
- Produces: `createAnthropicClient(anthropic): ModelClient` from `lib/clara/anthropic-client.ts`; `parseClaraRequestOptions(body): ClaraRequestOptions` where `ClaraRequestOptions = { clientDate?: string; tzOffsetMinutes?: number; surface: "web" | "ios" | "unknown" }` from `lib/clara/request.ts`.

- [ ] **Step 1: Write the failing request-parsing tests**

Create `lib/clara/request.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseClaraRequestOptions } from "./request";

test("a body with no new fields parses to unknown surface and no date", () => {
  assert.deepEqual(parseClaraRequestOptions({ messages: [] }), {
    clientDate: undefined,
    tzOffsetMinutes: undefined,
    surface: "unknown",
  });
});

test("valid new fields are picked up", () => {
  assert.deepEqual(
    parseClaraRequestOptions({ messages: [], clientDate: "2026-07-31", tzOffsetMinutes: -300, surface: "web" }),
    { clientDate: "2026-07-31", tzOffsetMinutes: -300, surface: "web" }
  );
});

test("garbage new fields are dropped, never fatal — the turn still works", () => {
  assert.deepEqual(
    parseClaraRequestOptions({ messages: [], clientDate: 42, tzOffsetMinutes: "x", surface: "hacker" }),
    { clientDate: undefined, tzOffsetMinutes: undefined, surface: "unknown" }
  );
});

test("a non-object body is tolerated", () => {
  assert.equal(parseClaraRequestOptions(null).surface, "unknown");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --test-name-pattern="parseClaraRequestOptions|new fields"`
Expected: FAIL — cannot find module `./request`.

- [ ] **Step 3: Write `lib/clara/request.ts`**

```ts
import { parseLocalDateStrict } from "@/lib/journal";

export interface ClaraRequestOptions {
  clientDate?: string;
  tzOffsetMinutes?: number;
  surface: "web" | "ios" | "unknown";
}

/**
 * Additive, optional extensions to the pinned chat body. Invalid values are
 * DROPPED, never 400: an old or buggy client must keep chatting exactly as it
 * does today. `messages` validation stays in lib/chat-history.ts.
 */
export function parseClaraRequestOptions(body: unknown): ClaraRequestOptions {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;

  const rawDate = b.clientDate;
  const clientDate =
    typeof rawDate === "string" && parseLocalDateStrict(rawDate) ? rawDate : undefined;

  const rawOffset = b.tzOffsetMinutes;
  const tzOffsetMinutes =
    typeof rawOffset === "number" && Number.isInteger(rawOffset) && Math.abs(rawOffset) <= 840
      ? rawOffset
      : undefined;

  const surface = b.surface === "web" || b.surface === "ios" ? b.surface : "unknown";

  return { clientDate, tzOffsetMinutes, surface };
}
```

- [ ] **Step 4: Write `lib/clara/anthropic-client.ts`**

```ts
import type Anthropic from "@anthropic-ai/sdk";
import type { ModelClient, ModelRoundEvent, ModelRoundRequest } from "./types";

export const CLARA_MODEL = "claude-sonnet-5";
export const CLARA_MAX_TOKENS = 1024;

/**
 * The ONLY Anthropic-aware file in the runtime. Adapts the SDK's streaming
 * message API to the ModelClient port so every loop path stays unit-testable.
 *
 * `cache_control` on the last system block marks the stable system+tools prefix
 * as cacheable — with an always-on toolbox that prefix is identical on every
 * round and every turn, which is what keeps the always-on strategy affordable
 * (spec §4.2).
 */
export function createAnthropicClient(anthropic: Anthropic): ModelClient {
  return {
    async openRound(req: ModelRoundRequest): Promise<AsyncIterable<ModelRoundEvent>> {
      const stream = anthropic.messages.stream({
        model: CLARA_MODEL,
        max_tokens: CLARA_MAX_TOKENS,
        thinking: { type: "disabled" },
        system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
        ...(req.tools.length > 0 ? { tools: req.tools } : {}),
        messages: req.messages as Anthropic.MessageParam[],
      });

      // Surfaces connect-time errors (429/529/etc) at await time, exactly as
      // the pre-loop route did, so round 1 can still answer with JSON.
      await stream.withResponse();

      return (async function* () {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            yield { type: "text", text: event.delta.text };
          }
        }
        // tool_use blocks are only complete at the end of the message.
        const final = await stream.finalMessage();
        for (const block of final.content) {
          if (block.type === "tool_use") {
            yield {
              type: "tool_use",
              id: block.id,
              name: block.name,
              input: (block.input ?? {}) as Record<string, unknown>,
            };
          }
        }
      })();
    },
  };
}
```

- [ ] **Step 5: Rewrite the POST handler in `app/api/dish-checker/route.ts`**

Keep the file's imports for `auth`, `prisma`, `rateLimit`, `sanitizeChatHistory`, `accountHasActivePremium`, `getAccountWithSubscription`, the freemium constants, `Anthropic`, and the food-map helpers. Add:

```ts
import { startClaraLoop } from "@/lib/clara/loop";
import { createAnthropicClient } from "@/lib/clara/anthropic-client";
import { parseClaraRequestOptions } from "@/lib/clara/request";
import { resolveToday } from "@/lib/clara/dates";
import { maxToolRounds } from "@/lib/clara/budget";
import {
  ALL_SKILLS, resolveActiveSkills, buildToolDefs, buildSystemPrompt, findTool,
} from "@/lib/clara/registry";
import type { ClaraContext, ToolResult } from "@/lib/clara/types";
```

Replace everything from `const foodMapText = buildFoodMapText(patient);` to the end of the function with:

```ts
  // NOTE: `patient` may be null — an account can exist without a Patient row,
  // and today's route still answers for them (buildFoodMapText tolerates null).
  // That behavior is pinned: no 404. Such a caller simply gets no toolbox,
  // which reproduces the pre-loop response exactly.
  const options = parseClaraRequestOptions(body);
  const { localDate } = resolveToday(options.clientDate, options.tzOffsetMinutes, new Date());
  const isPremium = accountHasActivePremium(account.subscriptions);
  const firstName = account.firstName ?? "there";

  const activeSkills = patient
    ? resolveActiveSkills(ALL_SKILLS, process.env.CLARA_SKILLS)
    : [];

  const ctx: ClaraContext | null = patient
    ? {
        patientId: patient.id,
        accountId: account.id,
        firstName,
        isPremium,
        today: localDate,
        surface: options.surface,
      }
    : null;

  const systemPrompt = buildSystemPrompt(
    firstName,
    buildFoodMapText(patient),
    activeSkills,
    localDate
  );

  const execute = async (name: string, input: Record<string, unknown>): Promise<ToolResult> => {
    const tool = ctx ? findTool(activeSkills, name) : null;
    if (!tool || !ctx) return { ok: false, reason: "FAILED", message: `Unknown tool ${name}` };
    return tool.handler(ctx, input);
  };

  let generator;
  try {
    generator = await startClaraLoop({
      client: createAnthropicClient(anthropic),
      system: systemPrompt,
      tools: buildToolDefs(activeSkills),
      messages: history,
      maxToolRounds: maxToolRounds(isPremium),
      execute,
      onError: (err) => console.error("clara loop error", err),
    });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      if (err.status === 429) {
        return NextResponse.json({ error: "Clara is busy, try again in a moment" }, { status: 429 });
      }
      if (err.status === 529) {
        return NextResponse.json({ error: "Clara is busy, try again in a moment" }, { status: 503 });
      }
    }
    return NextResponse.json({ error: "Clara is unavailable right now" }, { status: 500 });
  }

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of generator) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      } catch (err) {
        console.error("dish-checker stream error", err);
        controller.error(err);
      }
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
```

Delete the now-unused local `buildSystemPrompt` function at the bottom of the file — its content moved verbatim into `lib/clara/registry.ts`.

- [ ] **Step 6: Send the new fields from the web client**

In `components/dish-checker/DishCheckerClient.tsx`, find the `fetch("/api/dish-checker", …)` call and extend only the JSON body:

```ts
body: JSON.stringify({
  messages,
  clientDate: new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date()), // en-CA renders YYYY-MM-DD
  tzOffsetMinutes: -new Date().getTimezoneOffset(),
  surface: "web",
}),
```

- [ ] **Step 7: Run the full suite, typecheck, build**

```bash
npm test
npx tsc --noEmit
npm run build
```
Expected: suite PASS (existing `chat-history` and `freemium` tests unchanged), tsc clean of new errors, build green.

- [ ] **Step 8: Commit**

```bash
git add lib/clara/anthropic-client.ts lib/clara/request.ts lib/clara/request.test.ts app/api/dish-checker/route.ts components/dish-checker/DishCheckerClient.tsx
git commit -m "feat(clara): run the chat route through the skill-runtime loop (C0 E4)"
```

---

## Task E5: The capability-gap ledger

**Files:**
- Modify: `prisma/schema.prisma` (two enums, one model, one relation field on `Patient`)
- Create: `prisma/migrations/20260731000000_clara_capability_requests/migration.sql`
- Create: `lib/clara/gap.ts`
- Test: `lib/clara/gap.test.ts`
- Modify: `lib/clara/registry.ts` (register the runtime tool)

**Interfaces:**
- Consumes: `ClaraContext`, `ToolResult`, `Skill` from `./types`; `rateLimit` from `@/lib/rate-limit`.
- Produces: `gapSkill: Skill`, `GAP_CATEGORIES: readonly string[]`, `GAP_REASONS: readonly string[]`, `normalizeGapInput(input): { ok: true; value: NormalizedGap } | { ok: false; message: string }`, `GAP_DAILY_CAP`, `GAP_RATE_LIMIT_NAME` from `lib/clara/gap.ts`.

- [ ] **Step 1: Add the schema**

In `prisma/schema.prisma`, after the `MealLog` model add:

```prisma
enum ClaraGapCategory {
  LOGS
  NUTRITION
  MEAL_PLAN
  JOURNAL
  SUPPLEMENTS
  FILTERS
  GROCERY
  RESTAURANTS
  FRIDGE
  EXCHANGES
  PROGRESS
  TASTE
  CUSTOM_INGREDIENTS
  BODY_GOALS
  OTHER
}

enum ClaraGapReason {
  NOT_BUILT
  FLAGGED_OFF
  OUT_OF_SCOPE
  UNCLEAR
}

/// One recorded "Clara could not do that" event. Demand data that decides which
/// skill cycle runs next (spec §5). Stores a model-written PARAPHRASE only —
/// never the raw transcript. Retention: 180 days.
model ClaraCapabilityRequest {
  id        String           @id @default(cuid())
  patientId String
  patient   Patient          @relation(fields: [patientId], references: [id], onDelete: Cascade)
  category  ClaraGapCategory
  reason    ClaraGapReason   @default(NOT_BUILT)
  summary   String
  surface   String           @default("unknown")
  /// Client-local day, "YYYY-MM-DD" — the dedupe axis.
  localDate String
  createdAt DateTime         @default(now())

  /// One row per user per category per day: ranking counts people, not volume.
  @@unique([patientId, category, localDate])
  @@index([category, createdAt])
}
```

And add to the `Patient` model's relation list, next to `mealLogs`:

```prisma
  claraCapabilityRequests ClaraCapabilityRequest[]
```

- [ ] **Step 2: Author the migration by hand (additive only)**

Create `prisma/migrations/20260731000000_clara_capability_requests/migration.sql`:

```sql
-- CreateEnum
CREATE TYPE "ClaraGapCategory" AS ENUM ('LOGS', 'NUTRITION', 'MEAL_PLAN', 'JOURNAL', 'SUPPLEMENTS', 'FILTERS', 'GROCERY', 'RESTAURANTS', 'FRIDGE', 'EXCHANGES', 'PROGRESS', 'TASTE', 'CUSTOM_INGREDIENTS', 'BODY_GOALS', 'OTHER');

-- CreateEnum
CREATE TYPE "ClaraGapReason" AS ENUM ('NOT_BUILT', 'FLAGGED_OFF', 'OUT_OF_SCOPE', 'UNCLEAR');

-- CreateTable
CREATE TABLE "ClaraCapabilityRequest" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "category" "ClaraGapCategory" NOT NULL,
    "reason" "ClaraGapReason" NOT NULL DEFAULT 'NOT_BUILT',
    "summary" TEXT NOT NULL,
    "surface" TEXT NOT NULL DEFAULT 'unknown',
    "localDate" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaraCapabilityRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClaraCapabilityRequest_patientId_category_localDate_key" ON "ClaraCapabilityRequest"("patientId", "category", "localDate");

-- CreateIndex
CREATE INDEX "ClaraCapabilityRequest_category_createdAt_idx" ON "ClaraCapabilityRequest"("category", "createdAt");

-- AddForeignKey
ALTER TABLE "ClaraCapabilityRequest" ADD CONSTRAINT "ClaraCapabilityRequest_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

Then run `npx prisma generate` (NOT `migrate dev` — migrations apply at the release gate).

- [ ] **Step 3: Write the failing gap tests**

Create `lib/clara/gap.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeGapInput, gapSkill, GAP_CATEGORIES, GAP_DAILY_CAP } from "./gap";

test("a well-formed report normalizes", () => {
  const r = normalizeGapInput({ category: "LOGS", summary: "wanted last week's meals", reason: "NOT_BUILT" });
  assert.deepEqual(r, { ok: true, value: { category: "LOGS", summary: "wanted last week's meals", reason: "NOT_BUILT" } });
});

test("reason defaults to NOT_BUILT", () => {
  const r = normalizeGapInput({ category: "GROCERY", summary: "add milk" });
  assert.equal(r.ok && r.value.reason, "NOT_BUILT");
});

test("an unknown category falls back to OTHER rather than failing the turn", () => {
  const r = normalizeGapInput({ category: "TELEPORTATION", summary: "beam me up" });
  assert.equal(r.ok && r.value.category, "OTHER");
});

test("summary is required and trimmed to 200 chars", () => {
  assert.equal(normalizeGapInput({ category: "LOGS" }).ok, false);
  assert.equal(normalizeGapInput({ category: "LOGS", summary: "   " }).ok, false);
  const long = normalizeGapInput({ category: "LOGS", summary: "x".repeat(500) });
  assert.equal(long.ok && long.value.summary.length, 200);
});

test("every planned skill has a category, plus OTHER", () => {
  for (const c of ["LOGS", "NUTRITION", "MEAL_PLAN", "JOURNAL", "SUPPLEMENTS", "FILTERS",
                   "GROCERY", "RESTAURANTS", "FRIDGE", "EXCHANGES", "PROGRESS", "TASTE",
                   "CUSTOM_INGREDIENTS", "BODY_GOALS", "OTHER"]) {
    assert.ok(GAP_CATEGORIES.includes(c), `${c} missing`);
  }
});

test("gap_report takes no identity field and is capped per user per day", () => {
  const def = gapSkill.tools[0].def;
  assert.equal(def.name, "gap_report");
  assert.deepEqual(Object.keys(def.input_schema.properties).sort(), ["category", "reason", "summary"]);
  assert.equal(GAP_DAILY_CAP, 10);
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `npm test -- --test-name-pattern="gap"`
Expected: FAIL — cannot find module `./gap`.

- [ ] **Step 5: Write `lib/clara/gap.ts`**

```ts
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import type { ClaraContext, Skill, ToolResult } from "./types";

export const GAP_CATEGORIES = [
  "LOGS", "NUTRITION", "MEAL_PLAN", "JOURNAL", "SUPPLEMENTS", "FILTERS",
  "GROCERY", "RESTAURANTS", "FRIDGE", "EXCHANGES", "PROGRESS", "TASTE",
  "CUSTOM_INGREDIENTS", "BODY_GOALS", "OTHER",
] as const;

export const GAP_REASONS = ["NOT_BUILT", "FLAGGED_OFF", "OUT_OF_SCOPE", "UNCLEAR"] as const;

export const MAX_GAP_SUMMARY = 200;
/** Gap rows one user may create per day. Beyond it, reports are dropped silently. */
export const GAP_DAILY_CAP = 10;
export const GAP_RATE_LIMIT_NAME = "clara-gap-day";
export const GAP_RATE_LIMIT_WINDOW_SEC = 86400;

export interface NormalizedGap {
  category: (typeof GAP_CATEGORIES)[number];
  reason: (typeof GAP_REASONS)[number];
  summary: string;
}

/**
 * Model input is untrusted text: an unknown category degrades to OTHER instead
 * of failing, because losing the signal is worse than mis-filing it. Only a
 * missing summary is fatal — a row with no content is not demand data.
 */
export function normalizeGapInput(
  input: Record<string, unknown>
): { ok: true; value: NormalizedGap } | { ok: false; message: string } {
  const rawSummary = typeof input.summary === "string" ? input.summary.trim() : "";
  if (rawSummary.length === 0) {
    return { ok: false, message: "summary is required" };
  }
  const category = GAP_CATEGORIES.includes(input.category as never)
    ? (input.category as NormalizedGap["category"])
    : "OTHER";
  const reason = GAP_REASONS.includes(input.reason as never)
    ? (input.reason as NormalizedGap["reason"])
    : "NOT_BUILT";
  return {
    ok: true,
    value: { category, reason, summary: rawSummary.slice(0, MAX_GAP_SUMMARY) },
  };
}

/**
 * Runtime-owned, always active — this is not a product skill and must never be
 * disabled by CLARA_SKILLS (see registry.ts).
 */
export const gapSkill: Skill = {
  name: "gap",
  promptFragment:
    "About gap_report: call it once, silently, whenever the user asks for something none of your tools can do — reading or changing data you have no tool for. Pick the closest category, write one plain sentence describing what they wanted in your own words (never quote them verbatim), then tell them plainly that you cannot do that yet. Do not call it for questions you can answer from your own knowledge, and never mention the tool itself.",
  tools: [
    {
      def: {
        name: "gap_report",
        description:
          "Record that the user asked for a capability you do not have. Call it once per unmet request, before you tell them you cannot help. Do NOT call it when you were able to answer.",
        input_schema: {
          type: "object",
          properties: {
            category: {
              type: "string",
              enum: [...GAP_CATEGORIES],
              description: "The area of the product the request belongs to. Use OTHER only when nothing fits.",
            },
            summary: {
              type: "string",
              description: "One plain sentence describing what the user wanted, in your own words. Max 200 characters.",
            },
            reason: {
              type: "string",
              enum: [...GAP_REASONS],
              description:
                "NOT_BUILT if no such tool exists; OUT_OF_SCOPE for orders, payments, subscription or account settings; UNCLEAR if you could not tell what they meant.",
            },
          },
          required: ["category", "summary"],
        },
      },
      handler: async (ctx: ClaraContext, input): Promise<ToolResult> => {
        const parsed = normalizeGapInput(input);
        if (!parsed.ok) return { ok: false, reason: "INVALID_INPUT", message: parsed.message };

        const { success } = await rateLimit(
          GAP_RATE_LIMIT_NAME, ctx.patientId, GAP_DAILY_CAP, GAP_RATE_LIMIT_WINDOW_SEC
        );
        // Over the cap: acknowledge and drop. The user's chat must not change
        // because of an internal telemetry limit.
        if (!success) return { ok: true, data: { recorded: false } };

        await prisma.claraCapabilityRequest.upsert({
          where: {
            patientId_category_localDate: {
              patientId: ctx.patientId,
              category: parsed.value.category,
              localDate: ctx.today,
            },
          },
          create: {
            patientId: ctx.patientId,
            category: parsed.value.category,
            reason: parsed.value.reason,
            summary: parsed.value.summary,
            surface: ctx.surface,
            localDate: ctx.today,
          },
          // Same user, same category, same day ⇒ keep the first row. Ranking
          // counts distinct users, so repeats must not inflate anything.
          update: {},
        });

        return { ok: true, data: { recorded: true } };
      },
    },
  ],
};
```

- [ ] **Step 6: Register it as always-on**

In `lib/clara/registry.ts`, import `gapSkill` and make it exempt from the allow-list:

```ts
import { gapSkill } from "./gap";

/** Product skills — subject to CLARA_SKILLS. */
export const ALL_SKILLS: Skill[] = [profileSkill];

/**
 * Runtime skills are always active: gap_report is how we learn what to build
 * next, so a CLARA_SKILLS value must never be able to silence it.
 */
export const RUNTIME_SKILLS: Skill[] = [gapSkill];

export function resolveActiveSkills(all: Skill[], envValue: string | undefined): Skill[] {
  if (envValue === undefined) return [...all, ...RUNTIME_SKILLS];
  const allowed = new Set(
    envValue.split(",").map((s) => s.trim()).filter((s) => s.length > 0)
  );
  return [...all.filter((s) => allowed.has(s.name)), ...RUNTIME_SKILLS];
}
```

Then update `lib/clara/registry.test.ts` — the runtime skill is now always appended, so three assertions change and one is added:

```ts
test("an unset CLARA_SKILLS enables every registered skill", () => {
  assert.deepEqual(resolveActiveSkills([alpha, beta], undefined).map((s) => s.name), ["alpha", "beta", "gap"]);
});

test("CLARA_SKILLS is an allow-list; unknown tokens are ignored", () => {
  assert.deepEqual(resolveActiveSkills([alpha, beta], "beta,ghost").map((s) => s.name), ["beta", "gap"]);
});

test("an empty CLARA_SKILLS disables product skills but never the runtime one", () => {
  assert.deepEqual(resolveActiveSkills([alpha, beta], "").map((s) => s.name), ["gap"]);
});

test("gap_report cannot be switched off by any CLARA_SKILLS value", () => {
  for (const env of [undefined, "", "alpha", "ghost"]) {
    assert.ok(resolveActiveSkills([alpha], env).some((s) => s.name === "gap"), `env=${String(env)}`);
  }
});
```

In the same file, change the two whole-registry tests to iterate both lists:

```ts
const { ALL_SKILLS, RUNTIME_SKILLS } = await import("./registry");
const everySkill = [...ALL_SKILLS, ...RUNTIME_SKILLS];
```

and use `everySkill` where they previously used `ALL_SKILLS`. The `buildToolDefs`/prompt-fragment test passes `[alpha]` directly rather than through `resolveActiveSkills`, so it needs no change.

- [ ] **Step 7: Run tests, typecheck, build**

```bash
npm test
npx tsc --noEmit
npm run build
```
Expected: PASS / clean / green.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260731000000_clara_capability_requests lib/clara/gap.ts lib/clara/gap.test.ts lib/clara/registry.ts lib/clara/registry.test.ts
git commit -m "feat(clara): capability-gap ledger + always-on gap_report tool (C0 E5)"
```

---

## Task E6: The gap report (admin route + page)

> **REQUIRED:** invoke the `ui-ux-pro-max:ui-ux-pro-max` skill before editing the `.tsx` file (house rule + cycle.md §4.9).

**Files:**
- Create: `lib/clara/admin-gaps.ts`, `app/api/admin/clara-gaps/route.ts`, `app/(dashboard)/admin/clara-gaps/page.tsx`
- Test: `lib/clara/admin-gaps.test.ts`

**Interfaces:**
- Consumes: `requireAdmin`, `adminErrorResponse` from `@/lib/admin`; `GAP_CATEGORIES` from `./gap`.
- Produces: `aggregateGaps(rows, opts): GapReport` where `GapReport = { buildable: GapRow[]; outOfScope: GapRow[]; flaggedOff: GapRow[]; totalRows: number }` and `GapRow = { category: string; distinctUsers: number; rows: number; trend: number | null; samples: string[] }`, plus `MIN_SAMPLE_USERS = 20` and `MIN_SAMPLE_DAYS = 14`.

- [ ] **Step 1: Write the failing aggregation tests**

Create `lib/clara/admin-gaps.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateGaps, MIN_SAMPLE_USERS, MIN_SAMPLE_DAYS } from "./admin-gaps";

const row = (patientId: string, category: string, reason = "NOT_BUILT", summary = "s") =>
  ({ patientId, category, reason, summary, surface: "web", localDate: "2026-07-31" });

test("ranking counts distinct users, not rows", () => {
  const report = aggregateGaps(
    [row("p1", "LOGS"), row("p1", "LOGS"), row("p1", "LOGS"), row("p2", "JOURNAL"), row("p3", "JOURNAL")],
    { previous: [] }
  );
  assert.deepEqual(report.buildable.map((r) => [r.category, r.distinctUsers, r.rows]), [
    ["JOURNAL", 2, 2],
    ["LOGS", 1, 3],
  ]);
});

test("OUT_OF_SCOPE and FLAGGED_OFF never enter the buildable list", () => {
  const report = aggregateGaps(
    [row("p1", "LOGS"), row("p2", "OTHER", "OUT_OF_SCOPE"), row("p3", "GROCERY", "FLAGGED_OFF")],
    { previous: [] }
  );
  assert.deepEqual(report.buildable.map((r) => r.category), ["LOGS"]);
  assert.deepEqual(report.outOfScope.map((r) => r.category), ["OTHER"]);
  assert.deepEqual(report.flaggedOff.map((r) => r.category), ["GROCERY"]);
});

test("trend compares distinct users against the previous window", () => {
  const report = aggregateGaps([row("p1", "LOGS"), row("p2", "LOGS")], { previous: [row("p9", "LOGS")] });
  assert.equal(report.buildable[0].trend, 1);
});

test("trend is null when the category is new this window", () => {
  const report = aggregateGaps([row("p1", "LOGS")], { previous: [] });
  assert.equal(report.buildable[0].trend, null);
});

test("at most three sample summaries are surfaced per category", () => {
  const rows = ["a", "b", "c", "d"].map((s, i) => row(`p${i}`, "LOGS", "NOT_BUILT", s));
  assert.equal(aggregateGaps(rows, { previous: [] }).buildable[0].samples.length, 3);
});

test("the re-rank thresholds match the spec", () => {
  assert.equal(MIN_SAMPLE_USERS, 20);
  assert.equal(MIN_SAMPLE_DAYS, 14);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --test-name-pattern="distinct users|buildable|trend"`
Expected: FAIL — cannot find module `./admin-gaps`.

- [ ] **Step 3: Write `lib/clara/admin-gaps.ts`**

```ts
/** Demand thresholds before measured demand may override the default wave order (spec §8 Q12). */
export const MIN_SAMPLE_USERS = 20;
export const MIN_SAMPLE_DAYS = 14;

const SAMPLES_PER_CATEGORY = 3;

export interface GapInputRow {
  patientId: string;
  category: string;
  reason: string;
  summary: string;
  surface: string;
  localDate: string;
}

export interface GapRow {
  category: string;
  distinctUsers: number;
  rows: number;
  /** Change in distinct users vs the previous window; null if new. */
  trend: number | null;
  samples: string[];
}

export interface GapReport {
  buildable: GapRow[];
  outOfScope: GapRow[];
  flaggedOff: GapRow[];
  totalRows: number;
}

function group(rows: GapInputRow[]): Map<string, { users: Set<string>; rows: number; samples: string[] }> {
  const out = new Map<string, { users: Set<string>; rows: number; samples: string[] }>();
  for (const r of rows) {
    const entry = out.get(r.category) ?? { users: new Set<string>(), rows: 0, samples: [] };
    entry.users.add(r.patientId);
    entry.rows += 1;
    if (entry.samples.length < SAMPLES_PER_CATEGORY) entry.samples.push(r.summary);
    out.set(r.category, entry);
  }
  return out;
}

function toRows(rows: GapInputRow[], previous: Map<string, number>): GapRow[] {
  return [...group(rows).entries()]
    .map(([category, e]) => ({
      category,
      distinctUsers: e.users.size,
      rows: e.rows,
      trend: previous.has(category) ? e.users.size - previous.get(category)! : null,
      samples: e.samples,
    }))
    .sort((a, b) => b.distinctUsers - a.distinctUsers || a.category.localeCompare(b.category));
}

/**
 * Turns raw gap rows into the owner-facing report. Buildable demand excludes
 * OUT_OF_SCOPE (policy pressure — deliberately never built) and FLAGGED_OFF
 * (an ops problem, not backlog), so neither can drift into the build order.
 */
export function aggregateGaps(
  rows: GapInputRow[],
  opts: { previous: GapInputRow[] }
): GapReport {
  const previousUsers = new Map<string, number>();
  for (const [category, e] of group(opts.previous)) previousUsers.set(category, e.users.size);

  return {
    buildable: toRows(rows.filter((r) => r.reason === "NOT_BUILT" || r.reason === "UNCLEAR"), previousUsers),
    outOfScope: toRows(rows.filter((r) => r.reason === "OUT_OF_SCOPE"), previousUsers),
    flaggedOff: toRows(rows.filter((r) => r.reason === "FLAGGED_OFF"), previousUsers),
    totalRows: rows.length,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Write `app/api/admin/clara-gaps/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";
import { aggregateGaps, MIN_SAMPLE_DAYS, MIN_SAMPLE_USERS } from "@/lib/clara/admin-gaps";
import { parseLocalDateStrict } from "@/lib/journal";

// GET /api/admin/clara-gaps?from=YYYY-MM-DD&to=YYYY-MM-DD
// Owner-only demand report: what users asked Clara for that she could not do.
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();

    const { searchParams } = new URL(req.url);
    const rawFrom = searchParams.get("from");
    const rawTo = searchParams.get("to");
    if ((rawFrom && !parseLocalDateStrict(rawFrom)) || (rawTo && !parseLocalDateStrict(rawTo))) {
      return NextResponse.json({ error: "from/to must be YYYY-MM-DD strings" }, { status: 400 });
    }

    const to = rawTo ?? new Date().toISOString().slice(0, 10);
    const from = rawFrom ?? new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);

    const windowDays = Math.max(
      1,
      Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1
    );
    const prevTo = new Date(Date.parse(from) - 86_400_000).toISOString().slice(0, 10);
    const prevFrom = new Date(Date.parse(from) - windowDays * 86_400_000).toISOString().slice(0, 10);

    const select = { patientId: true, category: true, reason: true, summary: true, surface: true, localDate: true };
    const [rows, previous] = await Promise.all([
      prisma.claraCapabilityRequest.findMany({ where: { localDate: { gte: from, lte: to } }, select }),
      prisma.claraCapabilityRequest.findMany({ where: { localDate: { gte: prevFrom, lte: prevTo } }, select }),
    ]);

    const report = aggregateGaps(rows, { previous });
    const distinctUsers = new Set(rows.map((r) => r.patientId)).size;

    return NextResponse.json({
      from, to, windowDays,
      ...report,
      sampleReady: distinctUsers >= MIN_SAMPLE_USERS && windowDays >= MIN_SAMPLE_DAYS,
      thresholds: { minUsers: MIN_SAMPLE_USERS, minDays: MIN_SAMPLE_DAYS, distinctUsers },
    });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
```

- [ ] **Step 6: Build the page**

Invoke `ui-ux-pro-max:ui-ux-pro-max` first. Create `app/(dashboard)/admin/clara-gaps/page.tsx` as a `"use client"` component following the visual conventions already used in `app/(dashboard)/admin/coupons/page.tsx` (same palette tokens `#F9F7ED` / `#EAE4CA` / `#1E1A1A`, same `fieldClass`/`labelClass` shapes, same card rhythm). It must render:

- a from/to date range control defaulting to the last 30 days;
- a **"Build next"** ranked table of `buildable` — category, distinct users, rows, trend arrow, sample summaries;
- a `sampleReady` banner: below threshold, state plainly that the default wave order still stands and show `distinctUsers`/`windowDays` against the thresholds;
- **separate, visually secondary** sections for `outOfScope` and `flaggedOff`, each labelled with why it does not drive the build order.

- [ ] **Step 7: Verify the page renders**

Run: `npm run build`
Expected: green. (Per memory, the local dev server cannot render pages — an invalid Clerk key 500s every route — so build success plus the aggregation unit tests are the evidence here; live verification is a release-gate item.)

- [ ] **Step 8: Commit**

```bash
git add lib/clara/admin-gaps.ts lib/clara/admin-gaps.test.ts app/api/admin/clara-gaps app/\(dashboard\)/admin/clara-gaps
git commit -m "feat(clara): owner-only capability-gap report (C0 E6)"
```

---

## Task E7: Routing eval harness

**Files:**
- Create: `lib/clara/__fixtures__/routing.ts`, `scripts/clara-routing-eval.mjs`
- Modify: `package.json` (add the `clara:routing-eval` script)

**Interfaces:**
- Consumes: `ALL_SKILLS`, `RUNTIME_SKILLS`, `buildToolDefs`, `buildSystemPrompt` from `lib/clara/registry.ts`.
- Produces: `ROUTING_FIXTURE: RoutingCase[]` where `RoutingCase = { utterance: string; expect: string | null; note?: string }` (`expect: null` ⇒ Clara should answer with no tool at all).

- [ ] **Step 1: Seed the fixture**

Create `lib/clara/__fixtures__/routing.ts`:

```ts
/**
 * Utterance → expected tool. Every skill cycle APPENDS 10–20 cases here and
 * re-runs the whole accumulated set via `npm run clara:routing-eval` at audit
 * (spec §4.3). Bar: ≥90% top-1. `expect: null` means the right move is to
 * answer conversationally without calling anything.
 */
export interface RoutingCase {
  utterance: string;
  expect: string | null;
  note?: string;
}

export const ROUTING_FIXTURE: RoutingCase[] = [
  // ── profile (C0) ──
  { utterance: "what's on my dietary profile right now?", expect: "profile_get" },
  { utterance: "remind me which allergies you have on file for me", expect: "profile_get" },
  { utterance: "read back my food preferences", expect: "profile_get" },

  // ── no tool: Clara's native dish check ──
  { utterance: "is a chicken burrito okay for me?", expect: null, note: "answers from the prompt snapshot" },
  { utterance: "how much protein should I eat a day?", expect: null, note: "general knowledge" },
  { utterance: "thanks Clara!", expect: null },

  // ── gaps: capabilities that do not exist yet in C0 ──
  { utterance: "what did I eat two weeks ago?", expect: "gap_report", note: "S1 not built" },
  { utterance: "log that ramen for lunch", expect: "gap_report", note: "S1 not built" },
  { utterance: "add shellfish to my allergies", expect: "gap_report", note: "S6 not built; profile_get is read-only" },
  { utterance: "what's for dinner tomorrow?", expect: "gap_report", note: "S3 not built" },
  { utterance: "is oat milk on my grocery list?", expect: "gap_report", note: "S7 not built" },
  { utterance: "cancel my subscription", expect: "gap_report", note: "OUT_OF_SCOPE, still recorded" },
];
```

- [ ] **Step 2: Write the eval script**

Create `scripts/clara-routing-eval.mjs`:

```js
// Opt-in recognition eval. NOT part of `npm test`: it makes real Anthropic
// calls, so it is slow, costs money, and is non-deterministic. The controller
// runs it during the cycle's audit phase and records the score in the ledger.
//
//   ANTHROPIC_API_KEY=... npm run clara:routing-eval
//
// Bar: >= 90% top-1 tool selection (spec §4.3). Exits 1 below the bar.

import Anthropic from "@anthropic-ai/sdk";
import { ROUTING_FIXTURE } from "../lib/clara/__fixtures__/routing.ts";
import { ALL_SKILLS, RUNTIME_SKILLS, buildToolDefs, buildSystemPrompt } from "../lib/clara/registry.ts";

const BAR = 0.9;
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const active = [...ALL_SKILLS, ...RUNTIME_SKILLS];
const tools = buildToolDefs(active);
const system = buildSystemPrompt("Sam", "No allergies on file.", active, "2026-07-31");

let pass = 0;
const failures = [];

for (const testCase of ROUTING_FIXTURE) {
  const message = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1024,
    thinking: { type: "disabled" },
    system,
    tools,
    messages: [{ role: "user", content: testCase.utterance }],
  });
  const called = message.content.find((b) => b.type === "tool_use")?.name ?? null;
  if (called === testCase.expect) {
    pass += 1;
  } else {
    failures.push({ utterance: testCase.utterance, expected: testCase.expect, got: called });
  }
}

const score = pass / ROUTING_FIXTURE.length;
console.log(`\nrouting-eval: ${pass}/${ROUTING_FIXTURE.length} = ${(score * 100).toFixed(1)}% (bar ${BAR * 100}%)`);
for (const f of failures) {
  console.log(`  MISS  "${f.utterance}"  expected=${f.expected ?? "none"}  got=${f.got ?? "none"}`);
}
process.exit(score >= BAR ? 0 : 1);
```

- [ ] **Step 3: Add the script to `package.json`**

```json
"clara:routing-eval": "node --import tsx scripts/clara-routing-eval.mjs",
```

- [ ] **Step 4: Verify the harness runs**

Run: `ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY npm run clara:routing-eval`
Expected: a printed score. **Record the exact number in the ledger.** If below 90%, the fix is tool descriptions and prompt fragments (E2/E5) — not lowering the bar.

- [ ] **Step 5: Commit**

```bash
git add lib/clara/__fixtures__/routing.ts scripts/clara-routing-eval.mjs package.json
git commit -m "test(clara): routing eval harness + C0 fixture seed (C0 E7)"
```

---

## Task T1 (Clara iOS): send the local date with every chat turn

**Repo:** `~/Desktop/BeTech/Clara` — a separate work branch, merged and pushed alongside the engine branch.

**Files:**
- Modify: `Clara/Features/Chat/ChatWireMessage.swift` (extend `ChatWireRequestBody`, add the factory)
- Modify: `Clara/Core/Networking/WondishAPIClient.swift:245-260` (`buildChatURLRequest`)
- Test: `ClaraTests/StreamChatTests.swift` (append — **no new files**, so `project.pbxproj` is untouched; cycle.md §4.6)

**Interfaces:**
- Consumes: nothing new.
- Produces: `ChatWireRequestBody.make(messages:now:timeZone:) -> ChatWireRequestBody`.

**Design note — why the protocol signature does NOT change.** `streamChat(messages:)` is a
`ChatStreaming` protocol method (`ChatViewModel.swift:14`) with a test double
(`ClaraTests/Support/ScriptedChatStreaming.swift`). The local date is a property of the
*transport*, not of a call site's arguments, so it is assembled inside
`buildChatURLRequest`. `ChatViewModel` and `ScriptedChatStreaming` therefore have **zero
diff**, and no existing chat test changes meaning.

**Wire agreement with E4** (must match byte-for-byte):
`clientDate` is `"YYYY-MM-DD"` in the device's current timezone · `tzOffsetMinutes` is
minutes **east of UTC** (UTC-5 ⇒ `-300`, same sign convention as the web client's
`-getTimezoneOffset()`) · `surface` is the literal `"ios"`.

- [ ] **Step 1: Write the failing tests**

Append to `ClaraTests/StreamChatTests.swift`:

```swift
// MARK: - Chat body date fields (C0 T1)

func testBodyCarriesLocalDateInTheDeviceTimeZone() throws {
    // 2026-07-31T00:30Z is still 2026-07-30 for a UTC-7 device — the exact
    // case that made the server's UTC fallback say tomorrow.
    let now = Date(timeIntervalSince1970: 1_785_198_600) // 2026-07-31T00:30:00Z
    let tz = try XCTUnwrap(TimeZone(secondsFromGMT: -7 * 3600))
    let body = ChatWireRequestBody.make(
        messages: [ChatWireMessage(role: "user", content: "hi")],
        now: now,
        timeZone: tz
    )
    XCTAssertEqual(body.clientDate, "2026-07-30")
    XCTAssertEqual(body.tzOffsetMinutes, -420)
    XCTAssertEqual(body.surface, "ios")
}

func testBodyEncodesTheNewFieldsAlongsideMessages() throws {
    let body = ChatWireRequestBody.make(
        messages: [ChatWireMessage(role: "user", content: "hi")],
        now: Date(timeIntervalSince1970: 1_785_198_600),
        timeZone: try XCTUnwrap(TimeZone(secondsFromGMT: 0))
    )
    let data = try JSONEncoder().encode(body)
    let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    XCTAssertEqual(json["clientDate"] as? String, "2026-07-31")
    XCTAssertEqual(json["tzOffsetMinutes"] as? Int, 0)
    XCTAssertEqual(json["surface"] as? String, "ios")
    XCTAssertEqual((json["messages"] as? [[String: String]])?.count, 1)
}

func testClientDateIsGregorianRegardlessOfDeviceLocale() throws {
    // A non-Gregorian device calendar must not leak into the wire string.
    let body = ChatWireRequestBody.make(
        messages: [],
        now: Date(timeIntervalSince1970: 1_785_198_600),
        timeZone: try XCTUnwrap(TimeZone(secondsFromGMT: 0))
    )
    XCTAssertEqual(body.clientDate, "2026-07-31")
    XCTAssertEqual(body.clientDate.count, 10)
}
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd ~/Desktop/BeTech/Clara
xcodebuild test -scheme Clara -destination 'platform=iOS Simulator,name=iPhone 16' \
  -only-testing:ClaraTests/StreamChatTests 2>&1 | tail -30
```
Expected: compile failure — `ChatWireRequestBody.make` does not exist.

- [ ] **Step 3: Extend `ChatWireRequestBody`**

In `Clara/Features/Chat/ChatWireMessage.swift`, replace the `ChatWireRequestBody` struct with:

```swift
/// The `POST /api/dish-checker` request body. `messages` is the pinned field;
/// `clientDate`/`tzOffsetMinutes`/`surface` are the additive extensions the C0
/// skill runtime reads (server drops them if malformed, so an older build keeps
/// working unchanged).
///
/// The date is assembled at request time from the device clock and timezone —
/// it is a transport concern, which is why `ChatStreaming.streamChat(messages:)`
/// keeps its signature.
struct ChatWireRequestBody: Encodable {
    let messages: [ChatWireMessage]
    /// "YYYY-MM-DD" in the device's timezone. Clara resolves "two weeks ago"
    /// against this; without it the server falls back to its own UTC date and
    /// deliberately asserts no date at all.
    let clientDate: String
    /// Minutes east of UTC (UTC-5 ⇒ -300), matching the web client's
    /// `-getTimezoneOffset()`. The server rejects anything beyond ±840.
    let tzOffsetMinutes: Int
    /// Attributes capability-gap rows to the iOS surface.
    let surface: String

    static func make(
        messages: [ChatWireMessage],
        now: Date = Date(),
        timeZone: TimeZone = .current
    ) -> ChatWireRequestBody {
        let formatter = DateFormatter()
        // POSIX locale + explicit Gregorian calendar: a device set to a
        // non-Gregorian calendar would otherwise emit an unparseable string.
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = timeZone
        formatter.dateFormat = "yyyy-MM-dd"

        return ChatWireRequestBody(
            messages: messages,
            clientDate: formatter.string(from: now),
            tzOffsetMinutes: timeZone.secondsFromGMT(for: now) / 60,
            surface: "ios"
        )
    }
}
```

- [ ] **Step 4: Use the factory in the request builder**

In `Clara/Core/Networking/WondishAPIClient.swift:258`, replace:

```swift
        urlRequest.httpBody = try encoder.encode(ChatWireRequestBody(messages: messages))
```

with:

```swift
        urlRequest.httpBody = try encoder.encode(ChatWireRequestBody.make(messages: messages))
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
xcodebuild test -scheme Clara -destination 'platform=iOS Simulator,name=iPhone 16' \
  -only-testing:ClaraTests/StreamChatTests 2>&1 | tail -30
```
Expected: PASS, including the pre-existing `StreamChatTests` cases (the body gained fields; nothing it asserted was removed).

- [ ] **Step 6: Run the whole suite**

```bash
xcodebuild test -scheme Clara -destination 'platform=iOS Simulator,name=iPhone 16' 2>&1 | tail -20
```
Expected: PASS — `ChatViewModelTests`, `StreamChatLoopbackIntegrationTests` and the rest are untouched by design.

- [ ] **Step 7: Commit**

```bash
git add Clara/Features/Chat/ChatWireMessage.swift Clara/Core/Networking/WondishAPIClient.swift ClaraTests/StreamChatTests.swift
git commit -m "feat(chat): send clientDate, tz offset and surface with each turn (C0 T1)"
```

---

## Cycle close-out (controller)

- [ ] Final whole-branch review on the strongest model: contract walk of `app/api/dish-checker/route.ts` old vs new (byte-identical behavior for a valid legacy body), auth-scope check of every tool schema, migration additivity.
- [ ] Audit: `npm test` full suite, `npx tsc --noEmit`, `npm run build`, the full `xcodebuild test` suite in the Clara repo, and the routing-eval score recorded.
- [ ] Cross-repo contract walk: T1's encoded body vs E4's `parseClaraRequestOptions` — field names, the `tzOffsetMinutes` sign convention, and the `"ios"` surface literal.
- [ ] Ledger close-out block in `.superpowers/sdd/progress.md`: commits, test counts, deviations, post-merge tickets.
- [ ] Release gate: apply `20260731000000_clara_capability_requests` via `prisma migrate deploy` **before** any chat traffic hits the new tool; confirm `ANTHROPIC_API_KEY` in Vercel prod; decide whether `CLARA_SKILLS` is set (unset ⇒ profile + gap active); unauthenticated probe of `/api/admin/clara-gaps` returns JSON 401.
- [ ] Memory update: the always-on `gap_report` contract and the `lib/clara/` one-file-per-skill rule.
