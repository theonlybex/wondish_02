// Trigger trials (authored, not from the Wondish workbooks) for AERD and
// Rosacea — workbook 04 has no rules for their factors (357, 341). Evidence
// and sources: docs/research/rule-ban-lists-2026-10-07.md (decision "B").
//
// Same shape the workbook rules and the PCOS backfill use: one rule per food
// category, the workbook's 7/28/3/3-day schedule, monitored items linked from
// the condition's existing tracking items (JT-…). Codes start with "WB-TR-"
// so a clinician can find and review every authored rule.
// Report-only by default, idempotent (upsert by code, links skipDuplicates).
//   node --env-file=.env.local --import tsx scripts/trials-aerd-rosacea-2026-10-07.ts [--apply]
import { PrismaClient } from "@prisma/client";
import { TRIGGER_CATEGORY_TERMS } from "../lib/trials/category-terms";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

const AERD = "Aspirin-Exacerbated Respiratory Disease (AERD)";
const ROSACEA = "Rosacea";
const ROSACEA_SYMPTOMS = "Flushing; facial warmth; burning or stinging; visible redness; acne-like bumps";
const ROSACEA_SAFETY =
  "Triggers are individual — test one category at a time, never all at once. Diet is adjunctive and does not replace rosacea treatment. Hot drinks and very hot food are triggers too: let them cool.";
const ROSACEA_SOURCE = "https://pmc.ncbi.nlm.nih.gov/articles/PMC8794493/";
const ROSACEA_ITEMS = ["JT-0112", "JT-0113", "JT-0114", "JT-0115", "JT-0116"];

type Rule = { code: string; condition: string; category: string; examples: string; symptomsToMonitor: string; safetyNote: string; sourceUrl: string; monitored: string[] };

const RULES: Rule[] = [
  {
    code: "WB-TR-AERD-01", condition: AERD, category: "ALCOHOL",
    examples: "Wine, beer and spirits — most people with AERD report respiratory reactions to alcohol",
    symptomsToMonitor: "Nasal congestion or sinus symptoms; asthma symptoms; sneezing; cough; abdominal symptoms",
    safetyNote:
      "Reactions can include asthma attacks: keep your rescue inhaler with you and do not reintroduce alcohol without your doctor's agreement. Avoiding aspirin and NSAIDs is the core of AERD care and is not replaced by this trial. A salicylate-free diet is not recommended.",
    sourceUrl: "https://samterssociety.org/aerd-alcohol",
    monitored: ["JT-0221", "JT-0223", "JT-0224", "JT-0225", "JT-0226"],
  },
  { code: "WB-TR-ROS-01", category: "ALCOHOL", examples: "Red wine first, then other wine, beer and spirits — the most reported rosacea trigger" },
  { code: "WB-TR-ROS-02", category: "SPICY", examples: "Chili peppers, hot sauce, cayenne, red pepper flakes" },
  { code: "WB-TR-ROS-03", category: "HISTAMINE_TYRAMINE_RICH", examples: "Aged cheese, cured meats, fermented foods, soy sauce, wine" },
  { code: "WB-TR-ROS-04", category: "ACIDIC_TOMATO", examples: "Tomatoes, tomato sauce and paste, ketchup (also cinnamaldehyde-rich)" },
  { code: "WB-TR-ROS-05", category: "ACIDIC_CITRUS", examples: "Oranges, lemons, limes, grapefruit and their juice (also cinnamaldehyde-rich)" },
  { code: "WB-TR-ROS-06", category: "CHOCOLATE", examples: "Chocolate and cocoa (also cinnamaldehyde-rich)" },
  { code: "WB-TR-ROS-07", category: "CINNAMALDEHYDE", examples: "Cinnamon in all forms" },
].map((r) =>
  "condition" in r
    ? (r as Rule)
    : { ...r, condition: ROSACEA, symptomsToMonitor: ROSACEA_SYMPTOMS, safetyNote: ROSACEA_SAFETY, sourceUrl: ROSACEA_SOURCE, monitored: ROSACEA_ITEMS }
);

(async () => {
  const unknown = RULES.filter((r) => !TRIGGER_CATEGORY_TERMS[r.category]);
  if (unknown.length) throw new Error(`categories without terms: ${unknown.map((r) => r.category).join(", ")} — stop`);

  let created = 0, links = 0;
  for (const r of RULES) {
    const cond = await prisma.healthCondition.findFirst({ where: { name: r.condition, ownerPatientId: null }, select: { id: true } });
    if (!cond) throw new Error(`condition "${r.condition}" not found — stop`);
    const items = await prisma.conditionTrackingItem.findMany({ where: { conditionId: cond.id, code: { in: r.monitored } }, select: { id: true, code: true } });
    const missingItems = r.monitored.filter((c) => !items.some((i) => i.code === c));
    if (missingItems.length) throw new Error(`${r.code}: tracking items not found: ${missingItems.join(", ")} — stop`);
    const exists = await prisma.triggerRule.findUnique({ where: { code: r.code }, select: { id: true } });
    const terms = TRIGGER_CATEGORY_TERMS[r.category].terms;
    console.log(`${exists ? "=" : "+"} ${r.code} ${r.condition} · ${r.category} — removes: ${terms.slice(0, 6).join(", ")}${terms.length > 6 ? "…" : ""} · monitors ${items.length} items`);
    if (!exists) created++;
    if (!apply) continue;
    const rule = await prisma.triggerRule.upsert({
      where: { code: r.code },
      update: {},
      create: {
        code: r.code, conditionId: cond.id, category: r.category, action: "SELECTED_CATEGORY_TRIAL",
        baselineDays: 7, trialDays: 28, reintroductionDays: 3, washoutDays: 3, doseDependent: true,
        examples: r.examples, symptomsToMonitor: r.symptomsToMonitor, safetyNote: r.safetyNote, sourceUrl: r.sourceUrl,
      },
      select: { id: true },
    });
    const res = await prisma.triggerRuleTrackingItem.createMany({ data: items.map((i) => ({ ruleId: rule.id, trackingItemId: i.id })), skipDuplicates: true });
    links += res.count;
  }
  console.log(`${apply ? "APPLIED" : "REPORT ONLY"}: rules +${created}${apply ? `, links +${links}` : ""}${apply ? "" : ". Re-run with --apply."}`);
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
