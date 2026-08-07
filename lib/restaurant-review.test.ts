import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  splitReviewGated,
  ingredientDiff,
  parseReviewAction,
  reviewDecision,
} from "./restaurant-review";

// Phase 6a M3 (docs/restaurants/phase-6a-restaurant-admin-design.md §7):
// review workflow, pure. Verdict-affecting data (name, ingredients) on a
// PUBLISHED dish never changes without ops approval; everything else stays
// instant.

const row = (
  name: string,
  extra: Partial<{ quantity: number | null; unit: string | null; ingredientId: string | null }> = {}
) => ({ name, quantity: null, unit: null, ingredientId: null, ...extra });

describe("splitReviewGated", () => {
  it("applies name and ingredients instantly on a DRAFT dish", () => {
    const res = splitReviewGated({
      dishStatus: "DRAFT",
      currentName: "Pad Thai",
      currentIngredients: [row("Peanut")],
      requestedName: "Pad Thai Special",
      requestedIngredients: [row("Peanut"), row("Tofu")],
    });
    assert.equal(res.instant.name, "Pad Thai Special");
    assert.deepEqual(res.instant.ingredients, [row("Peanut"), row("Tofu")]);
    assert.equal(res.staged, null);
  });

  it("applies instantly on a PENDING_REVIEW dish (not live — review sees current data)", () => {
    const res = splitReviewGated({
      dishStatus: "PENDING_REVIEW",
      currentName: "Pad Thai",
      currentIngredients: [],
      requestedIngredients: [row("Peanut")],
    });
    assert.deepEqual(res.instant.ingredients, [row("Peanut")]);
    assert.equal(res.staged, null);
  });

  it("stages name and ingredients on a PUBLISHED dish", () => {
    const res = splitReviewGated({
      dishStatus: "PUBLISHED",
      currentName: "Pad Thai",
      currentIngredients: [row("Peanut")],
      requestedName: "Pad See Ew",
      requestedIngredients: [row("Rice noodles")],
    });
    assert.equal(res.instant.name, undefined);
    assert.equal(res.instant.ingredients, undefined);
    assert.deepEqual(res.staged, {
      name: "Pad See Ew",
      ingredients: [row("Rice noodles")],
    });
  });

  it("drops a no-op name and a no-op ingredient list instead of staging them", () => {
    const res = splitReviewGated({
      dishStatus: "PUBLISHED",
      currentName: "Pad Thai",
      currentIngredients: [row("Peanut", { quantity: 20, unit: "g", ingredientId: "ing_1" })],
      requestedName: "Pad Thai",
      requestedIngredients: [row("Peanut", { quantity: 20, unit: "g", ingredientId: "ing_1" })],
    });
    assert.equal(res.staged, null);
    assert.equal(res.instant.name, undefined);
    assert.equal(res.instant.ingredients, undefined);
  });

  it("stages only the changed half (ingredients changed, name untouched)", () => {
    const res = splitReviewGated({
      dishStatus: "PUBLISHED",
      currentName: "Pad Thai",
      currentIngredients: [row("Peanut")],
      requestedIngredients: [row("Peanut", { ingredientId: "ing_1" })], // catalog link added
    });
    assert.deepEqual(res.staged, {
      name: null,
      ingredients: [row("Peanut", { ingredientId: "ing_1" })],
    });
  });
});

describe("ingredientDiff", () => {
  it("reports added, removed, and changed rows by name", () => {
    const diff = ingredientDiff(
      [row("Peanut", { quantity: 20 }), row("Tofu"), row("Egg")],
      [row("Peanut", { quantity: 30 }), row("Egg"), row("Basil")]
    );
    assert.deepEqual(diff, { added: ["Basil"], removed: ["Tofu"], changed: ["Peanut"] });
  });

  it("treats an ingredientId change as changed (verdict matching moves off string luck)", () => {
    const diff = ingredientDiff([row("Peanut")], [row("Peanut", { ingredientId: "ing_1" })]);
    assert.deepEqual(diff, { added: [], removed: [], changed: ["Peanut"] });
  });

  it("returns empty lists for identical rows", () => {
    const rows = [row("Peanut", { quantity: 20, unit: "g" })];
    assert.deepEqual(ingredientDiff(rows, rows), { added: [], removed: [], changed: [] });
  });
});

describe("parseReviewAction", () => {
  it("accepts approve without a note", () => {
    const res = parseReviewAction({ action: "approve" });
    assert.ok(res.ok);
    assert.deepEqual(res.value, { action: "approve", note: null });
  });

  it("accepts approve with a trimmed note", () => {
    const res = parseReviewAction({ action: "approve", note: "  looks right  " });
    assert.ok(res.ok);
    assert.deepEqual(res.value, { action: "approve", note: "looks right" });
  });

  it("requires a note on reject", () => {
    const res = parseReviewAction({ action: "reject", note: "   " });
    assert.equal(res.ok, false);
  });

  it("rejects unknown actions and non-object bodies", () => {
    assert.equal(parseReviewAction({ action: "yeet" }).ok, false);
    assert.equal(parseReviewAction(null).ok, false);
  });
});

describe("reviewDecision", () => {
  const liveDish = { status: "PUBLISHED", deletedAt: null, ingredientCount: 3 };

  it("approve PUBLISH → dish goes live, freshness stamped", () => {
    const res = reviewDecision("PUBLISH", "approve", {
      status: "PENDING_REVIEW",
      deletedAt: null,
      ingredientCount: 2,
    });
    assert.ok(res.ok);
    assert.deepEqual(res.value, { dishStatus: "PUBLISHED", applyStaged: false, stampVerified: true });
  });

  it("approve PUBLISH fails when the dish left PENDING_REVIEW", () => {
    const res = reviewDecision("PUBLISH", "approve", liveDish);
    assert.equal(res.ok, false);
  });

  it("approve PUBLISH fails with zero ingredients (publish gate holds at approval too)", () => {
    const res = reviewDecision("PUBLISH", "approve", {
      status: "PENDING_REVIEW",
      deletedAt: null,
      ingredientCount: 0,
    });
    assert.equal(res.ok, false);
  });

  it("reject PUBLISH → dish returns to DRAFT", () => {
    const res = reviewDecision("PUBLISH", "reject", {
      status: "PENDING_REVIEW",
      deletedAt: null,
      ingredientCount: 2,
    });
    assert.ok(res.ok);
    assert.deepEqual(res.value, { dishStatus: "DRAFT", applyStaged: false, stampVerified: false });
  });

  it("approve EDIT → staged payload swaps in, freshness stamped, status untouched", () => {
    const res = reviewDecision("EDIT", "approve", liveDish);
    assert.ok(res.ok);
    assert.deepEqual(res.value, { dishStatus: null, applyStaged: true, stampVerified: true });
  });

  it("reject EDIT → dish untouched", () => {
    const res = reviewDecision("EDIT", "reject", liveDish);
    assert.ok(res.ok);
    assert.deepEqual(res.value, { dishStatus: null, applyStaged: false, stampVerified: false });
  });

  it("any decision fails on a soft-deleted dish", () => {
    const gone = { status: "PUBLISHED", deletedAt: new Date(), ingredientCount: 3 };
    assert.equal(reviewDecision("EDIT", "approve", gone).ok, false);
    assert.equal(reviewDecision("PUBLISH", "reject", gone).ok, false);
  });
});

describe("reviewDecision — staged-empty guard (audit fix)", () => {
  it("approve EDIT fails when the staged list would empty a live dish", () => {
    const res = reviewDecision(
      "EDIT",
      "approve",
      { status: "PUBLISHED", deletedAt: null, ingredientCount: 3 },
      { stagedIngredientCount: 0 }
    );
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.error, /ingredient/i);
  });

  it("approve EDIT passes with a non-empty staged list or no staged list (name-only)", () => {
    const live = { status: "PUBLISHED", deletedAt: null, ingredientCount: 3 };
    assert.ok(reviewDecision("EDIT", "approve", live, { stagedIngredientCount: 2 }).ok);
    assert.ok(reviewDecision("EDIT", "approve", live, { stagedIngredientCount: null }).ok);
    assert.ok(reviewDecision("EDIT", "approve", live).ok);
  });

  it("reject EDIT is unaffected by an empty staged list", () => {
    const res = reviewDecision(
      "EDIT",
      "reject",
      { status: "PUBLISHED", deletedAt: null, ingredientCount: 3 },
      { stagedIngredientCount: 0 }
    );
    assert.ok(res.ok);
  });
});
