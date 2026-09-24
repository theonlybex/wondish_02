import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCuisineChecklists, ownsStaple, CUISINE_STAPLES, CUISINE_READY_THRESHOLD } from "./cuisine-ingredients";

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

// ── Real pantry names, not the curated generics ─────────────────────────────
// Every test above feeds the staple list back in as "owned", which is why the
// lens shipped reading 0/8 for all 11 cuisines for every user: a pantry holds
// "Basmati rice", never "rice". These use the names from a real QA account.
test("a pantry of catalog names is matched, not just exact generics", () => {
  const pantry = [
    "Basmati rice", "jasmine rice", "Brown rice", "Wild rice",
    "Boneless chicken breasts", "chicken thighs", "ground beef",
    "Roma tomatoes", "Yellow onions", "Garlic cloves", "Extra virgin olive oil",
    "Russet potatoes", "Bell peppers", "broccoli", "carrots",
  ];
  const byName = Object.fromEntries(buildCuisineChecklists(pantry).map((c) => [c.cuisine, c]));

  const american = byName.American;
  for (const name of ["potato", "chicken", "beef", "tomato", "onion"]) {
    assert.equal(american.staples.find((s) => s.name === name)!.have, true, name);
  }
  assert.ok(american.have >= 5, `American should read at least 5/8, got ${american.have}`);

  // "rice" is satisfied by any of the four kinds, and olive oil by the bottle
  // the user actually owns.
  assert.equal(byName.Chinese.staples.find((s) => s.name === "rice")!.have, true);
  assert.equal(byName.Italian.staples.find((s) => s.name === "olive oil")!.have, true);
  assert.equal(byName.Italian.staples.find((s) => s.name === "garlic")!.have, true);

  // Nothing in this pantry is basil, pasta or parmesan.
  for (const name of ["basil", "pasta", "parmesan"]) {
    assert.equal(byName.Italian.staples.find((s) => s.name === name)!.have, false, name);
  }
});

test("a variety counts, a different food that merely contains the word does not", () => {
  // "cherry tomatoes" IS tomato; "rice vinegar" is not rice, and claiming a
  // cuisine is ready when the user cannot make rice is the same lie inverted.
  assert.equal(ownsStaple("tomato", ["Cherry tomatoes"]), true);
  assert.equal(ownsStaple("rice", ["rice vinegar"]), false);
  assert.equal(ownsStaple("rice", ["Basmati rice"]), true);
  assert.equal(ownsStaple("olive oil", ["Extra virgin olive oil"]), true);
  assert.equal(ownsStaple("olive oil", ["sunflower oil"]), false);
  assert.equal(ownsStaple("soy sauce", ["Low sodium soy sauce"]), true);
  assert.equal(ownsStaple("chicken", ["chicken"]), true);
  // A CUT is the food. This is where the head-noun rule alone got it wrong:
  // someone holding chicken thighs owns chicken, and saying otherwise is the
  // bug being fixed rather than a nuance of it.
  assert.equal(ownsStaple("chicken", ["chicken thighs"]), true);
  assert.equal(ownsStaple("chicken", ["Boneless chicken breasts"]), true);
  assert.equal(ownsStaple("beef", ["ground beef"]), true);
  // ...but a different food that merely contains the word still is not it.
  assert.equal(ownsStaple("chicken", ["chicken stock"]), false);
  assert.equal(ownsStaple("chicken", ["chicken seasoning"]), false);
});
