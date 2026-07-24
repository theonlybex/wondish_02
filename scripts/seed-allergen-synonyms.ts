/**
 * Allergen synonym seeder — fixes the 2026-07-24 audit CRITICAL finding.
 *
 * A FoodAllergy with no FoodAllergyBannedIngredient children matches only by
 * its own display name (lib/diet-match.ts derivePatientBans), so "Shellfish"
 * passes ingredient "Shrimp", "Fish" passes "Tuna", "Tree nuts" passes
 * "Walnuts" — false "safe" verdicts on every food surface. No prior seed
 * populated those children. This script adds a curated synonym list per
 * allergy, idempotently (per-pair existence check; re-runs converge, never
 * duplicate).
 *
 * SAFETY / OPERATION:
 *   - Default is DRY-RUN: prints exactly what it would create, writes nothing.
 *   - Pass --execute to write. Requires DATABASE_URL in the environment.
 *   - Allergies are matched by exact name against the rows the admin seed
 *     creates (app/api/admin/seed/route.ts). Unknown names are reported and
 *     skipped, never guessed.
 *
 *   Run:  npx tsx scripts/seed-allergen-synonyms.ts            (dry-run)
 *         npx tsx scripts/seed-allergen-synonyms.ts --execute  (writes)
 *
 * The synonym lists are matcher inputs, not medical advice: they feed the
 * word-boundary matchers in lib/diet-match.ts (plural stemming + phrase
 * matching mean "almond" also catches "Almonds" / "almond butter"). Curation
 * favors over-blocking — the safe direction for allergy verdicts.
 */
import { PrismaClient } from "@prisma/client";
import { ALLERGEN_SYNONYMS } from "../data/allergen-synonyms";

async function main() {
  const execute = process.argv.includes("--execute");
  const prisma = new PrismaClient();
  try {
    const allergies = await prisma.foodAllergy.findMany({
      include: { bannedIngredients: true },
    });
    const byName = new Map(allergies.map((a) => [a.name, a]));

    let created = 0;
    let skipped = 0;
    for (const [allergyName, synonyms] of Object.entries(ALLERGEN_SYNONYMS)) {
      const allergy = byName.get(allergyName);
      if (!allergy) {
        console.warn(`⚠ allergy not found in DB, skipping: "${allergyName}"`);
        continue;
      }
      const existing = new Set(
        allergy.bannedIngredients.map((b) => b.name.trim().toLowerCase())
      );
      for (const syn of synonyms) {
        if (existing.has(syn.trim().toLowerCase())) {
          skipped++;
          continue;
        }
        created++;
        if (execute) {
          await prisma.foodAllergyBannedIngredient.create({
            data: { allergyId: allergy.id, name: syn },
          });
        }
        console.log(`${execute ? "created" : "would create"}: ${allergyName} ← "${syn}"`);
      }
    }
    console.log(
      `${execute ? "EXECUTED" : "DRY-RUN (pass --execute to write)"}: ` +
        `${created} ${execute ? "created" : "to create"}, ${skipped} already present.`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
