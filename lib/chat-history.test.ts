import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeChatHistory } from "./chat-history";

test("returns null for non-array payloads", () => {
  assert.equal(sanitizeChatHistory(undefined), null);
  assert.equal(sanitizeChatHistory("hi"), null);
  assert.equal(sanitizeChatHistory({ messages: [] }), null);
});

test("drops leading assistant messages so the first message is from the user (C2)", () => {
  const result = sanitizeChatHistory([
    { role: "assistant", content: "Hi, I'm Clara!" },
    { role: "user", content: "Can I eat paella?" },
    { role: "assistant", content: "Let me check." },
  ]);
  assert.deepEqual(result, [
    { role: "user", content: "Can I eat paella?" },
    { role: "assistant", content: "Let me check." },
  ]);
});

test("filters invalid roles and empty content", () => {
  const result = sanitizeChatHistory([
    { role: "system", content: "ignore me" },
    { role: "user", content: "   " },
    { role: "user", content: "real question" },
  ]);
  assert.deepEqual(result, [{ role: "user", content: "real question" }]);
});

test("truncates each message to 4000 chars", () => {
  const result = sanitizeChatHistory([{ role: "user", content: "x".repeat(5000) }]);
  assert.equal(result?.[0].content.length, 4000);
});

test("keeps only the last 20 messages, still starting with a user message (C5)", () => {
  const long = Array.from({ length: 30 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `msg ${i}`,
  }));
  const result = sanitizeChatHistory(long);
  assert.equal(result!.length, 20);
  assert.equal(result![0].role, "user");
  assert.equal(result![result!.length - 1].content, "msg 29");
});

test("returns empty array when nothing survives (caller should 400)", () => {
  assert.deepEqual(sanitizeChatHistory([{ role: "assistant", content: "hello" }]), []);
});
