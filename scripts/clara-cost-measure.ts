// Measures what ONE Clara app-chat message costs, so the safety cap and the
// Clara-only AI pools (lib/ai-budget.ts) can be sized from data, not a guess.
//
//   npx tsx scripts/clara-cost-measure.ts
//
// Real Anthropic calls (costs cents). Never touches the database:
//   - tool execution is a stub returning canned, realistically sized JSON;
//   - DATABASE_URL is overwritten with an unreachable address AFTER .env.local
//     is loaded, so even an accidental query would fail rather than hit Neon.
//
// Load shape per message (the largest one the product will send):
//   full tool set (ALL_SKILLS + memory + ask_choices + gap_report), the real
//   system prompt, a realistic profile, a maximal memory block (50 memories
//   capped at 2,000 chars) and 20 messages of prior history, maxToolRounds 5.
//
// Prices: Claude Haiku 4.5 (CLARA_MODEL), per the claude-api skill table
// cached 2026-10-06: $1.00 / 1M input, $5.00 / 1M output, 5-minute cache
// write 1.25x input, cache read 0.1x input.

import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";

const PRICE_IN = 1.0 / 1_000_000;
const PRICE_OUT = 5.0 / 1_000_000;
const PRICE_CACHE_WRITE = 1.25 / 1_000_000;
const PRICE_CACHE_READ = 0.1 / 1_000_000;
const MAX_TOOL_ROUNDS = 5;
const SPEND_ABORT_USD = 0.5; // hard stop if something runs away

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(path.resolve(process.cwd(), file));
  } catch {
    // absent — fine
  }
}
// Belt and braces: nothing in this script may reach a real database.
process.env.DATABASE_URL = "postgresql://nobody:nothing@127.0.0.1:1/none";

// ── fixtures ────────────────────────────────────────────────────────────────

const PROFILE_TEXT = `Name: Sam. Age 41, female, 168 cm, 71 kg. Goal: lose 4 kg slowly and keep energy steady through the afternoon.
Diet pattern: omnivore, leans Mediterranean. Cooks for two on weeknights, 30 minutes max.
Allergies: shellfish (reaction: hives). Intolerances: lactose (mild; lactose-free milk is fine).
Avoid list: cilantro, blue cheese, liver.
Conditions on file: high LDL cholesterol (the app keeps saturated fat low), borderline blood pressure (the app keeps sodium under 2,000 mg).
Daily targets: 1,750 kcal, protein 110 g, carbohydrate 190 g, fat 58 g, fibre 30 g, sodium under 2,000 mg.
Favourite cuisines: Italian, Greek, Thai, Mexican. Dislikes: very spicy food, mushrooms.
Meal slots: breakfast, lunch, dinner, one snack. Usually eats dinner around 19:00.`;

const MEMORY_TEXTS = [
  "Sam prefers oatmeal over eggs at breakfast",
  "Cooks for two on weeknights",
  "Dislikes mushrooms, even blended",
  "Runs on Tuesday and Thursday mornings",
  "Likes Greek yogurt as an afternoon snack",
  "Is trying to eat fish twice a week",
  "Does not own an air fryer",
  "Prefers dinners ready in 30 minutes or less",
  "Husband is vegetarian on weekdays",
  "Wants lunches she can take to the office",
  "Has a sweet tooth after dinner",
  "Drinks two coffees, none after 2pm",
  "Batch-cooks grains on Sundays",
  "Likes spicy only when mild",
  "Allergic reaction to shrimp was hives",
  "Finds quinoa boring",
  "Enjoys cooking Thai curries on weekends",
  "Tries to avoid processed meats",
  "Eats out on Friday evenings",
  "Likes lentil soup in cold weather",
  "Prefers olive oil over butter",
  "Snacks on almonds when stressed",
  "Has a standing desk at work",
  "Wants more fibre without bloating",
  "Does not like leftovers two days running",
  "Uses lactose-free milk in coffee",
  "Goes to a yoga class on Wednesdays",
  "Likes tofu when it is crispy",
  "Feels sluggish after heavy pasta lunches",
  "Birthday dinner out is on the 14th",
  "Keeps frozen berries stocked",
  "Dislikes canned tuna",
  "Prefers salads with a protein on top",
  "Eats breakfast around 7:30",
  "Weighs herself on Monday mornings",
  "Likes sourdough but only toasted",
  "Mother-in-law visits on Saturday",
  "Wants to try making her own hummus",
  "Prefers brown rice to white",
  "Drinks sparkling water with meals",
  "Avoids eating after 8pm",
  "Finds raw onion too harsh",
  "Loves roasted sweet potato",
  "Orders extra vegetables when eating out",
  "Takes a vitamin D supplement",
  "Likes a square of dark chocolate daily",
  "Trying to cut down on sugary drinks",
  "Prefers chicken thighs over breast",
  "Dislikes very sweet sauces",
  "Aims for one meat-free dinner a week",
];

const HISTORY_TEXT: { role: "user" | "assistant"; content: string }[] = [
  { role: "user", content: "is a chicken burrito okay for me?" },
  {
    role: "assistant",
    content:
      "A chicken burrito can fit well. I'm assuming grilled chicken, rice, beans, salsa and a little cheese, no sour cream. The beans and chicken give you good protein and fibre. The main thing to watch is sodium, since tortillas and seasoned chicken add up, so ask for light cheese and skip the extra salt. Want me to suggest a lighter version?",
  },
  { role: "user", content: "yes please" },
  {
    role: "assistant",
    content:
      "Go for a bowl instead of the wrapped burrito: grilled chicken, black beans, brown rice, lots of lettuce and salsa, and a spoonful of guacamole. That keeps saturated fat low and trims about 250 calories. Does that sound good?",
  },
  { role: "user", content: "what's a good high protein snack?" },
  {
    role: "assistant",
    content:
      "Greek yogurt with berries is a great fit for you: about 15 grams of protein and low in saturated fat if you pick the low-fat kind. A small handful of almonds or a boiled egg also work well. Which sounds best?",
  },
  { role: "user", content: "I don't really like eggs" },
  {
    role: "assistant",
    content:
      "No problem at all. Then Greek yogurt or cottage cheese with some fruit would be my pick, and edamame is a good plant-based option with about 11 grams of protein per half cup.",
  },
  { role: "user", content: "how much fibre should I aim for?" },
  {
    role: "assistant",
    content:
      "Your target is 30 grams a day. Beans, lentils, oats, berries and vegetables with skins are the easiest ways to get there. Add it gradually and drink water alongside so it stays comfortable.",
  },
  { role: "user", content: "is oatmeal good for cholesterol?" },
  {
    role: "assistant",
    content:
      "Yes. Oats contain beta-glucan, a soluble fibre that helps lower LDL cholesterol, which matters for you. A bowl of plain oats with berries and a few walnuts is a great start to the day.",
  },
  { role: "user", content: "can I have pasta tonight?" },
  {
    role: "assistant",
    content:
      "Yes, pasta can fit. Pair a normal portion, about a cup cooked, with a tomato or olive oil based sauce, plenty of vegetables and a protein like chicken or white beans. Keep creamy sauces and extra cheese for another day to protect your cholesterol goal.",
  },
  { role: "user", content: "what's a good swap for white rice?" },
  {
    role: "assistant",
    content:
      "Brown rice is the simplest swap, and barley or farro add even more fibre. Cauliflower rice works if you want fewer carbs. Since you like brown rice already, I'd stay with that.",
  },
  { role: "user", content: "how many calories in an avocado?" },
  {
    role: "assistant",
    content:
      "A medium avocado has roughly 240 calories, mostly from healthy monounsaturated fat, plus about 10 grams of fibre. Half an avocado is a comfortable serving for your targets.",
  },
  { role: "user", content: "ok thanks Clara" },
  {
    role: "assistant",
    content: "Anytime! Let me know whenever you want help with a meal or a swap.",
  },
];

// ── canned tool results (inline; sized like the real handlers' output) ──────

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const TODAY = isoDaysAgo(0);
const LAST_TUESDAY = (() => {
  for (let i = 1; i <= 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    if (d.getDay() === 2) return isoDaysAgo(i);
  }
  return isoDaysAgo(7);
})();

const PLAN_MEALS = [
  { mealType: "Breakfast", dish: "Overnight oats with berries and walnuts", planned: true, done: true, kcal: 380, protein: 14, carbs: 52, fat: 12, sodiumMg: 90, servings: 1 },
  { mealType: "Lunch", dish: "Chicken and white bean salad with lemon dressing", planned: true, done: true, kcal: 520, protein: 41, carbs: 38, fat: 20, sodiumMg: 540, servings: 1 },
  { mealType: "Snack", dish: "Greek yogurt with blueberries", planned: true, done: false, kcal: 160, protein: 15, carbs: 18, fat: 3, sodiumMg: 70, servings: 1 },
  { mealType: "Dinner", dish: "Baked salmon with roasted sweet potato and green beans", planned: true, done: false, kcal: 640, protein: 42, carbs: 48, fat: 28, sodiumMg: 480, servings: 1, planEntryId: "cm9plan0entry0dinner0000001" },
];

const CANNED: Record<string, unknown> = {
  profile_get: {
    firstName: "Sam",
    allergies: ["shellfish"],
    intolerances: ["lactose (mild)"],
    avoid: ["cilantro", "blue cheese", "liver"],
    conditions: ["high LDL cholesterol", "borderline blood pressure"],
    goals: ["lose 4 kg slowly", "steady afternoon energy"],
    dietPattern: "omnivore, Mediterranean-leaning",
    dislikes: ["very spicy food", "mushrooms"],
    cuisines: ["Italian", "Greek", "Thai", "Mexican"],
    mealSlots: ["Breakfast", "Lunch", "Dinner", "Snack"],
    householdSize: 2,
  },
  plan_get: {
    date: TODAY,
    weekday: new Date().toLocaleDateString("en-US", { weekday: "long" }),
    meals: PLAN_MEALS,
    totals: { kcal: 1700, protein: 112, carbs: 156, fat: 63, sodiumMg: 1180 },
  },
  plan_alternatives: {
    forEntry: "cm9plan0entry0dinner0000001",
    current: "Baked salmon with roasted sweet potato and green beans",
    alternatives: [
      { recipeId: "cm9recipe00000000000000a1", title: "Lemon herb chicken thighs with barley and broccoli", kcal: 610, protein: 44, carbs: 46, fat: 26, sodiumMg: 450, minutes: 35 },
      { recipeId: "cm9recipe00000000000000a2", title: "Turkey and lentil chili with brown rice", kcal: 590, protein: 45, carbs: 62, fat: 14, sodiumMg: 520, minutes: 40 },
      { recipeId: "cm9recipe00000000000000a3", title: "Tofu and vegetable Thai red curry", kcal: 560, protein: 29, carbs: 55, fat: 24, sodiumMg: 560, minutes: 30 },
      { recipeId: "cm9recipe00000000000000a4", title: "Greek chicken souvlaki bowl with tzatziki", kcal: 620, protein: 48, carbs: 50, fat: 22, sodiumMg: 530, minutes: 30 },
      { recipeId: "cm9recipe00000000000000a5", title: "Pasta primavera with white beans and olive oil", kcal: 600, protein: 24, carbs: 84, fat: 18, sodiumMg: 380, minutes: 25 },
    ],
  },
  plan_swap_dish: { swapped: true, entryId: "cm9plan0entry0dinner0000001", newTitle: "Lemon herb chicken thighs with barley and broccoli" },
  plan_mark_done: { marked: true },
  plan_log_eaten: { logged: true, kcal: 640 },
  nutrition_day: {
    date: TODAY,
    consumed: { kcal: 900, protein: 55, carbs: 90, fat: 32, fibre: 14, sodiumMg: 630 },
    targets: { kcal: 1750, protein: 110, carbs: 190, fat: 58, fibre: 30, sodiumMg: 2000 },
    remaining: { kcal: 850, protein: 55, carbs: 100, fat: 26, fibre: 16, sodiumMg: 1370 },
    plannedNotYetEaten: ["Snack: Greek yogurt with blueberries", "Dinner: Baked salmon with roasted sweet potato and green beans"],
  },
  nutrition_range_summary: {
    from: isoDaysAgo(6),
    to: TODAY,
    days: Array.from({ length: 7 }, (_, i) => ({
      date: isoDaysAgo(6 - i),
      kcal: 1620 + i * 30,
      protein: 96 + i * 3,
      fat: 55 + (i % 3),
      carbs: 170 + i * 4,
      sodiumMg: 1500 + i * 60,
    })),
    averages: { kcal: 1710, protein: 105, carbs: 182, fat: 56, sodiumMg: 1680 },
    daysOnTarget: { protein: 4, kcal: 6, sodium: 7 },
  },
  nutrition_targets: {
    kcal: 1750,
    protein: { grams: 110, basis: "1.55 g per kg for weight loss with activity" },
    carbs: 190,
    fat: 58,
    fibre: 30,
    sodiumMg: 2000,
    source: "computed from profile and goal",
  },
  logs_search: {
    query: "turkey sandwich",
    matches: [
      { id: "cm9log00000000000000000a1", date: isoDaysAgo(3), mealType: "Lunch", name: "Turkey sandwich on whole wheat", kcal: 430, protein: 31, carbs: 44, fat: 12 },
      { id: "cm9log00000000000000000a2", date: isoDaysAgo(9), mealType: "Lunch", name: "Turkey and avocado sandwich", kcal: 510, protein: 33, carbs: 42, fat: 21 },
      { id: "cm9log00000000000000000a3", date: isoDaysAgo(17), mealType: "Lunch", name: "Turkey sandwich with side salad", kcal: 480, protein: 32, carbs: 45, fat: 16 },
    ],
  },
  logs_day_summary: {
    date: LAST_TUESDAY,
    entries: [
      { id: "cm9log00000000000000000b1", mealType: "Breakfast", name: "Oatmeal with blueberries and almonds", kcal: 390, protein: 13, carbs: 56, fat: 12 },
      { id: "cm9log00000000000000000b2", mealType: "Lunch", name: "Lentil soup with a slice of sourdough toast", kcal: 470, protein: 24, carbs: 68, fat: 9 },
      { id: "cm9log00000000000000000b3", mealType: "Snack", name: "Apple and a small handful of almonds", kcal: 210, protein: 5, carbs: 30, fat: 9 },
      { id: "cm9log00000000000000000b4", mealType: "Dinner", name: "Chicken stir fry with brown rice", kcal: 620, protein: 40, carbs: 70, fat: 17 },
    ],
    totals: { kcal: 1690, protein: 82, carbs: 224, fat: 47, sodiumMg: 1710 },
  },
  logs_create: { created: true, id: "cm9log00000000000000000c1", kcal: 430 },
  logs_delete: { deleted: true },
  memory_save: { saved: true, id: "cm9mem00000000000000000d1", count: 51 },
  memory_forget: { forgotten: true },
  gap_report: { recorded: true },
};

// ── prompts ─────────────────────────────────────────────────────────────────

interface Scenario {
  label: string;
  user: string;
  /** Replace the tail of the history (for confirm flows). */
  tail?: { role: "user" | "assistant"; content: string }[];
  writesAllowed: boolean;
}

const SCENARIOS: Scenario[] = [
  { label: "what's for dinner", user: "what's for dinner tonight?", writesAllowed: false },
  { label: "swap dinner", user: "can you swap tonight's dinner for something with chicken?", writesAllowed: false },
  { label: "protein today", user: "how much protein do I have left today?", writesAllowed: false },
  { label: "ate turkey sandwich", user: "I ate a turkey sandwich for lunch", writesAllowed: false },
  { label: "last Tuesday", user: "what did I eat last Tuesday?", writesAllowed: false },
  { label: "general question", user: "is it okay to eat rice every day?", writesAllowed: false },
  { label: "memory-worthy", user: "by the way, I started running on Saturdays too, so I'm usually hungrier on Sundays", writesAllowed: false },
  { label: "week overview", user: "how did I do this past week?", writesAllowed: false },
  {
    label: "yes-confirm swap",
    user: "Yes, swap it",
    tail: [
      { role: "user", content: "swap tonight's dinner for something with chicken" },
      {
        role: "assistant",
        content:
          "I'd swap the baked salmon for lemon herb chicken thighs with barley and broccoli. It's 610 calories with 44 grams of protein and fits your sodium target. Want me to make that swap?",
      },
    ],
    writesAllowed: true,
  },
  { label: "thanks", user: "thanks Clara, that's all I needed", writesAllowed: false },
];

// ── run ─────────────────────────────────────────────────────────────────────

function costOf(u: { input: number; output: number; cacheWrite: number; cacheRead: number }): number {
  return u.input * PRICE_IN + u.output * PRICE_OUT + u.cacheWrite * PRICE_CACHE_WRITE + u.cacheRead * PRICE_CACHE_READ;
}

function percentile(sorted: number[], p: number): number {
  // nearest-rank
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is required (.env.local) — this makes real model calls.");
    process.exit(2);
  }
  // Imported after the env is set: lib/db.ts reads DATABASE_URL at import time.
  const { ALL_SKILLS, RUNTIME_SKILLS, buildToolDefs, buildSystemPrompt } = await import("../lib/clara/registry");
  const { memorySkill, buildMemoryBlock } = await import("../lib/clara/skills/memory");
  const { askChoicesSkill } = await import("../lib/clara/ask-choices");
  const { createAnthropicClient, CLARA_MODEL } = await import("../lib/clara/anthropic-client");
  const { startClaraLoop } = await import("../lib/clara/loop");

  const active = [...ALL_SKILLS, memorySkill, askChoicesSkill, ...RUNTIME_SKILLS];
  const tools = buildToolDefs(active);

  const rows = MEMORY_TEXTS.map((text, i) => ({
    id: `cm9mem${String(i).padStart(19, "0")}`,
    text,
    createdAt: new Date(Date.UTC(2026, 7, 1 + i)),
  }));
  const memoryBlock = buildMemoryBlock("Sam", rows);
  const memoryLines = memoryBlock.split("\n").length - 1;
  const baseSystem = `${buildSystemPrompt("Sam", PROFILE_TEXT, active, TODAY)}\n\n${memoryBlock}`;

  console.log(`model            ${CLARA_MODEL}`);
  console.log(`tools            ${tools.length} (${tools.map((t) => t.name).join(", ")})`);
  console.log(`system prompt    ${baseSystem.length} chars (memory block ${memoryBlock.length} chars, ${memoryLines} of ${rows.length} memories kept)`);
  console.log(`history          20 messages + the new user message; maxToolRounds ${MAX_TOOL_ROUNDS}`);
  console.log(
    `prices           in $${(PRICE_IN * 1e6).toFixed(2)}/M, out $${(PRICE_OUT * 1e6).toFixed(2)}/M, cache write $${(PRICE_CACHE_WRITE * 1e6).toFixed(2)}/M, cache read $${(PRICE_CACHE_READ * 1e6).toFixed(2)}/M`
  );
  console.log(`today            ${TODAY}\n`);

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  interface Row {
    label: string;
    calls: number;
    input: number;
    output: number;
    cacheWrite: number;
    cacheRead: number;
    tools: string[];
    usd: number;
    usdUncached: number;
    reply: string;
  }
  const results: Row[] = [];
  let spent = 0;

  for (const [idx, sc] of SCENARIOS.entries()) {
    // History is exactly 20 messages, starting with a user turn, ending with an
    // assistant turn; the new user message makes 21.
    let history = HISTORY_TEXT.slice();
    if (sc.tail) history = [...history.slice(0, 20 - sc.tail.length), ...sc.tail];
    if (history.length !== 20) throw new Error(`history must be 20 messages, got ${history.length}`);

    const acc = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, calls: 0 };
    const client = createAnthropicClient(anthropic, (u) => {
      acc.calls += 1;
      acc.input += u.input_tokens;
      acc.output += u.output_tokens;
      acc.cacheWrite += u.cache_creation_input_tokens ?? 0;
      acc.cacheRead += u.cache_read_input_tokens ?? 0;
    });
    const toolsCalled: string[] = [];

    // A per-scenario nonce on the LAST line of the system prompt makes round 1
    // of every message a cold cache write (as for a member who last chatted
    // more than 5 minutes ago); later rounds of the SAME message read it back.
    const system = `${baseSystem}\n\n(run ${idx + 1}-${Date.now().toString(36)})`;

    let reply = "";
    try {
      const stream = await startClaraLoop({
        client,
        system,
        tools,
        messages: [...history, { role: "user", content: sc.user }],
        maxToolRounds: MAX_TOOL_ROUNDS,
        writesAllowed: sc.writesAllowed,
        onChoices: () => {},
        onError: (err) => console.error(`  ! loop error in "${sc.label}":`, err),
        execute: async (name) => {
          toolsCalled.push(name);
          const data = CANNED[name];
          return data === undefined
            ? { ok: false, reason: "NOT_FOUND", message: `no canned result for ${name}` }
            : { ok: true, data };
        },
      });
      for await (const chunk of stream) reply += chunk;
    } catch (err) {
      console.error(`\nclara-cost-measure: aborted on "${sc.label}" — ${(err as Error)?.message ?? err}`);
      process.exit(2);
    }

    const usd = costOf(acc);
    const usdUncached = (acc.input + acc.cacheWrite + acc.cacheRead) * PRICE_IN + acc.output * PRICE_OUT;
    spent += usd;
    results.push({ label: sc.label, calls: acc.calls, input: acc.input, output: acc.output, cacheWrite: acc.cacheWrite, cacheRead: acc.cacheRead, tools: toolsCalled, usd, usdUncached, reply });
    if (spent > SPEND_ABORT_USD) {
      console.error(`Spend passed $${SPEND_ABORT_USD} — stopping.`);
      break;
    }
  }

  const pad = (s: string | number, n: number) => String(s).padEnd(n);
  const padL = (s: string | number, n: number) => String(s).padStart(n);
  console.log(
    `${pad("prompt", 20)}${padL("calls", 6)}${padL("in(uncached)", 13)}${padL("cache-wr", 10)}${padL("cache-rd", 10)}${padL("out", 7)}${padL("$/message", 11)}${padL("$ no-cache", 12)}  tools`
  );
  for (const r of results) {
    console.log(
      `${pad(r.label, 20)}${padL(r.calls, 6)}${padL(r.input, 13)}${padL(r.cacheWrite, 10)}${padL(r.cacheRead, 10)}${padL(r.output, 7)}${padL("$" + r.usd.toFixed(5), 11)}${padL("$" + r.usdUncached.toFixed(5), 12)}  ${r.tools.join(",") || "-"}`
    );
  }

  const usds = results.map((r) => r.usd).sort((a, b) => a - b);
  const usdsNoCache = results.map((r) => r.usdUncached).sort((a, b) => a - b);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  console.log(`\nn = ${results.length} messages`);
  console.log(`cold-cache (as billed)  mean $${mean(usds).toFixed(5)}   p90 $${percentile(usds, 90).toFixed(5)}   max $${usds[usds.length - 1].toFixed(5)}`);
  console.log(`no caching at all       mean $${mean(usdsNoCache).toFixed(5)}   p90 $${percentile(usdsNoCache, 90).toFixed(5)}   max $${usdsNoCache[usdsNoCache.length - 1].toFixed(5)}`);
  console.log(`total spent this run    $${spent.toFixed(4)}`);

  console.log("\nreplies (first 160 chars):");
  for (const r of results) console.log(`- ${r.label}: ${r.reply.replace(/\s+/g, " ").slice(0, 160)}`);

  // The Prisma pool is lazy and was never used, but it holds the event loop open.
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
