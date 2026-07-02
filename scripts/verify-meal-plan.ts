/**
 * Runtime verification for the blue/green meal-plan regeneration (Phase A).
 *
 * Run: npx tsx scripts/verify-meal-plan.ts
 *
 * Asserts, against the dev DB, using a real profileCompleted patient:
 *   1. regeneratePlan bumps activePlanVersion by exactly 1.
 *   2. No menus are left under a non-active planVersion (cleanup ran).
 *   3. Status ends READY and not stale.
 *   4. Two concurrent regenerate calls -> exactly one MealPlanBusyError (claim-lock).
 *
 * Read-only safe-ish: it regenerates ONE patient's plan (which is the normal
 * operation). It restores nothing because regenerate is idempotent by design.
 */
import { prisma } from "../lib/db";
import { regeneratePlan, MealPlanBusyError } from "../lib/meal-plan-runner";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  const patient = await prisma.patient.findFirst({
    where: { profileCompleted: true },
    select: { id: true, activePlanVersion: true },
  });
  if (!patient) {
    console.error("No profileCompleted patient to test with. Seed/complete a profile first.");
    process.exit(1);
  }
  console.log(`Testing with patient ${patient.id} (activePlanVersion=${patient.activePlanVersion})`);

  const before = patient.activePlanVersion;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Simulate a previous run that inserted next-version rows and then crashed
  // BEFORE the flip: those rows share the retry's planVersion, so without a
  // purge the retry doubles the plan. The sentinel's ancient date makes it
  // identifiable after the regenerate.
  const sample = await prisma.menu.findFirst({
    where: { patientId: patient.id },
    select: { recipeId: true, mealTypeId: true },
  });
  if (sample) {
    await prisma.menu.create({
      data: {
        patientId: patient.id,
        recipeId: sample.recipeId,
        mealTypeId: sample.mealTypeId,
        planVersion: before + 1,
        date: new Date("2001-01-01"),
      },
    });
  }

  // 1–3: single regenerate
  const count = await regeneratePlan(patient.id, today);
  console.log(`Generated ${count} menu rows.`);

  const after = await prisma.patient.findUnique({
    where: { id: patient.id },
    select: { activePlanVersion: true, mealPlanStatus: true, mealPlanStale: true },
  });
  check("activePlanVersion bumped by 1", after!.activePlanVersion === before + 1, `before=${before} after=${after!.activePlanVersion}`);

  const orphans = await prisma.menu.count({
    where: { patientId: patient.id, planVersion: { not: after!.activePlanVersion } },
  });
  check("no orphan (old-version) menus remain", orphans === 0, `orphans=${orphans}`);

  const activeMenus = await prisma.menu.count({
    where: { patientId: patient.id, planVersion: after!.activePlanVersion },
  });
  check("active version has menus", activeMenus > 0, `activeMenus=${activeMenus}`);

  check("status READY and not stale", after!.mealPlanStatus === "READY" && after!.mealPlanStale === false,
    `status=${after!.mealPlanStatus} stale=${after!.mealPlanStale}`);

  const leftovers = await prisma.menu.count({
    where: { patientId: patient.id, planVersion: after!.activePlanVersion, date: { lt: today } },
  });
  check("failed-run leftovers purged before insert", sample == null || leftovers === 0, `leftovers=${leftovers}`);

  // 4: concurrent claim-lock — exactly one should win, the other gets MealPlanBusyError
  const results = await Promise.allSettled([
    regeneratePlan(patient.id, today),
    regeneratePlan(patient.id, today),
  ]);
  const busy = results.filter((r) => r.status === "rejected" && r.reason instanceof MealPlanBusyError).length;
  const fulfilled = results.filter((r) => r.status === "fulfilled").length;
  check("concurrent: exactly one MealPlanBusyError", busy === 1, `busy=${busy} fulfilled=${fulfilled}`);

  // After the race, status must settle back to READY (winner finished).
  const settled = await prisma.patient.findUnique({
    where: { id: patient.id },
    select: { mealPlanStatus: true },
  });
  check("status settled to READY after race", settled!.mealPlanStatus === "READY", `status=${settled!.mealPlanStatus}`);

  await prisma.$disconnect();
  console.log(failures === 0 ? "\nALL CHECKS PASSED ✓" : `\n${failures} CHECK(S) FAILED ✗`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("VERIFICATION ERROR:", e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
