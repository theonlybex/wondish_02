// One-off diet-rule data fixes (2026-09-11 QA). Dry-run by default.
//   set -a; source .env.local; set +a
//   npx tsx scripts/diet-rules-2026-09-11.ts [--apply]
//
// 1. FoodToAvoid.bannedIngredients — expand each avoid rule into ingredient
//    names so "Red meat" actually excludes beef ("ground beef · unlocks 7 more
//    dishes" was offered to a red-meat avoider).
// 2. Drop plain-salt rows from Hypertension / Heart Disease / Kidney Disease:
//    a hard "salt" ban left a Hypertension profile 3 library dinners. Sodium
//    guidance now reaches Clara through lib/food-map CONDITION_GUIDANCE.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

const AVOID_CHILDREN: Record<string, string[]> = {
  "Red meat": ["beef", "ground beef", "steak", "lamb", "veal", "venison", "bison", "goat"],
  "Pork": ["pork", "bacon", "ham", "prosciutto", "pancetta", "sausage", "salami", "pepperoni", "chorizo", "lard"],
  "Shellfish": ["shrimp", "prawns", "crab", "lobster", "crawfish", "scallops", "clams", "mussels", "oysters", "squid", "octopus"],
  // "chips" alone matched "dark chocolate chips"; "sugar" alone matched
  // "sugar-free granola" — keep the children specific.
  "Processed foods": ["deli meat", "hot dogs", "instant noodles", "potato chips", "tortilla chips", "processed cheese", "canned soup", "frozen pizza"],
  "Fried foods": ["french fries", "fried chicken", "tempura", "doughnuts", "fried fish", "onion rings"],
  "Alcohol": ["wine", "beer", "vodka", "rum", "whiskey", "sake", "liqueur", "cooking wine"],
  "Caffeine": ["coffee", "espresso", "black tea", "green tea", "matcha", "energy drink", "cola", "dark chocolate"],
  "Spicy foods": ["chili peppers", "jalapeño", "habanero", "cayenne pepper", "hot sauce", "sriracha", "red pepper flakes", "chili powder", "wasabi"],
  "Raw foods": ["sushi", "sashimi", "raw oysters", "steak tartare", "raw egg", "ceviche", "carpaccio"],
  "Added sugars": ["white sugar", "brown sugar", "cane sugar", "powdered sugar", "corn syrup", "high fructose corn syrup", "honey", "maple syrup", "agave", "candy", "soda"],
};
// Children created by an earlier run that turned out too broad.
const AVOID_RETIRED: Record<string, string[]> = { "Processed foods": ["chips"], "Added sugars": ["sugar"] };
const SALT_ROWS = ["salt", "table salt", "sea salt", "kosher salt"];
const SALT_CONDITIONS = ["Hypertension", "Heart Disease", "Kidney Disease stage 1-2"];

(async () => {
  const avoids = await prisma.foodToAvoid.findMany({ select: { id: true, name: true, bannedIngredients: { select: { name: true } } } });
  let toCreate = 0;
  for (const a of avoids) {
    const have = new Set(a.bannedIngredients.map((b) => b.name.toLowerCase()));
    const missing = (AVOID_CHILDREN[a.name] ?? []).filter((n) => !have.has(n.toLowerCase()));
    toCreate += missing.length;
    console.log(`[avoid] ${a.name}: +${missing.length}${missing.length ? " → " + missing.join(", ") : ""}`);
    if (apply && missing.length) {
      await prisma.foodToAvoidBannedIngredient.createMany({ data: missing.map((name) => ({ avoidId: a.id, name })), skipDuplicates: true });
    }
    const retired = (AVOID_RETIRED[a.name] ?? []).filter((n) => have.has(n.toLowerCase()));
    if (retired.length) {
      console.log(`[avoid] ${a.name}: retire → ${retired.join(", ")}`);
      if (apply) await prisma.foodToAvoidBannedIngredient.deleteMany({ where: { avoidId: a.id, name: { in: retired, mode: "insensitive" } } });
    }
  }
  const conds = await prisma.healthCondition.findMany({ where: { name: { in: SALT_CONDITIONS } }, select: { id: true, name: true, bannedIngredients: { select: { id: true, name: true } } } });
  let toDelete = 0;
  for (const c of conds) {
    const rows = c.bannedIngredients.filter((b) => SALT_ROWS.includes(b.name.toLowerCase()));
    toDelete += rows.length;
    console.log(`[salt] ${c.name}: -${rows.length}${rows.length ? " → " + rows.map((r) => r.name).join(", ") : ""}`);
    if (apply && rows.length) {
      await prisma.healthConditionBannedIngredient.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    }
  }
  console.log(`${apply ? "APPLIED" : "DRY RUN"}: create ${toCreate} avoid children, delete ${toDelete} salt rows`);
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
