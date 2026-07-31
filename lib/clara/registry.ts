import type { Skill, SkillTool, ToolDef } from "./types";
import { profileSkill } from "./skills/profile";
import { gapSkill } from "./gap";

/**
 * Product skills — subject to CLARA_SKILLS. A skill cycle adds exactly one
 * import and one array entry here; nothing else in the runtime changes.
 */
export const ALL_SKILLS: Skill[] = [profileSkill];

/**
 * Runtime skills are always active: gap_report is how we learn what to build
 * next, so a CLARA_SKILLS value must never be able to silence it.
 */
export const RUNTIME_SKILLS: Skill[] = [gapSkill];

/**
 * CLARA_SKILLS is an allow-list of product skill names ("profile,logs"). Unset
 * ⇒ all registered product skills are active; empty string ⇒ none (kill
 * switch). Unknown tokens are ignored so a stale env value can never crash the
 * route. Runtime skills are appended regardless.
 */
export function resolveActiveSkills(all: Skill[], envValue: string | undefined): Skill[] {
  if (envValue === undefined) return [...all, ...RUNTIME_SKILLS];
  const allowed = new Set(
    envValue.split(",").map((s) => s.trim()).filter((s) => s.length > 0)
  );
  return [...all.filter((s) => allowed.has(s.name)), ...RUNTIME_SKILLS];
}

export function buildToolDefs(active: Skill[]): ToolDef[] {
  return active.flatMap((s) => s.tools.map((t) => t.def));
}

export function findTool(active: Skill[], name: string): SkillTool | null {
  for (const skill of active) {
    const hit = skill.tools.find((t) => t.def.name === name);
    if (hit) return hit;
  }
  return null;
}

/**
 * The system prompt is rebuilt per active skill set (spec §8 Q8): base persona,
 * the caller's date (only when they told us one), the runtime's tool-use rules,
 * then each active skill's fragment.
 *
 * `today === null` means the caller sent no date and the server's own UTC date
 * is NOT theirs — asserting it would tell a UTC-7 user it is already tomorrow,
 * so we assert nothing, exactly as Clara behaved before the runtime existed.
 */
export function buildSystemPrompt(
  firstName: string,
  foodMapText: string,
  active: Skill[],
  today: string | null
): string {
  const dateLine =
    today === null
      ? ""
      : `\nToday's date for ${firstName} is ${today}. Resolve every relative date ("yesterday", "two weeks ago") against it.\n`;

  const base = `You are Clara, a warm and knowledgeable personal food advisor for ${firstName}.

${firstName}'s dietary profile:
${foodMapText}
${dateLine}
Your behavior:
1. When asked about a dish or food, assume the most common ingredients and preparation method if not specified — state your assumptions briefly before evaluating.
2. Start with what works well for ${firstName}'s goals and profile (positive first).
3. Identify every conflict with their dietary profile and explain WHY it matters to their health.
4. If the dish can be adjusted: propose specific modifications and ask if they accept.
   - If accepted → confirm ACCEPTED ✅ with modifications noted.
   - If declined → confirm REJECTED ❌, suggest an alternative dish.
5. No conflicts → confirm PASSED ✅, explain why it is a great fit for their profile.
6. After your first message, do NOT re-introduce yourself or restate their profile. Continue the conversation naturally.
7. Be warm, encouraging, and educational. Never clinical or cold.
8. Keep responses concise — 3 to 5 sentences unless the user asks for more detail.
9. If the dietary profile is empty or incomplete, still give your best nutritional advice based on general healthy eating principles.
10. Never use markdown formatting — no bold (**), no headers (#), no bullet dashes or asterisks. Write in plain, conversational prose like a knowledgeable friend texting you.`;

  // No toolbox ⇒ no tool rules. An account with no Patient row gets an empty
  // tools array, and telling that caller to "use a tool" or "call gap_report"
  // invites Clara to narrate a call she cannot make. Silence here is what makes
  // that path reproduce the pre-runtime response exactly.
  if (active.length === 0) return base;

  const runtimeRules = `

How you use your tools:
- Use a tool whenever answering needs ${firstName}'s actual data rather than general knowledge — anything about what they have recorded, planned, or set up. Do not guess at it and do not answer from memory of earlier turns.
- Always write one short sentence BEFORE you use a tool, saying what you are about to check ("Let me look at your profile…"). The user sees nothing while a tool runs, so silence reads as a freeze.
- Never invent data you did not retrieve. If a tool returns nothing, say so plainly.
- If ${firstName} asks for something none of your tools can do, call gap_report once, then tell them plainly that you cannot do that yet. Never promise a date.`;

  const fragments = active.map((s) => s.promptFragment.trim()).filter(Boolean);
  return fragments.length > 0
    ? `${base}${runtimeRules}\n\n${fragments.join("\n\n")}`
    : `${base}${runtimeRules}`;
}
