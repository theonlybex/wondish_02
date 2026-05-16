# Check Your Dishes — Design Spec
**Date:** 2026-05-14  
**Status:** Approved  

---

## Overview

A Premium-only conversational AI feature called **"Check your Dishes"** that gives users a personal AI food advisor named **Clara**. Clara is silently loaded with the user's full dietary profile (allergies, food preferences, health conditions, foods to avoid, motivations) at page open. The user chats freely with Clara about any dish, ingredient, or meal. Clara evaluates it against their profile, explains what works and what doesn't, and suggests modifications. No structured form — just conversation.

---

## Sidebar

- Nav item label: **"Check your Dishes"**
- Icon: `🍴`
- Position: immediately below "Meal Plan" in `navItems` array
- Route: `/dish-checker`
- Visible to all users in the sidebar; Premium gate enforced on the page itself (redirects FREE users to `/membership`)

---

## Page Layout

Two-column layout inside the standard dashboard shell:

```
┌──────────────────────────────────┬──────────────────────────────┐
│  Chat (left, ~65% width)         │  Info panel (right, ~35%)    │
│                                  │                              │
│  Clara opening message           │  🌿 Meet Clara               │
│  User messages (right-aligned)   │  ─────────────               │
│  Clara messages (left-aligned)   │  Your personal AI food       │
│  [streaming dots while typing]   │  expert.                     │
│                                  │                              │
│                                  │  Clara knows your dietary    │
│                                  │  preferences, allergies,     │
│                                  │  health conditions and       │
│                                  │  goals. Ask her about any    │
│                                  │  dish, ingredient, or meal   │
│                                  │  you are thinking of having. │
│                                  │                              │
│                                  │  She will tell you if it     │
│                                  │  works for you and suggest   │
│                                  │  changes if not.             │
│                                  │                              │
│  [Ask Clara about any food...]   │                              │
│                          [Send]  │                              │
└──────────────────────────────────┴──────────────────────────────┘
```

- Chat area scrolls; input is pinned to the bottom of the left column
- Clara's first message is rendered immediately on page load (not streamed) — a warm greeting using the user's first name
- Right panel is static, no interactivity
- Page title: `Check your Dishes`

---

## Data Flow

### Page load (Server Component: `app/(dashboard)/dish-checker/page.tsx`)

1. Auth check via Clerk — redirect to `/login` if unauthenticated
2. Premium check — redirect to `/membership` if `subscription.plan !== PREMIUM`
3. Fetch user's full food map from DB in one query:
   - `foodAllergies` + `FoodAllergyBannedIngredient`
   - `foodPreferences` + `FoodPreferenceBannedIngredient`
   - `foodToAvoid`
   - `healthConditions` + `HealthConditionBannedIngredient`
   - `motivations` + `MotivationBannedIngredient`
   - `patient.mealType` (dietary pattern)
   - `account.firstName`
4. Serialize food map into a plain object and pass as props to `DishCheckerClient`

### Chat interaction (Client Component: `components/dish-checker/DishCheckerClient.tsx`)

1. Maintains `messages: {role, content}[]` in local state (session-only, not persisted)
2. On send: appends user message to state, POSTs `{ messages }` to `/api/dish-checker`
3. Reads the streaming response and appends tokens to the latest AI message in state
4. Shows animated dots (`...`) while streaming

### API Route (`app/api/dish-checker/route.ts`)

1. Auth check
2. Re-fetch food map from DB (authoritative — food map never travels client → server)
3. Build system prompt (see below)
4. Call Claude `claude-sonnet-4-6` with `stream: true`, `system` prompt, and `messages` array from request body
5. Pipe the stream back to the client using `ReadableStream`

---

## System Prompt

```
You are Clara, a warm and knowledgeable personal food advisor for {firstName}.

{firstName}'s dietary profile:
- Dietary pattern: {mealType name, e.g. "Vegetarian"}
  Restricted ingredients from this pattern: {list or "none"}
- Allergies: {allergy names}
  Restricted ingredients from allergies: {flat list}
- Foods to avoid: {list or "none"}
- Health conditions: {condition names}
  Restricted ingredients from conditions: {flat list}
- Goals/motivations: {motivation names}
  Restricted ingredients from goals: {flat list}

Your behavior:
1. When asked about a dish, assume the most common ingredients and preparation
   method if not specified — state your assumptions briefly.
2. Start with what works well for {firstName}'s goals (positive first).
3. Identify every conflict with their profile and explain WHY it matters.
4. If the dish can be fixed: propose specific modifications and ask if they accept.
   - Accepted → confirm ACCEPTED ✅ with modifications noted.
   - Declined → confirm REJECTED ❌, suggest an alternative dish.
5. No conflicts → confirm PASSED ✅, explain why it is a good fit.
6. After the first message, do NOT re-introduce yourself or restate the profile.
   You already know it. Just continue the conversation naturally.
7. Be warm, encouraging, and educational. Never clinical or cold.
8. Keep responses concise — 3–5 sentences unless the user asks for more detail.
```

---

## Files to Create / Modify

| File | Action |
|---|---|
| `app/(dashboard)/dish-checker/page.tsx` | Create — server component, auth + premium gate, fetch food map |
| `components/dish-checker/DishCheckerClient.tsx` | Create — chat UI, streaming |
| `app/api/dish-checker/route.ts` | Create — auth, food map fetch, Claude streaming |
| `components/dashboard/DashboardSidebar.tsx` | Edit — add nav item below meal-plan |
| `messages/en.json` | Edit — add `dishChecker` translation keys |
| `messages/es.json` | Edit — add translated keys |
| `messages/ru.json` | Edit — add translated keys |

---

## Out of Scope

- Persisting chat history to the database
- Saving Clara's verdicts to the journal
- Free tier access
- Mobile-specific layout changes
- Admin controls for Clara's behavior
