// Mint a Clerk sign-in ticket so a QA run can log in without a password.
//
//   node scripts/qa-signin-ticket.mjs qa.bot1.0924@wondish.io
//
// Reads CLERK_SECRET_KEY from .env.local and asks Clerk for a one-hour sign-in
// token for that account's clerkId. Test-only: it can log in as any account in
// the database, so it never belongs in a deployed path.
// Prints the account's subscription rows, then a URL to navigate to. Tickets
// last one hour; mint a fresh one rather than reusing a stale URL.
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

for (const line of readFileSync("/Users/becks/Desktop/BeTech/wondish_02/.env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

const email = process.argv[2];
if (!email) throw new Error("usage: node qa-ticket.mjs <email>");

const prisma = new PrismaClient();
const account = await prisma.account.findFirst({
  where: { email },
  include: { subscriptions: true },
});
if (!account) throw new Error(`no account row for ${email}`);
console.log(
  `account ${email} | clerkId ${account.clerkId} | subs: ` +
    (account.subscriptions.map((s) => `${s.source}:${s.plan}/${s.status}`).join(", ") || "none")
);
await prisma.$disconnect();

const res = await fetch("https://api.clerk.com/v1/sign_in_tokens", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ user_id: account.clerkId, expires_in_seconds: 3600 }),
});
const body = await res.json();
if (!res.ok) throw new Error(`clerk ${res.status}: ${JSON.stringify(body)}`);
console.log(`http://localhost:3000/login?__clerk_ticket=${body.token}`);
