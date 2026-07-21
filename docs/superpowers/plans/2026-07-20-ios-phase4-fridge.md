# Clara iOS Phase 4 — Fridge

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Every task that creates or edits SwiftUI MUST invoke the `ui-ux-pro-max:ui-ux-pro-max` skill AND the `mobile-ios-design` skill before writing any Swift — this is a non-negotiable global user rule for all frontend work; it is restated in Step 1 of each such task.**

## ⚠️ Preconditions (verify BEFORE starting — this plan is unbuildable without them)

Phase 4 is written to **consume Phase 2's iOS infrastructure**, which does **not** exist on the Clara `main`/Phase-1 tip. Before any iOS task:

1. **Phase 2 must be merged.** Grep the Clara repo for the primitives Phase 4 consumes:
   ```bash
   cd /Users/becks/Desktop/NewView/Clara && \
   grep -rln 'WondishAPIClient\|SessionStore\|EntitlementStore\|UsageMeter\|FreemiumLimits\|PaywallView\|PaywallContext\|StubURLProtocol\|TokenProviding' Clara ClaraTests
   ```
   If this returns **nothing** (the current state on `main`), **STOP** — Phase 4 cannot compile. Phase 2 (auth/networking/session/entitlement/meter/paywall) is a hard prerequisite and must land first. Do **not** silently re-implement Phase-2 infra inside Phase 4; that violates the "zero new infrastructure" premise and creates two sources of truth.
2. **The web side has no such precondition** — Task 1 (`/api/fridge` + `lib/food-map.ts` extraction) is independent and can proceed against the live `wondish_02` repo immediately.
3. **Design-system primitives are already real** on Clara `main` (`WColor.*`, `WFont.inter`, `WSpacing`, `WRadius`, `WButtonStyle`, `WBadge`, `.wCard`, `WTextField`, `VerdictBadge`, `BrandWordmark`) — verified — so token-level feasibility is sound; only the **app-infra** layer is gated on Phase 2.

**Goal:** Build the **Fridge** tab — "what can I make from what's in my fridge?" The user enters ingredients as typed chips (and, once Phase 3 lands, optionally snaps a photo of their fridge reusing Phase-3 vision), taps **Generate**, and a **net-new** web endpoint `POST /api/fridge` asks Anthropic (`claude-sonnet-5`) to suggest a small set of recipes usable from those ingredients — **strictly constrained by the patient's allergies / foods-to-avoid / banned ingredients and biased toward their preferences and plan goal** — returning each recipe with per-serving macros and a fits-plan verdict. Every returned recipe is additionally passed through a **deterministic server-side allergen filter** (F-D7) so a prompt miss cannot surface a banned ingredient. The user browses results as `WCard` rows, opens a recipe detail (steps, macros, verdict), and one-taps **Log it** (`source=FRIDGE`, carrying the opaque `fridgeRecipeId` and the server-supplied `perServing`) to the already-shipped `POST /api/meal-log`. Generation is the metered/paid action: **free tier is 1 Fridge generation/day** via the Phase-2 `UsageMeter` (UX) plus a **server-side daily abuse backstop** (F-D2); at the cap the Phase-2 `PaywallView` is presented. `FridgePlaceholderView` is replaced wholesale.

**Architecture:** Phase 4 adds **zero new networking, session, entitlement, or paywall infrastructure** — it consumes Phase 2's `WondishAPIClient` (actor; Bearer injection, bounded single 401 re-mint+retry, redirect-never-success, ISO8601 decoding, typed `APIError`, **2xx-treated-as-success incl. 201**), `SessionStore` (`me`, `onboardingComplete`), `EntitlementStore` (`isPremium`), `UsageMeter` + `FreemiumLimits.fridgePerDay` (already `1`), and `PaywallView`. **Two Phase-2 files Phase 4 edits** (see Global Constraints — the draft's "single edit" claim was wrong): `PaywallContext` (add `.fridgeLimit` case + copy **and** an `Identifiable` conformance so `.sheet(item:)` compiles). The web side follows the repo's thin-route / pure-lib discipline: all generation logic (`normalizeIngredients`, `buildFridgePrompt`, `parseFridgeRecipes`, `applyAllergenFilter`) lives in `lib/fridge.ts` under `node --test`, and the dietary-constraint prompt block plus the structured banned-term list are **extracted** out of `dish-checker/route.ts` into a shared `lib/food-map.ts` (`buildFoodMapText`, `collectBannedTerms`, `PATIENT_FOOD_MAP_INCLUDE`) so `/api/fridge` and `/api/dish-checker` share one source of truth. `POST /api/fridge` is **non-streaming** (a single structured JSON body via Anthropic tool-use), unlike Chat/Phase-5. Logging reuses `POST /api/meal-log` **unchanged** — `FRIDGE` is already a `CALLER_SUPPLIED_SOURCES` value that accepts `name`/`perServing`/`fridgeRecipeId` and returns the day-envelope echo; the first write returns **`201`**, an idempotent replay returns **`200`**; **there are zero Prisma migrations**. The generated recipe is stateless: `fridgeRecipeId` is a server-minted opaque provenance token that only reaches the DB if/when the user logs, and is never read back for macro math. iOS logic is covered by `ClaraTests` (XCTest) behind `StubURLProtocol`/`TokenProviding` seams; web logic by `node --test`.

**Tech Stack:** Swift 5.9+ / SwiftUI, iOS 17.0 target, XcodeGen, XCTest, `NavigationStack` value-based routing, iOS-16+ `Layout` protocol (hand-rolled `FlowLayout`, zero new SPM deps); a tiny `UIViewRepresentable` over `UITextField` for empty-backspace chip deletion (see F-D-note in Task 3). Web side: Next.js 14, TypeScript, Prisma/Postgres, Clerk v7 (`@clerk/nextjs ^7`), `@anthropic-ai/sdk ^0.96.0` (image content blocks + non-streaming `.create()` with tool-use).

## Global Constraints

- iOS app location: `/Users/becks/Desktop/NewView/Clara` — its own git repository, separate from the web repo. App/bundle id: `io.wondish.clara`. **Branch `phase4-fridge` MUST be cut from the merged Phase-2 tip (the Phase-2 branch merged into `main`), NOT from the current Phase-1 `main`** — otherwise none of the consumed networking/session/entitlement/paywall code is present. State the base commit explicitly in Task 2 Step 0.
- Web repo: `/Users/becks/Desktop/NewView/wondish_02`, on branch `clara-ios-phase4-backend` (branched from `main`).
- **Reuse Phase-2 infrastructure — do not re-declare it.** Phase 4 *consumes* `WondishAPIClient`, `APIRequest`/`APIError`, `SessionStore`, `EntitlementStore`, `UsageMeter`, `FreemiumLimits`, `PaywallView`. **Phase-2 edits are exactly two, both on `PaywallContext`:** `+ case fridgeLimit` (with copy) and `: Identifiable` conformance (required by `.sheet(item:)`). No other Phase-2 file is modified.
- **Pin the reused `UsageMeter` surface before use.** The Phase-2 spec only guarantees `FreemiumLimits.{scan,fridge,chat}PerDay` and the pure `UsageMeter.isNewDay(last:now:)`. The Fridge gate needs a **feature-keyed counter** (`count(for:)` / `increment(for:)` + a feature enum with a `.fridge` case). Task 2 Step 0 reads the shipped Phase-2 `UsageMeter.swift` and records the exact signatures in the task's Interfaces. **If Phase 2 did not ship a feature-keyed counter, that method + enum is a Phase-2 gap Phase 4 must add to `UsageMeter` — declare it explicitly as a third Phase-2 edit at that point rather than inventing an undefined API.**
- **Freemium limit for this tab:** Fridge **generation** (the paid AI call) is metered client-side at `FreemiumLimits.fridgePerDay == 1` for free users for instant UX; **logging is never metered**; browsing results is never metered. Per F-D2, the **server is the economic backstop**: a per-day rate-limit bucket bounds abuse regardless of client tampering (the client-only meter alone is a trivially-bypassed honor system — Phase-2 D15 — which is unacceptably cheap to abuse on a per-generation AI+vision call).
- **Reuse the existing backend.** New server surface is added ONLY where genuinely required: exactly `POST /api/fridge` (net-new) plus the behavior-preserving extraction of `buildFoodMapText`/`collectBannedTerms`/`PATIENT_FOOD_MAP_INCLUDE` into `lib/food-map.ts`, and **exporting** the already-existing `MAX_MACRO`/`MAX_SERVINGS` bounds from `lib/meal-log.ts`. `POST /api/meal-log` (the log-it write) needs **zero changes**. **Zero Prisma migrations** (`fridgeRecipeId String?` and the `FRIDGE` enum already exist).
- Swift + SwiftUI only; iPhone-only (`TARGETED_DEVICE_FAMILY = 1`), portrait only. English only, no dark mode (design system is light-only).
- **Design tokens/components only — no new colors, no new fonts.** New views are token-only compositions; the only new reusable primitive is `FlowLayout` (a `Layout`, not a styled component) plus one thin `UITextField` representable for backspace-delete.
- Brand tokens are fixed: primary `#812549`, primary-light `#B75E78`, primary-dark `#5F1C35`, background `#F9F7ED`, secondary cream `#F5F1DD`, border `#EAE4CA`, text `#1E1A1A`, secondary text `#4F4A4A`, tertiary `#848181`, success `#00B9A6`, warning `#FDC221`, error `#EA5455`. **`WBadge(.info)` is a teal alias of `.success` — never use it for plan/state discrimination**; meal-type uses `.primary`, missing-ingredient chips use `.neutral`/`.warning`, verdicts use `VerdictBadge`, conflicts use `WColor.error`.
- iOS HIG: SF Symbols (no emoji icons in chrome; recipe `emoji` is content, allowed), **≥44 pt touch targets** (chip delete, Generate, Log it, servings stepper), respect safe areas, Dynamic Type via `WFont.inter`.
- iOS test/verify: `xcodegen generate` → `xcodebuild -project Clara.xcodeproj -scheme Clara -destination 'platform=iOS Simulator,name=<FIRST_AVAILABLE_IPHONE>' build|test` (discover the device via `xcrun simctl list devices available | grep iPhone`). Web test command: `npm test` (runs `node --import tsx --test lib/*.test.ts data/*.test.ts middleware.test.ts`; new tests must be `lib/*.test.ts` to be auto-picked).
- **`MealLogWriteDTO` / `LogResponseDTO` / `AddToLogService` are a hard cross-phase dependency:** Phase 3 (Picture) also logs, so the clean split is that **Phase 3 introduces these log-write DTOs + service; Phase 4 reuses them.** If Phase 3 has not landed when Phase 4 starts, **Phase 4 owns them** (Task 2 creates them under `Clara/Features/MealLog/`); if Phase 3 shipped them first, Task 2 imports Phase-3's and deletes any duplicate.
- **Photo input is a hard dependency on Phase 3's `PhotoCaptureView` + upload wrapper.** The upload endpoint (`POST /api/upload`, multipart, ≤5 MB, jpeg/png/webp/gif → `{ url }`) already exists; only the SwiftUI capture UI + multipart client is Phase-3's piece. Phase 4 ships **chips-only** and adds the "Snap your fridge" button as an **additive, Phase-3-gated** affordance. Phase 4 adds **no Info.plist keys** (`NSCameraUsageDescription` is owned by Phase 3's module).

---

## Open product decisions (need sign-off) — each has a RECOMMENDED default so the plan is actionable now

| # | Decision | RECOMMENDED default (plan is written against this) |
|---|---|---|
| F-D1 | `/api/fridge` per-minute rate-limit bucket | **`rateLimit("fridge", userId, 10, 60)`** — 10/min cost-bounds burst abuse of a heavy AI call (dish-checker uses 20/60s; generation is heavier). This is the *burst* limit; the *economic* limit is F-D2. |
| F-D2 | Free/paid boundary enforcement (economic protection) | **Server-side daily backstop, NOT client-only.** The client `UsageMeter` (1/day) stays for instant UX, but the recommended default **also** enforces on the server: fetch the account (already needed, F-D9), check `hasActivePremium(account.subscription)`; for non-premium, apply a per-day bucket `rateLimit("fridge-day", userId, FRIDGE_DAILY_FREE, 86400)` (**recommended `FRIDGE_DAILY_FREE = 3`** — above the honest 1/day client cap so legitimate users never hit it, but bounds a tampered client to 3/day instead of the ~14,400/day that client-only + 10/min would allow). Over-cap → **`402 {"error":"Premium required"}`** → iOS `APIError.premiumRequired` → `PaywallView(.fridgeLimit)`. Premium users bypass the daily bucket (still subject to F-D1). **Alternative:** pure client-only per Phase-2 D15 (accepted honor-system leak) — rejected as recommended because Fridge is the app's most expensive endpoint (per-generation tool-use, optionally vision) and the leak here is materially costlier than Scan/Chat. Flipping to the alternative is a route-only change; iOS is identical either way (a `402/403` already routes to the paywall). |
| F-D3 | Structured-output mechanism | **Anthropic tool-use** (`tools:[{name:"suggest_recipes", input_schema:…}]`, `tool_choice:{type:"tool", name:"suggest_recipes"}`) over free-text JSON — far more reliable parse. `parseFridgeRecipes` still validates/clamps regardless. |
| F-D4 | Recipes per response | **Cap 3.** `parseFridgeRecipes(raw, maxRecipes)` clamps its `maxRecipes` arg into `[1,5]`, then truncates the returned array to that value; the route passes `maxRecipes = 3`. (Precise semantics resolve the draft's ≤3-vs-≤5 wording conflict.) |
| F-D5 | Photo-input inclusion this phase | **Additive sub-task, gated on Phase 3.** Phase 4 ships **chips-only** and is fully buildable/verifiable without a camera; the "Snap your fridge" button + `imageUrl` path is added behind the Phase-3 `PhotoCaptureView` module (Task 4 Step 4). If Phase 3 hasn't landed, the button is omitted entirely. **Server hardening for the image branch is mandatory when built:** SSRF allowlist + media-type + byte cap (F-D10). |
| F-D6 | Verdict mapping from `fitsPlan`/`conflicts` | `fitsPlan && conflicts.isEmpty → .fits`; `fitsPlan && !conflicts.isEmpty → .caution`; `!fitsPlan → .doesntFit`. `.doesntFit` recipes still render, the ConflictCard expands, and the CTA softens to "Log anyway". |
| **F-D7** | **Allergen guarantee level (highest-stakes; health-critical)** | **HARD deterministic filter, not prompt-only.** The model is prompted to exclude allergens AND it self-certifies `fitsPlan`/`conflicts` — a single point of failure whose worst case is an allergic reaction. Recommended default adds an independent server-side guard: `collectBannedTerms(patient)` (allergen food names + all `bannedIngredients` from allergies/health-conditions/motivations + `foodToAvoid` names) is passed to `applyAllergenFilter(recipes, bannedTerms)`, which scans each recipe's `name` + `usesIngredients` + `missingIngredients` + `steps` for any banned term (case-insensitive, token/substring match) and **drops** any matching recipe outright (an allergen-bearing recipe is never shown, never loggable). Additionally the system prompt **forbids unlisted pantry staples**: every ingredient the recipe assumes — staples included — MUST appear in `usesIngredients` or `missingIngredients`, so no allergen (dairy/gluten/soy in "assumed" butter/flour/soy sauce) can enter a dish invisibly to the filter. **Alternative:** soft/prompt-only (mark, don't drop) — rejected; unacceptable failure mode for a nutrition/health product. |
| **F-D8** | **AI-estimated macros counted toward daily targets** | **Estimate, clamp for plausibility, and disclose.** `perServing` is model-invented and written verbatim to the nutrition ledger (server does no pricing for `CALLER_SUPPLIED_SOURCES`). Recommended default: `parseFridgeRecipes` clamps each field to `[0, MAX_MACRO]` / servings to `(0, MAX_SERVINGS]` **and** runs an energy-balance plausibility check — if `calories` deviates from `4·protein + 4·carbs + 9·fat` beyond ±40% (and abs diff > 50), normalize `calories` to the macro-derived estimate. The UI labels Fridge macros **"estimated"** on the detail MacroGrid. FRIDGE macros are always treated **complete** (`incomplete=false`) — the model fills all five fields, so the null-vs-0 distinction the server's `incomplete` flag encodes cannot meaningfully trip; a guessed `0 g fiber` is indistinguishable from a known one, and we disclose the whole set as estimates rather than per-field. **Alternative:** store raw, no plausibility clamp, no disclosure — rejected (silent hallucinated truth in the ledger). |
| **F-D9** | **Account/patient resolution parity with dish-checker** | **`getOrCreateAccount(userId)` then `patient.findFirst({ where:{ accountId: account.id } })`** — matches the extraction source (`dish-checker/route.ts`) so a signed-in user with no account row self-heals instead of hitting a hard `404`. Still `404 {"error":"Profile not found"}` if no Patient row exists after account resolution. (Resolves the silent divergence where the draft queried `where:{ account:{ clerkId } }` and 404'd users dish-checker would have healed.) |
| **F-D10** | **Image-URL fetch safety (only if F-D5 built)** | **SSRF allowlist + media/size guard.** `imageUrl` is client-supplied and server-fetched → never `fetch()` a raw client URL. Recommended: require `https` scheme and host ∈ the upload/CDN allowlist (the `/api/upload` blob host, from env); reject otherwise with `400`. On fetch, enforce `Content-Type` ∈ {jpeg,png,webp,gif} and a **≤5 MB** byte ceiling before base64; any failure → drop the image and proceed chips-only. Image-bearing calls share the F-D1 bucket. This branch is route-level and **untested by convention** (documented explicitly, not accidentally omitted). |

---

### Task 1: WEB — `lib/food-map.ts` extraction + exported bounds + `lib/fridge.ts` + `POST /api/fridge`

**Repo:** `/Users/becks/Desktop/NewView/wondish_02`. Independent of the iOS tasks; must land before Task 2 consumes the endpoint contract.

**Files:**
- Create: `lib/food-map.ts`, `lib/food-map.test.ts`
- Create: `lib/fridge.ts`, `lib/fridge.test.ts`
- Create: `app/api/fridge/route.ts`
- Modify: `lib/meal-log.ts` (add `export` to `MAX_MACRO` and `MAX_SERVINGS` — currently module-private; `lib/fridge.ts` imports them so validation matches what `/api/meal-log` accepts)
- Modify: `lib/meal-log.test.ts` (add a hard case exercising the `FRIDGE` `CALLER_SUPPLIED_SOURCES` + `fridgeRecipeId` persistence branch — moved here from VERIFY so it's a defined deliverable, not a conditional afterthought)
- Modify: `app/api/dish-checker/route.ts` (import `PATIENT_FOOD_MAP_INCLUDE`, `buildFoodMapText`, `collectBannedTerms` from `lib/food-map.ts`; delete its private copies — behavior-preserving)
- **No `middleware.ts` change** — `/api/fridge` is authenticated (the shipped `wantsJson401` branch already returns JSON 401 for Bearer clients); do NOT add it to `isPublicRoute`.

**Interfaces:**
- Produces: `lib/food-map.ts`, pure over a Prisma patient shape:
  - `PATIENT_FOOD_MAP_INCLUDE` — the Prisma `include` object (`mealType`, `foodAllergies{food{bannedIngredients}}`, `foodPreferences{food{bannedIngredients}}`, `foodToAvoid{food}`, `healthConditions{condition{bannedIngredients}}`, `motivations{motivation{bannedIngredients}}`), lifted verbatim from `dish-checker/route.ts`.
  - `buildFoodMapText(patient): string` — empty patient → `"No specific dietary restrictions on file."`, lifted verbatim.
  - `collectBannedTerms(patient): string[]` — **new**; returns a deduped, lowercased list of hard-avoid terms (allergen `food.name`s + every `bannedIngredients` string from allergies/health-conditions/motivations + `foodToAvoid` `food.name`s) for the F-D7 deterministic filter. Empty patient → `[]`.
- Produces: `lib/fridge.ts` — pure, zero Next/Prisma imports:
  - `normalizeIngredients(input: unknown): string[]` — trim, drop empties, case-insensitive dedupe, cap each item ≤80 chars, cap count at `MAX_INGREDIENTS = 30`, stable order; non-array/`undefined` → `[]`.
  - `parseFridgeRecipes(raw: unknown, maxRecipes: number): FridgeRecipe[] | null` — validates the model's tool-use JSON. Returns **`null` ONLY when `raw` is not a usable array** (unrecoverable junk → route emits 502). A valid array that yields zero surviving recipes returns **`[]`** (a legitimate "no recipes possible" result, NOT an error — resolves the draft's 502-swallows-empty bug). Per recipe: rejects/drops entries missing `name` or `steps`; clamps macro fields to `[0, MAX_MACRO]` and `servings` to `(0, MAX_SERVINGS]` (imported from `lib/meal-log.ts`); runs the F-D8 energy-balance plausibility normalization; coerces missing `missingIngredients`/`conflicts`/`usesIngredients` to `[]`; clamps `maxRecipes` into `[1,5]` then truncates to it; **mints `id = "frg_" + crypto.randomUUID()` server-side** (the model never supplies `id`).
  - `applyAllergenFilter(recipes: FridgeRecipe[], bannedTerms: string[]): FridgeRecipe[]` — **new (F-D7)**; drops any recipe whose `name`/`usesIngredients`/`missingIngredients`/`steps` contains a banned term (case-insensitive). Returns the survivors (possibly `[]`).
  - `buildFridgePrompt(ingredients: string[], mealType?: string): string` — user-message text (ingredient list + optional meal-type hint + strict tool-use instruction).
  - `FRIDGE_SYSTEM_PROMPT(foodMapText: string, maxRecipes: number): string` — system prompt with the dietary-constraint block injected; instructs the F-D7 no-unlisted-staples rule.
  - `SUGGEST_RECIPES_SCHEMA` — the tool `input_schema`.
- Produces: `POST /api/fridge` returning `FridgeResponseDTO` (below).

**`POST /api/fridge` contract**

Request:
```json
{ "ingredients": ["spinach","chickpeas","onion","garlic"],
  "mealType": "dinner",            // optional hint
  "imageUrl": "https://…" }        // optional; a URL from POST /api/upload (Phase-3 capture). Omitted for chips-only.
```
Response `200`:
```json
{ "recipes": [ {
  "id": "frg_a1b2c3…",
  "name": "Chickpea & Spinach Skillet",
  "description": "One-pan, ready in 20 min.",
  "emoji": "🍳",
  "usesIngredients": ["chickpeas","spinach","onion","garlic","olive oil"],
  "missingIngredients": ["cumin"],
  "steps": ["Sauté onion & garlic in olive oil…","Add chickpeas…"],
  "mealType": "dinner",
  "servings": 1,
  "perServing": { "calories": 420, "protein": 22, "carbs": 48, "fat": 15, "fiber": 9 },
  "fitsPlan": true,
  "conflicts": [] } ] }
```
A valid but empty result is `200 { "recipes": [] }` (no ingredients yielded a compliant recipe, or all candidates were dropped by the allergen filter). Status codes: `200` ok (incl. empty) · `400` no ingredients and no image / invalid body / disallowed `imageUrl` host · `401` unauth (JSON, matches middleware) · `402 {"error":"Premium required"}` (F-D2 daily backstop hit) · `404 {"error":"Profile not found"}` (no Patient row after account resolution) · `429` rate-limit or Anthropic-429 · `502 {"error":"Clara couldn't read that. Try again."}` (malformed model output — `parseFridgeRecipes` returned `null`) · `503` Anthropic-529 · `500` other.

- [ ] **Step 0: Create the branch + inventory the extraction surface + confirm bound exports**

```bash
cd /Users/becks/Desktop/NewView/wondish_02 && git checkout main && git pull && git checkout -b clara-ios-phase4-backend
```
`grep -n 'buildFoodMapText\|foodAllergies\|foodPreferences\|foodToAvoid\|healthConditions\|motivations\|bannedIngredients\|getOrCreateAccount' app/api/dish-checker/route.ts` to capture the exact include shape, `buildFoodMapText` body, the banned-term sources, and the account-resolution pattern before lifting them. `grep -n 'MAX_MACRO\|MAX_SERVINGS\|CALLER_SUPPLIED_SOURCES\|export' lib/meal-log.ts` to confirm `MAX_MACRO`/`MAX_SERVINGS` are currently **un-exported** consts (they are) — they will be exported in Step 2.

- [ ] **Step 1: Write failing `food-map.test.ts`, extract `buildFoodMapText` + `collectBannedTerms` + include, repoint dish-checker**

Create `lib/food-map.test.ts` (table-driven over a stub patient include): empty patient → `"No specific dietary restrictions on file."`; each of allergies / foodToAvoid / preferences / healthConditions / motivations renders its line; `bannedIngredients` surfaced; empty sections omitted; **`collectBannedTerms`** returns the union of allergen names + all `bannedIngredients` + `foodToAvoid` names, lowercased/deduped, and `[]` for an empty patient. Run `node --import tsx --test lib/food-map.test.ts` → **FAIL** (`Cannot find module './food-map'`). Then create `lib/food-map.ts` exporting `PATIENT_FOOD_MAP_INCLUDE` + `buildFoodMapText` (verbatim) + `collectBannedTerms`; edit `app/api/dish-checker/route.ts` to import them and delete the private copies. Run `node --import tsx --test lib/food-map.test.ts` and the existing dish-checker/chat-history tests → **PASS** (extraction is behavior-preserving).

- [ ] **Step 2: Export the bounds + write failing `fridge.test.ts` + implement `lib/fridge.ts`**

Add `export` to `MAX_MACRO` and `MAX_SERVINGS` in `lib/meal-log.ts` (behavior-preserving — no value change; re-run the existing `lib/meal-log.test.ts` to confirm green). Create `lib/fridge.test.ts`:
- `normalizeIngredients` — trims, lowercase-dedupes (`"Spinach"`+`"spinach"` → 1), drops empties, caps count at 30, caps item length ≤80, stable order; non-array/`undefined` → `[]`.
- `parseFridgeRecipes` — valid tool payload → typed array with `frg_`-prefixed minted ids; **`null` only for non-array/unusable raw**; **valid array with zero survivors → `[]` (NOT null)**; a recipe missing `name` or `steps` is dropped; `maxRecipes` arg clamped into `[1,5]` and the array truncated to it (assert "a 4th recipe is dropped when `maxRecipes=3`", and "arg `7` behaves as `5`"); clamps out-of-range macros to `[0, MAX_MACRO]`; clamps `servings` into `(0, MAX_SERVINGS]`; **F-D8 plausibility**: a recipe with `calories:9999, protein:5, carbs:5, fat:5` has `calories` normalized toward `4·5+4·5+9·5=85`; coerces missing `missingIngredients`/`conflicts`/`usesIngredients` to `[]`.
- `applyAllergenFilter` — a recipe naming a banned term in any of name/uses/missing/steps is dropped; a clean recipe survives; empty `bannedTerms` → passthrough; all-dropped → `[]`.
- `buildFridgePrompt` — asserts the assembled text contains the ingredient list and the meal-type hint and the strict tool-use instruction.
- `FRIDGE_SYSTEM_PROMPT` — asserts the injected `foodMapText` (allergy/avoid constraint text) appears **verbatim** (constraint injection is load-bearing) and that the no-unlisted-staples instruction is present.

Run → **FAIL**. Implement `lib/fridge.ts` (import `MAX_MACRO`/`MAX_SERVINGS` from `@/lib/meal-log`); run → **PASS**.

- [ ] **Step 3: Add the FRIDGE meal-log persistence test (hard deliverable)**

In `lib/meal-log.test.ts`, add a case asserting the `FRIDGE` `CALLER_SUPPLIED_SOURCES` path in `buildMealLogCreateData` writes the caller-supplied `perServing` verbatim and persists `fridgeRecipeId` (and does **not** invoke server pricing). Run `node --import tsx --test lib/meal-log.test.ts` → **PASS**. (Moved out of VERIFY so Task 5 only *runs* the suite, never authors tests.)

- [ ] **Step 4: Implement the thin route `app/api/fridge/route.ts`** (mirrors `dish-checker/route.ts`)

```ts
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { getOrCreateAccount, hasActivePremium } from "@/lib/…";   // same helpers meal-log/dish-checker use
import { PATIENT_FOOD_MAP_INCLUDE, buildFoodMapText, collectBannedTerms } from "@/lib/food-map";
import { normalizeIngredients, buildFridgePrompt, parseFridgeRecipes, applyAllergenFilter,
         FRIDGE_SYSTEM_PROMPT, SUGGEST_RECIPES_SCHEMA } from "@/lib/fridge";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const FRIDGE_DAILY_FREE = 3;                                              // F-D2

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const burst = await rateLimit("fridge", userId, 10, 60);               // F-D1
  if (!burst.success) return NextResponse.json({ error: "Too many requests. Please wait a moment." }, { status: 429 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }
  const ingredients = normalizeIngredients((body as any)?.ingredients);
  const imageUrl = typeof (body as any)?.imageUrl === "string" ? (body as any).imageUrl : undefined;
  const mealType = typeof (body as any)?.mealType === "string" ? (body as any).mealType : undefined;
  if (ingredients.length === 0 && !imageUrl)
    return NextResponse.json({ error: "Add at least one ingredient or a photo." }, { status: 400 });

  const account = await getOrCreateAccount(userId);                       // F-D9 parity with dish-checker

  if (!hasActivePremium(account?.subscription)) {                        // F-D2 server backstop
    const day = await rateLimit("fridge-day", userId, FRIDGE_DAILY_FREE, 86400);
    if (!day.success) return NextResponse.json({ error: "Premium required" }, { status: 402 });
  }

  const patient = await prisma.patient.findFirst({
    where: { accountId: account.id }, include: PATIENT_FOOD_MAP_INCLUDE });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const foodMapText = buildFoodMapText(patient);
  const bannedTerms = collectBannedTerms(patient);                       // F-D7
  const maxRecipes = 3;                                                   // F-D4

  const content: Anthropic.MessageParam["content"] = [];
  if (imageUrl) {
    // F-D10: validate scheme=https + host∈allowlist (else 400); fetch with Content-Type∈{jpeg,png,webp,gif}
    // and ≤5MB guard; base64; push { type:"image", source:{type:"base64", media_type, data} }.
    // Any fetch/validation failure → drop the image, proceed chips-only. (Route-level, untested by convention.)
  }
  content.push({ type: "text", text: buildFridgePrompt(ingredients, mealType) });

  let msg: Anthropic.Message;
  try {
    msg = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 2048,
      thinking: { type: "disabled" },                                    // latency, same as dish-checker C6
      system: FRIDGE_SYSTEM_PROMPT(foodMapText, maxRecipes),
      tools: [{ name: "suggest_recipes", description: "Return recipe suggestions.", input_schema: SUGGEST_RECIPES_SCHEMA }],
      tool_choice: { type: "tool", name: "suggest_recipes" },            // F-D3
      messages: [{ role: "user", content }],
    });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      if (err.status === 429) return NextResponse.json({ error: "Clara is busy, try again in a moment" }, { status: 429 });
      if (err.status === 529) return NextResponse.json({ error: "Clara is busy, try again in a moment" }, { status: 503 });
    }
    return NextResponse.json({ error: "Clara is unavailable right now" }, { status: 500 });
  }

  const toolBlock = msg.content.find((b) => b.type === "tool_use");
  const parsed = toolBlock ? parseFridgeRecipes((toolBlock as any).input?.recipes, maxRecipes) : null;
  if (parsed === null) return NextResponse.json({ error: "Clara couldn't read that. Try again." }, { status: 502 });
  const recipes = applyAllergenFilter(parsed, bannedTerms);              // F-D7 hard drop
  return NextResponse.json({ recipes });                                 // 200, possibly { recipes: [] }
}
```
`FRIDGE_SYSTEM_PROMPT` instructs: generate up to `maxRecipes` recipes usable from the supplied ingredients plus common pantry staples, but **every ingredient the recipe assumes — including any staple (oil, butter, flour, soy sauce, salt) — MUST be listed in `usesIngredients` or `missingIngredients`; assume nothing off-list** (F-D7); **strictly forbid** anything in the patient's allergies / restricted-from-allergies / foods-to-avoid / banned-ingredient lists (from `foodMapText`); bias toward preferences and the patient's goal/pattern; compute plausible `perServing` macros (calories ≈ 4·protein + 4·carbs + 9·fat); set `fitsPlan`/`conflicts`; call `suggest_recipes` with valid JSON only; `steps` as plain sentences. (Confirm the exact names/signatures of `getOrCreateAccount`/`hasActivePremium` against `app/api/meal-log/route.ts` before importing.)

- [ ] **Step 5: (F-D5/F-D10, additive) image content block** — implement the `if (imageUrl)` branch per F-D10: reject non-`https` or non-allowlisted host with `400`; fetch bytes, validate `Content-Type` ∈ {jpeg,png,webp,gif} and size ≤5 MB, base64-encode, push an Anthropic `image` content block so the model reads fridge contents and unions them with the typed chips. On any failure, drop the image and proceed chips-only. Depends on Phase-3 producing `imageUrl` via the existing `POST /api/upload`; the chips-only path skips this entirely and is fully functional without it.

- [ ] **Step 6: Full web suite + typecheck + commit**

```bash
npm test            # food-map (incl. collectBannedTerms), fridge (incl. applyAllergenFilter/empty-vs-null/plausibility),
                    # meal-log (incl. new FRIDGE branch), existing dish-checker/chat-history all PASS
npx tsc --noEmit    # clean (exported bounds + new route + lib typecheck)
git add lib/food-map.ts lib/food-map.test.ts lib/fridge.ts lib/fridge.test.ts \
        lib/meal-log.ts lib/meal-log.test.ts app/api/fridge/route.ts app/api/dish-checker/route.ts
git commit -m "feat(api): POST /api/fridge (tool-use recipe gen, deterministic allergen filter, macro-plausibility, server daily backstop) + shared lib/food-map extraction + export meal-log bounds"
```

---

### Task 2: iOS — Fridge + meal-log DTOs and services (unit-tested behind seams)

**Repo:** `/Users/becks/Desktop/NewView/Clara` — depends Task 1 (endpoint contract) **and the Phase-2 precondition**. Pure/DTO/service task; **no SwiftUI, no design-skill invocation required.** All remaining iOS tasks branch from here.

**Files:**
- Create: `Clara/Features/Fridge/FridgeModels.swift` (`FridgeRequestDTO`, `FridgeMacrosDTO`, `FridgeRecipeDTO`, `FridgeResponseDTO`)
- Create: `Clara/Features/Fridge/FridgeService.swift`
- Create **(only if Phase 3 has not landed — see Global Constraints):** `Clara/Features/MealLog/MealLogWriteDTO.swift` (`MealLogWriteDTO`, `MacroSnapshotDTO`, `DailyTargetDTO`, `RemainingDTO`, `MealLogRowDTO`, `LogResponseDTO`), `Clara/Features/MealLog/AddToLogService.swift`
- Create tests: `ClaraTests/Fridge/FridgeDTODecodingTests.swift`, `ClaraTests/Fridge/FridgeRequestEncodingTests.swift`, `ClaraTests/Fridge/FridgeServiceTests.swift`
- Create fixtures: `ClaraTests/Fixtures/fridge_three_recipes.json`, `fridge_recipe_conflicts.json`, `fridge_empty.json`, `meal_log_envelope.json` (a **real `getDayEnvelope` payload** where `dayTarget` has NO `fiber`/`incomplete` and `remaining` has NO `fiber`)

**Interfaces:**
- Produces (`FridgeModels.swift`):
```swift
struct FridgeRequestDTO: Encodable {
    let ingredients: [String]
    var mealType: String? = nil
    var imageUrl: String? = nil          // nil → key omitted (chips-only); present only behind Phase-3 capture
}
struct FridgeMacrosDTO: Codable, Hashable {
    let calories: Double; let protein: Double; let carbs: Double; let fat: Double; let fiber: Double
}
struct FridgeRecipeDTO: Codable, Hashable, Identifiable {   // Hashable+Identifiable → NavigationStack value route
    let id: String                        // "frg_…" opaque; becomes fridgeRecipeId on log
    let name: String
    let description: String
    let emoji: String?
    let usesIngredients: [String]
    let missingIngredients: [String]
    let steps: [String]
    let mealType: String
    let servings: Double
    let perServing: FridgeMacrosDTO
    let fitsPlan: Bool
    let conflicts: [String]
}
struct FridgeResponseDTO: Decodable { let recipes: [FridgeRecipeDTO] }   // recipes may be [] (valid empty)
```
- Produces (`FridgeService.swift`): `struct FridgeService { let api: WondishAPIClient; func suggest(_ req: FridgeRequestDTO) async throws -> [FridgeRecipeDTO] }` → `api.send(APIRequest(path:"/api/fridge", method:.post, body: req), as: FridgeResponseDTO.self).recipes`.
- Produces (log-write, Phase-3's DTOs; Phase 4 owns them only if Phase 3 hasn't landed). **Envelope decode is split by real server shape** — `dayTarget`/`remaining` have NO `fiber` and NO `incomplete`; only `dayTotals` does. A single fiber-bearing DTO for all three throws `keyNotFound(fiber)` on every real successful log:
```swift
struct MealLogWriteDTO: Encodable {
    let localDate: String                 // client LOCAL yyyy-MM-dd — NEVER server-defaulted
    let mealType: String
    let source: String                    // "FRIDGE"
    let name: String
    let servings: Double
    let perServing: FridgeMacrosDTO
    let fridgeRecipeId: String?           // the FridgeRecipeDTO.id
    let clientRequestId: String           // fresh UUID().uuidString.lowercased()
}
struct MacroSnapshotDTO: Decodable {      // dayTotals shape only
    let calories, protein, carbs, fat, fiber: Double
    let incomplete: Bool?
}
struct DailyTargetDTO: Decodable {        // dayTarget shape — NO fiber, NO incomplete
    let calories, protein, carbs, fat: Double
    let profile: String?; let basis: String?
}
struct RemainingDTO: Decodable {          // remaining shape — NO fiber, NO incomplete
    let calories, protein, carbs, fat: Double
}
struct MealLogRowDTO: Decodable { let id, name: String; let servings: Double; let fridgeRecipeId, clientRequestId: String? }
struct LogResponseDTO: Decodable {        // decodes { log, dayTotals, dayTarget, remaining }
    let log: MealLogRowDTO
    let dayTotals: MacroSnapshotDTO
    let dayTarget: DailyTargetDTO?        // null when patient has no active plan target
    let remaining: RemainingDTO?          // null when no target
}
struct AddToLogService { let api: WondishAPIClient
    func log(_ w: MealLogWriteDTO) async throws -> LogResponseDTO {
        // POST /api/meal-log returns 201 on first write, 200 on idempotent replay — both are success.
        // DEPENDENCY: confirm the reused Phase-2 WondishAPIClient treats 201 (not only 200) as success.
        try await api.send(APIRequest(path:"/api/meal-log", method:.post, body: w), as: LogResponseDTO.self) } }
```

- [ ] **Step 0: Cut the branch from the Phase-2 tip + pin `UsageMeter` + reconcile the log-write DTOs**

```bash
cd /Users/becks/Desktop/NewView/Clara
git checkout <merged-phase2-tip>          # the commit where Phase 2 merged into main — NOT the Phase-1 main tip
git checkout -b phase4-fridge             # record the base commit hash in the commit body
```
Re-run the **Preconditions grep**; if the Phase-2 primitives are absent, STOP. Then:
- **Pin `UsageMeter`:** read the shipped `UsageMeter.swift`/`FreemiumLimits.swift` and record the exact metering API the gate will call — `count(for:)`, `increment(for:)`, and the feature-key enum + `.fridge` case. If they do not exist, adding them is a **declared third Phase-2 edit** (note it here and in Task 4).
- **Reconcile log-write DTOs:** `grep -rn 'MealLogWriteDTO\|AddToLogService\|LogResponseDTO\|DailyTargetDTO\|RemainingDTO' Clara ClaraTests` — if Phase 3 already shipped them, **import Phase-3's and do NOT create the `Clara/Features/MealLog/` copies** (skip those files below); if absent, Phase 4 owns them.

- [ ] **Step 1: Add fixtures + write failing decode/encode tests**

`FridgeDTODecodingTests` (against a `JSONDecoder` configured identically to `WondishAPIClient` — `.iso8601`): `test_decodesFridgeResponse_threeRecipes` (asserts `recipes[0].id == "frg_a1b2c3"`, `perServing.calories == 420`, `usesIngredients.count == 5`); `test_decodesEmptyRecipes` (`{ "recipes": [] }` → empty array, no throw — the valid-empty case); `test_decodesRecipe_emptyMissingIngredients`; `test_decodesRecipe_fitsPlanFalse_withConflicts`; `test_fridgeRecipe_isHashableIdentifiable` (two decodes → equal `id`/`hashValue`, required for `navigationDestination(for:)`); **`test_decodesLogEnvelope_dayTargetHasNoFiber`** (feeds the real `meal_log_envelope.json` where `dayTarget` lacks `fiber`/`incomplete` and `remaining` lacks `fiber` → decodes cleanly via `DailyTargetDTO`/`RemainingDTO`; a single fiber-bearing DTO would throw here); `test_decodesLogEnvelope_nullTargetAndRemaining` (both null-tolerant); `test_decodeFailsGracefully_missingPerServing` (throws `DecodingError` → surfaced as `.decoding`).
`FridgeRequestEncodingTests`: `test_encodesFridgeRequest_chipsOnly` (nil `imageUrl` key omitted); `test_encodesFridgeRequest_withImageUrl`; `test_encodesMealLogWrite_fridgeSource` (`source:"FRIDGE"`, client-local `localDate`, required `name`, `perServing`, `fridgeRecipeId`, fresh `clientRequestId`, **no computed macro totals in body**); `test_mealLogWrite_localDateUsesClientTimeZone` (inject a fixed `Calendar`/`TimeZone`; assert `localDate` derives from device-local midnight, not UTC).
Run → compile **FAILURE**. Implement `FridgeModels.swift` (+ the MealLog DTOs if owned). Run → **PASS**.

- [ ] **Step 2: Write failing `FridgeServiceTests` over `StubURLProtocol`, implement the services**

`FridgeServiceTests` (a `WondishAPIClient` backed by `URLSessionConfiguration.ephemeral` + `StubURLProtocol` + `StubTokenProvider`): `test_generate_success_returnsRecipes` (200 + fixture → `[FridgeRecipeDTO]`); `test_generate_emptyRecipes_returnsEmpty` (200 + `fridge_empty.json` → `[]`, no error); `test_generate_402_mapsToPremiumRequired`; `test_generate_404_mapsToProfileNotFound` (`{"error":"Profile not found"}`); `test_generate_429_mapsToRateLimited` (`retryAfter` parsed); `test_generate_502_mapsToServer` (`.server(status:502)`); `test_generate_offline_mapsToOffline` (`URLError(.notConnectedToInternet)`); `test_log_created_201_treatedAsSuccess` (**stub 201** → envelope decoded, no error — confirms the reused client treats 201 as success); `test_log_success_200_returnsEnvelope` (replay path); `test_log_replayIdempotent` (same `clientRequestId` twice; 201 then 200 → surfaces the row, no duplicate assumption); `test_generate_sendsBearerAndSinglePath` (asserts `Authorization` header present, path `/api/fridge`, method POST). Run → compile **FAILURE**. Implement `FridgeService` (+ `AddToLogService` if owned) — both are thin over the Phase-2 actor, inheriting Bearer injection + bounded 401 re-mint + `APIError` mapping. Run → **PASS**.

- [ ] **Step 3: Regenerate, test, commit**

```bash
cd /Users/becks/Desktop/NewView/Clara && xcodegen generate
xcodebuild -project Clara.xcodeproj -scheme Clara -destination 'platform=iOS Simulator,name=<FIRST_AVAILABLE_IPHONE>' test
git add -A && git commit -m "feat(fridge): Fridge + meal-log write DTOs (envelope split by real server shape) and services over WondishAPIClient (unit-tested; 201-success, valid-empty)"
```
Expected: `TEST SUCCEEDED`.

---

### Task 3: iOS — `FlowLayout` + `IngredientChipsField` + `IngredientInputModel`

**Repo:** `/Users/becks/Desktop/NewView/Clara` — depends Task 2. **Frontend task — Step 1 invokes `ui-ux-pro-max` + `mobile-ios-design`.**

**Files:**
- Create: `Clara/DesignSystem/FlowLayout.swift` (`FlowLayout: Layout`)
- Create: `Clara/DesignSystem/BackspaceTextField.swift` (thin `UIViewRepresentable` over `UITextField`)
- Create: `Clara/Features/Fridge/IngredientInputModel.swift` (`@Observable`, no UI)
- Create: `Clara/Features/Fridge/IngredientChipsField.swift`
- Create test: `ClaraTests/Fridge/IngredientInputModelTests.swift`

**Interfaces:**
- Produces: `FlowLayout: Layout` (iOS-16+, ~40 lines, **zero new SPM deps**) implementing `sizeThatFits(proposal:subviews:cache:)` + `placeSubviews(in:proposal:subviews:cache:)`; wraps to a new row when the next subview would exceed the proposed width; `spacing` init param. Reused for chip input **and** the static ingredient wraps in the detail view.
- Produces: `BackspaceTextField` — a minimal `UIViewRepresentable` wrapping a `UITextField` subclass that overrides `deleteBackward()` to fire an `onBackspaceWhenEmpty` closure when the field is empty. **Rationale (F-D-note):** empty-backspace deletion is **not** achievable with a plain SwiftUI `TextField` + `.onChange(of:draft)` — when `draft` is already empty, backspace does not mutate the bound string, so `.onChange` never fires and `removeLast()` never runs. `IngredientChipsField` therefore cannot be a pure `TextField`; it uses `BackspaceTextField` for the inline input. (Model's `removeLast()` stays pure and unit-tested regardless.)
- Produces: `@Observable final class IngredientInputModel` — `var ingredients: [String]`, `var draft: String`; `func commitDraft()` (trim → comma/newline split → case-insensitive dedupe → drop empties → cap at `maxIngredients = 20`), `func remove(_ ingredient: String)`, `func removeLast()` (empty-backspace convention), `var canAddMore: Bool`. **Note the intentional client/server asymmetry:** the client caps at **20** for UI sanity, *within* the server's `MAX_INGREDIENTS = 30` bound and mirroring the server's normalize *semantics* (trim/dedupe/drop-empty). The client is deliberately stricter; it does not claim numeric parity. `canAddMore == false` at 20.
- Produces: `IngredientChipsField` — a `.wCard(padding: WSpacing.md)` wrapping `FlowLayout { ForEach(chips) { chip } ; inputField }`.

- [ ] **Step 1: Invoke the frontend design skills**

`Skill(ui-ux-pro-max:ui-ux-pro-max)` + `Skill(mobile-ios-design)` before any Swift/UI.

- [ ] **Step 2: Write failing `IngredientInputModelTests`, implement the model**

`test_addChip_trimsWhitespace`; `test_addChip_splitsOnCommaAndNewline` (`"garlic, onion\nrice"` → 3 chips); `test_addChip_dedupesCaseInsensitive` (`"Spinach"` then `"spinach"` → 1); `test_addChip_rejectsEmptyAfterTrim`; `test_removeChip_byValue`; `test_removeLast_onEmptyBackspace`; `test_capsAtMaxIngredients` (beyond 20 ignored); `test_canAddMore_falseAtCap`. Run → **FAILURE**. Implement `IngredientInputModel`. Run → **PASS**.

- [ ] **Step 3: Implement `FlowLayout` + `BackspaceTextField` + `IngredientChipsField`**

`FlowLayout` per interface. `BackspaceTextField` per interface (UITextField subclass overriding `deleteBackward()`). `IngredientChipsField`: **Chip** = capsule, `WColor.surfaceSecondary` bg, `WColor.primary` text `WFont.inter(14,.medium)`, trailing `xmark.circle.fill` SF Symbol delete with a **padding-expanded ≥44 pt hit area** and `.accessibilityLabel("Remove \(ingredient)")`. **Input** = inline `BackspaceTextField("Add ingredient…", text: $model.draft, onBackspaceWhenEmpty: { model.removeLast() })` styled to match `WTextField` (h-padding, `WColor.primary` focus ring), commit on return via its delegate → `model.commitDraft()`, plus comma/newline token-split in `.onChange(of: model.draft)` for the multi-paste path. (The ≥44 pt `xmark` remains the primary delete affordance; backspace-delete is the secondary convenience the representable enables.)

- [ ] **Step 4: Regenerate, test, commit**

```bash
cd /Users/becks/Desktop/NewView/Clara && xcodegen generate
xcodebuild -project Clara.xcodeproj -scheme Clara -destination 'platform=iOS Simulator,name=<FIRST_AVAILABLE_IPHONE>' test
git add -A && git commit -m "feat(fridge): FlowLayout wrap engine + BackspaceTextField + IngredientChipsField token input + input model (tested)"
```
Expected: `TEST SUCCEEDED`.

---

### Task 4: iOS — `FridgeViewModel` + `FridgeView` + `FridgeRecipeDetailView` + gating + log action (replaces placeholder)

**Repo:** `/Users/becks/Desktop/NewView/Clara` — depends Tasks 2, 3. **Frontend task — Step 1 invokes `ui-ux-pro-max` + `mobile-ios-design`.**

**Files:**
- Create: `Clara/Features/Fridge/FridgeViewModel.swift` (`@Observable @MainActor`)
- Create: `Clara/Features/Fridge/FridgeView.swift`, `Clara/Features/Fridge/FridgeRecipeRow.swift`, `Clara/Features/Fridge/FridgeRecipeDetailView.swift`
- Modify: `Clara/Features/Paywall/PaywallView.swift` — **the two Phase-2 edits**: add `case fridgeLimit` to `PaywallContext` with one headline/subhead copy pair ("Unlimited fridge recipes with Premium"), **and** add `: Identifiable` conformance to `PaywallContext` (`var id: Self { self }`) so `FridgeView`'s `.sheet(item:)` compiles. (If Phase 2's other paywall presenters used `.sheet(isPresented:)`, the `Identifiable` add is still safe and additive.)
- Modify: `Clara/App/RootTabView.swift` — swap the fridge tab from `FridgePlaceholderView()` to `FridgeView(...)` with injected dependencies. **Preserve `selection: Tab = .scan` as the default; change ONLY the `.fridge` tab body; leave the Scan / Chat / Stats / Account tab bodies untouched** (guards the Phase-2 Task-5 "Scan default + non-account tabs unchanged" commitment).
- Delete: `Clara/Features/Fridge/FridgePlaceholderView.swift`
- Create tests: `ClaraTests/Fridge/FridgeGateTests.swift`, `ClaraTests/Fridge/FridgeViewStateTests.swift`

**Interfaces:**
- Produces: `@Observable @MainActor final class FridgeViewModel` with init-injected deps (not singletons): `apiClient: WondishAPIClient?`, `entitlement: EntitlementStore`, `usage: UsageMeter`, `session: SessionStore`, `fridge: FridgeService`, `logger: AddToLogService`. State:
```swift
enum Screen: Equatable { case input, generating, results, error(APIError) }
var screen: Screen = .input
var input = IngredientInputModel()
var mealTypeHint: String? = nil
var recipes: [FridgeRecipeDTO] = []
var path = NavigationPath()
var paywall: PaywallContext? = nil          // PaywallContext is now Identifiable → .sheet(item:)
var loggingRecipeID: String? = nil
var toast: String? = nil
var pendingImageUrl: String? = nil          // F-D5; nil unless Phase-3 capture set it
var canGenerate: Bool { (!input.ingredients.isEmpty || pendingImageUrl != nil) && screen != .generating }
var remainingFree: Int { max(0, FreemiumLimits.fridgePerDay - usage.count(for: .fridge)) }   // uses the pinned UsageMeter API
var showFreeCounter: Bool { !entitlement.isPremium }
```
`func generate()` — **pre-call soft gate**: `if !entitlement.isPremium && usage.count(for: .fridge) >= FreemiumLimits.fridgePerDay { paywall = .fridgeLimit; return }`; else `screen = .generating`, call `fridge.suggest(...)`, on success set `recipes`, `screen = .results`, and **increment the meter on success only** (`if !entitlement.isPremium { usage.increment(for: .fridge) }`); on `APIError.premiumRequired` (F-D2 server backstop `402`) → `paywall = .fridgeLimit`; other `APIError` → `screen = .error(e)`. An empty `recipes` on success still routes to `.results` (the EmptyResultsCard renders — a real server outcome, not an error).
`func logRecipe(_ recipe:, servings:)` — set `loggingRecipeID`; build `MealLogWriteDTO(localDate: <client-local yyyy-MM-dd>, mealType: recipe.mealType, source:"FRIDGE", name: recipe.name, servings: chosen, perServing: recipe.perServing, fridgeRecipeId: recipe.id, clientRequestId: UUID().uuidString.lowercased())`; on success (201 first / 200 replay, both success) set `toast = "Added to today"`, `path = NavigationPath()` (pop-to-root), **display only the server `remaining`/`dayTotals` echo — no client macro math**; `.profileNotFound` → "Finish setup on the web" alert; `.offline`/`.server` → inline "Couldn't save — try again", keep detail on screen. **Logging is never metered.**
- Produces (pure mapping, `FridgeViewStateTests` surface): `verdict(for: FridgeRecipeDTO) -> Verdict` per **F-D6**.

- [ ] **Step 1: Invoke the frontend design skills**

`Skill(ui-ux-pro-max:ui-ux-pro-max)` + `Skill(mobile-ios-design)` before any Swift/UI.

- [ ] **Step 2: Write failing gate + state tests, implement `FridgeViewModel`**

`FridgeGateTests` (`UsageMeter` on a `UserDefaults(suiteName:)` scratch store + fixed-clock injection; `EntitlementStore` fed a `StubStoreManager` + a `SessionStore` with a synthetic `MeDTO`; `StubURLProtocol` recording call count): `test_freeUser_underLimit_generateAllowed`; `test_freeUser_atLimit_presentsPaywall` (asserts `paywall == .fridgeLimit` **and zero `/api/fridge` requests fired**); `test_premiumUser_atLimit_generateAllowed`; `test_server402_mapsToPaywall` (stub `402` → `paywall == .fridgeLimit`, mirroring the F-D2 backstop); `test_meterIncrementsOnSuccessOnly` (success increments; a 500-stub failure does NOT); `test_meterResetsOnNewDay` (advance clock past midnight → `count(.fridge) == 0`); `test_logAction_notMetered` (logging leaves the fridge meter untouched); `test_emptyRecipes_routesToResultsNotError` (200 empty → `.results`, `recipes.isEmpty`).
`FridgeViewStateTests` (pure): `test_fitsPlanTrue_noConflicts_mapsToFits`; `test_fitsPlanTrue_withConflicts_mapsToCaution`; `test_fitsPlanFalse_mapsToDoesntFit`; `test_missingIngredients_renderAsWBadgeNeutral` (variant `.neutral`/`.warning`, **never `.info`**); `test_reducerStates` (`.input → .generating → .results`; `.generating → .error(APIError)`; Generate disabled while `.generating`).
Run → **FAILURE**. Implement `FridgeViewModel`. Run → **PASS**.

- [ ] **Step 3: Build `FridgeView` + `FridgeRecipeRow` + `FridgeRecipeDetailView`**

`FridgeView`: `NavigationStack(path: $vm.path)` → `ScrollView { VStack(spacing: WSpacing.xl) { HeaderBlock ("What can I make?" `WFont.inter(22,.extrabold)` + `textSecondary` subtitle); IngredientChipsField(model: vm.input); optional MealTypeHintPicker (`.primary`-styled selectable capsules); FreeCounterRow (`WBadge(text:"\(vm.remainingFree) free left today", variant:.primary)` when `showFreeCounter`); Generate `Button` `WButtonStyle(variant:.primary, size:.lg)` `.disabled(!vm.canGenerate)`; then `switch vm.screen` → `.generating` SkeletonList (3 shimmer `.wCard` rows + "Clara's checking your fridge…"), `.results` ResultsSection **or** EmptyResultsCard ("No recipes from those ingredients — try adding a protein or a staple." + secondary "Edit ingredients") **when `recipes.isEmpty`** (a real 200-empty outcome, reachable now), `.error(e)` RetryCard (icon per kind via `userMessage(for:)` + "Try again" `WButtonStyle(.secondary)`, chips preserved; `.profileNotFound` → "Finish setup on the web" card, no retry), `.input` EmptyHero (`refrigerator` SF Symbol 48pt `WColor.primary`) when ingredients empty } }.padding(WSpacing.lg) }.background(WColor.background).navigationTitle("Fridge")` (inline) `.navigationDestination(for: FridgeRecipeDTO.self) { FridgeRecipeDetailView(recipe:$0, vm:vm) }` `.sheet(item: $vm.paywall) { PaywallView(context:$0) }` `.overlay(alignment:.bottom) { ToastView(vm.toast) }` (paywall/toast attached at root so they survive pushes).
`FridgeRecipeRow` (wrapped in `NavigationLink(value: recipe)`): `.wCard(padding: WSpacing.lg)` HStack — `Text(recipe.emoji ?? "🍽")`; VStack name `inter(16,.bold)` / description `inter(13) textSecondary lineLimit(2)` / a macro-pill row (`\(cal) kcal`, `P \(protein)g` in `WColor.surfaceSecondary` capsules) + `WBadge(text: recipe.mealType.capitalized, variant:.primary)` + compact `VerdictBadge(verdict:)`; "Needs: …" `inter(12) textTertiary` when `missingIngredients` nonempty; trailing `chevron.right`.
`FridgeRecipeDetailView`: `ScrollView { VStack(alignment:.leading, spacing: WSpacing.xl) { emoji+name `inter(24,.extrabold)`; `VerdictBadge(verdict:)`; ConflictCard (`.wCard`, `WColor.error` icon + bulleted `conflicts`) when nonempty; MacroGrid `.wCard` 2×3 `MacroStat` per-serving (server values only) **with an "Estimated" caption (F-D8)**; UsedIngredientsWrap (`FlowLayout` static `surfaceSecondary` chips); MissingIngredientsWrap (`WBadge(.neutral)`/warning-tinted) when nonempty; StepsList (numbered, numeral in a `WColor.primary` circle); optional servings stepper 1–8 (a UI default range) } }.safeAreaInset(edge:.bottom) { Log-it `Button` (`ProgressView` when `vm.loggingRecipeID == recipe.id`, else "Log it to today"; **"Log anyway"** when verdict `.doesntFit`) `WButtonStyle(.primary, .lg)` `.padding(WSpacing.lg).background(.ultraThinMaterial)` } .background(WColor.background)`. On tap → `vm.logRecipe(recipe, servings:)`.

- [ ] **Step 4: Apply the two `PaywallContext` edits, wire `RootTabView`, add the Phase-3-gated photo button, delete the placeholder**

Add `case fridgeLimit` + copy AND `Identifiable` conformance to `PaywallContext`. In `RootTabView`, replace **only** the `.fridge` tab body with `FridgeView(...)` constructing `FridgeViewModel` from the injected `WondishAPIClient`/`EntitlementStore`/`UsageMeter`/`SessionStore`; **keep `selection: Tab = .scan` and the Scan/Chat/Stats/Account bodies unchanged.** **F-D5 additive:** only if the Phase-3 `PhotoCaptureView` module exists, add a `secondary` "Snap your fridge" button (`camera` SF Symbol) beside the chip field that presents Phase-3's capture UI, uploads via the shipped `POST /api/upload` → `{url}`, and sets `vm.pendingImageUrl`; if Phase 3 hasn't landed, omit the button entirely (chips-only ships). Delete `FridgePlaceholderView.swift`.

- [ ] **Step 5: Regenerate, test, commit**

```bash
cd /Users/becks/Desktop/NewView/Clara && xcodegen generate
xcodebuild -project Clara.xcodeproj -scheme Clara -destination 'platform=iOS Simulator,name=<FIRST_AVAILABLE_IPHONE>' test
git add -A && git commit -m "feat(fridge): FridgeView list→detail, client-meter+server-402 paywall gate, valid-empty results, one-tap FRIDGE log, replaces placeholder"
```
Expected: `TEST SUCCEEDED`.

---

### Task 5: VERIFY — build + both suites + funnel screenshots + zero-migration confirm

**Repo:** both — depends all. Uses `using-xcode-cli` for every simulator step. Fridge states are driven behind a `#if DEBUG -UITestFixture` launch arg (the Phase-2 harness over `StubURLProtocol`) that injects canned `FridgeResponseDTO`/`LogResponseDTO` and forces each screen state. **This task only runs and asserts — it authors no production tests** (the FRIDGE meal-log branch and all fridge coverage are Task-1/Task-2/Task-4 deliverables).

- [ ] **Step 1: Regenerate + build (iOS) + web typecheck + migration confirm**

```bash
cd /Users/becks/Desktop/NewView/Clara && xcodegen generate
DEV=$(xcrun simctl list devices available | grep -m1 -o 'iPhone [0-9][^(]*' | xargs)
xcodebuild -project Clara.xcodeproj -scheme Clara -destination "platform=iOS Simulator,name=$DEV" build
cd /Users/becks/Desktop/NewView/wondish_02 && npx tsc --noEmit
npx prisma validate && npx prisma migrate status   # Phase 4 ships ZERO migrations
```
Expected: `BUILD SUCCEEDED` + clean typecheck + no pending Prisma diff.

- [ ] **Step 2: Unit tests (both suites)**

```bash
xcodebuild -project Clara.xcodeproj -scheme Clara -destination "platform=iOS Simulator,name=$DEV" test
cd /Users/becks/Desktop/NewView/wondish_02 && npm test
```
Expected: `TEST SUCCEEDED` / node `pass N  fail 0`. Confirm the web suite includes `lib/food-map.test.ts` (incl. `collectBannedTerms`), `lib/fridge.test.ts` (incl. `applyAllergenFilter`, empty-vs-null, plausibility), and the FRIDGE branch in `lib/meal-log.test.ts` — all authored in Task 1 (assert green; do not add here).

- [ ] **Step 3: Boot + install + screenshot the ten states**

```bash
xcrun simctl boot "$DEV"; xcrun simctl bootstatus "$DEV" -b
xcrun simctl install "$DEV" <path-to-Clara.app>
for FIX in fridgeEmpty fridgeChips fridgeGenerating fridgeResults fridgeEmptyResults fridgeDetail fridgeLogged fridgePaywall fridgeError fridgeNoProfile; do
  xcrun simctl launch --terminate-running-process "$DEV" io.wondish.clara -UITestFixture $FIX
  xcrun simctl io "$DEV" screenshot <scratchpad>/$FIX.png
done
```
Ten states: (1) empty (chip input, Generate disabled), (2) chips entered (FlowLayout wrapping ≥2 rows + delete affordance), (3) generating (skeleton + spinner), (4) results (3 `.wCard` rows with `VerdictBadge` + macro pills), (5) **valid-empty results** (200 `recipes:[]` → EmptyResultsCard, NOT an error), (6) recipe detail (steps, per-serving "Estimated" macros, verdict, Log-it CTA), (7) post-log success (server day-envelope echo / toast, pop-to-root), (8) paywall at limit (`PaywallView(.fridgeLimit)` for a free user's 2nd generate / server `402`), (9) error (inline retry card for `.offline`/`.server`/`.rateLimited`, chips preserved), (10) `.profileNotFound` prompt.

- [ ] **Step 4: Accessibility pass**

Screenshot at Dynamic Type XXL; verify ≥44 pt tap targets on chip delete, Generate, Log it, and the servings stepper; confirm VoiceOver labels on chips (`"Remove …"`) and macro pills grouped via `.accessibilityElement(children:.combine)`.

**Pass criteria:** `BUILD SUCCEEDED` + both suites green + zero Prisma migration diff + ten screenshots proving every state (including valid-empty). Visually confirm maroon `#812549`, cream `#F9F7ED`, Inter, light-only, `WBadge(.info)` never used for discrimination, "Estimated" macro disclosure present, ≥44 pt targets.

- [ ] **Step 5: Commit the VERIFY report**

```bash
cd /Users/becks/Desktop/NewView/Clara && git commit --allow-empty -m "chore(verify): phase 4 build + both suites + fridge funnel screenshots + zero-migration confirm"
```

---

## Out of scope for Phase 4 (deliberately)

- **Persisting generated recipes / "re-open a past fridge recipe."** `/api/fridge` is stateless; `fridgeRecipeId` is a provenance-only opaque token that reaches the DB only on log and is never read back for math. A browsable history of past generations would require a new persisted Prisma model — deferred.
- **The `MealLogWriteDTO`/`AddToLogService` ownership.** These belong to Phase 3 (Picture also logs); Phase 4 owns them only as a fallback if Phase 3 hasn't landed, and hands them back when it does.
- **Photo/vision input as a shipped default (F-D5).** Chips-only ships; the "Snap your fridge" path is additive behind Phase-3's `PhotoCaptureView` + the existing `POST /api/upload`. Camera permission strings / `NSCameraUsageDescription` are owned by Phase 3.
- **Editing a logged fridge meal, offline log queue, delta sync / tombstones.** The one-tap FRIDGE log is a single online `POST /api/meal-log`; the offline-queue + `updatedSince` delta sync is Phase 6 (macro-tracking plan).
- **Grocery-list integration** ("add missing ingredients to my list") — a natural follow-on using the existing `grocery-list` route; deferred.
- **Standardizing the backend gate on `402` vs `403`** — the client maps both to `.premiumRequired` (Phase-2 D5); no change here.
- **Per-field macro provenance / an `incomplete` flag for FRIDGE.** Per F-D8, FRIDGE macros are disclosed wholesale as estimates and always treated complete; distinguishing a guessed `0 g fiber` from a known one is not attempted.
- **Nutrition-database reconciliation of AI macros.** F-D8 clamps for gross implausibility and discloses "estimated"; it does not verify macros against a food database — deferred.

## Verification

- **iOS unit tests (XCTest, `@testable import Clara`, auto-picked under `ClaraTests/`; every unit isolates pure logic behind a `TokenProviding`/`URLProtocol` seam — no live Clerk/StoreKit/Anthropic/backend):** `FridgeDTODecodingTests` (incl. valid-empty decode, and the **split-envelope decode where `dayTarget`/`remaining` lack `fiber`/`incomplete`**), `FridgeRequestEncodingTests`, `FridgeServiceTests` (200/empty/402/404/429/502/offline mapping, **201-treated-as-success**, Bearer header + single POST path, idempotent replay) (T2); `IngredientInputModelTests` (trim/split/dedupe/cap-at-20/backspace) (T3); `FridgeGateTests` (under-limit allow, at-limit paywall with **zero network calls**, premium bypass, **server-402→paywall**, increment-on-success-only, new-day reset, log-not-metered, empty→results), `FridgeViewStateTests` (verdict mapping F-D6, missing-ingredient badge never `.info`, reducer state machine) (T4).
- **Web unit tests (`node:test`, `lib/*.test.ts` glob, routes stay thin/untested per convention):** `lib/food-map.test.ts` (extraction parity — all six constraint lines, empty→default string, banned ingredients surfaced, **`collectBannedTerms` union**), `lib/fridge.test.ts` (`normalizeIngredients` dedupe/cap-30/stable-order; `parseFridgeRecipes` **`null` only for non-array**, **valid-empty→`[]`**, clamps macros+servings, **F-D8 plausibility normalization**, `maxRecipes` clamped `[1,5]` then truncated, coerces empties, mints `frg_` ids; **`applyAllergenFilter` drops banned-term recipes**; `buildFridgePrompt` + `FRIDGE_SYSTEM_PROMPT` inject ingredients, meal-type hint, dietary-constraint block, and no-unlisted-staples rule), plus regression that the extraction left `dish-checker`/`chat-history` tests green, and that `lib/meal-log.test.ts` covers the FRIDGE `CALLER_SUPPLIED_SOURCES` + `fridgeRecipeId` branch and still passes after `MAX_MACRO`/`MAX_SERVINGS` are exported. Run: `npm test`.
- **Build + typecheck:** `xcodegen generate` → `xcodebuild … build` → `BUILD SUCCEEDED`; web `npx tsc --noEmit` clean; `npx prisma validate && npx prisma migrate status` confirms **zero migrations**.
- **Simulator screenshots (via `using-xcode-cli`, `#if DEBUG -UITestFixture`):** ten states — empty, chips (FlowLayout wrap + delete), generating, results (`.wCard` rows + `VerdictBadge`), **valid-empty results (EmptyResultsCard, not error)**, recipe detail (steps + per-serving "Estimated" macros + verdict + Log-it), post-log success (server day-envelope echo + pop-to-root), paywall at limit (`PaywallView(.fridgeLimit)`), inline error retry, `.profileNotFound` prompt. Confirm brand tokens, Inter, light-only, `WBadge(.info)` never used for discrimination, ≥44 pt targets, Dynamic Type XXL.