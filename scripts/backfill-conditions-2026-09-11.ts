// Backfill (authored, not from the Wondish workbooks) for the five conditions
// no workbook factor covers: Kidney Disease stage 1-2, Chronic kidney disease
// – stage 3, Thyroid Disorder, PCOS, Recovering after illness/surgery.
//
// Same shapes the workbooks seed (tracking items, one trigger rule, bans) so
// the app treats them identically. Codes start with "WB-" and inputSource
// carries "_BACKFILL" so a clinician can find and review every row; the
// sources behind each list are in SOURCES below. Dry-run by default,
// `--apply` writes, idempotent (upsert by code / skipDuplicates).
//   set -a; source .env.local; set +a
//   npx tsx scripts/backfill-conditions-2026-09-11.ts [--apply]
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

export const SOURCES = {
  ckd: [
    "https://www.kidney.org/kidney-topics/stage-g3a-chronic-kidney-disease-ckd",
    "https://www.kidney.org/kidney-topics/stage-g3b-chronic-kidney-disease-ckd",
    "https://www.niddk.nih.gov/health-information/kidney-disease/chronic-kidney-disease-ckd/healthy-eating-adults-chronic-kidney-disease",
    "https://www.kidney.org/kidney-topics/nutrition-and-kidney-disease-stages-1-5-not-dialysis",
  ],
  thyroid: [
    "https://www.niddk.nih.gov/-/media/Files/Endocrine-Diseases/Hypothyroidism_508.pdf",
    "https://www.niddk.nih.gov/health-information/endocrine-diseases/hyperthyroidism",
  ],
  pcos: [
    "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8600081/",
    "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12213572/",
  ],
  recovery: [
    "https://www.rnoh.nhs.uk/patients-and-visitors/patient-information-guides/eating-well-before-and-after-surgery-patients-guide",
    "https://leaflets.ekhuft.nhs.uk/a-guide-for-patients-about-eating-well-to-promote-wound-healing/html/",
    "https://www.nuh.nhs.uk/download.cfm?doc=docm93jijm4n14633.pdf&ver=33538",
  ],
};

type Item = { code: string; label: string; category?: "OBJECTIVE"; inputSource?: string };
const sym = (code: string, label: string): Item => ({ code, label });
const lab = (code: string, label: string, inputSource = "LAB"): Item => ({ code, label, category: "OBJECTIVE", inputSource });

const KIDNEY_SYMPTOMS: Item[] = [
  sym("FATIGUE", "Fatigue"), sym("SWELLING_FEET_ANKLES", "Swelling in feet or ankles"), sym("FOAMY_URINE", "Foamy urine"),
  sym("URINATION_CHANGE", "Urinating more or less often than usual"), sym("POOR_APPETITE", "Poor appetite"), sym("NAUSEA", "Nausea"),
  sym("MUSCLE_CRAMPS", "Muscle cramps"), sym("ITCHY_SKIN", "Itchy skin"), sym("TROUBLE_CONCENTRATING", "Trouble concentrating"), sym("SLEEP_PROBLEMS", "Sleep problems"),
];
const KIDNEY_LABS: Item[] = [
  lab("EGFR", "eGFR"), lab("URINE_ALBUMIN", "Urine albumin (uACR)"), lab("SERUM_POTASSIUM", "Serum potassium"), lab("SERUM_PHOSPHORUS", "Serum phosphorus"),
  lab("BLOOD_PRESSURE", "Blood pressure", "MEASUREMENT"),
];

const BACKFILL: { condition: string; prefix: string; items: Item[]; bans?: string[]; retire?: string[]; copyBansFrom?: string }[] = [
  { condition: "Kidney Disease stage 1-2", prefix: "WB-KID12", items: [...KIDNEY_SYMPTOMS, ...KIDNEY_LABS] },
  { condition: "Chronic kidney disease – stage 3", prefix: "WB-CKD3", items: [...KIDNEY_SYMPTOMS, sym("SHORTNESS_OF_BREATH", "Shortness of breath"), sym("METALLIC_TASTE", "Metallic taste"), ...KIDNEY_LABS], copyBansFrom: "Kidney Disease stage 1-2" },
  {
    condition: "Thyroid Disorder", prefix: "WB-THY",
    items: [
      sym("FATIGUE", "Fatigue"), sym("WEIGHT_CHANGE", "Unexplained weight change"), sym("COLD_INTOLERANCE", "Feeling cold"), sym("HEAT_INTOLERANCE", "Feeling hot or sweating"),
      sym("CONSTIPATION", "Constipation"), sym("DIARRHEA", "Diarrhea or frequent stools"), sym("DRY_SKIN", "Dry skin"), sym("HAIR_THINNING", "Hair thinning"),
      sym("PALPITATIONS", "Fast heartbeat or palpitations"), sym("MOOD_CHANGE", "Low mood or irritability"), sym("SLEEP_PROBLEMS", "Sleep problems"), sym("MUSCLE_WEAKNESS", "Muscle weakness"), sym("NECK_SWELLING", "Neck swelling"),
      lab("TSH", "TSH"), lab("FREE_T4", "Free T4"), lab("WEIGHT", "Weight", "MEASUREMENT"),
    ],
  },
  {
    condition: "PCOS", prefix: "WB-PCOS",
    items: [
      sym("IRREGULAR_PERIODS", "Irregular or missed periods"), sym("ACNE", "Acne"), sym("EXCESS_HAIR", "Excess facial or body hair"), sym("HAIR_THINNING", "Scalp hair thinning"),
      sym("WEIGHT_GAIN", "Weight gain or difficulty losing weight"), sym("SUGAR_CRAVINGS", "Sugar cravings"), sym("FATIGUE", "Fatigue"), sym("MOOD_CHANGE", "Low mood or anxiety"),
      sym("SLEEP_PROBLEMS", "Sleep problems"), sym("BLOATING", "Bloating"), sym("PELVIC_PAIN", "Pelvic pain"),
      lab("FASTING_GLUCOSE", "Fasting glucose"), lab("HBA1C", "HbA1c"), lab("FASTING_INSULIN", "Fasting insulin"), lab("WEIGHT", "Weight", "MEASUREMENT"), lab("WAIST", "Waist circumference", "MEASUREMENT"),
    ],
    // Standing bans: added sugars only (the diabetes factor's deployable
    // subset). Refined grains and juices are left to the HIGH_GLYCEMIC_PATTERN
    // trial below so its reintroduction phase can actually test them — a
    // standing ban on white rice made the challenge impossible (QA 2026-09-11).
    bans: ["white sugar", "brown sugar", "cane sugar", "granulated sugar", "powdered sugar", "corn syrup", "high fructose corn syrup", "maple syrup", "honey", "agave", "molasses", "candy", "soda", "sports drink"],
    retire: ["fruit juice", "orange juice", "apple juice", "white bread", "sliced bread", "white rice", "jasmine rice", "basmati rice", "all-purpose flour", "refined pasta", "instant oats", "jam", "jelly", "ice cream"],
  },
  {
    condition: "Recovering after illness/surgery", prefix: "WB-RECOV",
    items: [
      sym("APPETITE", "Appetite"), sym("ENERGY", "Energy level"), sym("NAUSEA", "Nausea"), sym("EARLY_FULLNESS", "Feeling full quickly"), sym("PAIN", "Pain"),
      sym("WOUND_HEALING", "Wound healing concerns"), sym("BOWEL_CHANGE", "Constipation or diarrhea"), sym("THIRST_HYDRATION", "Thirst or low fluid intake"), sym("SLEEP_PROBLEMS", "Sleep problems"), sym("ACTIVITY_TOLERANCE", "Activity tolerance"),
      lab("WEIGHT", "Weight", "MEASUREMENT"), lab("TEMPERATURE", "Temperature", "MEASUREMENT"),
    ],
  },
];

// One structured-pattern trial for PCOS, mirroring the Acne HIGH_GLYCEMIC_PATTERN rule.
const PCOS_TRIAL = {
  code: "WB-TR-PCOS-01", condition: "PCOS", category: "HIGH_GLYCEMIC_PATTERN", action: "STRUCTURED_PATTERN_TRIAL",
  examples: "Sugar-sweetened beverages, candy, refined-flour desserts, white rice and bread, highly refined carbohydrates",
  symptomsToMonitor: "Sugar cravings; fatigue; bloating; acne; weight change; cycle regularity",
  safetyNote: "Keep whole grains, legumes, fruit and vegetables — this trial lowers glycemic load, it is not a low-carbohydrate diet. Not a substitute for medical treatment.",
  sourceUrl: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8600081/",
  monitoredCodes: ["SUGAR_CRAVINGS", "FATIGUE", "BLOATING", "ACNE", "WEIGHT_GAIN", "IRREGULAR_PERIODS"],
};

(async () => {
  let items = 0, bans = 0, rules = 0, links = 0;
  for (const b of BACKFILL) {
    const cond = await prisma.healthCondition.findFirst({ where: { name: b.condition }, select: { id: true, bannedIngredients: { select: { name: true } } } });
    if (!cond) { console.log(`[skip] ${b.condition} not in DB`); continue; }
    const existing = new Set((await prisma.conditionTrackingItem.findMany({ where: { conditionId: cond.id }, select: { code: true } })).map((i) => i.code));
    const toAdd = b.items.filter((i) => !existing.has(`${b.prefix}-${i.code}`));
    items += toAdd.length;
    const have = new Set(cond.bannedIngredients.map((x) => x.name.toLowerCase()));
    let banNames = b.bans ?? [];
    if (b.copyBansFrom) {
      const src = await prisma.healthCondition.findFirst({ where: { name: b.copyBansFrom }, select: { bannedIngredients: { select: { name: true } } } });
      banNames = [...banNames, ...(src?.bannedIngredients.map((x) => x.name) ?? [])];
    }
    const bansToAdd = Array.from(new Set(banNames.filter((n) => !have.has(n.toLowerCase()))));
    const bansToRetire = (b.retire ?? []).filter((n) => have.has(n.toLowerCase()));
    bans += bansToAdd.length;
    console.log(`${b.condition}: items +${toAdd.length} (${b.items.length} total), bans +${bansToAdd.length}${bansToRetire.length ? ` -${bansToRetire.length} (${bansToRetire.join(", ")})` : ""}`);
    if (!apply) continue;
    if (bansToRetire.length) await prisma.healthConditionBannedIngredient.deleteMany({ where: { conditionId: cond.id, name: { in: bansToRetire, mode: "insensitive" } } });
    for (const i of toAdd) {
      await prisma.conditionTrackingItem.upsert({
        where: { code: `${b.prefix}-${i.code}` },
        update: {},
        create: { code: `${b.prefix}-${i.code}`, conditionId: cond.id, category: i.category ?? "SYMPTOM", itemCode: i.code, label: i.label, inputSource: i.inputSource ? `${i.inputSource}_BACKFILL` : "USER_REPORTED_BACKFILL", active: true },
      });
    }
    if (bansToAdd.length) await prisma.healthConditionBannedIngredient.createMany({ data: bansToAdd.map((name) => ({ conditionId: cond.id, name })), skipDuplicates: true });
  }

  const pcos = await prisma.healthCondition.findFirst({ where: { name: PCOS_TRIAL.condition }, select: { id: true } });
  const ruleExists = await prisma.triggerRule.findUnique({ where: { code: PCOS_TRIAL.code }, select: { id: true } });
  if (pcos && !ruleExists) { rules++; console.log(`PCOS trial ${PCOS_TRIAL.code}: +1`); }
  if (apply && pcos) {
    const rule = await prisma.triggerRule.upsert({
      where: { code: PCOS_TRIAL.code },
      update: {},
      create: { code: PCOS_TRIAL.code, conditionId: pcos.id, category: PCOS_TRIAL.category, action: PCOS_TRIAL.action, baselineDays: 7, trialDays: 28, reintroductionDays: 3, washoutDays: 3, doseDependent: true, examples: PCOS_TRIAL.examples, symptomsToMonitor: PCOS_TRIAL.symptomsToMonitor, safetyNote: PCOS_TRIAL.safetyNote, sourceUrl: PCOS_TRIAL.sourceUrl },
      select: { id: true },
    });
    const monitored = await prisma.conditionTrackingItem.findMany({ where: { code: { in: PCOS_TRIAL.monitoredCodes.map((c) => `WB-PCOS-${c}`) } }, select: { id: true } });
    const r = await prisma.triggerRuleTrackingItem.createMany({ data: monitored.map((m) => ({ ruleId: rule.id, trackingItemId: m.id })), skipDuplicates: true });
    links = r.count;
  }
  console.log(`${apply ? "APPLIED" : "DRY RUN"}: items +${items}, bans +${bans}, rules +${rules}${apply ? `, links +${links}` : ""}`);
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
