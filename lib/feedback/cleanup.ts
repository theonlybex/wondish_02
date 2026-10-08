// Screenshots live in S3, outside the database cascade: deleting an account
// removes the report rows but not the images (which can show health data).
// Collect the keys BEFORE the cascade and delete them, best effort.
import { prisma } from "@/lib/db";
import { deleteFile } from "@/lib/s3";

type Deps = { findKeys: (clerkId: string) => Promise<string[]>; del: (key: string) => Promise<void> };

const defaultDeps: Deps = {
  findKeys: async (clerkId) =>
    (await prisma.feedbackReport.findMany({ where: { patient: { account: { clerkId } }, screenshotKey: { not: null } }, select: { screenshotKey: true } }))
      .map((r) => r.screenshotKey!)
      .filter(Boolean),
  del: deleteFile,
};

/** Delete every feedback screenshot this user attached. Returns how many were removed. */
export async function deleteFeedbackScreenshots(clerkId: string, deps: Deps = defaultDeps): Promise<number> {
  const keys = await deps.findKeys(clerkId);
  const results = await Promise.allSettled(keys.map((k) => deps.del(k)));
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed) console.error(`[feedback] ${failed} screenshot(s) could not be deleted for a closed account`);
  return results.length - failed;
}
