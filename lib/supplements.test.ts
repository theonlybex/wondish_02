import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSupplementBody, validateIntakeBody, editsPillFacts } from "./supplements";

test("supplement create: accepts name + slot, trims, defaults dosage null", () => {
  const r = validateSupplementBody({ name: "  Vitamin D3 ", timeSlot: "MORNING" }, { partial: false });
  assert.deepEqual(r, { ok: true, name: "Vitamin D3", dosage: null, timeSlot: "MORNING" });
});

test("supplement create: keeps trimmed dosage", () => {
  const r = validateSupplementBody({ name: "Omega-3", dosage: " 1000 mg ", timeSlot: "EVENING" }, { partial: false });
  assert.deepEqual(r, { ok: true, name: "Omega-3", dosage: "1000 mg", timeSlot: "EVENING" });
});

test("supplement create: rejects missing/empty/whitespace name", () => {
  for (const name of [undefined, "", "   ", 42]) {
    const r = validateSupplementBody({ name, timeSlot: "MORNING" }, { partial: false });
    assert.equal(r.ok, false);
  }
});

test("supplement create: rejects name/dosage over 100 chars", () => {
  assert.equal(validateSupplementBody({ name: "x".repeat(101), timeSlot: "MORNING" }, { partial: false }).ok, false);
  assert.equal(validateSupplementBody({ name: "Zinc", dosage: "x".repeat(101), timeSlot: "MORNING" }, { partial: false }).ok, false);
});

test("supplement create: rejects bad timeSlot", () => {
  for (const timeSlot of [undefined, "NIGHT", "morning", 3]) {
    assert.equal(validateSupplementBody({ name: "Zinc", timeSlot }, { partial: false }).ok, false);
  }
});

test("supplement patch: partial accepts subset and omits missing keys", () => {
  const r = validateSupplementBody({ dosage: "500 mg" }, { partial: true });
  assert.deepEqual(r, { ok: true, dosage: "500 mg" });
  const r2 = validateSupplementBody({}, { partial: true });
  assert.deepEqual(r2, { ok: true });
});

test("supplement patch: explicit null dosage clears it, but null name rejected", () => {
  assert.deepEqual(validateSupplementBody({ dosage: null }, { partial: true }), { ok: true, dosage: null });
  assert.equal(validateSupplementBody({ name: null }, { partial: true }).ok, false);
});

test("intake: accepts YYYY-MM-DD + boolean taken, normalizes to local midnight", () => {
  const r = validateIntakeBody({ date: "2026-07-24", taken: true });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.taken, true);
    assert.deepEqual(
      [r.date.getFullYear(), r.date.getMonth(), r.date.getDate(), r.date.getHours()],
      [2026, 6, 24, 0],
    );
  }
});

test("intake: rejects bad date and non-boolean taken", () => {
  assert.equal(validateIntakeBody({ date: "07/24/2026", taken: true }).ok, false);
  assert.equal(validateIntakeBody({ date: "2026-07-24", taken: "yes" }).ok, false);
  assert.equal(validateIntakeBody({ taken: true }).ok, false);
});

// ─── contents / estimated (Clara first run) ───────────────────────────────────
test("contents: valid list passes through; null clears; absent is absent", () => {
  const ok = validateSupplementBody(
    { name: "Iron", timeSlot: "MORNING", contents: [{ key: "iron", amount: 18, unit: "mg" }], estimated: true },
    { partial: false },
  );
  assert.deepEqual(ok, {
    ok: true, name: "Iron", dosage: null, timeSlot: "MORNING",
    contents: [{ key: "iron", amount: 18, unit: "mg" }], estimated: true,
  });
  const cleared = validateSupplementBody({ contents: null }, { partial: true });
  assert.deepEqual(cleared, { ok: true, contents: null });
  assert.equal("contents" in (validateSupplementBody({ name: "x" }, { partial: true }) as object), false);
});

test("contents: rejects bad key, amount, unit, size, shape", () => {
  const bad = (contents: unknown) =>
    assert.equal(validateSupplementBody({ contents }, { partial: true }).ok, false);
  bad("iron");
  bad([{ key: "calories", amount: 1, unit: "mg" }]);
  bad([{ key: "iron", amount: 0, unit: "mg" }]);
  bad([{ key: "iron", amount: -1, unit: "mg" }]);
  bad([{ key: "iron", amount: 100001, unit: "mg" }]);
  bad([{ key: "iron", amount: "5", unit: "mg" }]);
  bad([{ key: "iron", amount: 5, unit: "kg" }]);
  bad([null]);
  bad(Array.from({ length: 31 }, () => ({ key: "iron", amount: 1, unit: "mg" })));
  // The boundary amount itself is allowed.
  assert.equal(validateSupplementBody({ contents: [{ key: "iron", amount: 100000, unit: "mcg" }] }, { partial: true }).ok, true);
});

test("estimated must be a boolean", () => {
  assert.equal(validateSupplementBody({ estimated: "yes" }, { partial: true }).ok, false);
  assert.deepEqual(validateSupplementBody({ estimated: false }, { partial: true }), { ok: true, estimated: false });
});

test("contents: duplicate keys are rejected", () => {
  assert.equal(
    validateSupplementBody({ contents: [{ key: "iron", amount: 1, unit: "mg" }, { key: "iron", amount: 2, unit: "mg" }] }, { partial: true }).ok,
    false,
  );
});

test("editsPillFacts: only real differences count", () => {
  const stored = { name: "Iron", dosage: null, contents: [{ key: "iron", amount: 18, unit: "mg" }] };
  assert.equal(editsPillFacts(stored, {}), false);
  assert.equal(editsPillFacts(stored, { name: "Iron", dosage: null, contents: [{ key: "iron", amount: 18, unit: "mg" }] }), false);
  assert.equal(editsPillFacts(stored, { name: "Iron 2" }), true);
  assert.equal(editsPillFacts(stored, { dosage: "1 tablet" }), true);
  assert.equal(editsPillFacts(stored, { contents: [{ key: "iron", amount: 20, unit: "mg" }] }), true);
  assert.equal(editsPillFacts({ ...stored, contents: null }, { contents: null }), false);
  assert.equal(editsPillFacts(stored, { contents: null }), true);
});

test("editsPillFacts: stored key order does not matter", () => {
  const stored = { name: "Iron", dosage: null, contents: [{ key: "iron", unit: "mg", amount: 18 }] };
  assert.equal(editsPillFacts(stored, { contents: [{ key: "iron", amount: 18, unit: "mg" }] }), false);
  assert.equal(editsPillFacts(stored, { contents: [{ key: "iron", amount: 18, unit: "g" }] }), true);
  assert.equal(editsPillFacts(stored, { contents: [] }), true);
});
