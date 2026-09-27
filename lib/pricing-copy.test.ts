import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { IntlMessageFormat } from "intl-messageformat";
import { AI_LIMITS } from "./ai-budget";

// es and ru /pricing showed a different, older feature list from English
// ("BMI calculator", "50+ recipes") — allowances that were not the ones
// enforced (QA cycles 16-17). Every language now takes its numbers from
// AI_LIMITS; this formats every locale's copy with them.
const locales = ["en", "es", "ru"] as const;
const lim = (tier: "free" | "premium") => ({
  weeks: AI_LIMITS.planGen[tier], msgs: AI_LIMITS.claraChat[tier], swaps: AI_LIMITS.swap[tier],
  fridge: AI_LIMITS.fridge[tier], cook: AI_LIMITS.cookDay[tier],
});
const keys: [string, "free" | "premium", (keyof ReturnType<typeof lim>)[]][] = [
  // freeF1 names no number: Free's new weeks are 0 — it has the first week.
  ["freeF1", "free", []], ["freeF2", "free", ["msgs"]], ["freeF3", "free", ["swaps", "fridge", "cook"]],
  ["premiumF2", "premium", ["weeks"]], ["premiumF3", "premium", ["msgs"]], ["premiumF4", "premium", ["swaps", "fridge"]], ["premiumF5", "premium", ["cook"]],
];

for (const loc of locales) {
  test(`${loc}: every plan line states the enforced allowance`, () => {
    const pricing = JSON.parse(readFileSync(`messages/${loc}.json`, "utf8")).pricing;
    for (const [key, tier, nums] of keys) {
      const out = new IntlMessageFormat(pricing[key], loc).format(lim(tier)) as string;
      for (const n of nums) assert.ok(out.includes(String(lim(tier)[n])), `${loc}.${key} lacks ${n}=${lim(tier)[n]}: ${out}`);
      assert.ok(!/[{}]/.test(out), `${loc}.${key} left a placeholder: ${out}`);
    }
    assert.ok(!/BMI|IMC|ИМТ|50\+/.test(JSON.stringify(pricing)), `${loc} still carries the old feature list`);
  });
}
