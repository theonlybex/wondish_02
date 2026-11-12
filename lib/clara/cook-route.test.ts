import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The route itself needs Clerk and Next to run; this pins its shape, the same
// way custom-plans.test.ts pins the profile route.
const src = readFileSync("app/api/clara/conversations/[id]/cook/route.ts", "utf8");

test("the cook route is rate limited per signed-in person, sized for someone cooking (30 a minute)", () => {
  assert.match(src, /import \{ rateLimit \} from "@\/lib\/rate-limit";/);
  assert.match(src, /rateLimit\("clara-cook", caller\.userId, 30, 60\)/);
  assert.match(src, /status: 429/);
});

test("the cook route checks the limit before it reads the body", () => {
  const limit = src.indexOf('rateLimit("clara-cook"');
  const body = src.indexOf("req.json()");
  assert.ok(limit > 0 && body > 0 && limit < body);
});
