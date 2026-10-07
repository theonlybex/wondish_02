import { test } from "node:test";
import assert from "node:assert/strict";
import { groupConditions, conditionLabel, CONDITION_GROUPS, OTHER_GROUP_TITLE } from "./condition-groups";

// The 41 built-in conditions in the DB on 2026-10-07.
const DB_NAMES = ["Acne", "Alzheimer's Disease", "Aspirin-Exacerbated Respiratory Disease (AERD)", "Autoimmune Diseases", "Cancer – after treatment", "Cancer – during treatment", "Celiac Disease", "Chronic Diarrhea", "Chronic Inflammatory Conditions", "Chronic Kidney Disease stage 1-2", "Chronic kidney disease – stage 3", "Constipation", "Eczema", "Fatty Liver Disease (NAFLD)", "Foggy brain", "GERD", "Gastritis", "Gut Candidiasis", "Hair Shedding", "Heart Disease and Atherosclerosis", "High Cholesterol", "Hypertension", "Hypertriglyceridemia", "IBD – active", "IBD – in remission", "IBS-C", "IBS-D", "IBS-M", "Leaky Gut Syndrome", "Migraine", "Overweight", "PCOS", "Prediabetes", "Pregnancy", "Recovering after illness/surgery", "Respiratory Allergies", "Rosacea", "Seborrheic Dermatitis", "Stroke", "Thyroid Disorder", "Type 2 Diabetes"];
const options = DB_NAMES.map((name, i) => ({ id: `c${i}`, name }));

test("every built-in condition lands in a named group — none in Other, none twice", () => {
  const groups = groupConditions(options);
  assert.ok(!groups.some((g) => g.title === OTHER_GROUP_TITLE), "a built-in condition fell into Other");
  const ids = groups.flatMap((g) => g.options.map((o) => o.id));
  assert.equal(ids.length, DB_NAMES.length);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(groups.map((g) => g.title), CONDITION_GROUPS.map((g) => g.title));
});

test("labels follow the product list; ids are unchanged", () => {
  const groups = groupConditions(options);
  const find = (name: string) => groups.flatMap((g) => g.options).find((o) => o.name === name)!;
  assert.equal(find("Hypertension").label, "High Blood Pressure");
  assert.equal(find("Hypertension").id, `c${DB_NAMES.indexOf("Hypertension")}`);
  assert.equal(find("GERD").label, "Gastroesophageal Reflux Disease (GERD)");
  assert.equal(find("Chronic kidney disease – stage 3").label, "Chronic Kidney Disease—Stage 3");
  assert.equal(find("Rosacea").label, "Rosacea");
  assert.equal(conditionLabel("Eczema"), "Eczema / Atopic Dermatitis");
  assert.equal(conditionLabel("Something new"), "Something new");
});

test("an unmapped condition goes to Other instead of disappearing; dash and case variants still match", () => {
  const groups = groupConditions([...options, { id: "new", name: "Gout" }, { id: "dash", name: "IBD - Active" }].filter((o) => o.name !== "IBD – active"));
  assert.deepEqual(groups.at(-1), { title: OTHER_GROUP_TITLE, options: [{ id: "new", name: "Gout", label: "Gout" }] });
  assert.ok(groups[0].options.some((o) => o.id === "dash" && o.label === "Inflammatory Bowel Disease (Active)"));
});
