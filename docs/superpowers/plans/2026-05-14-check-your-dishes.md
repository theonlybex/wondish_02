# Check Your Dishes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Premium-only "Check your Dishes" page where users chat with Clara, an AI food advisor pre-loaded with their dietary profile, who evaluates dishes and suggests modifications in real time.

**Architecture:** Server component fetches the user's first name and passes it to a client chat component. Each chat POST to `/api/dish-checker` re-fetches the user's full food map from Postgres server-side, builds a Clara system prompt, and streams a Claude response back. The food map never travels client→server; conversation history lives in client state only.

**Tech Stack:** Next.js 14 App Router, Anthropic SDK (`@anthropic-ai/sdk`), Prisma, Clerk auth, Tailwind CSS, next-intl

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `app/(dashboard)/dish-checker/page.tsx` | Create | Server component — auth, fetch firstName, render client |
| `components/dish-checker/DishCheckerClient.tsx` | Create | Chat UI with streaming, two-column layout |
| `app/api/dish-checker/route.ts` | Create | Auth, food map fetch, Clara prompt, Claude stream |
| `components/dashboard/DashboardSidebar.tsx` | Modify | Add nav item below Meal Plan |
| `messages/en.json` | Modify | Add `dishChecker` sidebar key |
| `messages/es.json` | Modify | Add `dishChecker` sidebar key |
| `messages/ru.json` | Modify | Add `dishChecker` sidebar key |

---

## Task 1: Install Anthropic SDK and configure API key

**Files:**
- Modify: `package.json` (via npm install)
- Modify: `.env` (add key — do NOT commit)

- [ ] **Step 1: Install the SDK**

```bash
npm install @anthropic-ai/sdk
```

Expected output: `added 1 package` (or similar). No peer dep warnings to worry about.

- [ ] **Step 2: Add the API key to .env**

Open `.env` and add this line (get the key from the Anthropic Console):

```
ANTHROPIC_API_KEY=sk-ant-...
```

`.env` is already in `.gitignore` — confirm it before proceeding.

- [ ] **Step 3: Verify SDK resolves**

```bash
node -e "const Anthropic = require('@anthropic-ai/sdk'); console.log('ok');"
```

Expected: `ok`

- [ ] **Step 4: Commit only the package files**

```bash
git add package.json package-lock.json
git commit -m "feat: add @anthropic-ai/sdk for Clara dish checker"
```

---

## Task 2: Add sidebar nav item and i18n keys

**Files:**
- Modify: `messages/en.json`
- Modify: `messages/es.json`
- Modify: `messages/ru.json`
- Modify: `components/dashboard/DashboardSidebar.tsx`

- [ ] **Step 1: Add English translation key**

In `messages/en.json`, find the `"sidebar"` object and add `"dishChecker"` after `"mealPlan"`:

```json
"sidebar": {
  "overview": "Overview",
  "mealPlan": "Meal Plan",
  "dishChecker": "Check your Dishes",
  "weeklyPlan": "Weekly Plan",
  ...
}
```

- [ ] **Step 2: Add Spanish translation key**

In `messages/es.json`, find the `"sidebar"` object and add after `"mealPlan"`:

```json
"dishChecker": "Revisa tus Platos",
```

- [ ] **Step 3: Add Russian translation key**

In `messages/ru.json`, find the `"sidebar"` object and add after `"mealPlan"`:

```json
"dishChecker": "Проверь свои блюда",
```

- [ ] **Step 4: Add the nav item to the sidebar**

In `components/dashboard/DashboardSidebar.tsx`, find the `navItems` array and insert the new item immediately after the `meal-plan` entry:

```tsx
const navItems = [
  { href: "/overview", label: t("overview"), icon: "▦" },
  { href: "/meal-plan", label: t("mealPlan"), icon: "🍽" },
  { href: "/dish-checker", label: t("dishChecker"), icon: "🍴" },
  { href: "/journal", label: t("myJournal"), icon: "📓" },
  { href: "/journey", label: t("myJourney"), icon: "📈" },
  { href: "/taste", label: t("myTaste"), icon: "❤️" },
  { href: "/grocery-list", label: t("groceryList"), icon: "🛒" },
];
```

- [ ] **Step 5: Verify sidebar renders**

Run `npm run dev`, open `http://localhost:3000/overview` as a Premium user, confirm "Check your Dishes" appears between Meal Plan and Journal in the left sidebar with the 🍴 icon.

- [ ] **Step 6: Commit**

```bash
git add components/dashboard/DashboardSidebar.tsx messages/en.json messages/es.json messages/ru.json
git commit -m "feat: add Check your Dishes sidebar nav item"
```

---

## Task 3: Build the API route

**Files:**
- Create: `app/api/dish-checker/route.ts`

This route receives the conversation history, re-fetches the user's food map server-side, builds the Clara system prompt, and streams Claude's response.

- [ ] **Step 1: Create the file with auth + food map fetch**

Create `app/api/dish-checker/route.ts`:

```typescript
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

type Message = { role: "user" | "assistant"; content: string };

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let messages: Message[] = [];
  try {
    const body = await req.json();
    messages = Array.isArray(body.messages) ? body.messages : [];
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (messages.length === 0) {
    return NextResponse.json({ error: "No messages provided" }, { status: 400 });
  }

  const account = await prisma.account.findUnique({
    where: { clerkId: userId },
    select: { id: true, firstName: true },
  });
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const patient = await prisma.patient.findFirst({
    where: { accountId: account.id },
    include: {
      mealType: true,
      foodAllergies: {
        include: {
          food: { include: { bannedIngredients: true } },
        },
      },
      foodPreferences: {
        include: {
          food: { include: { bannedIngredients: true } },
        },
      },
      foodToAvoid: {
        include: { food: true },
      },
      healthConditions: {
        include: {
          condition: { include: { bannedIngredients: true } },
        },
      },
      motivations: {
        include: {
          motivation: { include: { bannedIngredients: true } },
        },
      },
    },
  });

  const foodMapText = buildFoodMapText(patient);
  const systemPrompt = buildSystemPrompt(account.firstName, foodMapText);

  const validMessages = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .filter((m) => typeof m.content === "string" && m.content.trim().length > 0);

  const stream = anthropic.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: systemPrompt,
    messages: validMessages,
  });

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          if (
            chunk.type === "content_block_delta" &&
            chunk.delta.type === "text_delta"
          ) {
            controller.enqueue(new TextEncoder().encode(chunk.delta.text));
          }
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function buildFoodMapText(patient: Awaited<ReturnType<typeof prisma.patient.findFirst>> & {
  mealType?: { name: string } | null;
  foodAllergies?: { food: { name: string; bannedIngredients: { name: string }[] } }[];
  foodPreferences?: { food: { name: string; bannedIngredients: { name: string }[] } }[];
  foodToAvoid?: { food: { name: string } }[];
  healthConditions?: { condition: { name: string; bannedIngredients: { name: string }[] } }[];
  motivations?: { motivation: { name: string; bannedIngredients: { name: string }[] } }[];
} | null): string {
  if (!patient) return "No specific dietary restrictions on file.";

  const lines: string[] = [];

  if (patient.mealType) {
    lines.push(`Dietary pattern: ${patient.mealType.name}`);
  }

  if (patient.foodAllergies && patient.foodAllergies.length > 0) {
    const names = patient.foodAllergies.map((a) => a.food.name).join(", ");
    const banned = patient.foodAllergies.flatMap((a) =>
      a.food.bannedIngredients.map((b) => b.name)
    );
    lines.push(`Allergies: ${names}`);
    if (banned.length > 0) lines.push(`Restricted from allergies: ${banned.join(", ")}`);
  }

  if (patient.foodToAvoid && patient.foodToAvoid.length > 0) {
    lines.push(`Foods to avoid: ${patient.foodToAvoid.map((f) => f.food.name).join(", ")}`);
  }

  if (patient.foodPreferences && patient.foodPreferences.length > 0) {
    const names = patient.foodPreferences.map((p) => p.food.name).join(", ");
    const banned = patient.foodPreferences.flatMap((p) =>
      p.food.bannedIngredients.map((b) => b.name)
    );
    lines.push(`Food preferences: ${names}`);
    if (banned.length > 0) lines.push(`Restricted from preferences: ${banned.join(", ")}`);
  }

  if (patient.healthConditions && patient.healthConditions.length > 0) {
    const names = patient.healthConditions.map((c) => c.condition.name).join(", ");
    const banned = patient.healthConditions.flatMap((c) =>
      c.condition.bannedIngredients.map((b) => b.name)
    );
    lines.push(`Health conditions: ${names}`);
    if (banned.length > 0) lines.push(`Restricted from conditions: ${banned.join(", ")}`);
  }

  if (patient.motivations && patient.motivations.length > 0) {
    const names = patient.motivations.map((m) => m.motivation.name).join(", ");
    const banned = patient.motivations.flatMap((m) =>
      m.motivation.bannedIngredients.map((b) => b.name)
    );
    lines.push(`Goals: ${names}`);
    if (banned.length > 0) lines.push(`Restricted from goals: ${banned.join(", ")}`);
  }

  return lines.length > 0 ? lines.join("\n") : "No specific dietary restrictions on file.";
}

function buildSystemPrompt(firstName: string, foodMapText: string): string {
  return `You are Clara, a warm and knowledgeable personal food advisor for ${firstName}.

${firstName}'s dietary profile:
${foodMapText}

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
9. If the dietary profile is empty or incomplete, still give your best nutritional advice based on general healthy eating principles.`;
}
```

- [ ] **Step 2: Verify the route compiles**

```bash
npm run build 2>&1 | grep "dish-checker"
```

Expected: route listed under `app/api/dish-checker` with no errors. If TypeScript complains about the Prisma include type, simplify `buildFoodMapText`'s parameter type to `any` — the runtime shape is guaranteed by the Prisma query above it.

- [ ] **Step 3: Commit**

```bash
git add app/api/dish-checker/route.ts
git commit -m "feat: add Clara dish checker API route with streaming"
```

---

## Task 4: Build the page and chat client

**Files:**
- Create: `app/(dashboard)/dish-checker/page.tsx`
- Create: `components/dish-checker/DishCheckerClient.tsx`

- [ ] **Step 1: Create the server page component**

Create `app/(dashboard)/dish-checker/page.tsx`:

```tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getAccount } from "@/lib/queries";
import DishCheckerClient from "@/components/dish-checker/DishCheckerClient";

export const metadata = { title: "Check your Dishes" };

export default async function DishCheckerPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");

  const account = await getAccount(userId);
  if (!account) redirect("/login");
  if (!account.onboardingComplete) redirect("/profile?onboarding=true");

  return (
    <div className="h-full flex flex-col">
      <style>{`
        @keyframes dc-rise {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .dc { animation: dc-rise 0.55s cubic-bezier(0.22, 1, 0.36, 1) both; }
      `}</style>

      <div className="dc flex-shrink-0 mb-6" style={{ animationDelay: "0ms" }}>
        <p
          className="text-[9px] tracking-[0.28em] uppercase font-mono mb-2"
          style={{ color: "#7DB87D" }}
        >
          Premium · AI Advisor
        </p>
        <h1 className="text-3xl font-bold text-[#0d1f10]">Check your Dishes</h1>
        <p className="text-xs mt-1.5" style={{ color: "#9EA8A0" }}>
          Your personal AI food advisor
        </p>
      </div>

      <div className="dc flex-1 min-h-0" style={{ animationDelay: "80ms" }}>
        <DishCheckerClient firstName={account.firstName} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the chat client component**

Create `components/dish-checker/DishCheckerClient.tsx`:

```tsx
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
```

- [ ] **Step 3: Verify the build compiles**

```bash
npm run build 2>&1 | tail -20
```

Expected: exits `0`, no TypeScript errors on the new files. If you see a Prisma type error in the API route's `buildFoodMapText` parameter, change the type annotation to `any` — it does not affect runtime behaviour.

- [ ] **Step 4: Manual smoke test**

Run `npm run dev`. Log in as a Premium user. Navigate to `/dish-checker`.

Verify:
1. Page title "Check your Dishes" and Clara's opening message both render
2. Sidebar shows "🍴 Check your Dishes" between Meal Plan and Journal — highlighted when active
3. Free user navigating to `/dish-checker` sees the Premium gate (the layout's PremiumGuard handles this automatically)
4. Typing "Is shrimp pasta ok?" and pressing Enter sends the message, shows the bouncing dots, then streams Clara's reply
5. Shift+Enter inserts a newline without sending
6. Example prompt buttons in the info panel populate the input field when clicked
7. Subsequent messages continue the conversation without re-introducing Clara

- [ ] **Step 5: Commit**

```bash
git add app/\(dashboard\)/dish-checker/page.tsx components/dish-checker/DishCheckerClient.tsx
git commit -m "feat: Check your Dishes page with Clara AI advisor"
```
