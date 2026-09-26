/**
 * The import typos scripts/audit-library.ts found, fixed by EXACT substring —
 * nothing is inferred, so nothing else can change.
 *
 *   node --import tsx scripts/repair-typos.ts            # report only
 *   node --import tsx scripts/repair-typos.ts --apply    # write, after a backup
 *
 * Each pair was read in its sentence first (2026-09-25 audit). Add a pair only
 * after reading the sentence it lives in.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";

const FIXES: [string, string][] = [
  ["parmesa-style", "parmesan-style"],
  ["package isntructions", "package instructions"],
  ["Slicesalmon into", "Slice salmon into"],
  ["To cook the pasta:.", "To cook the pasta:"],
  ["flipping half wathroughou", "flipping halfway through"],
  ["peacans", "pecans"],
  ["Peacans", "Pecans"],
  ["remining", "remaining"],
];

const APPLY = process.argv.includes("--apply");

async function main() {
  const prisma = new PrismaClient();
  const rows = await prisma.recipe.findMany({ select: { id: true, name: true, description: true, steps: true } });
  const fix = (t: string) => FIXES.reduce((s, [a, b]) => s.split(a).join(b), t);
  const changes = rows
    .map((r) => ({ r, description: r.description == null ? null : fix(r.description), steps: r.steps.map(fix) }))
    .filter(({ r, description, steps }) => description !== r.description || steps.some((s, i) => s !== r.steps[i]));
  for (const [a] of FIXES) {
    const n = rows.filter((r) => [r.description ?? "", ...r.steps].some((t) => t.includes(a))).length;
    console.log(`${String(n).padStart(3)} × "${a}"`);
  }
  console.log(`dishes to change: ${changes.length}`);
  if (!APPLY) { console.log("report only. Re-run with --apply to write."); await prisma.$disconnect(); return; }
  const backup = `/tmp/wondish-typos-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(backup, JSON.stringify(changes.map(({ r }) => r), null, 2));
  console.log(`backup written: ${backup}`);
  for (const c of changes) await prisma.recipe.update({ where: { id: c.r.id }, data: { description: c.description, steps: c.steps } });
  console.log(`applied: ${changes.length} dishes`);
  await prisma.$disconnect();
}
main();
