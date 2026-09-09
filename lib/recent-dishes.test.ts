import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRecentDishes, recentDishIds, mergeRecentDishes, RECENT_DISH_WINDOW_DAYS } from "./recent-dishes";

const DAY = 86400000;
const now = 1_000_000_000_000;

test("parseRecentDishes keeps only well-formed entries", () => {
  const r = parseRecentDishes([{ id: "a", ts: 1 }, { id: 2, ts: 1 }, { id: "b" }, null, "x"]);
  assert.deepEqual(r, [{ id: "a", ts: 1 }]);
});

test("recentDishIds excludes dishes older than the window", () => {
  const entries = [
    { id: "fresh", ts: now - 10 * DAY },
    { id: "old", ts: now - (RECENT_DISH_WINDOW_DAYS + 1) * DAY },
  ];
  const ids = recentDishIds(entries, now);
  assert.ok(ids.has("fresh"));
  assert.ok(!ids.has("old"), "a dish past the 2-month window is eligible again");
});

test("mergeRecentDishes adds new ids at now, refreshes dupes, prunes expired", () => {
  const entries = [
    { id: "keep", ts: now - 5 * DAY },
    { id: "expired", ts: now - (RECENT_DISH_WINDOW_DAYS + 2) * DAY },
    { id: "dupe", ts: now - 30 * DAY },
  ];
  const merged = mergeRecentDishes(entries, ["dupe", "new"], now);
  const map = new Map(merged.map((e) => [e.id, e.ts]));
  assert.ok(!map.has("expired"), "expired entry pruned");
  assert.equal(map.get("keep"), now - 5 * DAY);
  assert.equal(map.get("dupe"), now, "an id served again is refreshed to now");
  assert.equal(map.get("new"), now);
});
