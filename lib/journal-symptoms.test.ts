import { test } from "node:test";
import assert from "node:assert/strict";
import { trackingItemsForPatient, validateSymptoms, type SymptomDb } from "./journal-symptoms";

function fakeDb(items: { id: string; label: string; condition: { name: string } }[], monitored: string[] | null): SymptomDb {
  return {
    conditionTrackingItem: { findMany: async () => items },
    triggerTrial: { findFirst: async () => (monitored ? { rule: { monitored: monitored.map((trackingItemId) => ({ trackingItemId })) } } : null) },
  };
}

test("trackingItemsForPatient puts trial-linked items first and keeps the rest in condition/label order", async () => {
  const db = fakeDb(
    [
      { id: "a", label: "Bloating", condition: { name: "GERD" } },
      { id: "b", label: "Heartburn", condition: { name: "GERD" } },
      { id: "c", label: "Headache", condition: { name: "Migraine" } },
    ],
    ["c"]
  );
  const out = await trackingItemsForPatient(db, "p1");
  assert.deepEqual(out.map((i) => [i.id, i.inTrial]), [["c", true], ["a", false], ["b", false]]);
  assert.equal(out[0].conditionName, "Migraine");
  assert.deepEqual(await trackingItemsForPatient(fakeDb([], null), "p1"), []);
});

test("validateSymptoms accepts known items, null clears, rejects junk and dedupes", () => {
  const allowed = new Set(["a", "b"]);
  assert.deepEqual(validateSymptoms(undefined, allowed), { ok: true, rows: [] });
  assert.deepEqual(validateSymptoms([{ trackingItemId: "a", severity: "MILD" }, { trackingItemId: "b", severity: null }, { trackingItemId: "a", severity: "SEVERE" }], allowed), {
    ok: true,
    rows: [{ trackingItemId: "a", severity: "MILD" }, { trackingItemId: "b", severity: null }],
  });
  assert.equal(validateSymptoms([{ trackingItemId: "zzz", severity: "MILD" }], allowed).ok, false);
  assert.equal(validateSymptoms([{ trackingItemId: "a", severity: "HUGE" }], allowed).ok, false);
  assert.equal(validateSymptoms("nope", allowed).ok, false);
});
