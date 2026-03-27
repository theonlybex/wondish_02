import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";

const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const envContent = readFileSync(join(__dirname, "../.env"), "utf8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
} catch { /* no .env */ }
if (process.env.DATABASE_URL_UNPOOLED) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED;
}

const p = new PrismaClient();

// ── Add missing ethnic cuisines ───────────────────────────────────────────────
const newCuisines = ["Caribbean", "South American", "Italian", "French", "Eastern European"];
for (const name of newCuisines) {
  await p.ethnic.upsert({
    where: { name },
    create: { name },
    update: {},
  });
  console.log(`  Ensured cuisine: ${name}`);
}

// ── Fetch all ethnic IDs ──────────────────────────────────────────────────────
const ethnics = await p.ethnic.findMany();
const id = Object.fromEntries(ethnics.map((e) => [e.name, e.id]));

// ── Priority-ordered classification rules ─────────────────────────────────────
// null = skip (raw ingredient / beverage / snack)
const RULES = [
  // Skip: single ingredients and beverages
  {
    skip: true,
    pattern:
      /^(almonds?|cashew nuts?|walnuts?|pecans?|pistachios?|hazelnuts?|dried figs?|pitted prunes?|banana|apple|orange|pear|watermelon|papaya|peach|kiwi|strawberries|blueberries|green grapes|red grapes|cantaloupe melon|honeydew melon|pineapple|green apple|red apple)$/i,
  },
  { skip: true, pattern: /^(brown rice|wild rice|barley|bulgur|couscous|quinoa|sweet corn)$/i },
  {
    skip: true,
    pattern:
      /^(black tea.*|black coffee|latte|soy latte|mocha latte|lactose-free latte|vanilla almond latte|herbal tea|sparkling water|mineral water|probiotic kombucha|oat milk|soy milk|unsweetened plain almond milk|unsweetened vanilla almond milk|gluten-free oat milk|milk chocolate|soymilk chocolate|vanilla almond milk chocolate|plain cocoa|protein bar|trail mix|canned in oil sardines|tuna.*canned.*|peanuts|sardines.*)$/i,
  },

  // ── South American ────────────────────────────────────────────────────────
  { ethnic: "South American", pattern: /argentinean/i },
  { ethnic: "South American", pattern: /brazilian rice/i },

  // ── Caribbean ─────────────────────────────────────────────────────────────
  { ethnic: "Caribbean", pattern: /caribbean/i },
  { ethnic: "Caribbean", pattern: /cuban salad/i },
  { ethnic: "Caribbean", pattern: /catfish stew/i }, // West African/Caribbean staple

  // ── Mexican ───────────────────────────────────────────────────────────────
  { ethnic: "Mexican", pattern: /taco|fajita|mexican bowl|quesadilla/i },
  { ethnic: "Mexican", pattern: /\bburrito\b/i },
  { ethnic: "Mexican", pattern: /spanish rice/i },

  // ── Asian ─────────────────────────────────────────────────────────────────
  { ethnic: "Asian", pattern: /stir.?fry|fried rice|egg foo young|vegetable fried barley/i },
  { ethnic: "Asian", pattern: /asian mango|lettuce wrap/i },
  { ethnic: "Asian", pattern: /tofu fried rice|sizzling/i },
  { ethnic: "Asian", pattern: /sambal/i },
  { ethnic: "Asian", pattern: /chicken zoodle/i },

  // ── Indian ────────────────────────────────────────────────────────────────
  { ethnic: "Indian", pattern: /\bcurr(y|ied)\b/i },

  // ── Middle Eastern ────────────────────────────────────────────────────────
  { ethnic: "Middle Eastern", pattern: /\bhummus\b/i },
  { ethnic: "Middle Eastern", pattern: /tabbouleh/i },
  { ethnic: "Middle Eastern", pattern: /bulgur.{0,10}chickpea|chickpea.{0,10}bulgur/i },

  // ── Mediterranean ─────────────────────────────────────────────────────────
  { ethnic: "Mediterranean", pattern: /\bmediterranean\b/i },
  { ethnic: "Mediterranean", pattern: /greek salad|nicoise|feta.*mint|mint.*feta/i },
  { ethnic: "Mediterranean", pattern: /couscous.{0,15}salad|salad.{0,15}couscous/i },
  { ethnic: "Mediterranean", pattern: /chickpeas.{0,15}couscous/i },
  { ethnic: "Mediterranean", pattern: /rice.*feta|feta.*rice/i },
  { ethnic: "Mediterranean", pattern: /roasted eggplant/i },

  // ── French ────────────────────────────────────────────────────────────────
  { ethnic: "French", pattern: /ratatouille/i },
  { ethnic: "French", pattern: /nicoise/i },
  { ethnic: "French", pattern: /\bquiche\b/i },
  { ethnic: "French", pattern: /braised chicken/i },

  // ── Italian ───────────────────────────────────────────────────────────────
  { ethnic: "Italian", pattern: /\bparmesan\b/i },
  { ethnic: "Italian", pattern: /\bfrittata\b/i },
  { ethnic: "Italian", pattern: /(blueberry|salmon|chicken|tofu|garden).{0,10}pasta salad|pasta salad/i },
  { ethnic: "Italian", pattern: /zucchini casserole/i },
  { ethnic: "Italian", pattern: /lemon chicken pasta|zingy.*pasta|chicken pasta/i },
  { ethnic: "Italian", pattern: /orzo salad/i },
  { ethnic: "Italian", pattern: /broccoli.*strawberry.*orzo/i },

  // ── Eastern European ──────────────────────────────────────────────────────
  { ethnic: "Eastern European", pattern: /stroganoff/i },
  { ethnic: "Eastern European", pattern: /sauerkraut/i },
  { ethnic: "Eastern European", pattern: /cabbage roll/i },
  { ethnic: "Eastern European", pattern: /dutch apple/i },

  // ── African (Creole / West African) ───────────────────────────────────────
  { ethnic: "African", pattern: /\bcreole\b/i },
  { ethnic: "African", pattern: /brunswick stew/i },

  // ── American ──────────────────────────────────────────────────────────────
  { ethnic: "American", pattern: /hash brown/i },
  { ethnic: "American", pattern: /sloppy joe/i },
  { ethnic: "American", pattern: /pot roast/i },
  { ethnic: "American", pattern: /chowder/i },
  { ethnic: "American", pattern: /club salad/i },
  { ethnic: "American", pattern: /peach sandwich/i },
  { ethnic: "American", pattern: /tuna.*sandwich|sandwich.*tuna/i },
  { ethnic: "American", pattern: /turkey.*sandwich|sandwich.*turkey/i },
  { ethnic: "American", pattern: /chicken salad.*sandwich|sandwich.*chicken salad/i },
  { ethnic: "American", pattern: /apple crisp|pistachio crisp/i },
  { ethnic: "American", pattern: /banana french toast/i },
  { ethnic: "American", pattern: /banana smoothie|banana split oatmeal/i },
  { ethnic: "American", pattern: /blueberry muffin/i },
  { ethnic: "American", pattern: /corn casserole|corn pancake/i },
  { ethnic: "American", pattern: /cottage cheese bowl/i },
  { ethnic: "American", pattern: /granola bar/i },
  { ethnic: "American", pattern: /grilled.*salmon|salmon.*grill/i },
  { ethnic: "American", pattern: /grilled.*chicken|chicken.*grill/i },
  { ethnic: "American", pattern: /grilled.*pork|pork.*grill/i },
  { ethnic: "American", pattern: /applesauce/i },
  { ethnic: "American", pattern: /mashed.*potato|potato.*mash/i },
  { ethnic: "American", pattern: /\boatmeal\b/i },
  { ethnic: "American", pattern: /quinoa.*bowl|power bowl/i },
  { ethnic: "American", pattern: /salmon.*burger|burger.*salmon/i },
  { ethnic: "American", pattern: /turkey.*chili|bean chili/i },
  { ethnic: "American", pattern: /scrambled egg/i },
  { ethnic: "American", pattern: /egg white/i },
  { ethnic: "American", pattern: /plant-based scrambled/i },
  { ethnic: "American", pattern: /plant-based eggs foo young/i },
  { ethnic: "American", pattern: /avocado toast/i },
  { ethnic: "American", pattern: /green onion omelet|broccoli.*omelet/i },
  { ethnic: "American", pattern: /baked.*salmon/i },
  { ethnic: "American", pattern: /baked.*chicken/i },
  { ethnic: "American", pattern: /baked.*fish/i },
  { ethnic: "American", pattern: /baked.*pumpkin|baked.*carrot|baked.*cauliflower/i },
  { ethnic: "American", pattern: /baked.*tofu/i },
  { ethnic: "American", pattern: /baked.*trout/i },
  { ethnic: "American", pattern: /baked.*potato|potato.*bak/i },
  { ethnic: "American", pattern: /baked.*lentil/i },
  { ethnic: "American", pattern: /baked.*banana/i },
  { ethnic: "American", pattern: /salmon loaf/i },
  { ethnic: "American", pattern: /turkey.*stew|vegan stew/i },
  { ethnic: "American", pattern: /turkey.*salad|salad.*turkey/i },
  { ethnic: "American", pattern: /turkey.*blueberr/i },
  { ethnic: "American", pattern: /turkey.*bean|bean.*turkey/i },
  { ethnic: "American", pattern: /\bchili\b/i },
  { ethnic: "American", pattern: /tuna salad|tuna apple|tuna.*greens|tuna.*loft/i },
  { ethnic: "American", pattern: /open faced/i },
  { ethnic: "American", pattern: /kale.*tuna|tuna.*kale/i },
  { ethnic: "American", pattern: /kale.*tofu|tofu.*kale/i },
  { ethnic: "American", pattern: /salmon.*zucchini|zucchini.*salmon/i },
  { ethnic: "American", pattern: /salmon.*vegetable|vegetable.*salmon/i },
  { ethnic: "American", pattern: /salmon.*cucumber|cucumber.*salmon/i },
  { ethnic: "American", pattern: /salmon.*spinach/i },
  { ethnic: "American", pattern: /smok.*salmon|mustard.*salmon|lemon.*salmon/i },
  { ethnic: "American", pattern: /tilapia/i },
  { ethnic: "American", pattern: /catfish.*spinach/i },
  { ethnic: "American", pattern: /dilled fish|zesty lemon fish/i },
  { ethnic: "American", pattern: /fish.*vegetable/i },
  { ethnic: "American", pattern: /beef.*vegetable|vegetable.*beef/i },
  { ethnic: "American", pattern: /beef.*cabbage|cabbage.*beef/i },
  { ethnic: "American", pattern: /beef.*greens?|greens?.*beef/i },
  { ethnic: "American", pattern: /ground beef/i },
  { ethnic: "American", pattern: /easy beef/i },
  { ethnic: "American", pattern: /black skillet pork|pork.*greens?/i },
  { ethnic: "American", pattern: /pork tenderloin/i },
  { ethnic: "American", pattern: /chicken.*mushroom|mushroom.*chicken/i },
  { ethnic: "American", pattern: /chicken.*brussels|brussels.*chicken/i },
  { ethnic: "American", pattern: /chicken.*blueberr/i },
  { ethnic: "American", pattern: /chicken.*cabbage/i },
  { ethnic: "American", pattern: /chicken.*vegetable|vegetable.*chicken/i },
  { ethnic: "American", pattern: /cheesy chicken|chicken rice bake/i },
  { ethnic: "American", pattern: /\b2-step chicken\b/i },
  { ethnic: "American", pattern: /apricot.*lemon|lemon.*apricot/i },
  { ethnic: "American", pattern: /autumn vegetable|fall veggie/i },
  { ethnic: "American", pattern: /roasted brussels/i },
  { ethnic: "American", pattern: /brussels sprouts.*mushroom|mushroom.*brussels/i },
  { ethnic: "American", pattern: /butternut squash/i },
  { ethnic: "American", pattern: /carrot.*raisin|raisin.*carrot/i },
  { ethnic: "American", pattern: /cauliflower.*shells|cauliflower.*tots|carrot.*tots/i },
  { ethnic: "American", pattern: /cauliflower.*floret/i },
  { ethnic: "American", pattern: /cheese.*stuffed|stuffed.*cheese/i },
  { ethnic: "American", pattern: /garden vegetable soup|black bean soup|curried squash stew/i },
  { ethnic: "American", pattern: /lentil soup/i },
  { ethnic: "American", pattern: /glazed carrots/i },
  { ethnic: "American", pattern: /boiled.*potato|boiled sweet/i },
  { ethnic: "American", pattern: /crunchy.*parfait|berries chia pudding|blueberries chia|chia pudding/i },
  { ethnic: "American", pattern: /fruity oatmeal/i },
  { ethnic: "American", pattern: /crunchy vegetable wrap/i },
  { ethnic: "American", pattern: /dave.*mushroom|herb-stuffed mushroom/i },
  { ethnic: "American", pattern: /delicious greens|beets.*beans.*greens/i },
  { ethnic: "American", pattern: /balsamic roasted/i },
  { ethnic: "American", pattern: /mushroom.*stuffed potato|tofu.*stuffed potato/i },
  { ethnic: "American", pattern: /broccoli.*corn|corn.*broccoli/i },
  { ethnic: "American", pattern: /broccoli.*mushroom/i },
  { ethnic: "American", pattern: /broiled tomato/i },
  { ethnic: "American", pattern: /leafy tofu/i },
  { ethnic: "American", pattern: /vegan.*sandwich/i },
  { ethnic: "American", pattern: /walnut.*rice.*pilaf|almond.*rice.*pilaf/i },
  { ethnic: "American", pattern: /air fryer|air-fryer/i },
  { ethnic: "American", pattern: /garden frittata/i },
  { ethnic: "American", pattern: /mustard.*lemon.*salmon|mustard.*capper/i },
  { ethnic: "American", pattern: /homemade cashew parmesan/i },
  { ethnic: "American", pattern: /trio of vegetable/i },
  { ethnic: "American", pattern: /cooked.*fresh.*veggie salad/i },
  { ethnic: "American", pattern: /gluten-free english muffin|whole-wheat english muffin/i },
  { ethnic: "American", pattern: /multigrain|gluten-free.*bread|gluten-free.*crackers/i },
  { ethnic: "American", pattern: /apple.*chicken salad|apple.*salmon.*salad|apple.*tofu.*salad/i },
  { ethnic: "American", pattern: /apple coleslaw/i },
  { ethnic: "American", pattern: /fish.*spinach sauce/i },
  { ethnic: "American", pattern: /vegan.*chili|vegan bean/i },
  { ethnic: "American", pattern: /asparagus.*shrimp/i },
  { ethnic: "American", pattern: /curried chickpea salad sandwich/i },
  { ethnic: "American", pattern: /^eggs over kale/i },
  { ethnic: "American", pattern: /black bean.*couscous salad/i },
  { ethnic: "American", pattern: /chicken.*with.*brussels/i },
  { ethnic: "American", pattern: /pork.*mushroom/i },
  { ethnic: "American", pattern: /chickpeas.*spinach/i },
  { ethnic: "American", pattern: /multicolor veggie/i },

  // ── Previously unclassified ────────────────────────────────────────────────
  { ethnic: "American", pattern: /greek yogurt parfait/i },
  { ethnic: "American", pattern: /turkey.*veggie wrap|veggie wrap/i },
  { ethnic: "Asian", pattern: /beef.*broccoli/i },
  { ethnic: "American", pattern: /apple.*almond butter/i },
  { ethnic: "Mediterranean", pattern: /brussel sprouts bulgur/i },
  { ethnic: "Middle Eastern", pattern: /cucumber yogurt dip/i },
  { ethnic: "American", pattern: /arugula.*beet salad|beet.*salad/i },
  { ethnic: "American", pattern: /almond banana bread/i },
  { ethnic: "American", pattern: /scrambled vegan eggs/i },
];

function classify(name) {
  for (const rule of RULES) {
    if (rule.pattern.test(name)) {
      return rule.skip ? "__skip__" : rule.ethnic;
    }
  }
  return null;
}

const recipes = await p.recipe.findMany({ select: { id: true, name: true } });

const updates = {};
let skipped = 0;
const unclassified = [];

for (const recipe of recipes) {
  const result = classify(recipe.name);
  if (result === "__skip__") { skipped++; continue; }
  if (!result) { unclassified.push(recipe.name); continue; }
  if (!updates[result]) updates[result] = [];
  updates[result].push(recipe.id);
}

let total = 0;
for (const [ethnicName, recipeIds] of Object.entries(updates)) {
  const ethnicId = id[ethnicName];
  if (!ethnicId) { console.warn(`  !! No ID for: ${ethnicName}`); continue; }
  const r = await p.recipe.updateMany({
    where: { id: { in: recipeIds } },
    data: { ethnicId },
  });
  console.log(`  ${ethnicName}: ${r.count} recipes`);
  total += r.count;
}

console.log(`\nTotal classified: ${total} | Skipped (ingredients/drinks): ${skipped} | Unclassified: ${unclassified.length}`);
if (unclassified.length) {
  console.log("\nUnclassified:");
  unclassified.forEach((n) => console.log(`  - ${n}`));
}

await p.$disconnect();
