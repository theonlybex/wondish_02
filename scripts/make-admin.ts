/**
 * One-time script: grants SUPER (admin) role to an account by email.
 *
 * Usage:
 *   npx tsx scripts/make-admin.ts your@email.com
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2];
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

  // Upsert the SUPER role
  const role = await prisma.role.upsert({
    where: { name: "SUPER" },
    update: {},
    create: { name: "SUPER" },
  });

  // Assign to account
  await prisma.accountRole.upsert({
    where: { accountId_roleId: { accountId: account.id, roleId: role.id } },
    update: {},
    create: { accountId: account.id, roleId: role.id },
  });

  console.log(`✓ Admin access granted to ${email}`);
  console.log(`  Account ID: ${account.id}`);
  console.log(`  Role: SUPER`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
