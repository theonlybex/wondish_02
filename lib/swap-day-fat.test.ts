import { test } from "node:test";
import assert from "node:assert/strict";
import { swapPushesDayFat } from "./swap-day-fat";

const day = { dayFatBudgetG: 53, tolerance: 1.3 }; // ceiling 68.9 g

test("a swap that takes the day past its fat ceiling is refused (QA cycle 17: 162%)", () => {
  assert.equal(swapPushesDayFat({ ...day, otherFatG: 50, candidateFatG: 36, replacedFatG: 18 }), true);
});

test("a swap inside the ceiling passes", () => {
  assert.equal(swapPushesDayFat({ ...day, otherFatG: 40, candidateFatG: 20, replacedFatG: 25 }), false);
});

test("a day already over is not made worse, but may be made better", () => {
  assert.equal(swapPushesDayFat({ ...day, otherFatG: 70, candidateFatG: 12, replacedFatG: 30 }), false);
  assert.equal(swapPushesDayFat({ ...day, otherFatG: 70, candidateFatG: 31, replacedFatG: 30 }), true);
});

test("no budget, no rule", () => {
  assert.equal(swapPushesDayFat({ otherFatG: 500, candidateFatG: 99, replacedFatG: 0, dayFatBudgetG: 0, tolerance: 1.3 }), false);
});
