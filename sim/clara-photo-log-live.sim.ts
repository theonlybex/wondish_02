// Photo-meal logging, LIVE: does Clara price a meal with foods_nutrition, say the
// totals the tool gave her, and then log it by passing logs_create the foods
// (so the numbers are added up in code)? Opt-in and capped:
//
//   SIM_LIVE=1 npm run sim:clara-photo-log
//
// Three meals, two turns each ("Just estimate", then "Log as lunch"): the real
// chat service and the real model, an in-memory conversation, and a log that
// only records what would have been written. No database is reachable.
import "./clara-live-key"; // keeps the API key, drops database URLs
import Anthropic from "@anthropic-ai/sdk";
import { startClaraAppTurn, type ChatServiceDeps } from "../lib/clara/chat-service";
import { makeConversationStore, type ConversationDeps, type HistoryRow } from "../lib/clara/conversations";
import { createAnthropicClient } from "../lib/clara/anthropic-client";
import { askChoicesSkill } from "../lib/clara/ask-choices";
import { logsSkill, makeLogsHandlers, type LogsDeps } from "../lib/clara/skills/logs";
import { foodsNutritionHandler, mealTotals, parseFoodRows } from "../lib/clara/food-grams";
import type { MemoryDeps } from "../lib/clara/skills/memory";
import type { Skill, ToolResult } from "../lib/clara/types";
import type { MealLogRow } from "../lib/meal-log";

if (process.env.SIM_LIVE !== "1") {
  console.log("sim:clara-photo-log is opt-in: run with SIM_LIVE=1 (it calls the real model, about 6 turns).");
  process.exit(0);
}
const key = (globalThis as { __simLiveKey?: string }).__simLiveKey;
if (!key) {
  console.log("No ANTHROPIC_API_KEY in .env.local: live check skipped.");
  process.exit(0);
}

const TODAY = new Date().toISOString().slice(0, 10);

/** What Clara said about the photo on the photo turn (the photo itself is never replayed). */
const MEALS: { label: string; note: string; seen: string }[] = [
  {
    label: "A: plain foods the table knows",
    note: "my lunch",
    seen: "Grilled chicken breast about 150 g, white rice about 180 g, steamed broccoli about 100 g.",
  },
  {
    label: "B: foods the table does not know",
    note: "my lunch",
    seen: "Two slices of pepperoni pizza about 220 g, a side salad of lettuce about 60 g with ranch dressing about 30 g.",
  },
  {
    label: "C: a mix, with prepared foods",
    note: "my lunch",
    seen: "Salmon fillet about 140 g, roast potatoes about 180 g, garlic bread about 60 g, green beans about 80 g.",
  },
];

interface Call {
  name: string;
  input: Record<string, unknown>;
  result: ToolResult;
}

async function runMeal(meal: (typeof MEALS)[number]) {
  const history: HistoryRow[] = [
    { id: "h0", role: "user", content: `[photo:photo-1234abcd] ${meal.note}`, choices: null, toolTrace: null, createdAt: new Date() },
    {
      id: "h1",
      role: "assistant",
      content: `${meal.seen} Was any oil or butter used in cooking?`,
      choices: { question: "Was any oil or butter used in cooking?", options: ["None", "1 tsp, about 5 g", "1 tbsp, about 14 g", "More", "Just estimate"] },
      toolTrace: null,
      createdAt: new Date(),
    },
  ];
  const store: ConversationDeps = {
    createConversation: async () => ({ id: "c1" }),
    isOwned: async () => true,
    recentMessages: async (_id, limit) => [...history].reverse().slice(0, limit),
    insertMessage: async ({ role, content, choices, toolTrace }) => {
      const id = `m${history.length}`;
      history.push({ id, role, content, choices, toolTrace: toolTrace ?? null, createdAt: new Date() } as HistoryRow);
      return { id };
    },
    listPage: async () => [],
    getOwned: async () => null,
    deleteOwned: async () => false,
  };
  const memory: MemoryDeps = {
    list: async () => [],
    create: async (_p, text) => ({ id: "n", text, createdAt: new Date() }),
    remove: async () => false,
    clear: async () => 0,
  };

  // The log: nothing is stored; what would have been written is recorded.
  const writes: { calories: number | null; protein: number | null; carbs: number | null; fat: number | null; name: string }[] = [];
  const logsDeps: LogsDeps = {
    findRows: async () => [],
    findById: async () => null,
    create: async (args) => {
      const c = (args as unknown as { create: Record<string, unknown> }).create;
      writes.push({ name: String(c.name), calories: c.calories as number | null, protein: c.protein as number | null, carbs: c.carbs as number | null, fat: c.fat as number | null });
      return { id: "log-sim", loggedAt: new Date(), updatedAt: new Date(), deletedAt: null, ...c } as unknown as MealLogRow;
    },
    softDelete: async () => {},
    consumeWriteBudget: async () => true,
  };
  const fake = makeLogsHandlers(logsDeps);
  const calls: Call[] = [];
  const handlerFor: Record<string, (ctx: never, input: Record<string, unknown>, id?: string) => Promise<ToolResult>> = {
    logs_search: fake.search as never,
    logs_day_summary: fake.daySummary as never,
    logs_create: fake.create as never,
    logs_delete: fake.del as never,
    foods_nutrition: foodsNutritionHandler as never,
  };
  const logs: Skill = {
    ...logsSkill,
    tools: logsSkill.tools.map((t) => ({
      def: t.def,
      handler: (async (ctx: never, input: Record<string, unknown>, id?: string) => {
        const result = await handlerFor[t.def.name](ctx, input, id);
        calls.push({ name: t.def.name, input, result });
        return result;
      }) as never,
    })),
  };

  const deps: ChatServiceDeps = {
    store: makeConversationStore(store),
    memory,
    client: createAnthropicClient(new Anthropic({ apiKey: key, timeout: 90_000, maxRetries: 1 })),
    skills: [logs, askChoicesSkill],
    todaysPlan: async () => "",
    onIntent: () => {},
    onConversion: () => {},
    onError: (err) => console.log(`  [service error] ${(err as Error)?.message ?? String(err)}`),
  };
  const patient = { id: "p1", mealType: null, foodAllergies: [], foodToAvoid: [], foodPreferences: [], healthConditions: [], motivations: [] };

  const say = async (message: string): Promise<string> => {
    const res = await startClaraAppTurn(deps, {
      patient, account: { id: "a1", firstName: "Sam" }, isPremium: true, message, conversationId: "c1",
      options: { clientDate: TODAY, tzOffsetMinutes: 0, surface: "ios" }, parts: true,
    } as never);
    if (!res.ok) return `[refused ${res.status}] ${JSON.stringify(res.body)}`;
    let text = "";
    for await (const ev of res.events) {
      const e = ev as { type: string; text?: string };
      if (e.type === "text" && typeof e.text === "string") text += e.text;
    }
    return text;
  };

  console.log(`\n══ ${meal.label}\n   photo seen as: ${meal.seen}`);
  const first = await say("Just estimate");
  const priced = calls.filter((c) => c.name === "foods_nutrition");
  const lastPriced = priced.at(-1);
  const toolTotals = lastPriced?.result.ok ? (lastPriced.result.data as { totals: { calories: number; protein: number; carbs: number; fat: number }; estimated: string[]; missing?: string[] }) : null;
  const firstRow = history.at(-1);
  console.log(`   turn 1 reply: ${first.replace(/\s+/g, " ").trim()}`);
  console.log(`   answer boxes: ${JSON.stringify((firstRow?.choices as { options?: string[] } | null)?.options ?? null)}`);
  console.log(`   foods_nutrition calls: ${priced.length}`);
  for (const c of priced) console.log(`     input: ${JSON.stringify(c.input)}`);
  console.log(`   tool totals: ${JSON.stringify(toolTotals?.totals ?? null)}  estimated by Clara: ${JSON.stringify(toolTotals?.estimated ?? null)}  missing: ${JSON.stringify(toolTotals?.missing ?? [])}`);
  const saidKcal = toolTotals ? new RegExp(`\\b${toolTotals.totals.calories}\\b`).test(first.replace(/,/g, "")) : false;
  console.log(`   CHECK said the tool's calories (${toolTotals?.totals.calories ?? "?"}) in the reply: ${saidKcal ? "YES" : "NO"}`);

  // The app writes the foods and totals itself now; a second mention means Clara repeated them.
  const mentions = toolTotals ? (first.replace(/,/g, "").match(new RegExp(`\\b${toolTotals.totals.calories}\\b`, "g")) ?? []).length : 0;
  console.log(`   CHECK times the calories appear in the reply (1 is right, 2+ is a repeat): ${mentions}`);

  const second = await say("Log as lunch");
  const created = calls.filter((c) => c.name === "logs_create");
  console.log(`   turn 2 reply: ${second.replace(/\s+/g, " ").trim()}`);
  console.log(`   logs_create calls: ${created.length}`);
  for (const c of created) {
    console.log(`     input: ${JSON.stringify(c.input)}`);
    console.log(`     result ok: ${c.result.ok}${c.result.ok ? "" : ` (${(c.result as { message?: string }).message})`}`);
  }
  const withFoods = created.some((c) => Array.isArray(c.input.foods));
  console.log(`   CHECK logs_create was given the foods list: ${created.length === 0 ? "NO CALL" : withFoods ? "YES" : "NO (typed numbers)"}`);
  // The same sum, redone here from the foods Clara sent when logging.
  const sent = created.find((c) => Array.isArray(c.input.foods));
  const reparsed = sent ? parseFoodRows(sent.input) : null;
  const redone = reparsed && reparsed.ok ? mealTotals(reparsed.rows) : null;
  console.log(`   logged: ${JSON.stringify(writes)}`);
  const logged = writes.at(-1);
  const same = logged && toolTotals ? logged.calories === toolTotals.totals.calories : false;
  console.log(`   CHECK logged calories equal the calories Clara was shown: ${logged ? (same ? "YES" : `NO (logged ${logged.calories}, shown ${toolTotals?.totals.calories ?? "?"})`) : "NOTHING LOGGED"}`);
  if (redone && logged) console.log(`   CHECK logged calories equal the sum of the foods sent: ${redone.calories === logged.calories ? "YES" : "NO"}`);
  return { saidKcal, withFoods, same, logged: !!logged };
}

async function main() {
  const results = [];
  for (const meal of MEALS) results.push(await runMeal(meal));
  console.log("\n══ SUMMARY");
  console.log(`   said the tool's calories: ${results.filter((r) => r.saidKcal).length}/${results.length}`);
  console.log(`   logged through the foods list: ${results.filter((r) => r.withFoods).length}/${results.length}`);
  console.log(`   logged calories equal the calories shown: ${results.filter((r) => r.same).length}/${results.length}`);
  console.log(`   something was logged: ${results.filter((r) => r.logged).length}/${results.length}`);
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
