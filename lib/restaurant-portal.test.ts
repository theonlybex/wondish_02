import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PORTAL_DISH_MUTABLE_FIELDS,
  parsePortalIngredients,
  parsePortalMacros,
  portalStatusAction,
} from "./restaurant-portal";

// Phase 6a M2 (docs/restaurants/phase-6a-restaurant-admin-design.md §5.3,
// §6, §7): portal write validation, pure.

describe("PORTAL_DISH_MUTABLE_FIELDS", () => {
  it("never includes identity, status, or ops-only fields", () => {
    for (const banned of ["id", "restaurantId", "status", "isRecommended", "deletedAt", "ingredients"]) {
      assert.equal((PORTAL_DISH_MUTABLE_FIELDS as readonly string[]).includes(banned), false, banned);
    }
  });
  it("includes the nutrition and display scalars", () => {
    for (const field of ["name", "section", "price", "calories", "protein", "carbs", "fat", "fiber", "available"]) {
      assert.equal((PORTAL_DISH_MUTABLE_FIELDS as readonly string[]).includes(field), true, field);
    }
  });
});

describe("parsePortalIngredients", () => {
  it("passes catalog-linked and free-text rows, deduped by name", () => {
    const res = parsePortalIngredients([
      { name: "Peanut", ingredientId: "ing_1", quantity: 20, unit: "g" },
      { name: "Secret sauce" },
      { name: "Peanut", ingredientId: "ing_1" }, // duplicate name — last wins
    ]);
    assert.ok(res.ok);
    assert.deepEqual(res.value, [
      { name: "Peanut", ingredientId: "ing_1", quantity: null, unit: null },
      { name: "Secret sauce", ingredientId: null, quantity: null, unit: null },
    ]);
  });

  it("rejects a non-string ingredientId", () => {
    const res = parsePortalIngredients([{ name: "Peanut", ingredientId: 42 }]);
    assert.equal(res.ok, false);
  });

  it("rejects empty names and non-arrays", () => {
    assert.equal(parsePortalIngredients([{ name: " " }]).ok, false);
    assert.equal(parsePortalIngredients("nope").ok, false);
  });
});

describe("parsePortalMacros", () => {
  it("accepts numbers and blanks (null), never fabricating zeros", () => {
    const res = parsePortalMacros({ calories: 620, protein: null, carbs: undefined, fat: 22.5, fiber: 4 });
    assert.ok(res.ok);
    assert.deepEqual(res.value, { calories: 620, protein: null, fat: 22.5, fiber: 4 });
  });

  it("rejects negatives, non-finite, and absurd values", () => {
    assert.equal(parsePortalMacros({ calories: -1 }).ok, false);
    assert.equal(parsePortalMacros({ protein: Infinity }).ok, false);
    assert.equal(parsePortalMacros({ calories: 100000 }).ok, false);
  });
});

describe("portalStatusAction", () => {
  it("submit: DRAFT with ingredients → PENDING_REVIEW", () => {
    const res = portalStatusAction("submit", "DRAFT", 3);
    assert.ok(res.ok);
    assert.equal(res.value, "PENDING_REVIEW");
  });

  it("submit: enforces the ingredient publish gate", () => {
    const res = portalStatusAction("submit", "DRAFT", 0);
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.error, /ingredient/i);
  });

  it("submit: already-live and already-in-review are rejected", () => {
    assert.equal(portalStatusAction("submit", "PUBLISHED", 3).ok, false);
    assert.equal(portalStatusAction("submit", "PENDING_REVIEW", 3).ok, false);
  });

  it("unpublish: PUBLISHED or PENDING_REVIEW → DRAFT; DRAFT rejected", () => {
    const fromLive = portalStatusAction("unpublish", "PUBLISHED", 3);
    assert.ok(fromLive.ok);
    assert.equal(fromLive.value, "DRAFT");
    const fromReview = portalStatusAction("unpublish", "PENDING_REVIEW", 0);
    assert.ok(fromReview.ok);
    assert.equal(fromReview.value, "DRAFT");
    assert.equal(portalStatusAction("unpublish", "DRAFT", 3).ok, false);
  });
});
