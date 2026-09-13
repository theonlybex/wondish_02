"use client";

import { useState, useRef, useEffect } from "react";
import { apiFetch } from "@/lib/client-fetch";

interface Message {
  role: "user" | "assistant";
  content: string;
  /** Rendered as Clara, but never sent back to the model as history. */
  error?: boolean;
}

interface Props {
  firstName: string;
}

/** The one fallback Clara says when we have nothing specific and true to tell. */
const GENERIC_ERROR = "Sorry — something went wrong. Please try again.";

export default function DishCheckerClient({ firstName }: Props) {
  const opening = `Hi ${firstName}! I'm Clara, your personal food advisor. I know your allergies, diet, and goals — so ask me anything about food: check a dish against your profile, ask about ingredients or swaps, or tell me your goal and I'll suggest what to eat.`;

  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: opening },
  ]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!isStreaming) inputRef.current?.focus();
  }, [isStreaming]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || isStreaming) return;

    const userMsg: Message = { role: "user", content: text };
    // Error bubbles ("Too many requests…") used to be replayed to the model
    // as real assistant turns (C3). Only genuine turns go back.
    const history = [...messages.filter((m) => !m.error), userMsg];
    setMessages([...messages, userMsg]);
    setInput("");
    setIsStreaming(true);
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    // A silent mobile drop used to leave reader.read() pending forever,
    // with the textarea and Send disabled until reload (C3). Abort if no
    // byte arrives for STALL_MS; the abort surfaces as a stream error below.
    const STALL_MS = 30_000;
    const controller = new AbortController();
    let stall: ReturnType<typeof setTimeout> | undefined;
    const kick = () => {
      if (stall) clearTimeout(stall);
      stall = setTimeout(() => controller.abort(), STALL_MS);
    };
    kick();

    try {
      const res = await apiFetch("/api/dish-checker", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.filter((m, i) => !(i === 0 && m.role === "assistant")),
          // Clara resolves relative dates ("two weeks ago") against these. The
          // server does no UTC math and asserts no date at all when they are
          // absent, so an older client keeps working unchanged.
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
        // The API answers with sentences ("Clara is busy — try again in a
        // moment.") and with bare fragments ("Unauthorized", "Invalid body")
        // alike. Only a sentence belongs in a Clara bubble; anything else
        // falls back to the generic line.
        let errMsg = GENERIC_ERROR;
        if (res.status === 401) {
          errMsg = "Your session expired — reload the page and try again.";
        } else {
          try {
            const errData = await res.json();
            if (typeof errData?.error === "string" && /[.!?…]$/.test(errData.error.trim())) {
              errMsg = errData.error;
            }
          } catch { /* ignore parse errors */ }
        }
        throw new Error(errMsg);
      }
      if (!res.body) throw new Error(GENERIC_ERROR);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      const appendChunk = (chunk: string) =>
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          return [
            ...updated.slice(0, -1),
            { ...last, content: last.content + chunk },
          ];
        });

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            // A multi-byte character split across the final chunk boundary
            // stays inside the decoder until a non-streaming decode flushes
            // it, so the last letter of an answer is not silently dropped.
            const tail = decoder.decode();
            if (tail) appendChunk(tail);
            break;
          }
          const chunk = decoder.decode(value, { stream: true });
          kick();
          appendChunk(chunk);
        }
      } catch {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          const partial = last.content.trim();
          return [
            ...updated.slice(0, -1),
            partial
              ? { ...last, content: `${last.content}\n\n(Clara got cut off — send your message again for the rest.)`, error: true }
              : { ...last, content: GENERIC_ERROR, error: true },
          ];
        });
      }
    } catch (err) {
      // A watchdog abort before the first byte lands here, and its message is
      // written by the browser ("signal is aborted without reason") — never
      // something to put in a chat bubble. Only our own errors are shown.
      const aborted = (err as { name?: string } | null)?.name === "AbortError";
      setMessages((prev) => [
        ...prev.slice(0, -1),
        {
          role: "assistant",
          content: !aborted && err instanceof Error ? err.message : GENERIC_ERROR,
          error: true,
        },
      ]);
    } finally {
      if (stall) clearTimeout(stall);
      setIsStreaming(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const shadow = "0 1px 3px rgba(30,26,26,0.07), 0 0 0 1px rgba(30,26,26,0.04)";

  return (
    // min-h-full (not h-full): the row is at least the viewport height, and
    // grows to the taller column — so the chat window is never shorter than
    // the suggestions panel. items-stretch keeps both columns the same height.
    <div className="min-h-full flex items-stretch gap-5">
      {/* ── Chat column ── */}
      <div
        className="flex-1 flex flex-col bg-white rounded-2xl overflow-hidden"
        style={{ boxShadow: shadow }}
      >
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex items-end gap-2.5 ${
                msg.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              {msg.role === "assistant" && (
                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mb-0.5">
                  <span className="text-base leading-none">🌿</span>
                </div>
              )}
              <div
                className={`max-w-[78%] px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                  msg.role === "user"
                    ? "bg-[#1E1A1A] text-white rounded-br-sm"
                    : "bg-[#F9F7ED] text-[#1E1A1A] rounded-bl-sm"
                }`}
              >
                {msg.content ||
                  (isStreaming && i === messages.length - 1 ? (
                    <span className="flex gap-1 items-center h-4">
                      {[0, 150, 300].map((delay) => (
                        <span
                          key={delay}
                          className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce"
                          style={{ animationDelay: `${delay}ms` }}
                        />
                      ))}
                    </span>
                  ) : (
                    ""
                  ))}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        <div
          className="flex-shrink-0 p-4 border-t"
          style={{ borderColor: "rgba(30,26,26,0.06)" }}
        >
          <div className="flex gap-3 items-end">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask Clara about any food or dish…"
              rows={1}
              disabled={isStreaming}
              className="flex-1 resize-none rounded-xl px-4 py-3 text-sm text-[#1E1A1A] bg-[#F9F7ED] border border-transparent focus:outline-none focus:border-primary/30 transition-colors disabled:opacity-50"
            />
            <button
              onClick={send}
              disabled={isStreaming || !input.trim()}
              className="px-5 py-3 rounded-xl bg-primary text-white font-bold text-sm transition-colors hover:bg-primary-dark disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
            >
              Send
            </button>
          </div>
          <p
            className="text-[9px] mt-2 font-mono tracking-wide"
            style={{ color: "#ABA6A6" }}
          >
            Enter ↵ to send · Shift+Enter for new line
          </p>
        </div>
      </div>

      {/* ── Info panel — desktop only; on phones it squeezed the chat into a
          ~150px column with an unusable input. ── */}
      <div className="hidden lg:block w-64 flex-shrink-0">
        <div
          className="bg-white rounded-2xl p-6 sticky top-0"
          style={{ boxShadow: shadow }}
        >
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
            <span className="text-xl leading-none">🌿</span>
          </div>
          <p
            className="text-[9px] tracking-[0.28em] uppercase font-bold mb-1"
            style={{ color: "#B75E78" }}
          >
            Your advisor
          </p>
          <h2 className="text-lg font-bold text-[#1E1A1A] mb-4">
            Meet Clara
          </h2>
          <p className="text-sm leading-relaxed mb-5" style={{ color: "#848181" }}>
            Knows your diet, allergies, and goals.
          </p>

          <p className="text-[9px] tracking-[0.22em] uppercase font-bold mb-2" style={{ color: "#ABA6A6" }}>
            Best for
          </p>
          <ul className="space-y-1.5 mb-5 text-sm" style={{ color: "#1E1A1A" }}>
            <li>Checking if you can eat a dish</li>
            <li>Food &amp; nutrition questions</li>
            <li>Suggestions for your goals</li>
          </ul>

          <p className="text-[9px] tracking-[0.22em] uppercase font-bold mb-2" style={{ color: "#ABA6A6" }}>
            Try asking
          </p>
          <div className="space-y-2.5">
            {[
              "Can I eat a Caesar salad?",
              "Is oat milk fine with my diet?",
              "What should I eat to hit my protein goal?",
              "A lower-carb swap for pasta?",
            ].map((ex) => (
              <button
                key={ex}
                onClick={() => setInput(ex)}
                className="w-full text-left text-xs px-3 py-2 rounded-lg transition-colors"
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
      </div>
    </div>
  );
}
