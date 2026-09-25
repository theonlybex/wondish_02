/**
 * Two repairs a user reads directly: a dangerous instruction, and a title that
 * is a shopping line.
 *
 *   node --import tsx scripts/repair-steps-and-titles.ts            # report only
 *   node --import tsx scripts/repair-steps-and-titles.ts --apply    # write, after a backup
 *
 * 1. "Rinse the chicken breast and pat dry." USDA and FSIS have advised against
 *    rinsing raw meat, poultry and fish for years: the water aerosolises
 *    surface bacteria across the sink and the cooking was going to kill them
 *    anyway. 22 public dishes say it. The pat-dry is the useful half, so the
 *    sentence is rewritten and the dish kept.
 *
 * 2. "Large Eggs with Spinach and Yellow Onions" — the catalog row name used as
 *    a recipe name. It does not lie, so the title gate passes it; it also tells
 *    the cook nothing. The steps say what was actually done, so the grading
 *    word becomes the method.
 *
 * Both rules live in lib/dish-plausibility.ts, where generation reads them too.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";
import { stepRinsesRawProtein, withoutRawProteinRinse, nameFromCookedForm } from "../lib/dish-plausibility";

const APPLY = process.argv.includes("--apply");

async function main() {
  const prisma = new PrismaClient();

  const rows = await prisma.recipe.findMany({
    where: { isPublic: true },
    select: { id: true, name: true, description: true, steps: true, tags: true },
  });

  const stepFixes: { id: string; name: string; from: string; to: string }[] = [];
  const titleFixes: { id: string; from: string; to: string; description: string | null }[] = [];

  const taken = new Set(rows.map((r) => r.name.trim().toLowerCase()));

  for (const r of rows) {
    if (r.steps.some(stepRinsesRawProtein)) {
      const next = r.steps.map((s) => withoutRawProteinRinse(s) ?? s);
      stepFixes.push({ id: r.id, name: r.name, from: r.steps.join(" ⏎ "), to: next.join(" ⏎ ") });
    }

    const renamed = nameFromCookedForm(r.name, r.steps);
    if (renamed && !taken.has(renamed.trim().toLowerCase())) {
      taken.delete(r.name.trim().toLowerCase());
      taken.add(renamed.trim().toLowerCase());
      // The library's convention is that the description repeats the name when
      // it has nothing else to say; a stale description naming the old title
      // would contradict the card it sits on.
      const description = r.description && r.description.trim() === r.name.trim() ? renamed : r.description;
      titleFixes.push({ id: r.id, from: r.name, to: renamed, description });
    }
  }

  console.log(`public dishes:                       ${rows.length}`);
  console.log(`telling the user to rinse raw meat:  ${stepFixes.length}`);
  console.log(`titled after a grocery grading word: ${titleFixes.length}`);
  console.log(
    "\nsteps:\n" +
      stepFixes
        .slice(0, 6)
        .map((f) => `  ${f.name}\n     was: ${f.from.split(" ⏎ ").find(stepRinsesRawProtein)}`)
        .join("\n")
  );
  console.log("\ntitles:\n" + titleFixes.slice(0, 8).map((f) => `  ${f.from}\n    → ${f.to}`).join("\n"));

  if (!APPLY) {
    console.log("\nreport only. Re-run with --apply to write.");
    await prisma.$disconnect();
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `/tmp/wondish-steps-titles-${stamp}.json`;
  writeFileSync(backup, JSON.stringify({ stepFixes, titleFixes }, null, 2));
  console.log(`\nbackup written: ${backup}`);

  for (const f of stepFixes) {
    await prisma.recipe.update({ where: { id: f.id }, data: { steps: f.to.split(" ⏎ ") } });
  }
  for (const f of titleFixes) {
    await prisma.recipe.update({ where: { id: f.id }, data: { name: f.to, description: f.description } });
  }

  console.log(`\napplied: ${stepFixes.length} dishes no longer tell the user to rinse raw meat, ${titleFixes.length} renamed to what they are`);
  await prisma.$disconnect();
}

main();
