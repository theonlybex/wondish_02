import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_DISH_RULES, storedRulesFrom, type StoredRules } from "../dish-rules";
import type { ClaraContext } from "../types";
import { applyRulesBody, makeRuleHandlers, rulesMatching, rulesView, ruleTools, type RulesDeps } from "./rules";

const CTX = { patientId: "p1", accountId: "a1", firstName: "Sam", isPremium: false, today: "2026-11-22", surface: "ios", disabledSkills: [] } as unknown as ClaraContext;
const store = (start: StoredRules | null = storedRulesFrom(null)) => {
  let value = start;
  const saves: StoredRules[] = [];
  const deps: RulesDeps = { load: async () => value, save: async (_id, r) => { value = r; saves.push(r); } };
  return { deps, saves, get: () => value! };
};

test("rule_add saves a rule in their words, says whether the app checks it, and never saves one twice", async () => {
  const s = store();
  const h = makeRuleHandlers(s.deps);
  const a: any = await h.add(CTX, { text: '  Never put "mushrooms" in my dishes ' });
  assert.equal(a.ok, true);
  assert.equal(a.data.rule, "Never put mushrooms in my dishes");
  assert.match(a.data.note, /no dish you suggest will use mushrooms; the app checks every dish for it/);
  assert.equal(a.data.checkedByApp, true);
  assert.deepEqual(s.get().mine.map((r) => [r.text, r.on]), [["Never put mushrooms in my dishes", true]]);
  const b: any = await h.add(CTX, { text: "No cooking over 30 minutes on weekdays" });
  assert.match(b.data.note, /an instruction to you, NOT something the app checks/);
  assert.equal(b.data.checkedByApp, false);
  // An allergy is never saved as a rule.
  for (const text of ["I'm allergic to peanuts", "no peanuts (allergy)", "lactose intolerant, no milk"]) {
    const r: any = await h.add(CTX, { text });
    assert.equal(r.ok, false, text);
    assert.match(r.message, /profile/);
  }
  assert.equal(s.get().mine.length, 2);
  // Said again: not saved twice; a switched-off one is switched back on.
  s.deps.save("p1", { ...s.get(), mine: s.get().mine.map((r) => ({ ...r, on: false })) });
  const again: any = await h.add(CTX, { text: "never put mushrooms in my dishes" });
  assert.equal(again.data.alreadyThere, true);
  assert.equal(s.get().mine.length, 2);
  assert.equal(s.get().mine[0].on, true);
  for (const bad of [{}, { text: "" }, { text: "x".repeat(121) }, { text: 5 }]) assert.equal((await h.add(CTX, bad)).ok, false);
  // The cap.
  const full = store({ switches: { ...DEFAULT_DISH_RULES }, mine: Array.from({ length: 15 }, (_, i) => ({ id: `r${i}`, text: `rule ${i}`, on: true })) });
  const capped: any = await makeRuleHandlers(full.deps).add(CTX, { text: "one more" });
  assert.deepEqual([capped.ok, capped.reason], [false, "OUT_OF_RANGE"]);
  assert.equal(full.saves.length, 0);
});

test("rule_remove: the exact rule, or every rule about the food named; never a guess from shared letters; rule_list", async () => {
  const mine = [
    { id: "r1", text: "No mushrooms", on: true }, { id: "r2", text: "Never put mushrooms in my dishes", on: true },
    { id: "r3", text: "Keep dinners under 25 minutes", on: false }, { id: "r4", text: "No rice", on: true },
  ];
  const s = store({ switches: { ...DEFAULT_DISH_RULES, keepWeekVaried: false }, mine });
  const h = makeRuleHandlers(s.deps);
  const list: any = await h.list(CTX);
  assert.deepEqual(list.data.theirOwn.map((r: any) => r.rule), mine.map((r) => r.text));
  assert.deepEqual(list.data.switchedOff, ["Keep my week varied"]);
  // Loose words remove nothing.
  for (const text of ["no", "e", "dinners", "you can use rice vinegar", "meat", "potatoes are fine"]) {
    assert.deepEqual(rulesMatching(mine, text).map((r) => r.id), text === "you can use rice vinegar" ? ["r4"] : [], text);
  }
  // By food: both mushroom rules go, in either number.
  for (const text of ["you can use mushrooms again", "forget the mushroom rule"]) assert.deepEqual(rulesMatching(mine, text).map((r) => r.id), ["r1", "r2"], text);
  assert.deepEqual(rulesMatching(mine, "keep dinners under 25 minutes").map((r) => r.id), ["r3"]);
  assert.deepEqual(rulesMatching(mine, "the rule about dinners under 25 minutes").map((r) => r.id), []);
  assert.deepEqual(rulesMatching(mine, "dinners under 25 minutes").map((r) => r.id), ["r3"]);
  const gone: any = await h.remove(CTX, { text: "you can use mushrooms again" });
  assert.deepEqual([gone.ok, gone.data.removed], [true, ["No mushrooms", "Never put mushrooms in my dishes"]]);
  assert.deepEqual(s.get().mine.map((r) => r.id), ["r3", "r4"]);
  const none: any = await h.remove(CTX, { text: "no olives" });
  assert.deepEqual([none.ok, none.reason], [false, "NOT_FOUND"]);
  const all: any = await h.remove(CTX, { all: true });
  assert.deepEqual([all.ok, all.data.removed.length, s.get().mine.length], [true, 2, 0]);
  assert.equal(s.get().switches.keepWeekVaried, false); // the switches are untouched by the tools
});

test("the app's save: switches by name, their own rules as the whole list; anything malformed is refused", () => {
  const current: StoredRules = { switches: { ...DEFAULT_DISH_RULES }, mine: [{ id: "r1", text: "No mushrooms", on: true }, { id: "r2", text: "Keep dinners light", on: true }] };
  const next = applyRulesBody(current, { system: { proteinFreeLunches: false }, mine: [{ id: "r2", text: "Keep dinners light", on: false }, { text: " No olives " }, { id: "made-up", text: "No pork" }] })!;
  assert.equal(next.switches.proteinFreeLunches, false);
  assert.equal(next.switches.cookFromHome, true);
  assert.deepEqual(next.mine.map((r) => [r.text, r.on]), [["Keep dinners light", false], ["No olives", true], ["No pork", true]]);
  assert.equal(next.mine[0].id, "r2");
  assert.ok(next.mine[1].id.startsWith("r_") && next.mine[2].id.startsWith("r_") && next.mine[2].id !== "made-up");
  // Only `system`: their rules are untouched.
  assert.deepEqual(applyRulesBody(current, { system: { sizeToCalories: false } })!.mine, current.mine);
  for (const bad of [null, [], { system: { nonsense: true } }, { system: { cookFromHome: "no" } }, { mine: "x" }, { mine: [{ text: "" }] }, { mine: [{ text: "x".repeat(121) }] }, { mine: Array.from({ length: 16 }, (_, i) => ({ text: `r ${i}` })) }, { mine: [{ text: "No olives", on: "false" }] }, { mine: [{ text: "No olives", on: 0 }] }]) {
    assert.equal(applyRulesBody(current, bad), null, JSON.stringify(bad)?.slice(0, 60));
  }
  const view = rulesView(next);
  assert.equal(view.system.length, 10);
  assert.deepEqual(view.system.find((x) => x.key === "proteinFreeLunches")?.on, false);
  // A rule that names one known food is checked by the app; anything else is an instruction.
  assert.deepEqual(view.mine.map((r) => [r.text, r.checked]), [["Keep dinners light", false], ["No olives", true], ["No pork", true]]);
  assert.deepEqual(ruleTools().map((t) => t.def.name), ["dish_rule_add", "dish_rule_remove", "dish_rule_list"]);
});
