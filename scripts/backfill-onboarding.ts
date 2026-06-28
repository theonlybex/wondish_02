/**
 * One-time backfill: marks onboarding complete for accounts that already have a
 * complete profile but predate the `onboardingComplete` flag.
 *
 * Accounts created before the onboarding flags shipped read `onboardingComplete
 * = false` even though their profile is fully filled in, which traps them in the
 * onboarding redirect. This sets the DB flag for every such account so they are
 * unlocked immediately (rather than waiting for the dashboard layout to self-heal
 * the flag on their next visit).
 *
 * The DB column is now the single source of truth for the onboarding gate, so
 * this script only needs to fix that column.
 *
 * Usage:
 *   npx tsx scripts/backfill-onboarding.ts          # dry run (lists matches)
 *   npx tsx scripts/backfill-onboarding.ts --apply  # writes the changes
 */

import { PrismaClient } from "@prisma/client";
import { isProfileComplete } from "../lib/onboarding";

const prisma = new PrismaClient();

async function main() {
  const apply = process.argv.includes("--apply");

  const accounts = await prisma.account.findMany({
    where: { onboardingComplete: false },
    select: {
      id: true,
      email: true,
      patient: {
        select: {
          birthday: true,
          height: true,
          heightFt: true,
          heightIn: true,
          weight: true,
          physicalActivityId: true,
        },
      },
    },
  });

  const toHeal = accounts.filter((a) => isProfileComplete(a.patient));

  console.log(
    `${accounts.length} accounts with onboardingComplete=false; ${toHeal.length} have a complete profile and will be backfilled.`
  );
  toHeal.forEach((a) => console.log(`  ${a.email}  (${a.id})`));

  if (!apply) {
    console.log("\nDry run. Re-run with --apply to write these changes.");
    return;
  }

  let updated = 0;
  for (const a of toHeal) {
    await prisma.account.update({
      where: { id: a.id },
      data: { onboardingComplete: true },
    });
    updated += 1;
  }
  console.log(`\n✓ Backfilled ${updated} accounts.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
