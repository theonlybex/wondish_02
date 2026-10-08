import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deleteFeedbackScreenshots } from "./cleanup";

test("every screenshot a user attached is deleted; one failure does not stop the rest", async () => {
  const deleted: string[] = [];
  const n = await deleteFeedbackScreenshots("clerk_1", {
    findKeys: async (clerkId) => (clerkId === "clerk_1" ? ["feedback/a.png", "feedback/b.png", "feedback/c.png"] : []),
    del: async (key) => { if (key.endsWith("b.png")) throw new Error("s3 down"); deleted.push(key); },
  });
  assert.deepEqual(deleted, ["feedback/a.png", "feedback/c.png"]);
  assert.equal(n, 2);
});

test("account deletion removes screenshots BEFORE the cascade forgets their keys", () => {
  const src = readFileSync("app/api/me/route.ts", "utf8");
  const cleanup = src.indexOf("deleteFeedbackScreenshots(userId)");
  const cascade = src.indexOf("prisma.account.deleteMany({ where: { clerkId: userId } })");
  assert.ok(cleanup > 0, "DELETE /api/me does not delete feedback screenshots");
  assert.ok(cleanup < cascade, "screenshots must be deleted before the account cascade");
});

import { deleteOrphanedIssues } from "./cleanup";
test("issues left with no reports after an account is deleted are removed; shared ones stay", async () => {
  const removed: string[] = [];
  const n = await deleteOrphanedIssues(["iss-mine", "iss-shared"], {
    remaining: async (id) => (id === "iss-shared" ? 2 : 0),
    remove: async (id) => { removed.push(id); },
  });
  assert.deepEqual(removed, ["iss-mine"]);
  assert.equal(n, 1);
});

test("account deletion collects issue ids before the cascade and removes orphans after it", () => {
  const src = readFileSync("app/api/me/route.ts", "utf8");
  const collect = src.indexOf("feedbackIssueIdsFor(userId)");
  const cascade = src.indexOf("prisma.account.deleteMany({ where: { clerkId: userId } })");
  const orphans = src.indexOf("deleteOrphanedIssues(");
  assert.ok(collect > 0 && orphans > 0, "DELETE /api/me does not clean up orphaned feedback issues");
  assert.ok(collect < cascade && cascade < orphans, "collect before the cascade, delete orphans after it");
});
