// "How Clara cooks" (piece D): the person's rule switches and the rules they
// add in their own words. The app reads and writes them through
// /api/clara/rules; Clara adds or removes one of the person's own rules with
// the two tools here when they say so in chat ("never put mushrooms in my
// dishes"). Nothing here touches allergies or the diet: those stay in the
// profile, and a rule of the person's can never override them.
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import type { ClaraContext, SkillTool, ToolResult } from "../types";
import {
  DISH_RULE_COPY, DISH_RULE_KEYS, MAX_USER_RULES, MAX_USER_RULE_CHARS,
  cleanRuleText, ruleFood, ruleFoodMatches, storedRulesFrom, type DishRules, type StoredRules, type UserRule,
} from "../dish-rules";

/** Effects, injected so every path is unit-tested without a database. */
export interface RulesDeps {
  load(patientId: string): Promise<StoredRules | null>;
  save(patientId: string, rules: StoredRules): Promise<void>;
}

export const prismaRulesDeps: RulesDeps = {
  load: async (patientId) => {
    const row = await prisma.patient.findUnique({ where: { id: patientId }, select: { claraRules: true } });
    return row ? storedRulesFrom(row.claraRules) : null;
  },
  save: async (patientId, rules) => {
    await prisma.patient.update({ where: { id: patientId }, data: { claraRules: rules as unknown as object } });
  },
};

/** What the app's screen shows: Clara's rules as switches, then the person's own. */
export interface RulesView {
  system: { key: keyof DishRules; title: string; detail: string; on: boolean }[];
  mine: (UserRule & { /** Held in code (a "no such food" rule), not only asked of Clara. */ checked: boolean })[];
}
export function rulesView(rules: StoredRules): RulesView {
  return {
    system: DISH_RULE_KEYS.map((key) => ({ key, ...DISH_RULE_COPY[key], on: rules.switches[key] })),
    mine: rules.mine.map((r) => ({ ...r, checked: ruleFood(r.text) !== null })),
  };
}

/**
 * The app's save: `{ system?: { key: boolean }, mine?: [{ id?, text, on? }] }`. `system` changes only
 * the switches it names; `mine`, when present, is the whole list (a rule left out is deleted, one
 * without an id is new). null for a malformed body, a rule that is empty or too long, or too many.
 */
export function applyRulesBody(current: StoredRules, raw: unknown): StoredRules | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const switches = { ...current.switches };
  if (o.system !== undefined) {
    if (!o.system || typeof o.system !== "object" || Array.isArray(o.system)) return null;
    for (const [k, v] of Object.entries(o.system as Record<string, unknown>)) {
      if (!(DISH_RULE_KEYS as readonly string[]).includes(k) || typeof v !== "boolean") return null;
      switches[k as keyof DishRules] = v;
    }
  }
  let mine = current.mine;
  if (o.mine !== undefined) {
    if (!Array.isArray(o.mine)) return null;
    const next: UserRule[] = [];
    const seenText = new Set<string>();
    const seenId = new Set<string>();
    for (const item of o.mine) {
      if (!item || typeof item !== "object") return null;
      const r = item as Record<string, unknown>;
      const text = cleanRuleText(r.text);
      if (!text) return null;
      if (seenText.has(text.toLowerCase())) continue;
      seenText.add(text.toLowerCase());
      // An id is kept only when it is one of theirs; anything else is a new rule.
      const known = typeof r.id === "string" && !seenId.has(r.id) ? current.mine.find((x) => x.id === r.id) : undefined;
      if (r.on !== undefined && typeof r.on !== "boolean") return null;
      // A new rule that is an allergy or a diet is not taken: the profile is where those are enforced.
      if (!current.mine.some((x) => x.text.toLowerCase() === text.toLowerCase()) && notARule(text) !== null) return null;
      const id = known?.id ?? newRuleId();
      seenId.add(id);
      next.push({ id, text, on: r.on !== false });
    }
    if (next.length > MAX_USER_RULES) return null;
    mine = next;
  }
  return { switches, mine };
}

const fold = (t: string) => t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const singular = (w: string) => (/ies$/.test(w) ? `${w.slice(0, -3)}y` : /(oes|ses|shes|ches|xes)$/.test(w) ? w.slice(0, -2) : /s$/.test(w) && !/ss$/.test(w) ? w.slice(0, -1) : w);

/**
 * The rules a request to remove means, never a guess from a few shared letters:
 *  - the rule with exactly those words; else
 *  - EVERY rule about a food the request names as a whole word, in either number ("you can use
 *    mushrooms again", "forget the mushroom rule" → both "No mushrooms" and "Never put mushrooms in
 *    my dishes"); else
 *  - a rule whose whole text the request contains, or that contains the whole request when the
 *    request is at least three words.
 */
/**
 * What a text is when it is not a cooking rule: an allergy or an intolerance ("I'm allergic to
 * peanuts", "peanuts make me sick", "my throat swells"), or a whole way of eating ("I'm vegan").
 * Both belong in the profile, where every dish is checked against them; a rule is only an instruction.
 */
export function notARule(text: string): "allergy" | "diet" | null {
  if (/\b(allerg\w*|anaphyla\w*|intoleran\w*|c[oe]?eliac|epipen|hives|reaction)\b|\b(?:makes?|made|gets?|got) me (?:sick|ill)\b|\bthroat\b.*\b(?:swell\w*|clos\w*|itch\w*)\b|\b(?:swell\w*|clos\w*|itch\w*)\b.*\bthroat\b/i.test(text)) return "allergy";
  if (/\b(?:i'?m|i am|we'?re|we are)\s+(?:a\s+)?(?:vegan|vegetarian|pescatarian|pescetarian|keto|paleo|halal|kosher|gluten[- ]free|dairy[- ]free)\b/i.test(text)) return "diet";
  return null;
}

export function rulesMatching(mine: readonly UserRule[], text: string): UserRule[] {
  const asked = fold(text);
  if (asked.length === 0) return [];
  const exact = mine.filter((r) => fold(r.text) === asked);
  if (exact.length > 0) return exact;
  const askedWords = new Set(asked.split(" ").map(singular));
  const byFood = mine.filter((r) => {
    const food = ruleFood(r.text);
    // The request names that food itself, not another one made with its word ("you can use rice
    // vinegar" does not lift "No rice", "olive oil is fine" does not lift a rule about olives).
    return food !== null && fold(food).split(" ").map(singular).every((w) => askedWords.has(w)) && ruleFoodMatches(food, asked);
  });
  if (byFood.length > 0) return byFood;
  const long = asked.split(" ").length >= 3;
  return mine.filter((r) => { const t = fold(r.text); return ` ${asked} `.includes(` ${t} `) || (long && ` ${t} `.includes(` ${asked} `)); });
}

const newRuleId = () => `r_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const invalid = (message: string): ToolResult => ({ ok: false, reason: "INVALID_INPUT", message });

export function makeRuleHandlers(deps: RulesDeps = prismaRulesDeps) {
  const add = async (ctx: ClaraContext, input: Record<string, unknown>): Promise<ToolResult> => {
    const text = cleanRuleText(input.text);
    if (!text) return invalid(`text is required: one short rule, at most ${MAX_USER_RULE_CHARS} characters`);
    // An allergy or an intolerance is never a rule: a rule is an instruction, the profile is enforced.
    if (notARule(text) === "allergy") {
      return { ok: false, reason: "INVALID_INPUT", message: "That is an allergy or an intolerance, not a cooking rule. Do not save it as a rule: tell them to add it under Conditions and eating in their profile, where it is checked on every dish." };
    }
    if (notARule(text) === "diet") {
      return { ok: false, reason: "INVALID_INPUT", message: "That is a way of eating, not a cooking rule. Do not save it as a rule: tell them to set it under Conditions and eating in their profile, where it is checked on every dish." };
    }
    try {
      const rules = await deps.load(ctx.patientId);
      if (!rules) return { ok: false, reason: "NOT_FOUND", message: "No profile to save the rule on." };
      const newFood = ruleFood(text);
      // The same words, or the same food in other words ("No mushrooms" after "Never put mushrooms in my dishes").
      const same = rules.mine.find((r) => r.text.toLowerCase() === text.toLowerCase())
        ?? (newFood ? rules.mine.find((r) => { const f = ruleFood(r.text); return f !== null && ruleFoodMatches(f, newFood) && ruleFoodMatches(newFood, f); }) : undefined);
      if (same) {
        // Said again: make sure it is on.
        if (!same.on) await deps.save(ctx.patientId, { ...rules, mine: rules.mine.map((r) => (r.id === same.id ? { ...r, on: true } : r)) });
        return { ok: true, data: { alreadyThere: true, rule: same.text, note: "They already have this rule. Tell them it is on; do not save it again." } };
      }
      if (rules.mine.length >= MAX_USER_RULES) {
        return { ok: false, reason: "OUT_OF_RANGE", message: `They already have ${MAX_USER_RULES} rules of their own. Ask which one to remove first, or point them to How Clara cooks in the app's settings.` };
      }
      const rule: UserRule = { id: newRuleId(), text, on: true };
      await deps.save(ctx.patientId, { ...rules, mine: [...rules.mine, rule] });
      const food = ruleFood(text);
      return {
        ok: true,
        data: {
          saved: true,
          rule: rule.text,
          checkedByApp: food !== null,
          note: food
            ? `Saved. From now on no dish you suggest will use ${food}; the app checks every dish for it. Tell them in one short sentence, and that they can switch it off under How Clara cooks in settings.`
            : "Saved. You will follow it when you suggest dishes. It is an instruction to you, NOT something the app checks, so do not say it is guaranteed. Tell them in one short sentence, and that they can switch it off under How Clara cooks in settings.",
        },
      };
    } catch {
      return { ok: false, reason: "FAILED", message: "Could not save that rule right now." };
    }
  };

  const remove = async (ctx: ClaraContext, input: Record<string, unknown>): Promise<ToolResult> => {
    const all = input.all === true;
    const text = cleanRuleText(input.text);
    if (!all && !text) return invalid("text is required: the rule to remove, as they said it or as it is saved (or all: true for every rule)");
    try {
      const rules = await deps.load(ctx.patientId);
      if (!rules) return { ok: false, reason: "NOT_FOUND", message: "No profile." };
      const hits = all ? rules.mine : rulesMatching(rules.mine, text as string);
      if (hits.length === 0) {
        return { ok: false, reason: "NOT_FOUND", message: `No rule of theirs matches that. Their rules: ${rules.mine.map((r) => r.text).join("; ") || "none"}. Use the rule's own words.` };
      }
      const gone = new Set(hits.map((r) => r.id));
      await deps.save(ctx.patientId, { ...rules, mine: rules.mine.filter((r) => !gone.has(r.id)) });
      return { ok: true, data: { removed: hits.map((r) => r.text) } };
    } catch {
      return { ok: false, reason: "FAILED", message: "Could not remove that rule right now." };
    }
  };

  const list = async (ctx: ClaraContext): Promise<ToolResult> => {
    try {
      const rules = await deps.load(ctx.patientId);
      if (!rules) return { ok: false, reason: "NOT_FOUND", message: "No profile." };
      const view = rulesView(rules);
      return {
        ok: true,
        data: {
          theirOwn: view.mine.map((r) => ({ rule: r.text, on: r.on })),
          switchedOff: view.system.filter((s) => !s.on).map((s) => s.title),
          note: "Clara's own rules are switches under How Clara cooks in settings; you cannot change those from chat.",
        },
      };
    } catch {
      return { ok: false, reason: "FAILED", message: "Could not read their rules right now." };
    }
  };

  return { add, remove, list };
}

/** One sentence for the dish skill's prompt, and the three tools. */
export const RULES_PROMPT =
  "They can give you standing rules for their dishes in their own words (\"never put mushrooms in my dishes\", \"no cooking over 30 minutes on weekdays\"): save one with dish_rule_add when they state a lasting preference about how you cook for them, and say in one sentence that it is saved. A one-off wish for the dish at hand (\"no rice tonight\") is not a rule: just suggest the dish without it. An allergy, an intolerance or a diet is NEVER a rule: tell them to add it to their profile, where it is enforced. A wish with an end (\"no salmon this week\") is not a rule either: keep to it in this chat. Remove a rule with dish_rule_remove only when they ask. Say what the result's note says about a saved rule, no more: do not promise the app checks a rule unless the note says it does.";

export function ruleTools(deps: RulesDeps = prismaRulesDeps): SkillTool[] {
  const h = makeRuleHandlers(deps);
  return [
    {
      def: {
        name: "dish_rule_add",
        description:
          "Save a standing rule of theirs for how you cook for them, in their words, short (at most 120 characters): 'No mushrooms', 'No cooking over 30 minutes on weekdays', 'Dinner is always vegetarian on Fridays'. Use only when they state a lasting preference. NOT for an allergy, intolerance or diet (that belongs in their profile) and NOT for a wish about tonight's dish only.",
        input_schema: {
          type: "object",
          properties: { text: { type: "string", description: "The rule, as one short plain sentence in their words." } },
          required: ["text"],
        },
      },
      handler: h.add,
    },
    {
      def: {
        name: "dish_rule_remove",
        description: "Remove their own rules when they ask ('you can use mushrooms again'). text is the rule as saved, or the food it is about: every rule about that food goes. all: true removes every rule of theirs, only when they ask for exactly that. Never call it unless they asked.",
        input_schema: {
          type: "object",
          properties: {
            text: { type: "string", description: "The rule to remove in its own words, or the food it is about." },
            all: { type: "boolean", description: "true to remove every one of their own rules." },
          },
        },
      },
      handler: h.remove,
    },
    {
      def: {
        name: "dish_rule_list",
        description: "Their own rules for how you cook, and which of your rules they switched off. Use when they ask what rules you follow for them.",
        input_schema: { type: "object", properties: {} },
      },
      handler: (ctx) => h.list(ctx),
    },
  ];
}
