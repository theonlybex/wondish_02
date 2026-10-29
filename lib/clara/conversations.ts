// Saved Clara conversations: the persistence port + a small store on top of it.
// Every method that takes a patientId scopes by it in the same atomic query, so
// a conversation id belonging to another member reads as "not found" and
// nothing is loaded or deleted. Appends do NOT re-check ownership — the route
// must call `owned()` first and 404 before it writes.
import { prisma } from "@/lib/db";
import type { ClaraChoices, ModelMessage } from "./types";

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
  /** Newest first, at most `limit` rows. */
  recentMessages: (conversationId: string, limit: number) => Promise<StoredMessage[]>;
  /** Inserts a message and bumps the conversation's updatedAt. */
  insertMessage: (a: {
    conversationId: string;
    role: "user" | "assistant";
    content: string;
    choices: ClaraChoices | null;
    surface: string;
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
    return rows.map(toStored);
  },
  insertMessage: async ({ conversationId, role, content, choices, surface }) => {
    const [row] = await prisma.$transaction([
      prisma.claraMessage.create({
        data: { conversationId, role, content, surface, ...(choices ? { choices: { ...choices } } : {}) },
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

/** First message → sidebar title: whitespace collapsed, at most 60 chars. */
export function titleFrom(message: string): string {
  const flat = message.replace(/\s+/g, " ").trim();
  if (flat.length <= TITLE_MAX_CHARS) return flat;
  return flat.slice(0, TITLE_MAX_CHARS - 1).trimEnd() + "…";
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
     * Plain-text turns only (no tool blocks), at most `limit`, oldest first,
     * starting with a user message — the Messages API rejects a leading
     * assistant turn.
     */
    async history(
      conversationId: string,
      limit: number = HISTORY_LIMIT
    ): Promise<{ messages: ModelMessage[]; lastAssistantHadChoices: boolean }> {
      const newestFirst = await deps.recentMessages(conversationId, limit);
      const lastAssistantHadChoices = newestFirst.find((m) => m.role === "assistant")?.choices != null;
      const oldestFirst = [...newestFirst].reverse();
      while (oldestFirst.length > 0 && oldestFirst[0].role === "assistant") oldestFirst.shift();
      return {
        messages: oldestFirst.map((m) => ({
          role: m.role,
          content: m.role === "assistant" ? replayText(m.content, m.choices) : m.content,
        })),
        lastAssistantHadChoices,
      };
    },

    appendUser: (conversationId: string, content: string, surface: string) =>
      deps.insertMessage({ conversationId, role: "user", content, choices: null, surface }),

    appendAssistant: (conversationId: string, content: string, choices: ClaraChoices | null, surface: string) =>
      deps.insertMessage({ conversationId, role: "assistant", content, choices, surface }),

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

    get: (conversationId: string, patientId: string) => deps.getOwned(conversationId, patientId),

    remove: (conversationId: string, patientId: string) => deps.deleteOwned(conversationId, patientId),
  };
}

export type ConversationStore = ReturnType<typeof makeConversationStore>;
