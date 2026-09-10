// Backfill cooking steps for public dishes that have none. One Haiku call per
// batch of dishes; each batch is written as soon as it returns, so the run is
// resumable (dishes that already have steps are skipped) and never overwrites.
//
//   set -a; source .env.local; set +a
//   npx tsx scripts/backfill-recipe-steps.ts            # dry-run: counts + cost estimate
//   npx tsx scripts/backfill-recipe-steps.ts --apply    # generate + write
//
// Cost guard: aborts before any call that would push spend past MAX_USD.

import Anthropic from "@anthropic-ai/sdk";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const MODEL = "claude-haiku-4-5";
const MAX_USD = Number(process.env.STEPS_MAX_USD ?? 2.5);
const BATCH = 10;
const IN_PER_M = 1, OUT_PER_M = 5;
// Per-dish worst-case estimate used by the guard (observed ~120 in / ~300 out).
const EST_IN = 160, EST_OUT = 400;

async function main(write: boolean) {
  const dishes = await prisma.recipe.findMany({
    where: { isPublic: true, steps: { isEmpty: true } },
    select: {
      id: true, name: true, description: true, prepTime: true, cookTime: true, servings: true,
      ethnic: { select: { name: true } },
      ingredients: { select: { quantity: true, unit: true, note: true, ingredient: { select: { name: true, unit: true } } } },
    },
    orderBy: { name: "asc" },
  });
  const est = dishes.length * (EST_IN * IN_PER_M + EST_OUT * OUT_PER_M) / 1e6;
  console.log(`${dishes.length} dishes without steps; worst-case estimate $${est.toFixed(2)} (cap $${MAX_USD})`);
  if (!write) return;
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not loaded");

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let spent = 0, filled = 0, failed = 0;

  for (let i = 0; i < dishes.length; i += BATCH) {
    const batch = dishes.slice(i, i + BATCH);
    const callEst = batch.length * (EST_IN * IN_PER_M + EST_OUT * OUT_PER_M) / 1e6;
    if (spent + callEst > MAX_USD) {
      console.log(`cost guard: $${spent.toFixed(3)} spent, next call ~$${callEst.toFixed(3)} would exceed $${MAX_USD}; stopping (rerun to resume)`);
      break;
    }

    const text = batch
      .map((d) => {
        const ings = d.ingredients
          .map((ri) => {
            const qty = ri.quantity ? `${ri.quantity}${ri.unit ?? ri.ingredient.unit ? " " + (ri.unit ?? ri.ingredient.unit) : ""} ` : "";
            return `${qty}${ri.ingredient.name}${ri.note ? ` (${ri.note})` : ""}`;
          })
          .join("; ");
        const meta = [
          d.ethnic?.name ? `cuisine: ${d.ethnic.name}` : "",
          d.prepTime ? `prep ${d.prepTime} min` : "",
          d.cookTime ? `cook ${d.cookTime} min` : "",
          d.servings ? `serves ${d.servings}` : "",
        ].filter(Boolean).join(", ");
        return `ID ${d.id}\nName: ${d.name}\n${meta ? meta + "\n" : ""}${d.description ? `About: ${d.description}\n` : ""}Ingredients: ${ings}`;
      })
      .join("\n\n");

    try {
      const msg = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 6000,
        system:
          "You write home-cooking instructions. For each dish, produce 5–10 clear, numbered-in-order steps a beginner can follow: " +
          "include prep (wash/chop), heat levels, pan/oven temperatures, timings, and doneness cues. Use ONLY the listed ingredients " +
          "(salt, pepper and water are always allowed). Honour every parenthesised ingredient note exactly (e.g. 'egg whites only' → separate and use the whites). " +
          "Each step is one plain sentence without a leading number. Reply with ONLY a JSON object: { \"<ID>\": [\"step\", ...], ... } covering every dish.",
        messages: [{ role: "user", content: text }],
      });
      spent += msg.usage.input_tokens * IN_PER_M / 1e6 + msg.usage.output_tokens * OUT_PER_M / 1e6;
      const raw = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
      const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as Record<string, unknown>;

      for (const d of batch) {
        const steps = Array.isArray(parsed[d.id])
          ? (parsed[d.id] as unknown[]).filter((s): s is string => typeof s === "string" && s.trim().length > 0).map((s) => s.trim())
          : [];
        if (steps.length < 3) { failed++; console.warn(`  ! ${d.name}: ${steps.length} steps, skipped`); continue; }
        // Guard against a concurrent writer: only fill if still empty.
        const res = await prisma.recipe.updateMany({ where: { id: d.id, steps: { isEmpty: true } }, data: { steps } });
        if (res.count) filled++;
      }
      console.log(`batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(dishes.length / BATCH)}: in=${msg.usage.input_tokens} out=${msg.usage.output_tokens} filled=${filled} spent=$${spent.toFixed(3)}`);
    } catch (e) {
      failed += batch.length;
      console.warn(`  ! batch ${Math.floor(i / BATCH) + 1} failed: ${(e as Error).message}`);
    }
  }
  console.log(`\nfilled ${filled}, skipped/failed ${failed}, total spend $${spent.toFixed(3)}`);
}

main(process.argv.includes("--apply"))
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
