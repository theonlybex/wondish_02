// Ban lists for three conditions that banned nothing, from the evidence review
// in docs/research/rule-ban-lists-2026-10-07.md (decision "A" rules only).
// Report-only by default, idempotent (createMany skipDuplicates).
//   node --env-file=.env.local --import tsx scripts/condition-bans-research-2026-10-07.ts [--apply]
//
// - Cancer – during treatment: FDA/NCI food safety for immunocompromised
//   diners — names that carry the risk (raw fish, smoked fish, raw milk,
//   raw sprouts, deli meat). Strong evidence.
// - IBD – active: low-residue flare guidance (whole nuts, seeds, popcorn,
//   corn kernels, dried fruit). Commonly advised; CLINICIAN SIGN-OFF before
//   --apply. Specific names only: "almonds" would also ban almond milk/flour
//   (the stem matches both ways), so the whole-nut forms are named.
// - Chronic Diarrhea: sugar alcohols (NIDDK). Mostly guards Clara's output;
//   the library uses none of them today.
//
// The report shows, per condition, which shopping-catalog items and how many
// library dishes the new list removes, and every term that hits nothing.
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import { derivePatientBans, buildDietMatchers, evaluateDishAgainstProfile } from "../lib/diet-match";
import { INGREDIENT_CATALOG } from "../lib/ingredient-catalog";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

const LISTS: Record<string, string[]> = {
  "Cancer – during treatment": [
    "sushi", "sashimi", "ceviche", "poke", "carpaccio", "tartare",
    "raw oysters", "smoked salmon", "lox", "gravlax",
    "raw milk", "unpasteurized milk", "raw milk cheese", "unpasteurized juice",
    "alfalfa sprouts", "deli meat", "deli turkey",
  ],
  "IBD – active": [
    "popcorn", "walnuts", "pecans", "pistachios", "hazelnuts",
    "almond slivers", "sliced almonds", "whole almonds",
    "unsalted peanuts", "roasted peanuts", "cashew nuts", "dry unsalted roasted cashews",
    "sunflower seeds", "pumpkin seeds", "poppy seeds", "sesame seeds", "chia seeds",
    "corn kernels", "kernel corn",
    "raisins", "dried cranberries", "dried figs", "prunes", "shredded coconut",
  ],
  "Chronic Diarrhea": ["sorbitol", "xylitol", "mannitol", "maltitol", "sugar-free candy", "sugar-free gum"],
};

(async () => {
  const conditions = await prisma.healthCondition.findMany({
    where: { name: { in: Object.keys(LISTS) }, ownerPatientId: null },
    select: { id: true, name: true, bannedIngredients: { select: { name: true } } },
  });
  const missing = Object.keys(LISTS).filter((n) => !conditions.some((c) => c.name === n));
  if (missing.length) throw new Error(`conditions not found: ${missing.join(", ")} — stop`);

  const recipes = await prisma.recipe.findMany({
    where: { isPublic: true },
    select: { ingredients: { select: { ingredient: { select: { name: true } } } } },
  });
  const ingredientNames = Array.from(new Set(recipes.flatMap((r) => r.ingredients.map((i) => i.ingredient.name))));
  const catalog = INGREDIENT_CATALOG.flatMap((c) => c.items);

  let total = 0;
  const added: { conditionId: string; name: string }[] = [];
  for (const cond of conditions) {
    const have = new Set(cond.bannedIngredients.map((b) => b.name.toLowerCase()));
    const toAdd = LISTS[cond.name].filter((n) => !have.has(n.toLowerCase()));
    total += toAdd.length;

    // Impact of the FULL resulting list, judged by the real engine.
    const all = [...cond.bannedIngredients.map((b) => b.name), ...toAdd];
    const matchers = buildDietMatchers(derivePatientBans({
      foodAllergies: [], foodToAvoid: [], foodPreferences: [], motivations: [],
      healthConditions: [{ condition: { name: cond.name, bannedIngredients: all.map((name) => ({ name })) } }],
    }));
    const banned = (n: string) => !evaluateDishAgainstProfile([n], matchers).passed;
    const catalogHit = catalog.filter(banned);
    const ingredientHit = ingredientNames.filter(banned);
    const dishesRemoved = recipes.filter((r) => !evaluateDishAgainstProfile(r.ingredients.map((i) => i.ingredient.name), matchers).passed).length;
    // Terms that hit nothing in the library or catalog today (fine for Clara's
    // free text, but worth knowing).
    const silent = toAdd.filter((t) => {
      const one = buildDietMatchers({ allergyNames: [], exactBanned: [{ name: t, source: "condition" }] });
      return ![...ingredientNames, ...catalog].some((n) => !evaluateDishAgainstProfile([n], one).passed);
    });

    console.log(`\n[${cond.name}] ${have.size} → +${toAdd.length}`);
    if (toAdd.length) console.log(`  add: ${toAdd.join(", ")}`);
    console.log(`  shopping catalog items banned: ${catalogHit.join(", ") || "none"}`);
    console.log(`  library ingredients banned (${ingredientHit.length}): ${ingredientHit.slice(0, 30).join(" | ")}${ingredientHit.length > 30 ? " …" : ""}`);
    console.log(`  library dishes removed: ${dishesRemoved} of ${recipes.length}`);
    console.log(`  terms matching nothing today: ${silent.join(", ") || "none"}`);
    for (const name of toAdd) added.push({ conditionId: cond.id, name });
  }

  if (!apply) {
    console.log(`\nReport only: ${total} rows would be created. Re-run with --apply.`);
    return prisma.$disconnect();
  }
  // Rollback = the rows this run creates (delete them by conditionId + name).
  const rollback = `scripts/condition-bans-research-2026-10-07.rollback-${Date.now()}.json`;
  fs.writeFileSync(rollback, JSON.stringify(added, null, 1));
  console.log(`rollback → ${rollback}`);
  const res = await prisma.healthConditionBannedIngredient.createMany({ data: added, skipDuplicates: true });
  console.log(`Applied: ${res.count} rows created.`);
  await prisma.$disconnect();
})();
