import { test } from "node:test";
import assert from "node:assert/strict";
import { adminErrorResponse, pickFields, RECIPE_MUTABLE_FIELDS, ZIPCODE_MUTABLE_FIELDS } from "./admin";

// Note: requireAdmin() is not tested here — it requires Clerk auth() and a
// real database via Prisma. Only the pure error-mapping helper is covered.

test("UNAUTHORIZED error maps to 401 with Unauthorized body", async () => {
  const res = adminErrorResponse(new Error("UNAUTHORIZED"));
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: "Unauthorized" });
});

test("FORBIDDEN error maps to 403 with Forbidden body", async () => {
  const res = adminErrorResponse(new Error("FORBIDDEN"));
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: "Forbidden" });
});

test("other Error maps to 500 and echoes the message", async () => {
  const res = adminErrorResponse(new Error("database exploded"));
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: "database exploded" });
});

test("non-Error values map to 500 with generic message", async () => {
  const res = adminErrorResponse("some string");
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: "Internal error" });
});

test("null and undefined map to 500 with generic message", async () => {
  for (const val of [null, undefined]) {
    const res = adminErrorResponse(val);
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: "Internal error" });
  }
});

test("error whose message merely contains UNAUTHORIZED is not a 401 (exact match only)", async () => {
  const res = adminErrorResponse(new Error("UNAUTHORIZED: token expired"));
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: "UNAUTHORIZED: token expired" });
});

test("non-Error object with a message property is NOT duck-typed into a 401", async () => {
  // The source gates on `err instanceof Error`, so a plain object carrying
  // message: "UNAUTHORIZED" must fall through to the generic 500, never 401.
  const res = adminErrorResponse({ message: "UNAUTHORIZED" });
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: "Internal error" });
});

test("Error subclasses pass the instanceof gate and map by message", async () => {
  class AuthError extends Error {}
  const res = adminErrorResponse(new AuthError("FORBIDDEN"));
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: "Forbidden" });
});

test("responses are JSON content type", () => {
  const res = adminErrorResponse(new Error("UNAUTHORIZED"));
  assert.match(res.headers.get("content-type") ?? "", /application\/json/);
});

// ─── 2026-07-24 logic-audit Task 6: pickFields allowlist ────────────────────
//
// Admin bodies were spread verbatim into prisma create/update, which accepts
// ANY Prisma key — including nested relation writes ("dishes": {...}) that
// bypass the publish gate and its row lock. Only allowlisted scalars pass.

test("pickFields keeps only allowlisted keys, drops relations/ids/unknowns", () => {
  const body = {
    name: "X",
    description: "d",
    id: "evil",
    dishes: { create: [{ name: "D", status: "PUBLISHED" }] },
    menus: { create: [] },
    unknown: 1,
  };
  assert.deepEqual(pickFields(body, ["name", "description"] as const), {
    name: "X",
    description: "d",
  });
});

test("pickFields preserves explicit null/false values and omits absent keys", () => {
  const out = pickFields({ ethnicId: null, active: false }, ["ethnicId", "active", "city"] as const);
  assert.deepEqual(out, { ethnicId: null, active: false });
  assert.equal("city" in out, false);
});

test("RECIPE/ZIPCODE allowlists contain no relation or identity keys", () => {
  for (const list of [RECIPE_MUTABLE_FIELDS, ZIPCODE_MUTABLE_FIELDS]) {
    for (const banned of ["id", "ingredients", "menus", "mealLogs", "dishPreferences", "createdAt", "updatedAt"]) {
      assert.equal((list as readonly string[]).includes(banned), false, `${banned} must not be allowlisted`);
    }
  }
});
