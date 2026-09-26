/**
 * Library data a user can see is wrong — REPORT ONLY, writes nothing.
 *
 *   node --import tsx scripts/audit-library.ts
 *
 * Two findings from QA cycle 17 that need a person, not a rule:
 *
 *  1. Broken prose in public dishes — "Add Tofu , cook 8-10 minutes until done,
 *     flipping half wathroughou, remove from heat." Import noise: a space before
 *     punctuation, doubled punctuation, a word that is not a word. The spacing
 *     can be repaired mechanically; a garbled word cannot, so each is listed.
 *  2. Declared calories no meal has: under 60 kcal (84 rows in cycle 17,
 *     "Beef Pot Roast" at 0) or over 1,200 (5 rows). The builder now refuses
 *     them for a slot's main dish (lib/meal-plan.ts MIN_MEAL_KCAL); /dishes still
 *     shows them.
 *
 * A CSV of every flagged row is written to /tmp for review.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync } from "node:fs";

const SPACE_BEFORE_PUNCT = /\s[,.;:!?](?=\s|$)/;
const DOUBLE_PUNCT = /[,.;:]{2,}(?!\.)/;
// A "word" of 5+ letters with no vowel, or one that runs a known word into
// another ("wathroughou"): the second is heuristic, so these are listed for a
// person to read, never rewritten.
const NO_VOWEL_WORD = /\b[b-df-hj-np-tv-z]{5,}\b/i;
// A word that is not a word: 7+ letters, in neither the system dictionary nor
// the catalog's own ingredient names ("wathroughou"). A first version matched
// any word containing "through" or "heat" and flagged "preheated" 158 times.
const DICT = new Set(
  (() => { try { return readFileSync("/usr/share/dict/words", "utf8"); } catch { return ""; } })()
    .split("\n").map((w) => w.trim().toLowerCase()).filter(Boolean)
);
const INFLECTED = /(s|es|ed|d|ing|ly|er|est)$/;
const isWord = (w: string, food: Set<string>) => {
  const l = w.toLowerCase();
  if (DICT.has(l) || food.has(l)) return true;
  for (const suf of ["s", "es", "ed", "d", "ing", "ly", "er", "est"]) if (l.endsWith(suf) && (DICT.has(l.slice(0, -suf.length)) || DICT.has(l.slice(0, -suf.length) + "e"))) return true;
  if (/(ied|ies)$/.test(l) && DICT.has(l.slice(0, -3) + "y")) return true;
  return false;
};
void INFLECTED;

async function main() {
  const prisma = new PrismaClient();
  const rows = await prisma.recipe.findMany({
    where: { isPublic: true },
    select: { id: true, name: true, description: true, steps: true, calories: true, dishType: { select: { name: true } }, mealType: { select: { name: true } } },
  });

  const food = new Set(
    (await prisma.ingredient.findMany({ select: { name: true } }))
      .flatMap((i) => i.name.toLowerCase().split(/[^a-z]+/))
      .filter(Boolean)
  );
  // Unknown words used across 3+ dishes are real words the 1934 dictionary
  // lacks ("nonstick", "smoothie", "frittata"); a garbled one is a one-off.
  const unknownIn = new Map<string, Set<string>>();
  for (const r of rows) for (const t of [r.description ?? "", ...r.steps]) for (const w of t.match(/[A-Za-z]{7,}/g) ?? []) {
    if (isWord(w, food)) continue;
    const k = w.toLowerCase(); if (!unknownIn.has(k)) unknownIn.set(k, new Set()); unknownIn.get(k)!.add(r.id);
  }
  if (process.env.LIST_UNKNOWN) {
    const common = [...unknownIn.entries()].filter(([, ids]) => ids.size >= 3).sort((a, b) => b[1].size - a[1].size);
    console.log("unknown words in 3+ dishes:\n" + common.map(([w, ids]) => `${ids.size} ${w}`).join("  |  "));
  }
  const garbled = (t: string) => (t.match(/[A-Za-z]{7,}/g) ?? []).find((w) => (unknownIn.get(w.toLowerCase())?.size ?? 99) <= 2);
  const prose: { id: string; name: string; why: string; text: string }[] = [];
  for (const r of rows) {
    for (const t of [r.description ?? "", ...r.steps]) {
      const why = SPACE_BEFORE_PUNCT.test(t) ? "space before punctuation"
        : DOUBLE_PUNCT.test(t) ? "doubled punctuation"
        : NO_VOWEL_WORD.test(t) ? "word with no vowel"
        : DICT.size > 0 && garbled(t) ? `not a word: "${garbled(t)}"`
        : null;
      if (why) { prose.push({ id: r.id, name: r.name, why, text: t }); break; }
    }
  }
  const isSide = (r: (typeof rows)[number]) => /side/i.test(r.dishType?.name ?? "");
  const tiny = rows.filter((r) => (r.calories ?? 0) < 60 && !isSide(r));
  const huge = rows.filter((r) => (r.calories ?? 0) > 1200);

  const count = (why: string) => prose.filter((p) => p.why === why).length;
  console.log(`public dishes:                 ${rows.length}`);
  console.log(`broken prose:                  ${prose.length}`);
  for (const w of ["space before punctuation", "doubled punctuation", "word with no vowel"]) console.log(`  ${w.padEnd(28)} ${count(w)}`);
  console.log(`  ${"not a word".padEnd(28)} ${prose.filter((p) => p.why.startsWith("not a word")).length}`);
  console.log(`under 60 kcal (not a side):    ${tiny.length}   (0 kcal: ${tiny.filter((r) => !r.calories).length})`);
  console.log(`over 1,200 kcal:               ${huge.length}`);
  console.log("\nprose samples:\n" + prose.slice(0, Number(process.env.SAMPLE ?? 10)).map((p) => `  [${p.why}] ${p.name}\n     ${p.text.slice(0, 140)}`).join("\n"));
  console.log("\ncalorie samples:\n" + [...tiny.slice(0, 8), ...huge.slice(0, 5)].map((r) => `  ${r.calories} kcal  ${r.mealType?.name ?? "?"}  ${r.name}`).join("\n"));

  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const csv = ["kind,id,name,detail",
    ...prose.map((p) => ["prose", p.id, esc(p.name), esc(`${p.why}: ${p.text}`)].join(",")),
    ...tiny.map((r) => ["under-60-kcal", r.id, esc(r.name), String(r.calories)].join(",")),
    ...huge.map((r) => ["over-1200-kcal", r.id, esc(r.name), String(r.calories)].join(",")),
  ].join("\n");
  const out = `/tmp/wondish-library-audit-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
  writeFileSync(out, csv);
  console.log(`\nfull list: ${out}  (report only — nothing was changed)`);
  await prisma.$disconnect();
}

main();
