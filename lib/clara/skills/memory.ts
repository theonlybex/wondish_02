import { prisma } from "@/lib/db";
import type { ClaraContext, Skill, ToolResult } from "../types";

export const MEMORY_MAX_CHARS = 200;
export const MEMORY_CAP = 50;
export const MEMORY_BLOCK_MAX_CHARS = 2000;

export interface MemoryRow {
  id: string;
  text: string;
  createdAt: Date;
}

/** Effects, injected so every handler path is unit-tested without a DB. */
export interface MemoryDeps {
  list(patientId: string): Promise<MemoryRow[]>;
  create(patientId: string, text: string, surface: string): Promise<MemoryRow>;
  /** Ownership-scoped: id AND patientId in one atomic where. False when nothing matched. */
  remove(patientId: string, id: string): Promise<boolean>;
  clear(patientId: string): Promise<number>;
}

const SELECT = { id: true, text: true, createdAt: true } as const;

export const prismaMemoryDeps: MemoryDeps = {
  list: async (patientId) =>
    prisma.claraMemory.findMany({
      where: { patientId },
      orderBy: { createdAt: "asc" },
      select: SELECT,
    }),
  create: async (patientId, text, surface) =>
    prisma.claraMemory.create({ data: { patientId, text, surface }, select: SELECT }),
  remove: async (patientId, id) => {
    const { count } = await prisma.claraMemory.deleteMany({ where: { id, patientId } });
    return count > 0;
  },
  clear: async (patientId) => {
    const { count } = await prisma.claraMemory.deleteMany({ where: { patientId } });
    return count;
  },
};

/** Thin pass-through for routes (the profile "What Clara remembers" list). */
export const memoryStore = {
  list: (patientId: string) => prismaMemoryDeps.list(patientId),
  remove: (patientId: string, id: string) => prismaMemoryDeps.remove(patientId, id),
  clear: (patientId: string) => prismaMemoryDeps.clear(patientId),
};

/**
 * The block appended to the system prompt every turn. Oldest first, but when
 * the total would pass the cap the OLDEST rows are dropped — a long-lived
 * member's recent notes matter more than their first ones.
 */
export function buildMemoryBlock(firstName: string, rows: MemoryRow[]): string {
  if (rows.length === 0) return "";
  const heading = `What you remember about ${firstName}`;
  const sorted = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const kept: string[] = [];
  let used = heading.length;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const line = `[${sorted[i].id}] ${sorted[i].text}`;
    // +1 for the newline that joins this line to the block.
    if (used + 1 + line.length > MEMORY_BLOCK_MAX_CHARS) break;
    used += 1 + line.length;
    kept.unshift(line);
  }
  if (kept.length === 0) return "";
  return [heading, ...kept].join("\n");
}

/**
 * Read-only memory block for surfaces without memory tools (the old chat).
 * Never throws: a failed read is logged and the caller proceeds without it,
 * so memory can never break a chat.
 */
export async function loadMemoryBlock(
  firstName: string,
  patientId: string,
  list: (patientId: string) => Promise<MemoryRow[]> = memoryStore.list
): Promise<string> {
  try {
    return buildMemoryBlock(firstName, await list(patientId));
  } catch (err) {
    console.error("[clara-memory] could not read memories", err);
    return "";
  }
}

/** Appends the block after the existing prompt; an empty block changes nothing. */
export function appendMemoryBlock(prompt: string, block: string): string {
  return block === "" ? prompt : `${prompt}\n\n${block}`;
}

const invalid = (message: string): ToolResult => ({ ok: false, reason: "INVALID_INPUT", message });

export function makeMemoryHandlers(deps: MemoryDeps = prismaMemoryDeps) {
  const save = async (ctx: ClaraContext, input: Record<string, unknown>): Promise<ToolResult> => {
    // Every whitespace run (newlines included) becomes one space, so a saved
    // note is always one line and can't pose as a second "[id] text" entry in
    // the prompt's memory block.
    const text = typeof input.text === "string" ? input.text.replace(/\s+/g, " ").trim() : "";
    if (text.length === 0) return invalid("text is required");
    if (text.length > MEMORY_MAX_CHARS) {
      return invalid(`text must be at most ${MEMORY_MAX_CHARS} characters — shorten it`);
    }
    try {
      const rows = await deps.list(ctx.patientId);
      const lower = text.toLowerCase();
      if (rows.some((r) => r.text.trim().toLowerCase() === lower)) {
        return { ok: true, data: { duplicate: true } };
      }
      if (rows.length >= MEMORY_CAP) {
        return {
          ok: false,
          reason: "OUT_OF_RANGE",
          message: `You already remember ${MEMORY_CAP} things about them — ask which one to forget before saving a new one.`,
        };
      }
      const row = await deps.create(ctx.patientId, text, ctx.surface);
      return { ok: true, data: { saved: true, memoryId: row.id, text: row.text } };
    } catch {
      return { ok: false, reason: "FAILED", message: "Could not save that memory right now." };
    }
  };

  const forget = async (ctx: ClaraContext, input: Record<string, unknown>): Promise<ToolResult> => {
    const memoryId = typeof input.memoryId === "string" ? input.memoryId.trim() : "";
    if (memoryId.length === 0) return invalid("memoryId is required");
    try {
      // Scoped by ctx.patientId in the same where — someone else's id is just NOT_FOUND.
      const removed = await deps.remove(ctx.patientId, memoryId);
      if (!removed) {
        return { ok: false, reason: "NOT_FOUND", message: "No such memory — use an id from what you remember." };
      }
      return { ok: true, data: { forgotten: true } };
    } catch {
      return { ok: false, reason: "FAILED", message: "Could not forget that right now." };
    }
  };

  return { save, forget };
}

export function makeMemorySkill(deps: MemoryDeps = prismaMemoryDeps): Skill {
  const h = makeMemoryHandlers(deps);
  return {
    name: "memory",
    promptFragment:
      "About your memory_ tools: you keep short notes about the user that carry across every chat, and they are listed in the memory block above with an id each. Save a note with memory_save when you learn a stable fact or preference that will help later answers — who they cook for, their schedule, their cooking habits, their goals, things they keep asking about. When they mention the same fact about themselves a second time in the conversation (their work schedule, who they cook for, a routine), save it then, even if they never ask you to remember it — the repetition is the signal that it matters to them. Keep it to one short plain sentence, and keep third parties minimal (say \"cooks for two kids\", not names and ages). Never save anything their profile already holds — allergies, conditions, foods to avoid, diet preferences — because the profile drives their meal plan and you cannot change it; if they want those changed, tell them you cannot edit the profile yet and call gap_report (FILTERS). Never save one-off events like what they ate today; that belongs in their log. Never save a note that is already in the block. Whenever you save, tell them in the same reply, in a few natural words (\"Got it, I'll remember you cook for three\"). When they ask you to forget something, find it in the block and call memory_forget with its id, then confirm it is gone. If a save is refused because you remember too much, ask which note to forget instead of choosing for them. Never mention the tool names or ids to the user.",
    tools: [
      {
        def: {
          name: "memory_save",
          description:
            "Save one short note about the user (max 200 characters) that will help in future chats: household, schedule, cooking habits, goals, recurring interests. NOT for profile facts (allergies, conditions, foods to avoid, diet preferences) and NOT for one-off events. Always tell the user in the same reply.",
          input_schema: {
            type: "object",
            properties: {
              text: {
                type: "string",
                description: "One short plain sentence, max 200 characters, e.g. \"Cooks for three on weeknights\".",
              },
            },
            required: ["text"],
          },
        },
        handler: h.save,
      },
      {
        def: {
          name: "memory_forget",
          description:
            "Forget one saved note when the user asks you to. memoryId is the id shown in brackets in the memory block. Never call it unless the user asked.",
          input_schema: {
            type: "object",
            properties: {
              memoryId: { type: "string", description: "The id from the memory block, without the brackets." },
            },
            required: ["memoryId"],
          },
        },
        handler: h.forget,
      },
    ],
  };
}

export const memorySkill: Skill = makeMemorySkill();
