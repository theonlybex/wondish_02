import { test } from "node:test";
import assert from "node:assert/strict";
import { isProfileComplete, type ProfileCompletionInput } from "./onboarding";

// A fully complete profile using the metric height column.
function completeMetricProfile(): ProfileCompletionInput {
  return {
    birthday: new Date("1994-01-01"),
    height: 165,
    weight: 60,
    physicalActivityId: "activity-2",
  };
}

// A fully complete profile using the imperial ft/in columns instead of `height`.
function completeImperialProfile(): ProfileCompletionInput {
  return {
    birthday: new Date("1994-01-01"),
    heightFt: 5,
    heightIn: 5,
    weight: 60,
    physicalActivityId: "activity-2",
  };
}

test("null, undefined and empty patients are incomplete", () => {
  assert.equal(isProfileComplete(null), false);
  assert.equal(isProfileComplete(undefined), false);
  assert.equal(isProfileComplete({}), false);
});

test("complete profile with metric height is complete", () => {
  assert.equal(isProfileComplete(completeMetricProfile()), true);
});

test("complete profile with imperial ft/in height is complete", () => {
  assert.equal(isProfileComplete(completeImperialProfile()), true);
});

test("birthday may be a non-empty string (DB rows often serialize dates)", () => {
  assert.equal(
    isProfileComplete({ ...completeMetricProfile(), birthday: "1994-01-01" }),
    true
  );
});

test("missing or null birthday is incomplete", () => {
  assert.equal(
    isProfileComplete({ ...completeMetricProfile(), birthday: null }),
    false
  );
  assert.equal(
    isProfileComplete({ ...completeMetricProfile(), birthday: undefined }),
    false
  );
});

test("empty-string birthday is treated as missing (falsy check)", () => {
  assert.equal(
    isProfileComplete({ ...completeMetricProfile(), birthday: "" }),
    false
  );
});

test("missing height in both unit systems is incomplete", () => {
  const p = completeMetricProfile()!;
  assert.equal(isProfileComplete({ ...p, height: null }), false);
  assert.equal(
    isProfileComplete({ ...p, height: null, heightFt: null, heightIn: null }),
    false
  );
});

test("imperial height requires BOTH ft and in — a lone ft or lone in is incomplete", () => {
  const base = completeImperialProfile()!;
  assert.equal(isProfileComplete({ ...base, heightIn: null }), false);
  assert.equal(isProfileComplete({ ...base, heightFt: null }), false);
});

test("heightIn of 0 counts as present (exactly N feet tall)", () => {
  assert.equal(
    isProfileComplete({ ...completeImperialProfile(), heightIn: 0 }),
    true
  );
});

test("heightFt of 0 is rejected — unlike heightIn, 0 feet is never physically meaningful", () => {
  // Asymmetric to heightIn: heightFt uses the `pos` (>0) check because nobody
  // is 0 feet tall, whereas heightIn legitimately can be 0 (e.g. 5ft 0in).
  assert.equal(
    isProfileComplete({ ...completeImperialProfile(), heightFt: 0 }),
    false
  );
});

test("either unit system alone satisfies the height requirement", () => {
  // Metric only, imperial columns null.
  assert.equal(
    isProfileComplete({
      ...completeMetricProfile(),
      heightFt: null,
      heightIn: null,
    }),
    true
  );
  // Imperial only, metric column null.
  assert.equal(
    isProfileComplete({ ...completeImperialProfile(), height: null }),
    true
  );
});

test("missing or null weight is incomplete", () => {
  assert.equal(
    isProfileComplete({ ...completeMetricProfile(), weight: null }),
    false
  );
  assert.equal(
    isProfileComplete({ ...completeMetricProfile(), weight: undefined }),
    false
  );
});

test("weight of 0 is rejected as physically meaningless", () => {
  assert.equal(
    isProfileComplete({ ...completeMetricProfile(), weight: 0 }),
    false
  );
});

test("height of 0 is rejected as physically meaningless", () => {
  assert.equal(
    isProfileComplete({ ...completeMetricProfile(), height: 0 }),
    false
  );
});

test("an Invalid Date birthday is rejected", () => {
  // `new Date("not-a-date")` is a truthy object, but Number.isNaN(getTime())
  // catches it — this function now validates the date, not just its presence.
  assert.equal(
    isProfileComplete({
      ...completeMetricProfile(),
      birthday: new Date("not-a-date"),
    }),
    false
  );
});

test("imperial height with 0 inches (5ft 0in) is complete — 0 inches is legitimate", () => {
  // Unlike weight/height-in-cm, 0 is a valid value for heightIn (someone who
  // is exactly N feet tall), so it must use a non-negative check, not `pos`.
  assert.equal(
    isProfileComplete({
      ...completeImperialProfile(),
      height: null,
      heightFt: 5,
      heightIn: 0,
    }),
    true
  );
});

test("missing, null or empty physicalActivityId is incomplete", () => {
  const p = completeMetricProfile()!;
  assert.equal(isProfileComplete({ ...p, physicalActivityId: null }), false);
  assert.equal(
    isProfileComplete({ ...p, physicalActivityId: undefined }),
    false
  );
  // Empty string is falsy, so it reads as missing.
  assert.equal(isProfileComplete({ ...p, physicalActivityId: "" }), false);
});

test("return value is a real boolean, never a truthy/falsy leak", () => {
  assert.equal(typeof isProfileComplete(completeMetricProfile()), "boolean");
  assert.equal(typeof isProfileComplete({}), "boolean");
});

// ─── Clara first run: usual eating, pills, starting picture ───────────────────
import {
  validateOnboardingBody,
  commonConditions,
  reconcilePills,
  planOnboardingPut,
  buildOnboardingResponse,
} from "./onboarding";

test("validateOnboardingBody accepts a full body", () => {
  const r = validateOnboardingBody({
    usualEating: { veg: 2, fruit: 1, beans: 0, grains: null, fish: 1, meat: 1, dairy: 2, packaged: 0, sweet: 1 },
    pills: ["Iron", "Iron", "Vitamin D"],
    weightGoal: "lose",
    noCondition: true,
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.value.pills, ["Iron", "Vitamin D"]);
    assert.equal(r.value.usualEating?.grains, null);
    assert.equal(r.value.weightGoal, "lose");
    assert.equal(r.value.noCondition, true);
  }
});

test("validateOnboardingBody: missing usualEating keys are unanswered; empty body is fine", () => {
  const r = validateOnboardingBody({ usualEating: { veg: 1 } });
  assert.equal(r.ok && r.value.usualEating?.fruit, null);
  assert.equal(validateOnboardingBody({}).ok, true);
});

test("validateOnboardingBody rejects bad values with a field", () => {
  const bad = (body: unknown, field: string) => {
    const r = validateOnboardingBody(body);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.field, field);
  };
  bad({ usualEating: { veg: 3 } }, "usualEating");
  bad({ usualEating: { veg: "1" } }, "usualEating");
  bad({ usualEating: { unknown: 1 } }, "usualEating");
  bad({ usualEating: [] }, "usualEating");
  bad({ pills: ["Zinc"] }, "pills");
  bad({ pills: "Iron" }, "pills");
  bad({ weightGoal: "shrink" }, "weightGoal");
  bad({ noCondition: "yes" }, "noCondition");
  bad(null, "body");
  bad([], "body");
});

test("validateOnboardingBody allows weightGoal null", () => {
  const r = validateOnboardingBody({ weightGoal: null });
  assert.equal(r.ok && r.value.weightGoal, null);
});

test("commonConditions matches the real database names, omits misses, keeps order", () => {
  const all = [
    { id: "1", name: "Type 2 Diabetes" },
    { id: "2", name: "Hypertension" },
    { id: "3", name: "High Cholesterol" },
    { id: "4", name: "GERD" },
    { id: "5", name: "IBS-M" },
    { id: "6", name: "IBS-C" },
    { id: "7", name: "Celiac Disease" },
    { id: "8", name: "Chronic Kidney Disease stage 1-2" },
    { id: "9", name: "Chronic kidney disease – stage 3" },
    { id: "10", name: "PCOS" },
    { id: "11", name: "Fatty Liver Disease (NAFLD)" },
    { id: "12", name: "Migraine" },
    { id: "13", name: "Acne" },
  ];
  const r = commonConditions(all);
  const chips = r.filter((c) => c.common);
  assert.deepEqual(
    chips.map((c) => c.label),
    ["Type 2 diabetes", "High blood pressure", "High cholesterol", "Acid reflux (GERD)", "IBS",
     "Celiac disease", "Kidney disease", "PCOS", "Fatty liver", "Migraine"],
  );
  assert.equal(chips.find((c) => c.label === "Kidney disease")?.id, "8");
  assert.equal(chips.find((c) => c.label === "IBS")?.id, "5");
  // Everything is still returned; non-chips are not common.
  assert.equal(r.length, all.length);
  assert.equal(r.find((c) => c.id === "13")?.common, false);
  assert.equal(r.find((c) => c.id === "6")?.common, false);
});

test("commonConditions omits a chip with no match", () => {
  const r = commonConditions([{ id: "1", name: "Migraine" }]);
  assert.deepEqual(r.filter((c) => c.common).map((c) => c.label), ["Migraine"]);
});

test("reconcilePills: creates missing, soft-deletes unlisted typical pills, never touches edited ones", () => {
  const existing = [
    { id: "a", name: "Iron", estimated: true },
    { id: "b", name: "Vitamin D", estimated: false }, // edited by the person
    { id: "c", name: "Calcium", estimated: true },
    { id: "d", name: "Fish oil", estimated: true }, // not a catalogue pill
  ];
  const r = reconcilePills(existing, ["Iron", "Magnesium"]);
  assert.deepEqual(r.create, ["Magnesium"]);
  assert.deepEqual(r.softDelete, ["c"]);
});

test("reconcilePills: re-adding a name that exists creates nothing, even if edited", () => {
  const existing = [{ id: "b", name: "Vitamin D", estimated: false }];
  assert.deepEqual(reconcilePills(existing, ["Vitamin D"]), { create: [], softDelete: [] });
});

test("reconcilePills: empty request removes only typical-dose catalogue pills", () => {
  const existing = [
    { id: "a", name: "Iron", estimated: true },
    { id: "b", name: "Magnesium", estimated: false },
  ];
  assert.deepEqual(reconcilePills(existing, []), { create: [], softDelete: ["a"] });
});

test("planOnboardingPut recomputes the starting picture from new answers and pills", () => {
  const plan = planOnboardingPut(
    { usualEating: { veg: 0, fruit: 0, beans: 0, grains: 0, fish: 0, meat: 0, dairy: 0, packaged: 2, sweet: 0 }, pills: ["Multivitamin"] },
    { usualEating: null, supplements: [] },
  );
  assert.deepEqual(plan.pillOps.create, ["Multivitamin"]);
  assert.deepEqual(plan.patientData.startingPicture?.aLot, ["sodium"]);
  assert.equal(plan.patientData.startingPicture?.little.includes("vitaminC"), false);
  assert.equal(plan.patientData.startingPicture?.little.includes("fibre"), true);
});

test("planOnboardingPut with only pills uses the stored answers", () => {
  const stored = { veg: 0, fruit: 0, beans: 0, grains: 0, fish: 0, meat: 0, dairy: 0, packaged: null, sweet: null };
  const plan = planOnboardingPut({ pills: ["Iron"] }, { usualEating: stored, supplements: [] });
  assert.equal(plan.patientData.startingPicture?.little.includes("iron"), false);
  assert.equal(plan.patientData.startingPicture?.little.includes("calcium"), true);
});

test("planOnboardingPut with an empty body keeps answers and pills but still recomputes", () => {
  const plan = planOnboardingPut({}, { usualEating: null, supplements: [{ id: "a", name: "Iron", estimated: true }] });
  assert.deepEqual(plan.pillOps, { create: [], softDelete: [] });
  assert.deepEqual(plan.patientData.startingPicture, { little: [], aLot: [] });
  assert.equal("weightGoal" in plan.patientData, false);
});

test("buildOnboardingResponse shapes the wire contract", () => {
  const r = buildOnboardingResponse({
    conditions: [{ id: "c1", name: "Hypertension" }],
    allergies: [{ id: "al1", name: "Peanut" }],
    activities: [{ id: "ac1", name: "Light" }],
    patient: {
      birthday: new Date("1990-04-02T00:00:00Z"), sexAtBirth: "FEMALE", height: 170, weight: 154.3236,
      physicalActivityId: "ac1", usualEating: { veg: 2 }, startingPicture: { little: ["fibre"], aLot: ["sodium"] },
      weightGoal: "keep", noCondition: false, conditionIds: ["c1", "gone"], allergyIds: ["al1"],
    },
    pills: ["Vitamin D", "Fish oil"],
  });
  assert.equal(r.complete, true);
  assert.deepEqual(r.conditions, [{ id: "c1", name: "Hypertension", common: true, label: "High blood pressure" }]);
  assert.equal(r.profile.weightKg, 70);
  assert.equal(r.profile.heightCm, 170);
  assert.equal(r.profile.birthday, "1990-04-02");
  assert.deepEqual(r.profile.conditionIds, ["c1"]);
  assert.equal(r.usualEating.veg, 2);
  assert.equal(r.usualEating.fruit, null);
  assert.deepEqual(r.pills, ["Vitamin D"]);
  assert.deepEqual(r.startingPicture, {
    little: [{ key: "fibre", name: "Fibre" }],
    aLot: [{ key: "sodium", name: "Sodium" }],
  });
});

test("buildOnboardingResponse with no patient is empty, not a crash", () => {
  const r = buildOnboardingResponse({ conditions: [], allergies: [], activities: [], patient: null, pills: [] });
  assert.equal(r.complete, false);
  assert.equal(r.profile.weightKg, null);
  assert.deepEqual(r.startingPicture, { little: [], aLot: [] });
  assert.equal(r.weightGoal, null);
});
