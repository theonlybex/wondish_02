"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { MAX_MESSAGE_CHARS } from "@/lib/chat-history";
import { apiFetch } from "@/lib/client-fetch";
import { readClaraEvents } from "@/lib/clara/ndjson-client";
import ConversationList, { type ConversationSummary } from "@/components/clara/ConversationList";
import AnswerChoices from "@/components/clara/AnswerChoices";

interface ChatMessage {
  key: string;
  role: "user" | "assistant";
  content: string;
  /** A notice in Clara's bubble (a failed reply, a refusal) — not a saved reply. */
  error?: boolean;
  /** Set on a reply that failed before Clara wrote anything: re-send this text. */
  retryText?: string;
  /** 409 PROFILE_INCOMPLETE: offer the way to finish onboarding. */
  profileLink?: boolean;
}

interface Choices {
  question: string;
  options: string[];
}

interface Props {
  firstName: string;
}

/** The one fallback Clara says when we have nothing specific and true to tell. */
const GENERIC_ERROR = "Sorry — something went wrong. Please try again.";
/** A saved chat that was deleted (or aged out): same words as the iOS app. */
const CHAT_GONE = "This chat isn't available anymore.";
const CUT_OFF_NOTE =
  "(Clara got cut off. Open this chat again from your list in a moment to see her saved reply.)";

/**
 * No byte for this long ⇒ the connection is dead (a silent mobile drop used to
 * leave the input disabled until reload). Long enough for one tool round,
 * which runs up to 55s before Clara streams anything.
 */
const STALL_MS = 90_000;

const TRY_ASKING = [
  "Can I eat a Caesar salad?",
  "Is oat milk fine with my diet?",
  "What should I eat to hit my protein goal?",
  "Swap tonight's dinner for something lighter",
];

/** Only a sentence belongs in a Clara bubble; bare fragments ("Invalid body") do not. */
function sentence(value: unknown): string | null {
  return typeof value === "string" && /[.!?…]$/.test(value.trim()) ? value.trim() : null;
}

function readChoices(value: unknown): Choices | null {
  if (typeof value !== "object" || value === null) return null;
  const c = value as { question?: unknown; options?: unknown };
  if (typeof c.question !== "string" || !Array.isArray(c.options)) return null;
  const options = c.options.filter((o): o is string => typeof o === "string" && o.trim().length > 0);
  return options.length > 0 ? { question: c.question, options } : null;
}

function RetryIcon() {
  return (
    <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.2L3 16M3 21v-5h5" />
    </svg>
  );
}

function ChatsIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
    </svg>
  );
}

function Dots() {
  return (
    <span className="flex gap-1 items-center h-4" aria-label="Clara is typing">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce motion-reduce:animate-none"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}

export default function DishCheckerClient({ firstName }: Props) {
  const name = firstName.trim();
  // Client-side only: never sent to the server, never saved.
  const greeting = `Hi${name ? ` ${name}` : ""}! I'm Clara, an AI assistant for food and nutrition. I know your allergies, diet and goals, so ask me anything about food: check a dish against your profile, ask about ingredients or swaps, or get help with your meal plan. I'm an AI, so I can make mistakes — check anything medical with your doctor or dietitian.`;

  // ── Thread ──
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [choices, setChoices] = useState<Choices | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showGreeting, setShowGreeting] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [threadError, setThreadError] = useState<{ text: string; retryId?: string } | null>(null);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);

  // ── Saved chats ──
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [listNotice, setListNotice] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false); // below lg the list is a toggled panel

  // Refs, because state lags a render: a second tap in the same tick must see
  // the first one's lock (Review Focus 1), and a send must use the id the
  // `meta` event just delivered.
  const busyRef = useRef(false);
  const conversationIdRef = useRef<string | null>(null);
  const loadTokenRef = useRef(0);
  const keyRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const nextKey = () => `m${++keyRef.current}`;
  const busy = isStreaming || loadingThread;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!busy) inputRef.current?.focus();
  }, [busy]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, choices]);

  // ── List ──
  const loadList = useCallback(async (cursor?: string) => {
    if (cursor) setLoadingMore(true);
    else {
      setListLoading(true);
      setListError(null);
    }
    try {
      const res = await apiFetch(`/api/clara/conversations${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const page: ConversationSummary[] = Array.isArray(data?.items) ? data.items : [];
      setItems((prev) => (cursor ? [...prev, ...page.filter((p) => !prev.some((x) => x.id === p.id))] : page));
      setNextCursor(typeof data?.nextCursor === "string" && data.nextCursor ? data.nextCursor : null);
    } catch {
      if (!cursor) setListError("Couldn't load your chats.");
      else setListNotice("Couldn't load older chats. Please try again.");
    } finally {
      if (cursor) setLoadingMore(false);
      else setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  /**
   * After a turn: the active chat moves to the top with the server's title and
   * time. Only page 1 is re-read; older pages already loaded stay, so the
   * "Show older chats" cursor stays valid.
   */
  const syncAfterTurn = useCallback(async (id: string) => {
    try {
      const res = await apiFetch("/api/clara/conversations");
      if (!res.ok) return;
      const data = await res.json();
      const page: ConversationSummary[] = Array.isArray(data?.items) ? data.items : [];
      setItems((prev) => {
        const top = page.find((p) => p.id === id) ?? prev.find((x) => x.id === id);
        const unseen = page.filter((p) => p.id !== id && !prev.some((x) => x.id === p.id));
        const rest = prev.filter((x) => x.id !== id);
        return top ? [top, ...unseen, ...rest] : [...unseen, ...rest];
      });
      if (listError) {
        setListError(null);
        setNextCursor(typeof data?.nextCursor === "string" && data.nextCursor ? data.nextCursor : null);
      }
    } catch {
      /* the list catches up on the next turn */
    }
  }, [listError]);

  const adoptConversation = (id: string) => {
    conversationIdRef.current = id;
    setActiveId(id);
  };

  // ── Send ──
  const send = useCallback(
    async (raw: string, opts: { fromInput?: boolean; retryOf?: string } = {}) => {
      const text = raw.trim();
      if (!text || busyRef.current) return;
      busyRef.current = true;

      // Boxes vanish on the first tap (Review Focus 1).
      setChoices(null);
      setThreadError(null);
      setListOpen(false);
      setIsStreaming(true);
      if (opts.fromInput) setInput("");

      const assistantKey = nextKey();
      setMessages((prev) => {
        // A retry re-sends the same text into the same chat: the user bubble
        // is already there, only the failed reply goes.
        const base = opts.retryOf
          ? prev.filter((m) => m.key !== opts.retryOf)
          : [...prev, { key: nextKey(), role: "user" as const, content: text }];
        return [...base, { key: assistantKey, role: "assistant", content: "" }];
      });
      const patch = (fn: (m: ChatMessage) => ChatMessage) =>
        setMessages((prev) => prev.map((m) => (m.key === assistantKey ? fn(m) : m)));
      const fail = (content: string, extra: Partial<ChatMessage> = {}) =>
        patch((m) => ({ ...m, content, error: true, ...extra }));

      const controller = new AbortController();
      let stall: ReturnType<typeof setTimeout> | undefined;
      const kick = () => {
        if (stall) clearTimeout(stall);
        stall = setTimeout(() => controller.abort(), STALL_MS);
      };
      kick();

      try {
        const conversationId = conversationIdRef.current;
        const res = await apiFetch("/api/clara/chat", {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(conversationId ? { conversationId } : {}),
            message: text,
            // Clara resolves relative dates ("two weeks ago") against these.
            // en-CA renders YYYY-MM-DD; offset is minutes EAST of UTC (UTC-5 ⇒ -300).
            clientDate: new Intl.DateTimeFormat("en-CA", {
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            }).format(new Date()),
            tzOffsetMinutes: -new Date().getTimezoneOffset(),
            surface: "web",
          }),
        });

        if (!res.ok) {
          let data: { error?: unknown; code?: unknown; conversationId?: unknown } | null = null;
          try {
            data = await res.json();
          } catch {
            /* not JSON */
          }
          // A 500/503 after the user message was saved names the chat: a retry
          // must go back into it (the server de-dups the identical message).
          if (typeof data?.conversationId === "string") adoptConversation(data.conversationId);

          if (res.status === 401) {
            fail("Your session expired — reload the page and try again.");
          } else if (res.status === 409 && data?.code === "PROFILE_INCOMPLETE") {
            fail(typeof data.error === "string" ? data.error : "Finish setting up your profile to chat with Clara.", {
              profileLink: true,
            });
          } else if (res.status === 429 && data?.code === "CLARA_RESTING") {
            // Clara's own words, shown as they are. Nothing to retry today.
            fail(typeof data.error === "string" ? data.error : GENERIC_ERROR);
          } else if (res.status === 404) {
            // Same words as the iOS app; the next send starts a new chat.
            fail(CHAT_GONE);
            setItems((prev) => prev.filter((x) => x.id !== conversationId));
            conversationIdRef.current = null;
            setActiveId(null);
          } else if (res.status === 400) {
            fail(sentence(data?.error) ?? GENERIC_ERROR);
          } else {
            fail(sentence(data?.error) ?? GENERIC_ERROR, { retryText: text });
          }
          return;
        }
        if (!res.body) {
          fail(GENERIC_ERROR, { retryText: text });
          return;
        }

        let streamedText = false;
        let done: { messageId: string | null } | null = null;
        let offered: Choices | null = null;
        try {
          for await (const event of readClaraEvents(res.body)) {
            kick();
            if (event.type === "meta") {
              adoptConversation(event.conversationId);
              // A brand-new chat shows in the list at once; the server's own
              // title and time replace this after the turn (syncAfterTurn).
              const id = event.conversationId;
              setItems((prev) =>
                prev.some((x) => x.id === id)
                  ? prev
                  : [{ id, title: text.replace(/\s+/g, " ").slice(0, 60), updatedAt: new Date().toISOString() }, ...prev]
              );
            }
            else if (event.type === "text") {
              if (event.text.trim()) streamedText = true;
              patch((m) => ({ ...m, content: m.content + event.text }));
            } else if (event.type === "choices") offered = { question: event.question, options: event.options };
            else if (event.type === "done") done = { messageId: event.messageId };
          }
        } catch {
          /* dropped connection or watchdog abort — handled below */
        }

        if (done?.messageId) {
          // Saved. Boxes only for a saved reply: the server confirms a write
          // only on the turn right after a saved message that carried them.
          if (offered && offered.options.length > 0) setChoices(offered);
        } else if (done) {
          // messageId null: the reply failed before Clara wrote anything, so
          // nothing was saved for it. Same text, same chat.
          patch((m) => ({ ...m, content: m.content.trim() ? m.content : GENERIC_ERROR, error: true, retryText: text }));
        } else if (streamedText) {
          // The server keeps going without us and saves what Clara wrote.
          patch((m) => ({ ...m, content: `${m.content}\n\n${CUT_OFF_NOTE}`, error: true }));
        } else {
          fail(GENERIC_ERROR, { retryText: text });
        }
      } catch {
        // Network failure or a watchdog abort before the first byte. The
        // browser's own words ("signal is aborted without reason") never reach
        // a chat bubble.
        fail(GENERIC_ERROR, { retryText: text });
      } finally {
        if (stall) clearTimeout(stall);
        busyRef.current = false;
        setIsStreaming(false);
        const id = conversationIdRef.current;
        if (id) void syncAfterTurn(id);
      }
    },
    [syncAfterTurn]
  );

  // ── Open / new / delete ──
  const newChat = useCallback(() => {
    if (busyRef.current) return;
    loadTokenRef.current++;
    conversationIdRef.current = null;
    setActiveId(null);
    setMessages([]);
    setChoices(null);
    setThreadError(null);
    setLoadingThread(false);
    setShowGreeting(true);
    setListOpen(false);
    inputRef.current?.focus();
  }, []);

  const openConversation = useCallback(async (id: string) => {
    if (busyRef.current) return;
    const token = ++loadTokenRef.current;
    conversationIdRef.current = id;
    setActiveId(id);
    setMessages([]);
    setChoices(null);
    setThreadError(null);
    setShowGreeting(false);
    setListOpen(false);
    setLoadingThread(true);
    try {
      const res = await apiFetch(`/api/clara/conversations/${encodeURIComponent(id)}`);
      if (token !== loadTokenRef.current) return;
      if (res.status === 404) {
        setItems((prev) => prev.filter((x) => x.id !== id));
        conversationIdRef.current = null;
        setActiveId(null);
        setShowGreeting(true);
        setThreadError({ text: CHAT_GONE });
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      if (token !== loadTokenRef.current) return;
      const saved: { role?: unknown; content?: unknown; choices?: unknown }[] = Array.isArray(data?.messages)
        ? data.messages
        : [];
      setMessages(
        saved
          .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
          .map((m) => ({ key: nextKey(), role: m.role as "user" | "assistant", content: m.content as string }))
      );
      // Boxes come back only when Clara's question is still the last word.
      const last = saved[saved.length - 1];
      setChoices(last?.role === "assistant" ? readChoices(last.choices) : null);
    } catch {
      if (token !== loadTokenRef.current) return;
      setThreadError({ text: "I couldn't open that chat.", retryId: id });
    } finally {
      if (token === loadTokenRef.current) setLoadingThread(false);
    }
  }, []);

  const deleteConversation = useCallback(
    async (item: ConversationSummary) => {
      if (busyRef.current) return;
      if (!window.confirm(`Delete "${item.title || "this chat"}"? This can't be undone.`)) return;
      setListNotice(null);
      setDeletingId(item.id);
      try {
        const res = await apiFetch(`/api/clara/conversations/${encodeURIComponent(item.id)}`, { method: "DELETE" });
        // 404: already gone (another tab, or retention) — same outcome.
        if (!res.ok && res.status !== 404) throw new Error(String(res.status));
        setItems((prev) => prev.filter((x) => x.id !== item.id));
        if (conversationIdRef.current === item.id) newChat();
      } catch {
        setListNotice("Couldn't delete that chat. Please try again.");
      } finally {
        setDeletingId(null);
      }
    },
    [newChat]
  );

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input, { fromInput: true });
    }
  }

  const shadow = "0 1px 3px rgba(30,26,26,0.07), 0 0 0 1px rgba(30,26,26,0.04)";
  const last = messages[messages.length - 1];
  const showChoices = !!choices && !busy && last?.role === "assistant" && !last.error;

  const list = (
    <ConversationList
      items={items}
      activeId={activeId}
      loading={listLoading}
      error={listError}
      notice={listNotice}
      hasMore={!!nextCursor}
      loadingMore={loadingMore}
      disabled={isStreaming}
      deletingId={deletingId}
      onSelect={(id) => void openConversation(id)}
      onNew={newChat}
      onDelete={(item) => void deleteConversation(item)}
      onLoadMore={() => nextCursor && void loadList(nextCursor)}
      onRetry={() => void loadList()}
    />
  );

  const avatar = (
    <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mb-0.5">
      <span className="text-base leading-none" aria-hidden="true">
        🌿
      </span>
    </div>
  );

  return (
    // h-full: the thread scrolls inside the chat card and the input stays put.
    // The min height keeps it usable on a short laptop screen.
    <div className="h-full min-h-[560px] flex items-stretch gap-5">
      {/* ── Saved chats — a column on desktop ── */}
      <aside
        className="hidden lg:flex w-64 flex-shrink-0 flex-col bg-white rounded-2xl p-4 min-h-0"
        style={{ boxShadow: shadow }}
      >
        {list}
      </aside>

      {/* ── Chat column ── */}
      <div className="flex-1 min-w-0 flex flex-col bg-white rounded-2xl overflow-hidden" style={{ boxShadow: shadow }}>
        {/* Below lg the list folds into a panel at the top of the card. */}
        <div className="lg:hidden flex-shrink-0 border-b" style={{ borderColor: "rgba(30,26,26,0.06)" }}>
          <div className="flex items-center justify-between gap-3 px-4 py-2">
            <button
              type="button"
              onClick={() => setListOpen((v) => !v)}
              aria-expanded={listOpen}
              aria-controls="clara-chats-panel"
              className="flex items-center gap-2 min-h-[44px] px-2 -ml-2 rounded-lg text-sm font-bold transition-colors hover:bg-[#F9F7ED] cursor-pointer"
              style={{ color: "#1E1A1A" }}
            >
              <ChatsIcon />
              Your chats
              <span aria-hidden="true" className={`text-xs transition-transform ${listOpen ? "rotate-180" : ""}`}>
                ▾
              </span>
            </button>
            {/* The open list has its own New chat button. */}
            {!listOpen && (
              <button
                type="button"
                onClick={newChat}
                disabled={isStreaming}
                className="min-h-[44px] px-3 rounded-lg text-sm font-bold transition-colors hover:bg-primary/[0.06] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                style={{ color: "#812549" }}
              >
                + New chat
              </button>
            )}
          </div>
          {listOpen && (
            <div id="clara-chats-panel" className="px-4 pb-4 max-h-[50vh] flex flex-col">
              {list}
            </div>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4" aria-live="polite" aria-busy={busy}>
          {showGreeting && (
            <div className="flex items-end gap-2.5 justify-start">
              {avatar}
              <div className="max-w-[78%] px-4 py-3 rounded-2xl rounded-bl-sm text-sm leading-relaxed whitespace-pre-wrap bg-[#F9F7ED] text-[#1E1A1A]">
                {greeting}
              </div>
            </div>
          )}

          {showGreeting && messages.length === 0 && !threadError && (
            <div className="pl-[38px]">
              <p className="text-[9px] tracking-[0.22em] uppercase font-bold mb-2" style={{ color: "#ABA6A6" }}>
                Try asking
              </p>
              <div className="flex flex-wrap gap-2">
                {TRY_ASKING.map((ex) => (
                  <button
                    type="button"
                    key={ex}
                    onClick={() => {
                      setInput(ex);
                      inputRef.current?.focus();
                    }}
                    className="text-left text-xs px-3 py-2 min-h-[36px] rounded-lg transition-colors hover:bg-primary/[0.1] cursor-pointer"
                    style={{
                      color: "#B75E78",
                      background: "rgba(129,37,73,0.06)",
                      border: "1px solid rgba(129,37,73,0.15)",
                    }}
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}

          {loadingThread && (
            <div className="space-y-4" aria-label="Loading chat">
              {["w-2/3", "w-1/2 ml-auto", "w-3/5"].map((w, i) => (
                <div key={i} className={`h-12 rounded-2xl bg-[#F9F7ED] animate-pulse ${w}`} />
              ))}
            </div>
          )}

          {threadError && (
            <div className="flex items-end gap-2.5 justify-start" role="alert">
              {avatar}
              <div className="max-w-[78%] px-4 py-3 rounded-2xl rounded-bl-sm text-sm leading-relaxed bg-[#F9F7ED] text-[#1E1A1A]">
                {threadError.text}
                {threadError.retryId && (
                  <button
                    type="button"
                    onClick={() => threadError.retryId && void openConversation(threadError.retryId)}
                    className="flex items-center gap-1.5 mt-2 font-bold hover:underline cursor-pointer"
                    style={{ color: "#812549" }}
                  >
                    <RetryIcon />
                    Try again
                  </button>
                )}
              </div>
            </div>
          )}

          {messages.map((msg, i) => {
            const isLast = i === messages.length - 1;
            return (
              <div
                key={msg.key}
                className={`flex items-end gap-2.5 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {msg.role === "assistant" && avatar}
                <div
                  className={`max-w-[78%] px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
                    msg.role === "user"
                      ? "bg-[#1E1A1A] text-white rounded-br-sm"
                      : "bg-[#F9F7ED] text-[#1E1A1A] rounded-bl-sm"
                  }`}
                >
                  {msg.content || (isStreaming && isLast ? <Dots /> : "")}
                  {msg.profileLink && (
                    <Link href="/profile" className="block mt-2 font-bold hover:underline" style={{ color: "#812549" }}>
                      Finish your profile →
                    </Link>
                  )}
                  {msg.retryText && (
                    <button
                      type="button"
                      onClick={() => msg.retryText && void send(msg.retryText, { retryOf: msg.key })}
                      disabled={busy}
                      className="flex items-center gap-1.5 mt-2 font-bold hover:underline disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                      style={{ color: "#812549" }}
                    >
                      <RetryIcon />
                      Try again
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {/* Under Clara's latest message only. */}
          {showChoices && choices && (
            <AnswerChoices
              question={choices.question}
              options={choices.options}
              disabled={busy}
              onPick={(option) => void send(option)}
              onOther={() => inputRef.current?.focus()}
            />
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        <div className="flex-shrink-0 p-4 border-t" style={{ borderColor: "rgba(30,26,26,0.06)" }}>
          {/* The counter appears only once the cap is close enough to matter. */}
          {input.length > MAX_MESSAGE_CHARS * 0.9 && (
            <p
              className="text-[10px] mb-1.5 text-right tabular-nums"
              aria-live="polite"
              style={{ color: input.length >= MAX_MESSAGE_CHARS ? "#B75E78" : "#848181" }}
            >
              {input.length >= MAX_MESSAGE_CHARS
                ? `Message limit reached — ${MAX_MESSAGE_CHARS.toLocaleString()} characters.`
                : `${(MAX_MESSAGE_CHARS - input.length).toLocaleString()} character${MAX_MESSAGE_CHARS - input.length === 1 ? "" : "s"} left`}
            </p>
          )}
          <div className="flex gap-3 items-end">
            {/* maxLength matches the server's MAX_MESSAGE_CHARS (the route
                rejects anything longer). */}
            <label htmlFor="clara-input" className="sr-only">
              Message Clara
            </label>
            <textarea
              id="clara-input"
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value.slice(0, MAX_MESSAGE_CHARS))}
              onKeyDown={handleKeyDown}
              placeholder={showChoices ? "Or type your own answer…" : "Ask Clara about any food or dish…"}
              rows={1}
              maxLength={MAX_MESSAGE_CHARS}
              disabled={busy}
              className="flex-1 resize-none rounded-xl px-4 py-3 text-sm text-[#1E1A1A] bg-[#F9F7ED] border border-transparent focus:outline-none focus:border-primary/30 transition-colors disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => void send(input, { fromInput: true })}
              disabled={busy || !input.trim()}
              className="px-5 py-3 rounded-xl bg-primary text-white font-bold text-sm transition-colors hover:bg-primary-dark disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
            >
              Send
            </button>
          </div>
          <p className="text-[9px] mt-2 font-mono tracking-wide" style={{ color: "#ABA6A6" }}>
            Enter ↵ to send · Shift+Enter for new line · Chats are saved
          </p>
        </div>
      </div>
    </div>
  );
}
