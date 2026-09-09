import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCuisineChecklists, CUISINE_STAPLES, CUISINE_READY_THRESHOLD } from "./cuisine-ingredients";

test("marks staples you own and computes counts", () => {
  const owned = new Set(["olive oil", "garlic", "tomato"]);
  const italian = buildCuisineChecklists(owned).find((c) => c.cuisine === "Italian")!;
  assert.equal(italian.have, 3);
  assert.equal(italian.total, CUISINE_STAPLES.Italian.length);
  assert.equal(italian.staples.find((s) => s.name === "garlic")!.have, true);
  assert.equal(italian.staples.find((s) => s.name === "basil")!.have, false);
});

test("ready flips once the threshold of staples is owned", () => {
  const italian = CUISINE_STAPLES.Italian;
  const need = Math.ceil(italian.length * CUISINE_READY_THRESHOLD);
  const owned = new Set(italian.slice(0, need).map((s) => s.toLowerCase()));
  const c = buildCuisineChecklists(owned).find((x) => x.cuisine === "Italian")!;
  assert.equal(c.ready, true);
  const fewer = new Set(italian.slice(0, need - 1).map((s) => s.toLowerCase()));
  assert.equal(buildCuisineChecklists(fewer).find((x) => x.cuisine === "Italian")!.ready, false);
});

test("a shared ingredient reports the other cuisines it unlocks", () => {
  const garlic = buildCuisineChecklists(new Set()).find((c) => c.cuisine === "Italian")!
    .staples.find((s) => s.name === "garlic")!;
  assert.ok(garlic.alsoIn.includes("Chinese"));
  assert.ok(garlic.alsoIn.includes("Mediterranean"));
  assert.ok(!garlic.alsoIn.includes("Italian"));
});
