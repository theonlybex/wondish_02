"use client";

import { useState, useRef, useEffect } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Props {
  firstName: string;
}

export default function DishCheckerClient({ firstName }: Props) {
  const opening = `Hi ${firstName}! I'm Clara, your personal food advisor. Tell me about any dish or food you're thinking of eating — I'll check it against your dietary profile and let you know if it's a good fit, and suggest changes if not.`;

  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: opening },
  ]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || isStreaming) return;

    const userMsg: Message = { role: "user", content: text };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput("");
    setIsStreaming(true);
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/dish-checker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });

      if (!res.ok || !res.body) throw new Error("Request failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          return [
            ...updated.slice(0, -1),
            { ...last, content: last.content + chunk },
          ];
        });
      }
    } catch {
      setMessages((prev) => [
        ...prev.slice(0, -1),
        {
          role: "assistant",
          content: "Sorry, something went wrong. Please try again.",
        },
      ]);
    } finally {
      setIsStreaming(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const shadow = "0 1px 3px rgba(13,31,16,0.07), 0 0 0 1px rgba(13,31,16,0.04)";

  return (
    <div className="h-full flex gap-5">
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
                    ? "bg-[#0d1f10] text-white rounded-br-sm"
                    : "bg-[#f4faf5] text-[#0d1f10] rounded-bl-sm"
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
          style={{ borderColor: "rgba(13,31,16,0.06)" }}
        >
          <div className="flex gap-3 items-end">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask Clara about any food or dish…"
              rows={1}
              disabled={isStreaming}
              className="flex-1 resize-none rounded-xl px-4 py-3 text-sm text-[#0d1f10] bg-[#f4faf5] border border-transparent focus:outline-none focus:border-primary/30 transition-colors disabled:opacity-50"
            />
            <button
              onClick={send}
              disabled={isStreaming || !input.trim()}
              className="px-5 py-3 rounded-xl bg-primary text-[#0a1509] font-bold text-sm transition-colors hover:bg-primary-dark disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
            >
              Send
            </button>
          </div>
          <p
            className="text-[9px] mt-2 font-mono tracking-wide"
            style={{ color: "#ADBDAD" }}
          >
            Enter ↵ to send · Shift+Enter for new line
          </p>
        </div>
      </div>

      {/* ── Info panel ── */}
      <div className="w-64 flex-shrink-0">
        <div
          className="bg-white rounded-2xl p-6 sticky top-0"
          style={{ boxShadow: shadow }}
        >
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
            <span className="text-xl leading-none">🌿</span>
          </div>
          <p
            className="text-[9px] tracking-[0.28em] uppercase font-bold mb-1"
            style={{ color: "#7DB87D" }}
          >
            Your advisor
          </p>
          <h2 className="text-lg font-bold text-[#0d1f10] mb-4">
            Meet Clara
          </h2>
          <p className="text-sm leading-relaxed mb-3" style={{ color: "#9EA8A0" }}>
            Your personal AI food expert.
          </p>
          <p className="text-sm leading-relaxed mb-3" style={{ color: "#9EA8A0" }}>
            Clara knows your dietary preferences, allergies, health conditions,
            and goals. Ask her about any dish, ingredient, or meal you are
            thinking of having.
          </p>
          <p className="text-sm leading-relaxed" style={{ color: "#9EA8A0" }}>
            She will tell you if it works for you — and suggest changes if not.
          </p>

          <div
            className="mt-6 pt-5 border-t space-y-2.5"
            style={{ borderColor: "rgba(13,31,16,0.06)" }}
          >
            {[
              "Is lamb curry ok for me?",
              "Can I eat sushi tonight?",
              "What about a Caesar salad?",
            ].map((ex) => (
              <button
                key={ex}
                onClick={() => setInput(ex)}
                className="w-full text-left text-xs px-3 py-2 rounded-lg transition-colors"
                style={{
                  color: "#7DB87D",
                  background: "rgba(74,222,128,0.06)",
                  border: "1px solid rgba(74,222,128,0.15)",
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
