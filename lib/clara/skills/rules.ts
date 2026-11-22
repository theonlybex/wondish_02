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
  cleanRuleText, ruleFood, storedRulesFrom, type DishRules, type StoredRules, type UserRule,
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
    if (!Array.isArray(o.mine) || o.mine.length > MAX_USER_RULES) return null;
    const next: UserRule[] = [];
    const seenText = new Set<string>();
    for (const item of o.mine) {
      if (!item || typeof item !== "object") return null;
      const r = item as Record<string, unknown>;
      const text = cleanRuleText(r.text);
      if (!text) return null;
      if (seenText.has(text.toLowerCase())) continue;
      seenText.add(text.toLowerCase());
      // An id is kept only when it is one of theirs; anything else is a new rule.
      const known = typeof r.id === "string" ? current.mine.find((x) => x.id === r.id) : undefined;
      next.push({ id: known?.id ?? newRuleId(), text, on: r.on !== false });
    }
    mine = next;
  }
  return { switches, mine };
}

const newRuleId = () => `r_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const invalid = (message: string): ToolResult => ({ ok: false, reason: "INVALID_INPUT", message });

export function makeRuleHandlers(deps: RulesDeps = prismaRulesDeps) {
  const add = async (ctx: ClaraContext, input: Record<string, unknown>): Promise<ToolResult> => {
    const text = cleanRuleText(input.text);
    if (!text) return invalid(`text is required: one short rule, at most ${MAX_USER_RULE_CHARS} characters`);
    try {
      const rules = await deps.load(ctx.patientId);
      if (!rules) return { ok: false, reason: "NOT_FOUND", message: "No profile to save the rule on." };
      const same = rules.mine.find((r) => r.text.toLowerCase() === text.toLowerCase());
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
          note: food
            ? `Saved. From now on no dish you suggest will use ${food}; the app checks it. Tell them in one short sentence, and that they can switch it off under How Clara cooks in settings.`
            : "Saved. You will follow it when you suggest dishes; it is an instruction to you, not something the app checks. Tell them in one short sentence, and that they can switch it off under How Clara cooks in settings.",
        },
      };
    } catch {
      return { ok: false, reason: "FAILED", message: "Could not save that rule right now." };
    }
  };

  const remove = async (ctx: ClaraContext, input: Record<string, unknown>): Promise<ToolResult> => {
    const text = cleanRuleText(input.text);
    if (!text) return invalid("text is required: the rule to remove, as they said it or as it is saved");
    try {
      const rules = await deps.load(ctx.patientId);
      if (!rules) return { ok: false, reason: "NOT_FOUND", message: "No profile." };
      const lower = text.toLowerCase();
      const food = ruleFood(text);
      // The same words, or a rule about the same food ("mushrooms are fine again").
      const hit = rules.mine.find((r) => r.text.toLowerCase() === lower)
        ?? rules.mine.find((r) => { const f = ruleFood(r.text); return f !== null && (f === food || lower.includes(f)); })
        ?? rules.mine.find((r) => r.text.toLowerCase().includes(lower) || lower.includes(r.text.toLowerCase()));
      if (!hit) {
        return { ok: false, reason: "NOT_FOUND", message: `No rule of theirs matches that. Their rules: ${rules.mine.map((r) => r.text).join("; ") || "none"}.` };
      }
      await deps.save(ctx.patientId, { ...rules, mine: rules.mine.filter((r) => r.id !== hit.id) });
      return { ok: true, data: { removed: true, rule: hit.text } };
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
  "They can give you standing rules for their dishes in their own words (\"never put mushrooms in my dishes\", \"no cooking over 30 minutes on weekdays\"): save one with dish_rule_add when they state a lasting preference about how you cook for them, and say in one sentence that it is saved. A one-off wish for the dish at hand (\"no rice tonight\") is not a rule: just suggest the dish without it. An allergy, an intolerance or a diet is NEVER a rule: tell them to add it to their profile, where it is enforced. Remove a rule with dish_rule_remove only when they ask.";

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
        description: "Remove one of their own rules when they ask ('you can use mushrooms again'). text is the rule as saved, or what they said. Never call it unless they asked.",
        input_schema: {
          type: "object",
          properties: { text: { type: "string", description: "The rule to remove, or the food it is about." } },
          required: ["text"],
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
