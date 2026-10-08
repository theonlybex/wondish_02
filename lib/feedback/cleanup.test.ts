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
