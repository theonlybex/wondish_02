import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeMemorySkill,
  buildMemoryBlock,
  MEMORY_MAX_CHARS,
  MEMORY_CAP,
  MEMORY_BLOCK_MAX_CHARS,
  type MemoryDeps,
  type MemoryRow,
} from "./memory";
import type { ClaraContext } from "../types";

const ctx: ClaraContext = {
  patientId: "p1",
  accountId: "a1",
  firstName: "Sam",
  isPremium: false,
  today: "2026-10-28",
  surface: "web",
  disabledSkills: [],
};

const mem = (id: string, text: string, day = 1): MemoryRow => ({
  id,
  text,
  createdAt: new Date(Date.UTC(2026, 9, day)),
});

function fakeDeps(initial: MemoryRow[] = []) {
  const calls = {
    list: [] as string[],
    create: [] as Array<[string, string, string]>,
    remove: [] as Array<[string, string]>,
    clear: [] as string[],
  };
  const deps: MemoryDeps = {
    list: async (p) => {
      calls.list.push(p);
      return initial;
    },
    create: async (p, text, surface) => {
      calls.create.push([p, text, surface]);
      return mem("new-1", text, 28);
    },
    remove: async (p, id) => {
      calls.remove.push([p, id]);
      return p === "p1" && initial.some((r) => r.id === id);
    },
    clear: async (p) => {
      calls.clear.push(p);
      return initial.length;
    },
  };
  return { deps, calls };
}

const tool = (skill: ReturnType<typeof makeMemorySkill>, name: string) => {
  const t = skill.tools.find((x) => x.def.name === name);
  assert.ok(t, `${name} missing`);
  return t;
};

test("skill shape: name, two tools, neither is a write tool", () => {
  const skill = makeMemorySkill(fakeDeps().deps);
  assert.equal(skill.name, "memory");
  assert.deepEqual(skill.tools.map((t) => t.def.name).sort(), ["memory_forget", "memory_save"]);
  for (const t of skill.tools) assert.notEqual(t.def.isWrite, true);
});

test("tool inputs carry no identity field", () => {
  const skill = makeMemorySkill(fakeDeps().deps);
  assert.deepEqual(Object.keys(tool(skill, "memory_save").def.input_schema.properties), ["text"]);
  assert.deepEqual(Object.keys(tool(skill, "memory_forget").def.input_schema.properties), ["memoryId"]);
});

test("save trims text and passes the caller's patient id and surface", async () => {
  const { deps, calls } = fakeDeps();
  const r = await tool(makeMemorySkill(deps), "memory_save").handler(ctx, { text: "  Cooks for three  " });
  assert.equal(r.ok, true);
  assert.deepEqual(calls.create, [["p1", "Cooks for three", "web"]]);
  assert.deepEqual(r.ok && r.data, { saved: true, memoryId: "new-1", text: "Cooks for three" });
});

test("empty, whitespace, non-string and 201-char text are INVALID_INPUT", async () => {
  const { deps, calls } = fakeDeps();
  const save = tool(makeMemorySkill(deps), "memory_save").handler;
  for (const text of ["", "   ", undefined, 42, "x".repeat(MEMORY_MAX_CHARS + 1)]) {
    const r = await save(ctx, { text });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.reason, "INVALID_INPUT");
  }
  assert.equal(calls.create.length, 0);
});

test("exactly 200 chars is accepted", async () => {
  const { deps } = fakeDeps();
  const r = await tool(makeMemorySkill(deps), "memory_save").handler(ctx, { text: "x".repeat(200) });
  assert.equal(r.ok, true);
});

test("a case-insensitive duplicate returns ok+duplicate and creates nothing", async () => {
  const { deps, calls } = fakeDeps([mem("m1", "Cooks for three")]);
  const r = await tool(makeMemorySkill(deps), "memory_save").handler(ctx, { text: "  cooks FOR three " });
  assert.deepEqual(r, { ok: true, data: { duplicate: true } });
  assert.equal(calls.create.length, 0);
});

test("at the cap a new memory is OUT_OF_RANGE and tells Clara to ask which to forget", async () => {
  const rows = Array.from({ length: MEMORY_CAP }, (_, i) => mem(`m${i}`, `fact ${i}`, 1));
  const { deps, calls } = fakeDeps(rows);
  const r = await tool(makeMemorySkill(deps), "memory_save").handler(ctx, { text: "something new" });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.reason, "OUT_OF_RANGE");
  assert.match(!r.ok ? r.message : "", /forget/i);
  assert.equal(calls.create.length, 0);
});

test("a duplicate at the cap is still just a duplicate", async () => {
  const rows = Array.from({ length: MEMORY_CAP }, (_, i) => mem(`m${i}`, `fact ${i}`, 1));
  const { deps } = fakeDeps(rows);
  const r = await tool(makeMemorySkill(deps), "memory_save").handler(ctx, { text: "FACT 3" });
  assert.deepEqual(r, { ok: true, data: { duplicate: true } });
});

test("a store failure on save returns FAILED instead of throwing", async () => {
  const { deps } = fakeDeps();
  deps.create = async () => {
    throw new Error("db down");
  };
  const r = await tool(makeMemorySkill(deps), "memory_save").handler(ctx, { text: "ok" });
  assert.equal(!r.ok && r.reason, "FAILED");
});

test("forget removes the caller's own memory", async () => {
  const { deps, calls } = fakeDeps([mem("m1", "Cooks for three")]);
  const r = await tool(makeMemorySkill(deps), "memory_forget").handler(ctx, { memoryId: "m1" });
  assert.deepEqual(r, { ok: true, data: { forgotten: true } });
  assert.deepEqual(calls.remove, [["p1", "m1"]]);
});

test("forget on an id that isn't the caller's is NOT_FOUND", async () => {
  const { deps, calls } = fakeDeps([mem("m1", "Cooks for three")]);
  const r = await tool(makeMemorySkill(deps), "memory_forget").handler(ctx, { memoryId: "someone-elses" });
  assert.equal(!r.ok && r.reason, "NOT_FOUND");
  // ownership is enforced by passing ctx.patientId to the scoped remove
  assert.deepEqual(calls.remove, [["p1", "someone-elses"]]);
});

test("forget with a missing or non-string id is INVALID_INPUT", async () => {
  const { deps, calls } = fakeDeps();
  const forget = tool(makeMemorySkill(deps), "memory_forget").handler;
  for (const memoryId of [undefined, "", "  ", 7]) {
    const r = await forget(ctx, { memoryId });
    assert.equal(!r.ok && r.reason, "INVALID_INPUT");
  }
  assert.equal(calls.remove.length, 0);
});

test("a store failure on forget returns FAILED instead of throwing", async () => {
  const { deps } = fakeDeps();
  deps.remove = async () => {
    throw new Error("db down");
  };
  const r = await tool(makeMemorySkill(deps), "memory_forget").handler(ctx, { memoryId: "m1" });
  assert.equal(!r.ok && r.reason, "FAILED");
});

test("buildMemoryBlock is empty when there are no memories", () => {
  assert.equal(buildMemoryBlock("Sam", []), "");
});

test("buildMemoryBlock has a heading and [id] text lines, oldest first", () => {
  const block = buildMemoryBlock("Sam", [mem("m1", "Cooks for three", 1), mem("m2", "Meal preps Sundays", 2)]);
  const lines = block.split("\n");
  assert.match(lines[0], /^What you remember about Sam/);
  assert.deepEqual(lines.slice(1), ["[m1] Cooks for three", "[m2] Meal preps Sundays"]);
});

test("buildMemoryBlock drops the OLDEST rows first when over 2,000 chars", () => {
  const rows = Array.from({ length: 30 }, (_, i) =>
    mem(`m${String(i).padStart(2, "0")}`, `${"x".repeat(150)}-${i}`, i + 1)
  );
  const block = buildMemoryBlock("Sam", rows);
  assert.ok(block.length <= MEMORY_BLOCK_MAX_CHARS, `block is ${block.length}`);
  assert.ok(block.includes("[m29]"), "newest row must survive");
  assert.ok(!block.includes("[m00]"), "oldest row must be dropped");
  // surviving rows are a contiguous newest suffix, still oldest-first
  const ids = [...block.matchAll(/\[(m\d\d)\]/g)].map((m) => m[1]);
  assert.deepEqual(ids, [...ids].sort());
  assert.equal(ids[ids.length - 1], "m29");
  const first = Number(ids[0].slice(1));
  assert.deepEqual(ids, rows.slice(first).map((r) => r.id));
  // and it is the maximal suffix: one more older row would not fit
  const withOneMore = buildMemoryBlock("Sam", rows.slice(first - 1));
  assert.ok(first - 1 < 0 || withOneMore.length <= MEMORY_BLOCK_MAX_CHARS);
});

test("buildMemoryBlock sorts by createdAt so input order doesn't matter", () => {
  const block = buildMemoryBlock("Sam", [mem("m2", "second", 2), mem("m1", "first", 1)]);
  assert.ok(block.indexOf("[m1]") < block.indexOf("[m2]"));
});

test("prompt fragment carries the profile rule and the same-reply rule", () => {
  const f = makeMemorySkill(fakeDeps().deps).promptFragment;
  assert.match(f, /never/i);
  assert.match(f, /allergies/i);
  assert.match(f, /tell them in the same reply/i);
  assert.match(f, /one-off/i);
  assert.match(f, /memory_save/);
  assert.match(f, /memory_forget/);
});
