/**
 * One-time script: grants SUPER (admin) role to an account by email.
 *
 * Usage:
 *   npx tsx scripts/make-admin.ts your@email.com
 *   npx tsx scripts/make-admin.ts --backfill   # ADMIN premium row for every existing SUPER
 */

import { PrismaClient } from "@prisma/client";
import { grantSuper } from "../lib/admin-grant";

const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2];
  if (email === "--backfill") {
    const supers = await prisma.accountRole.findMany({
      where: { role: { name: "SUPER" } },
      select: { account: { select: { id: true, email: true } } },
    });
    for (const s of supers) {
      await grantSuper(prisma, s.account.id);
      console.log(`✓ ADMIN premium row ensured for ${s.account.email}`);
    }
    console.log(`${supers.length} admin account(s) backfilled`);
    return;
  }
  if (!email) {
    console.error("Usage: npx tsx scripts/make-admin.ts your@email.com");
    process.exit(1);
  }

  // Try exact match first, then partial
  let account = await prisma.account.findUnique({ where: { email } });

  if (!account) {
    // Show all accounts to help find the right one
    const all = await prisma.account.findMany({ select: { id: true, email: true, firstName: true, lastName: true, clerkId: true } });
    if (all.length === 0) {
      console.error("No accounts exist in the database at all.");
    } else {
      console.error(`No exact match for: ${email}\n`);
      console.log("Accounts in the database:");
      all.forEach((a) => console.log(`  ${a.email}  (${a.firstName} ${a.lastName})  clerkId: ${a.clerkId ?? "none"}`));
    }
    process.exit(1);
  }

  // SUPER role + ADMIN-source premium row (admins have Premium by default).
  await grantSuper(prisma, account.id);

  console.log(`✓ Admin access granted to ${email}`);
  console.log(`  Account ID: ${account.id}`);
  console.log(`  Role: SUPER · Premium: ADMIN row (no end)`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
