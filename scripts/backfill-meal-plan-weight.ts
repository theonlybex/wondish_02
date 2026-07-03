/**
 * One-time backfill: patients whose meal plan predates the mealPlanWeight
 * anchor column (added 2026-06-30, 5dba152) have a null anchor, which
 * permanently disables weight-drift detection and pins journey progress at 0%.
 *
 * For each patient with a plan but no anchor, recover the weight the plan was
 * built for, in order of fidelity:
 *   1. latest journal weigh-in dated on/before mealPlanStartDate
 *   2. earliest journal weigh-in after mealPlanStartDate
 *   3. current profile weight
 * All weights are lbs (the app's single stored unit).
 *
 * Run:      npx tsx scripts/backfill-meal-plan-weight.ts --dry
 * Apply:    npx tsx scripts/backfill-meal-plan-weight.ts
 */
import { prisma } from "../lib/db";

const dryRun = process.argv.includes("--dry");

async function main() {
  const patients = await prisma.patient.findMany({
    where: { mealPlanStartDate: { not: null }, mealPlanWeight: null },
    select: {
      id: true,
      weight: true,
      mealPlanStartDate: true,
      account: { select: { email: true } },
    },
  });
  console.log(`${patients.length} patient(s) with a plan but no weight anchor${dryRun ? " (dry run)" : ""}`);

  for (const p of patients) {
    const planStart = p.mealPlanStartDate!;
    const before = await prisma.journalEntry.findFirst({
      where: { patientId: p.id, weight: { not: null }, date: { lte: planStart } },
      orderBy: { date: "desc" },
      select: { weight: true, date: true },
    });
    const after = before
      ? null
      : await prisma.journalEntry.findFirst({
          where: { patientId: p.id, weight: { not: null }, date: { gt: planStart } },
          orderBy: { date: "asc" },
          select: { weight: true, date: true },
        });

    const source = before ?? after;
    const anchor = source?.weight ?? p.weight;
    const via = before ? "weigh-in before plan start"
      : after ? "first weigh-in after plan start"
      : p.weight != null ? "current profile weight"
      : "none";

    if (anchor == null) {
      console.log(`SKIP  ${p.account.email} — no weight available anywhere`);
      continue;
    }

    console.log(
      `${dryRun ? "WOULD SET" : "SET"}  ${p.account.email} — anchor ${anchor} lbs (${via}` +
      `${source ? `, ${source.date.toISOString().slice(0, 10)}` : ""}) for plan started ${planStart.toISOString().slice(0, 10)}`
    );
    if (!dryRun) {
      await prisma.patient.update({ where: { id: p.id }, data: { mealPlanWeight: anchor } });
    }
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
