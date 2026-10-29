// Saved Clara conversations: the persistence port + a small store on top of it.
// Every method that takes a patientId scopes by it in the same atomic query, so
// a conversation id belonging to another member reads as "not found" and
// nothing is loaded or deleted. Appends do NOT re-check ownership — the route
// must call `owned()` first and 404 before it writes.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { ClaraChoices, ModelContentBlock, ModelMessage } from "./types";

export type { ClaraChoices } from "./types";

export const HISTORY_LIMIT = 20;
export const LIST_PAGE_SIZE = 30;
export const TITLE_MAX_CHARS = 60;

export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  choices: ClaraChoices | null;
  createdAt: Date;
}

/**
 * One tool call an assistant turn actually executed, as saved on its row.
 * `input` and `result` are JSON strings, already cut to size by the chat
 * service — so `input` may no longer parse, and replays as {} if so.
 */
export interface ToolTraceEntry {
  id: string;
  name: string;
  input: string;
  result: string;
}

/**
 * A row as the history window reads it: the client-facing message plus the
 * raw stored tool trace, parsed defensively by the store. Never leaves the
 * server — `get()` returns plain StoredMessages.
 */
export interface HistoryRow extends StoredMessage {
  toolTrace?: unknown;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: Date;
}

/** Persistence port. Prisma-backed by default; in-memory fakes in tests. */
export interface ConversationDeps {
  /** Creates the conversation AND its first user message together. */
  createConversation: (a: {
    patientId: string;
    title: string;
    surface: string;
    firstMessage: string;
  }) => Promise<{ id: string }>;
  isOwned: (conversationId: string, patientId: string) => Promise<boolean>;
  /** Newest first, at most `limit` rows, each with its raw stored tool trace. */
  recentMessages: (conversationId: string, limit: number) => Promise<HistoryRow[]>;
  /** Inserts a message and bumps the conversation's updatedAt. */
  insertMessage: (a: {
    conversationId: string;
    role: "user" | "assistant";
    content: string;
    choices: ClaraChoices | null;
    surface: string;
    /** Assistant rows only; null/absent ⇒ the column stays NULL. */
    toolTrace?: ToolTraceEntry[] | null;
  }) => Promise<{ id: string }>;
  /** Newest updatedAt first; rows strictly after `cursor` (a conversation id). */
  listPage: (patientId: string, cursor: string | undefined, take: number) => Promise<ConversationSummary[]>;
  /** Ownership-scoped; messages oldest first. */
  getOwned: (
    conversationId: string,
    patientId: string
  ) => Promise<{ id: string; title: string; messages: StoredMessage[] } | null>;
  /** Ownership-scoped; true when a row was deleted. */
  deleteOwned: (conversationId: string, patientId: string) => Promise<boolean>;
}

/** Reads the Json column defensively; anything malformed counts as "no boxes". */
function parseChoices(raw: unknown): ClaraChoices | null {
  if (!raw || typeof raw !== "object") return null;
  const { question, options } = raw as { question?: unknown; options?: unknown };
  if (typeof question !== "string" || !Array.isArray(options)) return null;
  if (!options.every((o) => typeof o === "string")) return null;
  return { question, options: options as string[] };
}

/**
 * Reads the toolTrace Json column defensively: anything that is not an array
 * counts as no trace, and malformed entries are skipped one by one.
 */
function parseToolTrace(raw: unknown): ToolTraceEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (e): e is ToolTraceEntry =>
      !!e &&
      typeof e === "object" &&
      typeof (e as ToolTraceEntry).id === "string" &&
      (e as ToolTraceEntry).id.length > 0 &&
      typeof (e as ToolTraceEntry).name === "string" &&
      typeof (e as ToolTraceEntry).input === "string" &&
      typeof (e as ToolTraceEntry).result === "string"
  );
}

/** A stored input that no longer parses to an object (it may have been cut) replays as {}. */
function parseToolInput(input: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(input);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function toStored(r: {
  id: string;
  role: string;
  content: string;
  choices: unknown;
  createdAt: Date;
}): StoredMessage {
  return {
    id: r.id,
    role: r.role === "assistant" ? "assistant" : "user",
    content: r.content,
    choices: parseChoices(r.choices),
    createdAt: r.createdAt,
  };
}

const prismaConversationDeps: ConversationDeps = {
  createConversation: async ({ patientId, title, surface, firstMessage }) => {
    const row = await prisma.claraConversation.create({
      data: {
        patientId,
        title,
        surface,
        messages: { create: { role: "user", content: firstMessage, surface } },
      },
      select: { id: true },
    });
    return { id: row.id };
  },
  isOwned: async (conversationId, patientId) =>
    (await prisma.claraConversation.count({ where: { id: conversationId, patientId } })) > 0,
  recentMessages: async (conversationId, limit) => {
    const rows = await prisma.claraMessage.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    });
    return rows.map((r) => ({ ...toStored(r), toolTrace: r.toolTrace }));
  },
  insertMessage: async ({ conversationId, role, content, choices, surface, toolTrace }) => {
    const [row] = await prisma.$transaction([
      prisma.claraMessage.create({
        data: {
          conversationId,
          role,
          content,
          surface,
          ...(choices ? { choices: { ...choices } } : {}),
          ...(toolTrace && toolTrace.length > 0
            ? { toolTrace: toolTrace.map((e) => ({ ...e })) as Prisma.InputJsonValue }
            : {}),
        },
        select: { id: true },
      }),
      // @updatedAt only fires on a write to the row itself, so bump it explicitly.
      prisma.claraConversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
        select: { id: true },
      }),
    ]);
    return { id: row.id };
  },
  listPage: async (patientId, cursor, take) =>
    prisma.claraConversation.findMany({
      where: { patientId },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, title: true, updatedAt: true },
    }),
  getOwned: async (conversationId, patientId) => {
    const row = await prisma.claraConversation.findFirst({
      where: { id: conversationId, patientId },
      select: {
        id: true,
        title: true,
        messages: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      },
    });
    return row ? { id: row.id, title: row.title, messages: row.messages.map(toStored) } : null;
  },
  deleteOwned: async (conversationId, patientId) => {
    const { count } = await prisma.claraConversation.deleteMany({ where: { id: conversationId, patientId } });
    return count > 0;
  },
};

/**
 * First message → sidebar title: whitespace collapsed, at most 60 characters.
 * Counted and cut by code points, not UTF-16 units, so an emoji at the cut is
 * kept whole — a lone surrogate would be rejected when the row is saved.
 */
export function titleFrom(message: string): string {
  const flat = message.replace(/\s+/g, " ").trim();
  const chars = Array.from(flat);
  if (chars.length <= TITLE_MAX_CHARS) return flat;
  return chars.slice(0, TITLE_MAX_CHARS - 1).join("").trimEnd() + "…";
}

/**
 * What the model sees for a saved assistant turn. The answer boxes are not part
 * of `content`, so without this the model would forget it had offered them.
 */
export function replayText(content: string, choices: ClaraChoices | null): string {
  if (!choices || choices.options.length === 0) return content;
  return `${content}\n${choices.options.map((o) => `- ${o}`).join("\n")}`;
}

export function makeConversationStore(deps: ConversationDeps = prismaConversationDeps) {
  return {
    create: (patientId: string, firstMessage: string, surface: string) =>
      deps.createConversation({ patientId, title: titleFrom(firstMessage), surface, firstMessage }),

    owned: (conversationId: string, patientId: string) => deps.isOwned(conversationId, patientId),

    /**
     * At most `limit` saved ROWS, oldest first, starting with a user message —
     * the Messages API rejects a leading assistant turn. Both rules apply to
     * rows; only then does each assistant row with a tool trace expand into
     * three messages: assistant [tool_use…], user [tool_result…], assistant
     * text. Without the calls, an earlier "Got it, I'll remember that" reads
     * as the whole action, and later in a long chat the model imitates the
     * words and skips the tool (live debugging 2026-10-28).
     *
     * No thinking blocks are replayed with the calls. The API requires them
     * only within an in-progress tool-use turn; these turns are complete
     * (each is followed by its text answer), and prior-turn thinking may be
     * omitted. Clara runs Haiku 4.5 with thinking off anyway.
     */
    async history(
      conversationId: string,
      limit: number = HISTORY_LIMIT
    ): Promise<{ messages: ModelMessage[]; lastAssistantHadChoices: boolean }> {
      const newestFirst = await deps.recentMessages(conversationId, limit);
      const lastAssistantHadChoices = newestFirst.find((m) => m.role === "assistant")?.choices != null;
      const oldestFirst = [...newestFirst].reverse();
      while (oldestFirst.length > 0 && oldestFirst[0].role === "assistant") oldestFirst.shift();
      // tool_use ids must be unique across the request. Anthropic ids already
      // are; a repeat (a copied row, a fake) is prefixed with its row id.
      const usedIds = new Set<string>();
      const uniqueId = (id: string, rowId: string): string => {
        let out = usedIds.has(id) ? `${rowId}_${id}` : id;
        for (let n = 2; usedIds.has(out); n++) out = `${rowId}_${n}_${id}`;
        usedIds.add(out);
        return out;
      };
      const messages: ModelMessage[] = [];
      for (const m of oldestFirst) {
        if (m.role !== "assistant") {
          messages.push({ role: "user", content: m.content });
          continue;
        }
        const calls = parseToolTrace(m.toolTrace);
        if (calls.length > 0) {
          const ids = calls.map((c) => uniqueId(c.id, m.id));
          messages.push({
            role: "assistant",
            content: calls.map(
              (c, i): ModelContentBlock => ({ type: "tool_use", id: ids[i], name: c.name, input: parseToolInput(c.input) })
            ),
          });
          messages.push({
            role: "user",
            content: calls.map(
              (c, i): ModelContentBlock => ({ type: "tool_result", tool_use_id: ids[i], content: c.result })
            ),
          });
        }
        messages.push({ role: "assistant", content: replayText(m.content, m.choices) });
      }
      return { messages, lastAssistantHadChoices };
    },

    appendUser: (conversationId: string, content: string, surface: string) =>
      deps.insertMessage({ conversationId, role: "user", content, choices: null, surface }),

    appendAssistant: (
      conversationId: string,
      content: string,
      choices: ClaraChoices | null,
      surface: string,
      toolTrace: ToolTraceEntry[] | null = null
    ) => deps.insertMessage({ conversationId, role: "assistant", content, choices, surface, toolTrace }),

    async list(
      patientId: string,
      cursor?: string
    ): Promise<{ items: ConversationSummary[]; nextCursor: string | null }> {
      // One extra row tells us whether another page exists.
      const rows = await deps.listPage(patientId, cursor, LIST_PAGE_SIZE + 1);
      const items = rows.slice(0, LIST_PAGE_SIZE);
      const nextCursor = rows.length > LIST_PAGE_SIZE ? items[items.length - 1].id : null;
      return { items, nextCursor };
    },

    /**
     * What GET /api/clara/conversations/:id returns. Messages are rebuilt as
     * plain StoredMessages so the tool trace (raw tool inputs and results)
     * never reaches a client, whatever the persistence layer hands back.
     */
    async get(conversationId: string, patientId: string) {
      const row = await deps.getOwned(conversationId, patientId);
      if (!row) return null;
      return { id: row.id, title: row.title, messages: row.messages.map(toStored) };
    },

    remove: (conversationId: string, patientId: string) => deps.deleteOwned(conversationId, patientId),
  };
}

export type ConversationStore = ReturnType<typeof makeConversationStore>;
