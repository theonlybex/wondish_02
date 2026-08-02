// Opt-in recognition eval. NOT part of `npm test`: it makes real Anthropic
// calls, so it is slow, costs money, and is non-deterministic. The controller
// runs it during the cycle's audit phase and records the score in the ledger.
//
//   ANTHROPIC_API_KEY=... npm run clara:routing-eval
//
// Bar: >= 90% top-1 tool selection (spec §4.3). Exits 1 below the bar.

import Anthropic from "@anthropic-ai/sdk";
import { ROUTING_FIXTURE } from "../lib/clara/__fixtures__/routing.ts";
import {
  ALL_SKILLS,
  RUNTIME_SKILLS,
  buildToolDefs,
  buildSystemPrompt,
} from "../lib/clara/registry.ts";
import { CLARA_MODEL, CLARA_MAX_TOKENS } from "../lib/clara/anthropic-client.ts";

const BAR = 0.9;

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is required — this eval makes real model calls.");
  process.exit(2);
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const active = [...ALL_SKILLS, ...RUNTIME_SKILLS];
const tools = buildToolDefs(active);
const system = buildSystemPrompt("Sam", "No allergies on file.", active, "2026-07-31");

console.log(`routing-eval: ${ROUTING_FIXTURE.length} cases against ${tools.length} tools\n`);

let pass = 0;
const failures = [];

for (const testCase of ROUTING_FIXTURE) {
  let message;
  try {
    // Settings mirror lib/clara/anthropic-client.ts exactly — the eval must
    // measure the production configuration (thinking omitted ⇒ adaptive).
    message = await anthropic.messages.create({
      model: CLARA_MODEL,
      max_tokens: CLARA_MAX_TOKENS,
      system,
      tools,
      // Seeded history lets a case assert second-turn behavior (confirm flow).
      messages: [...(testCase.history ?? []), { role: "user", content: testCase.utterance }],
    });
  } catch (err) {
    // A partial score is worthless and a stack trace is unreadable: say what
    // broke and stop. Exit 2 = "could not measure", distinct from 1 = "below bar".
    if (err?.status === 401) {
      console.error(
        "\n\nrouting-eval: ANTHROPIC_API_KEY was rejected (401). The local .env key is a" +
          "\nplaceholder — run this with a real key, or at the release gate against prod env."
      );
    } else {
      console.error(`\n\nrouting-eval: aborted on "${testCase.utterance}" — ${err?.message ?? err}`);
    }
    process.exit(2);
  }
  const called = message.content.find((b) => b.type === "tool_use")?.name ?? null;
  if (called === testCase.expect) {
    pass += 1;
    process.stdout.write(".");
  } else {
    process.stdout.write("x");
    failures.push({ utterance: testCase.utterance, expected: testCase.expect, got: called });
  }
}

const score = pass / ROUTING_FIXTURE.length;
console.log(
  `\n\nrouting-eval: ${pass}/${ROUTING_FIXTURE.length} = ${(score * 100).toFixed(1)}% (bar ${BAR * 100}%)`
);
for (const f of failures) {
  console.log(`  MISS  "${f.utterance}"  expected=${f.expected ?? "none"}  got=${f.got ?? "none"}`);
}
process.exit(score >= BAR ? 0 : 1);
