# Clara iOS Phase 3 — Scan / Picture Mode

> **Intended path:** `/Users/becks/Desktop/NewView/wondish_02/docs/superpowers/plans/2026-07-20-ios-phase3-scan-picture-mode.md`
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Every task that creates or edits SwiftUI MUST invoke the `ui-ux-pro-max:ui-ux-pro-max` skill AND the `mobile-ios-design` skill before writing any Swift — this is a non-negotiable global user rule for all frontend work; it is restated in Step 1 of each iOS task, including the pure-logic ones (they feed the design surface).**

**Goal:** Build the **Scan** tab (Picture Mode) — Clara's DEFAULT tab, zero taps from launch. The user captures (camera) or picks (photo library) a photo of a dish; the app downscales/orientation-bakes/JPEG-encodes it, sends it to a **NEW** web vision endpoint (`POST /api/picture`, Anthropic image analysis against the patient's dietary profile), and renders the returned verdict with the existing `VerdictBadge`, an estimated per-serving macro snapshot, a persistent safety caveat, and a one-tap **Log this** that writes to the **existing** `POST /api/meal-log` (`source=PICTURE`, carrying the opaque `pictureResultId` and the model's `perServing`). Scan is a **free** feature capped at **3/day** on-device via the Phase-2 `UsageMeter`; beyond the cap Clara presents the Phase-2 `PaywallView(context: .scanLimit)`. Replaces `ScanPlaceholderView` wholesale while leaving `RootTabView`'s tab structure and default `.scan` selection intact.

**Architecture:** The new endpoint follows repo conventions exactly — `auth()` → JSON 401, `rateLimit("picture", …)` for abuse control **plus a server-side hard daily backstop `rateLimit("picture-daily", …)`** (cost ceiling, P13; the 3/day UX cap remains client-side per Phase-2 D15), `account.findUnique({clerkId})`/`patient.findFirst({accountId})` **mirroring `dish-checker/route.ts` exactly** (a null patient is NOT a 404 — the shared food-map builder returns a no-restrictions sentence), and Anthropic `claude-sonnet-5` **vision** with the analysis constrained by **structured outputs** (`anthropic.messages.parse` + `output_config.format` json_schema; `parsed_output` is read, with a text-block JSON fallback). All non-SDK logic is pure and lives in `lib/picture.ts` (request validation, structured-output parsing, verdict mapping, safety-posture downgrade, prompt builder) plus a shared `lib/patient-context.ts` (the dietary "food map" builder **and the exported Prisma `include` it depends on**, extracted **verbatim** from `dish-checker/route.ts` and reused by both routes), each covered by `node --test`. The endpoint is **stateless** — `pictureResultId` is a fresh `crypto.randomUUID()`; no new Prisma model, no migration. On iOS, the Scan feature is a thin stack over the Phase-2 primitives: a pure `ImageEncoder` (orientation-baked downscale + JPEG + base64 via `UIGraphicsImageRenderer`) with **no `WondishAPIClient` change** (the image ships as base64 in a JSON body, so the Phase-2 Bearer-inject + one-shot-401-re-mint path is reused unmodified), a `PictureService` and a new `AddToLogService` over the `\.apiClient` actor, an `@Observable @MainActor ScanViewModel` state machine that meters free usage via `UsageMeter` and reads premium truth via `EntitlementStore`, and SwiftUI capture (`PhotosPicker` for the library, a `UIViewControllerRepresentable` `UIImagePickerController` for the camera) + result screens rebuilt with the ported design system. Camera capture requires an `NSCameraUsageDescription` Info.plist string; the SwiftUI `PhotosPicker` runs out-of-process and needs **no** photo-library usage string. iOS logic is covered by `ClaraTests` behind `URLProtocol`/service seams; web logic is covered by `node --test` under `lib/*.test.ts`.

**Tech Stack:** Swift 5.9+ / SwiftUI, iOS 17.0 target, XcodeGen, XCTest, PhotosUI (`PhotosPicker`), AVFoundation (camera permission), UIKit (`UIImagePickerController` bridge, `UIGraphicsImageRenderer`); web side: Next.js 14, TypeScript, Prisma/Postgres, Clerk v7 (`@clerk/nextjs ^7`), Anthropic SDK 0.96.0 (vision + structured outputs via `messages.parse`), `node --test`.

## Global Constraints

- iOS app location: `/Users/becks/Desktop/NewView/Clara` — its own git repository, separate from the web repo. Work on branch `phase3-scan-picture` (from the Phase-2 tip). App/bundle id: `io.wondish.clara`.
- Web repo: `/Users/becks/Desktop/NewView/wondish_02`, on branch `clara-ios-phase3-backend` (branched from `main` after the Phase-2 backend branch lands; the endpoint is independent of Phase-2 server surface but reuses `lib/auth.ts` helpers).
- Swift + SwiftUI only; UIKit bridging allowed **only** where SwiftUI has no equivalent (camera capture, `UIGraphicsImageRenderer` downscale). iPhone-only (`TARGETED_DEVICE_FAMILY = 1`), portrait only.
- **Reuse the Phase-2 foundation, do not re-plan it:** gate premium via `EntitlementStore.isPremium`, meter free usage via `UsageMeter`, present `PaywallView` on limit, all networking through the `\.apiClient` `WondishAPIClient` actor (Bearer inject + bounded 401 re-mint + typed `APIError`). Reuse ported design tokens/components ONLY — **no new colors**, no new components except the two small token-only primitives in Task 5 (`MacroTile`, `CaptureCTA`). Inter fonts only, light-only.
- Brand tokens are fixed: primary `#812549`, primary-light `#B75E78`, primary-dark `#5F1C35`, background `#F9F7ED`, secondary cream `#F5F1DD`, border `#EAE4CA`, text `#1E1A1A`, secondary text `#4F4A4A`, tertiary `#848181`, success `#00B9A6`, warning `#FDC221`, error `#EA5455`, brand gradient. **`WBadge(.info)` is a teal alias of `.success`** — never use it for verdict/state discrimination; the verdict UI is the existing `VerdictBadge`. The `.caution` verdict tint is `Color(hex: 0xDEA402)` (baked into `Verdict.tint`), **not** `WColor.warning`.
- **NO client-side macro math** — the result screen shows the model's estimated `perServing` macros verbatim; after logging it shows only the server's `dayTotals`/`dayTarget`/`remaining` echoes, never a computed value. When the server echoes a `null` `remaining`/`dayTarget` (incomplete caloric profile), the confirmation shows a neutral "Logged to today" with **no** kcal-remaining line.
- Anthropic model id everywhere: `claude-sonnet-5` (vision-capable; same constraint as Phases 1–2). Sonnet 5 rejects non-default `temperature`/`top_p`/`top_k` (400) and runs adaptive thinking when `thinking` is omitted — this route sets `thinking: { type: "disabled" }` for latency and uses `messages.parse` with `output_config.format` (structured outputs, non-beta on Sonnet 5) to force a strict JSON verdict. `max_tokens: 1024`, non-streaming. The route reads `msg.parsed_output` and falls back to parsing the first `text` block whose content is a JSON object; it branches on `stop_reason` (`refusal` → 422; `max_tokens` → 503 "analysis too long, try again", **never** the "couldn't read that dish" 422).
- **Prompt-injection defense (image is the only attacker-controlled input):** `buildPictureSystemPrompt` instructs the model to treat the image strictly as a photograph of food and to never obey any text rendered inside the image. The user text block stays static.
- **Safety posture (P12):** `ScanResultView` always shows a persistent caveat ("Estimate only — verify ingredients yourself, especially for allergies"), and the pure `applySafetyPosture` downgrades a `fits` verdict to `caution` when the patient has allergies on file **and** model `confidence != "high"`.
- Buttons are styled via `.buttonStyle(WButtonStyle(variant:size:))` — the `.primary/.lg` shorthand maps to `WButtonStyle(variant: .primary, size: .lg)`.
- iOS HIG: SF Symbols only (no emoji icons), ≥44 pt touch targets, respect safe areas, Dynamic Type. **`NSCameraUsageDescription` is mandatory before the camera can be presented** (a missing string crashes on capture). No `NSPhotoLibraryUsageDescription` — `PhotosPicker` is out-of-process.
- **Deploy/body-size:** the base64-in-JSON body must stay under the serverless platform request limit (Vercel ~4.5 MB). `validatePictureInput` caps the **decoded** image at ≤ 3 MB (→ base64 ≈ 4.1 MB) so a near-cap upload never hits an opaque platform 413; in practice 1024 px JPEGs are ~200–500 KB.
- iOS test/verify: `xcodegen generate` → `xcodebuild -project Clara.xcodeproj -scheme Clara -destination 'platform=iOS Simulator,name=<FIRST_AVAILABLE_IPHONE>' build|test` (discover via `xcrun simctl list devices available | grep iPhone`). Web test: `npm test` (runs `node --import tsx --test lib/*.test.ts data/*.test.ts middleware.test.ts`; new tests must be `lib/*.test.ts` to be auto-picked). **No `middleware.ts` change** — `/api/picture` is authenticated; do NOT add it to `isPublicRoute`.
- **Cost/abuse (P13):** production MUST have Upstash Redis configured for the `picture` limiter — `lib/rate-limit.ts` silently falls back to a per-instance in-memory counter that bounds nothing across serverless instances. Task 1 Step 5 hands off a note to require Redis in prod; the route adds a per-user hard daily cap as a cost backstop distinct from the freemium UX cap.
- **Build-time confirmations (flagged, not guessed — all confined to `PictureService`/`ScanViewModel` glue and the capture layer):** the exact Phase-2 `UsageMeter` per-feature surface (`FreemiumLimits.scanPerDay`, a `.scan` feature case, `remaining(_:)`/`record(_:)`) — **verify present; if the per-feature surface is absent it is net-new code, so Task 5 lists `Modify: UsageMeter.swift` and extends it under test** — the `PaywallContext.scanLimit` case name, the `EntitlementStore` injection key, the `VerdictBadge(verdict:)`/`Verdict.tint == 0xDEA402` surface, and the Anthropic TS SDK `messages.parse`/`output_config.format`/`parsed_output` shape for `claude-sonnet-5` (SDK 0.96.0) — pinned in this plan against the Phase-2 doc + the installed SDK, re-verified against the Phase-2 code and installed SDK at implementation time.
- **Bearer acceptance remains a live dependency** (from Phase 2): the shipped `clerkMiddleware`/`auth()` must validate the iOS session JWT from the `Authorization` header (correct `azp` for `io.wondish.clara`). Task 6 hits **both** `/api/picture` and `/api/meal-log` with a real iOS-minted Bearer and asserts **200/201**, not merely that the JSON-401 branch fires.

---

## Open decisions (need sign-off) — each has a RECOMMENDED default so the plan is actionable now

| # | Decision | RECOMMENDED default (plan is written against this) |
|---|---|---|
| P1 | Image upload transport | **Base64 in a JSON body.** Reuses the Phase-2 `WondishAPIClient` (Bearer inject + bounded 401 re-mint + typed errors) with **zero client change** — no multipart plumbing, no second auth path. Anthropic needs base64 anyway; the ~33% wire overhead on a ~1024 px JPEG (~200–500 KB) is negligible and stays under the platform body limit. (`/api/upload`'s multipart form is a separate web-only flow; not reused.) |
| P2 | Vision model + output contract | **`claude-sonnet-5` + structured outputs via `anthropic.messages.parse`** (`output_config.format` json_schema, read `parsed_output` with text-block fallback), `thinking:{type:"disabled"}`, `max_tokens:1024`, non-streaming. Forces a strict `{ name, verdict, rationale, perServing, assumptions, confidence }` JSON — no free-text parsing fragility; `stop_reason` is branched so truncation isn't misreported as an unreadable image. |
| P3 | Downscale target | **1024 px long edge, JPEG quality 0.7, orientation baked** (drawn through `UIGraphicsImageRenderer` so camera EXIF rotation is applied, not just tagged). Ample for dish/ingredient recognition; keeps payload small. (Sonnet 5 supports up to 2576 px but that ~3×'s image tokens for no accuracy gain here.) |
| P4 | Scan quota (UX) | **Client-only daily cap (Phase-2 D15).** The 3/day free UX cap is `UsageMeter` on-device; premium = unlimited. **No premium gate** on the route — Scan is a free feature; do NOT call `hasActivePremium` in the route. |
| P5 | Persist a `PictureResult` row server-side | **No — stateless.** The endpoint returns a fresh `crypto.randomUUID()` as `pictureResultId`; the `MealLog` row carries the macros directly (`source=PICTURE`, `perServing`, opaque `pictureResultId`). No new Prisma table, no migration. (Server-side retention/audit → new model, out of scope.) |
| P6 | Capture framework | **`PhotosPicker` (SwiftUI, out-of-process) for the library + `UIImagePickerController(.camera)` via `UIViewControllerRepresentable` for the camera.** HIG-correct, least code. Only `NSCameraUsageDescription` required; **no** photo-library string. |
| P7 | Verdict taxonomy | **Reuse the Phase-1 `Verdict` enum** (`fits` / `caution` / `doesntFit` → `VerdictBadge` success / `#DEA402` / error). The model returns exactly one of these three strings; `Verdict(apiValue:)` maps it, unknown → `.doesntFit`. |
| P8 | Meal-type at log time | **Default by time-of-day, user-editable segmented picker** on the result screen (`LocalDate.defaultMealType(hour:)`: 04–10→breakfast, 10–15→lunch, 15–21→dinner, else snack). |
| P9 | Behavior at the daily cap | **Present `PaywallView(context: .scanLimit)`** (premium = unlimited). Free users see the paywall the moment they attempt scan #4 that day; no capture surface presents. |
| P10 | Servings | **Fixed 1 serving for Phase 3.** Picture Mode logs one serving of the recognized dish; a servings stepper is deferred. |
| P11 | Model-macro clamping | **Clamp each estimated macro to `[0, MAX_MACRO]` in `parsePictureAnalysis`,** importing the shared `MAX_MACRO` (exported from `lib/meal-log.ts`). `checkPerServing` 400s any macro `<0` or `>MAX_MACRO`, so a wild vision estimate must be clamped in the picture lib against the **same** constant or the downstream one-tap log write fails. |
| **P12** | **AI verdict safety posture (allergies)** | **Persistent caveat + conditional downgrade.** `ScanResultView` always renders "Estimate only — verify ingredients yourself, especially for allergies." `applySafetyPosture` downgrades `fits`→`caution` when the patient has allergies on file **and** `confidence != "high"`. **Sign-off required on the liability of shipping an AI allergy verdict at all** — this default is the conservative baseline, not a substitute for legal review. |
| **P13** | **Server-side cost ceiling** | **Abuse limiter + hard daily backstop + Redis-in-prod.** Keep `rateLimit("picture", userId, 10, 60)` for burst abuse and add `rateLimit("picture-daily", userId, 25, 86400)` as a per-user cost backstop (distinct from the freemium UX cap; a bypassed on-device cap still can't drive unbounded spend). Production MUST configure Upstash Redis — the in-memory fallback is per-instance and bounds nothing on serverless. **Sign-off required** on the $ exposure and the 25/day number. |
| **P14** | **"Log this" for a profile-less user** | **Analyze for all; log requires a profile.** `/api/picture` tolerates a null patient (a profile-less user can reach a verdict on the default tab), but `POST /api/meal-log` 404s "Profile not found" when `patient` is null. The `.logged` path handles a `404` with a "Finish setting up your profile to log meals" affordance (a distinct `APIError.notFound` branch in `ScanErrorCard`), rather than gating capture. **Sign-off**: block-on-profile vs. this analyze-then-nudge default. |
| **P15** | **Logged macros are AI estimates, no edit step** | **Ship log-as-is for Phase 3.** The model's `perServing` is written to the nutrition diary verbatim (feeds `dayTotals`/`remaining`); no pre-log edit/confirm. A correction/edit step is a later phase. **Sign-off** on logging AI estimates as diary truth. |

---

### Task 1: WEB — `POST /api/picture` (Anthropic vision) + shared `lib/patient-context.ts` + pure `lib/picture.ts`

**Repo:** `/Users/becks/Desktop/NewView/wondish_02` — branch `clara-ios-phase3-backend`. Independent of the iOS tasks; must land before Task 3/Task 5 consume it.

**Files:**
- Create: `lib/patient-context.ts`, `lib/patient-context.test.ts`
- Create: `lib/picture.ts`, `lib/picture.test.ts`
- Create: `app/api/picture/route.ts`
- Modify: `app/api/dish-checker/route.ts` (drop the inline `buildFoodMapText` + inline `include`, import the shared `buildFoodMapText` + `PATIENT_FOOD_MAP_INCLUDE` — pure refactor, no behavior change)
- Modify: `lib/meal-log.ts` (add `export` to the existing `MAX_MACRO` const so `lib/picture.ts` shares one bound; no logic change)
- **No `middleware.ts` change** — `/api/picture` is authenticated; do NOT add it to `isPublicRoute`.

**Interfaces:**
- Produces: `PATIENT_FOOD_MAP_INCLUDE` in `lib/patient-context.ts` — the exact Prisma `include` object from `dish-checker/route.ts` (`mealType`; `foodAllergies.food.bannedIngredients`; `foodPreferences.food.bannedIngredients`; `foodToAvoid.food`; `healthConditions.condition.bannedIngredients`; `motivations.motivation.bannedIngredients`), imported by **both** routes so the shared builder can never drift from the fetched shape.
- Produces: `buildFoodMapText(patient): string` in `lib/patient-context.ts` — the dietary "food map" builder **extracted verbatim** from `dish-checker/route.ts` (meal type, allergies + banned ingredients, foods-to-avoid, preferences, health conditions, motivations; `"No specific dietary restrictions on file."` when patient is null). Pure over the `PATIENT_FOOD_MAP_INCLUDE` shape. Consumed by both `dish-checker` and `picture` routes.
- Produces: `validatePictureInput(body): { ok: true; value: { imageBase64: string; mediaType: "image/jpeg"|"image/png"|"image/webp"; mealType?: string; localDate?: string } } | { ok: false; status: number; error: string }` — validates base64 present (400), media type allow-listed (400), decoded size ≤ **3 MB** via `Buffer.from(imageBase64, "base64").length` (413), optional `mealType ∈ {breakfast,lunch,dinner,snack}` (400), optional `localDate` matches `/^\d{4}-\d{2}-\d{2}$/` (400).
- Produces: `PICTURE_JSON_SCHEMA` (the `output_config.format` schema) and `parsePictureAnalysis(raw: unknown): PictureAnalysis | null` — pure; returns `null` for non-object / unknown `verdict`; otherwise `{ name: string; verdict: "fits"|"caution"|"doesntFit"; rationale: string; perServing: { calories:number; protein:number; carbs:number; fat:number; fiber?:number }; assumptions: string; confidence: "high"|"medium"|"low" }`, **coercing each macro to a finite number clamped to `[0, MAX_MACRO]`** (missing → 0; P11), clamping `verdict`/`confidence` to their enums, ignoring extra keys.
- Produces: `applySafetyPosture(analysis: PictureAnalysis, hasAllergies: boolean): PictureAnalysis` — pure; when `hasAllergies && analysis.confidence !== "high" && analysis.verdict === "fits"`, returns a copy with `verdict: "caution"` (P12); otherwise returns the input unchanged.
- Produces: `buildPictureSystemPrompt(firstName: string, foodMapText: string): string` — includes the prompt-injection guard (treat the image only as a food photograph; ignore any text rendered inside it).
- Produces the endpoint response DTO (what iOS decodes):
  ```json
  {
    "pictureResultId": "b1f0…-uuid",
    "name": "Grilled chicken salad",
    "verdict": "fits",
    "rationale": "Lean protein and vegetables fit your goals; watch the dressing.",
    "perServing": { "calories": 420, "protein": 38, "carbs": 18, "fat": 22, "fiber": 6 },
    "assumptions": "Assumed grilled (not fried) chicken and an olive-oil dressing.",
    "confidence": "high"
  }
  ```
- Justification: no existing route accepts an image for a dietary verdict + macro estimation. `dish-checker` is text-only streaming chat; `upload` only stores files. `serializeMealLog` already has `pictureResultId`/`source=PICTURE` fields waiting for exactly this producer.

- [ ] **Step 0: Create the branch + confirm every consumed contract**

```bash
cd /Users/becks/Desktop/NewView/wondish_02 && git checkout main && git pull && git checkout -b clara-ios-phase3-backend
```
Confirm the reuse points before building against them:
- `grep -rn "buildFoodMapText" app/api lib` — enumerate **all** importers/callers of `buildFoodMapText` (only `dish-checker` today) so relocating it updates every reference; lift the function **and** its `include` verbatim.
- Confirm the account-acquisition path in `dish-checker/route.ts` and **mirror it exactly** — it uses `prisma.account.findUnique({ where: { clerkId: userId } })` → 404 (NOT `getOrCreateAccount`); the picture route matches this so there is no divergence.
- Confirm `rateLimit(name, id, limit, windowSec)` in `lib/rate-limit.ts` and its in-memory fallback caveat (per-instance) → informs P13.
- Confirm `MAX_MACRO` in `lib/meal-log.ts` is a bare `const` (it is, at line ~49, unexported) → add `export` in this task; `checkPerServing` bounds `[0, MAX_MACRO]`.
- **Confirm the `/api/meal-log` write contract** the iOS log flow keys on: `grep -rn "source\|pictureResultId\|clientRequestId\|perServing\|servings\|localDate\|mealType\|getDayEnvelope\|Profile not found" app/api/meal-log/route.ts lib/meal-log.ts`. Record: request-body field names (`source`, `perServing`, `pictureResultId`, `clientRequestId`, `localDate`, `mealType`, `servings`, `name`), that `MealLogSource.PICTURE` is accepted and is a caller-supplied-macro source, the success status (`created ? 201 : 200`), the echo key-set (`{ log, dayTotals, dayTarget, remaining }` from `getDayEnvelope`, with `dayTarget`/`remaining` nullable), and that a null patient → **404 "Profile not found"** (→ P14). Task 2 DTOs are pinned to *this*, not to prose.
- Verify the Anthropic SDK 0.96.0 structured-output surface against the installed typings: `anthropic.messages.parse(...)` exists, populates `parsed_output`, and accepts `output_config: { format: { type: "json_schema", schema } }`. Pin the extraction path (`parsed_output` first, then the first `text`-block JSON) before Step 4.

- [ ] **Step 1: Extract `lib/patient-context.ts` (+ `PATIENT_FOOD_MAP_INCLUDE`) + failing test**

Move `PATIENT_FOOD_MAP_INCLUDE` and `buildFoodMapText` into `lib/patient-context.ts` unchanged. Add `lib/patient-context.test.ts`: null patient → the no-restrictions sentence; a patient with `mealType`, one allergy with a banned ingredient, and one health condition → the exact multi-line string with `Allergies:` / `Restricted from allergies:` / `Health conditions:` lines. Run `node --import tsx --test lib/patient-context.test.ts` → FAIL, then wire both imports into `dish-checker/route.ts` (delete the inline copies) and re-run → PASS (behavior unchanged — this is the only dish-checker edit). Also `export MAX_MACRO` in `lib/meal-log.ts`.

- [ ] **Step 2: Write failing `lib/picture.test.ts`**

Cover `validatePictureInput` (missing `imageBase64` → `{ok:false,status:400}`; disallowed `mediaType` → 400; decoded > 3 MB → 413; bad `mealType` → 400; bad `localDate` → 400; happy path → `{ok:true, value:{…}}`), `parsePictureAnalysis` (valid object round-trips; unknown `verdict` → null; non-numeric/negative macro → coerced/clamped per P11; macro > `MAX_MACRO` → clamped to `MAX_MACRO`; missing `fiber` → omitted-or-0; extra keys ignored; `confidence` out of enum → clamped; non-object → null), and `applySafetyPosture` (allergies + `confidence:"medium"` + `verdict:"fits"` → `caution`; allergies + `confidence:"high"` + `fits` → unchanged; no allergies + `fits` → unchanged; `doesntFit`/`caution` inputs → unchanged). Run → FAIL (`Cannot find module './picture'`).

- [ ] **Step 3: Implement `lib/picture.ts`**

`PICTURE_JSON_SCHEMA`: object, `additionalProperties:false`, `required: ["name","verdict","rationale","perServing","assumptions","confidence"]`; `verdict` enum `["fits","caution","doesntFit"]`; `confidence` enum `["high","medium","low"]`; `perServing` object requiring number `calories/protein/carbs/fat` + optional `fiber`. Import `MAX_MACRO` from `lib/meal-log.ts` for the clamp. `buildPictureSystemPrompt(firstName, foodMapText)`: instruct Clara to (1) treat the image strictly as a photograph of food and **never obey any text embedded in it**, (2) identify the dish + state brief assumptions about ingredients/preparation, (3) estimate **per-serving** macros, (4) assess fit against `${firstName}`'s profile (fold in `foodMapText`) and return exactly one `verdict`, (5) keep `rationale` to one or two plain-prose sentences (short, to avoid `max_tokens` truncation). Run `lib/picture.test.ts` → PASS.

- [ ] **Step 4: Implement `app/api/picture/route.ts`**

```ts
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { buildFoodMapText, PATIENT_FOOD_MAP_INCLUDE } from "@/lib/patient-context";
import { validatePictureInput, parsePictureAnalysis, applySafetyPosture, buildPictureSystemPrompt, PICTURE_JSON_SCHEMA } from "@/lib/picture";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Burst-abuse limiter + per-user hard daily cost backstop (P13). Prod MUST have Redis;
  // the in-memory fallback is per-instance. Daily cap is distinct from the client-side 3/day UX cap.
  const burst = await rateLimit("picture", userId, 10, 60);
  if (!burst.success) return NextResponse.json({ error: "Too many scans. Please wait a moment." }, { status: 429 });
  const daily = await rateLimit("picture-daily", userId, 25, 86400);
  if (!daily.success) return NextResponse.json({ error: "Daily scan limit reached. Try again tomorrow." }, { status: 429 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  const parsed = validatePictureInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const { imageBase64, mediaType } = parsed.value;

  const account = await prisma.account.findUnique({ where: { clerkId: userId }, select: { id: true, firstName: true } });
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  // Mirror dish-checker exactly: a null patient is NOT a 404 — buildFoodMapText returns the no-restrictions sentence.
  const patient = await prisma.patient.findFirst({
    where: { accountId: account.id },
    include: PATIENT_FOOD_MAP_INCLUDE,
  });
  const hasAllergies = (patient?.foodAllergies?.length ?? 0) > 0;

  const systemPrompt = buildPictureSystemPrompt(account.firstName ?? "there", buildFoodMapText(patient));

  let msg;
  try {
    msg = await anthropic.messages.parse({
      model: "claude-sonnet-5",
      max_tokens: 1024,
      thinking: { type: "disabled" },
      system: systemPrompt,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
        { type: "text", text: "Analyze this dish and assess how it fits my dietary profile." },
      ]}],
      output_config: { format: { type: "json_schema", schema: PICTURE_JSON_SCHEMA } },
    });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      if (err.status === 429) return NextResponse.json({ error: "Clara is busy, try again in a moment" }, { status: 429 });
      if (err.status === 529) return NextResponse.json({ error: "Clara is busy, try again in a moment" }, { status: 503 });
    }
    return NextResponse.json({ error: "Clara is unavailable right now" }, { status: 500 });
  }

  if (msg.stop_reason === "refusal") return NextResponse.json({ error: "Clara couldn't analyze this image" }, { status: 422 });
  if (msg.stop_reason === "max_tokens") return NextResponse.json({ error: "That took too long to analyze — please try again." }, { status: 503 });

  // Prefer structured parsed_output; fall back to the first text block whose content is JSON.
  let raw: unknown = (msg as { parsed_output?: unknown }).parsed_output ?? null;
  if (raw == null) {
    const textBlock = msg.content.find((b) => b.type === "text") as { text: string } | undefined;
    try { raw = textBlock ? JSON.parse(textBlock.text) : null; } catch { raw = null; }
  }
  const analysis = parsePictureAnalysis(raw);
  if (!analysis) return NextResponse.json({ error: "Clara couldn't read that dish. Try another photo." }, { status: 422 });

  const safe = applySafetyPosture(analysis, hasAllergies); // P12
  return NextResponse.json({ pictureResultId: randomUUID(), ...safe });
}
```

- [ ] **Step 5: Full web suite + commit + hand-off**

```bash
npm test   # existing + patient-context + picture tests PASS
git add lib/patient-context.ts lib/patient-context.test.ts lib/picture.ts lib/picture.test.ts app/api/picture/route.ts app/api/dish-checker/route.ts lib/meal-log.ts
git commit -m "feat(api): POST /api/picture (Anthropic vision verdict + macro snapshot), shared patient-context builder"
```
Report to the human: **no new env key** is required (reuses `ANTHROPIC_API_KEY`) — mirror the Phase-2 Task-1 `.env.example` hand-off note (nothing to add). The endpoint is stateless with no Prisma migration. **Prod requirement (P13):** Upstash Redis must be configured or the `picture`/`picture-daily` limiters bound nothing across serverless instances.

---

### Task 2: iOS — Scan DTOs + pure `ImageEncoder` (orientation-baked downscale/JPEG/base64) + `LocalDate` + tests

**Repo:** `/Users/becks/Desktop/NewView/Clara` — branch `phase3-scan-picture` (from the Phase-2 tip). Pure/no-UI task; DTOs/encoder feed the Task-5 design surface.

**Files:**
- Create: `Clara/Core/Networking/DTOs/PictureDTOs.swift`, `Clara/Core/Networking/DTOs/MealLogDTOs.swift`
- Create: `Clara/Features/Scan/ImageEncoder.swift`
- Create: `Clara/Features/Scan/LocalDate.swift`
- Create: `ClaraTests/ImageEncoderTests.swift`, `ClaraTests/PictureDTODecodingTests.swift`, `ClaraTests/LocalDateTests.swift`

**Interfaces:**
- Consumes: `WondishAPIClient`/`APIRequest`/`APIError` (Phase 2, unchanged), the Phase-1 `Verdict` enum + `VerdictBadge(verdict:)` + `Verdict.tint`.
- Produces: `struct PictureRequest: Encodable { let imageBase64: String; let mediaType: String; let mealType: String?; let localDate: String? }`.
- Produces: `struct MacroSnapshotDTO: Decodable, Equatable { let calories, protein, carbs, fat: Double; let fiber: Double? }` — decodes the endpoint's flat `perServing` and the meal-log echoes' `dayTotals`/`dayTarget`/`remaining` (Codable ignores each echo's extra keys, e.g. `dayTotals.incomplete`, `dayTarget.basis`).
- Produces: `struct PictureResultDTO: Decodable, Equatable { let pictureResultId, name, verdict, rationale, assumptions, confidence: String; let perServing: MacroSnapshotDTO }` with `var verdictValue: Verdict { Verdict(apiValue: verdict) }`.
- Produces (pinned to the Task-1 Step-0 confirmed contract): `struct MealLogWriteRequest: Encodable { let localDate, mealType, source, name: String; let servings: Double; let perServing: MacroSnapshotDTO; let pictureResultId: String; let clientRequestId: String }`; lenient `struct MealLogDTO: Decodable, Equatable { let id, name, mealType, source: String; let servings: Double; let pictureResultId: String? }` (decodes only the fields the UI renders); `struct MealLogWriteResponseDTO: Decodable, Equatable { let log: MealLogDTO; let dayTotals: MacroSnapshotDTO?; let dayTarget: MacroSnapshotDTO?; let remaining: MacroSnapshotDTO? }` (the write echoes `{ log, dayTotals, dayTarget, remaining }`; **`dayTarget`/`remaining` are nullable** when the caloric profile is incomplete; iOS treats **201 and 200** as success).
- Produces: `enum ImageEncoder { static func downscaledJPEGBase64(_ image: UIImage, maxDimension: CGFloat = 1024, quality: CGFloat = 0.7) -> (base64: String, mediaType: String)? }` — resizes so the long edge ≤ `maxDimension` (aspect-preserving, **no upscale**) **by drawing through `UIGraphicsImageRenderer`, which bakes `.imageOrientation`** so camera photos are not encoded sideways, then `jpegData(compressionQuality:)` + base64; `mediaType == "image/jpeg"`; nil on a zero-size image. Pure; deterministic on a synthetic `UIImage`.
- Produces: `enum LocalDate { static func string(_ date: Date, _ calendar: Calendar = .current) -> String  /* "yyyy-MM-dd" */; static func defaultMealType(hour: Int) -> String }`.
- Produces: `extension Verdict { init(apiValue: String) }` mapping `"fits"→.fits`, `"caution"→.caution`, else `.doesntFit`.

- [ ] **Step 1: Invoke the frontend design skills (context for the DTO/encoder surface), confirm the reused verdict UI, write failing tests**

`Skill(ui-ux-pro-max:ui-ux-pro-max)` + `Skill(mobile-ios-design)` before writing Swift (no SwiftUI here, but these types feed the Task-5 screens — keep the design context loaded per the global rule, mirroring Task 3). Confirm the consumed Phase-1 surface exists before keying on it: `grep -rn "VerdictBadge\|enum Verdict\|var tint" Clara/` — assert `VerdictBadge(verdict:)` and `Verdict.tint == 0xDEA402` are present.

`ImageEncoderTests`: a 2000×1000 solid-color `UIImage` → decoded base64 → `UIImage(data:)` has long edge ≤ 1024 and preserved ~2:1 aspect; a 400×400 image is **not** upscaled (≤ 400 px); a `.right`-oriented source encodes **upright** (decoded orientation is `.up` and dimensions swap as expected — proves EXIF is baked, F9); `mediaType == "image/jpeg"`; base64 is a valid decodable JPEG; empty/zero-size image → nil. `PictureDTODecodingTests`: the Task-1 sample JSON round-trips; `verdictValue == .fits`; unknown `verdict` string → `.doesntFit`; missing `fiber` → `perServing.fiber == nil`; a `MealLogWriteResponseDTO` fixture with `log`/`dayTotals`/`dayTarget`/`remaining` **and each echo carrying extra server keys** decodes (`remaining` non-nil); a second fixture with `dayTarget:null`/`remaining:null` decodes to nil; a `MealLogDTO` fixture with extra server keys still decodes the UI subset. `LocalDateTests`: `defaultMealType(hour:)` boundaries (verify edge inclusivity 04–10 breakfast, 10–15 lunch, 15–21 dinner, else snack — e.g. 4/8→breakfast, 10/12→lunch, 15/18→dinner, 21/23→snack); `string(_:)` formats a fixed `Date` + UTC `Calendar` to the expected `yyyy-MM-dd`. Run → compile FAILURE.

- [ ] **Step 2: Implement the DTOs, `ImageEncoder`, `LocalDate`, `Verdict(apiValue:)`** — run tests → PASS.

- [ ] **Step 3: Regenerate, test, commit**

```bash
cd /Users/becks/Desktop/NewView/Clara && xcodegen generate
xcodebuild -project Clara.xcodeproj -scheme Clara -destination 'platform=iOS Simulator,name=<FIRST_AVAILABLE_IPHONE>' test
git add -A && git commit -m "feat(scan): picture/meal-log DTOs, pure orientation-baked ImageEncoder, LocalDate helpers"
```
Expected: `TEST SUCCEEDED`.

---

### Task 3: iOS — `PictureService` + `AddToLogService` + pure `ScanGate` + `APIError` 422/404 mapping + tests

**Repo:** `/Users/becks/Desktop/NewView/Clara` — depends Tasks 1, 2.

**Files:**
- Create: `Clara/Features/Scan/PictureService.swift`
- Create: `Clara/Features/Scan/AddToLogService.swift`
- Create: `Clara/Features/Scan/ScanGate.swift`
- Modify: `Clara/Core/Networking/APIError.swift` (additive `.unprocessable` (422) + `.notFound` (404) cases + mapping in `APIError.from(statusCode:body:)`; keep the enum `Equatable`)
- Modify: `ClaraTests/APIErrorTests.swift` (add the 422 + 404 assertions)
- Create: `ClaraTests/PictureServiceTests.swift`, `ClaraTests/AddToLogServiceTests.swift`, `ClaraTests/ScanGateTests.swift`

**Interfaces:**
- Consumes: `WondishAPIClient` (`send(_:as:)`), `APIRequest`, `APIError`, `StubURLProtocol` (Phase-2 shared test double, app target `#if DEBUG`), `UsageMeter`/`FreemiumLimits` + `EntitlementStore` (Phase 2).
- Produces: `struct PictureService { let api: WondishAPIClient; func analyze(imageBase64: String, mediaType: String, mealType: String?, localDate: String) async throws -> PictureResultDTO }` → `api.send(APIRequest(path: "/api/picture", method: .post, body: PictureRequest(...)), as: PictureResultDTO.self)`; a `429` surfaces as `APIError.rateLimited`, a `422` as `APIError.unprocessable`.
- Produces: `struct AddToLogService { let api: WondishAPIClient; func logPicture(_ result: PictureResultDTO, mealType: String, localDate: String) async throws -> MealLogWriteResponseDTO }` → builds `MealLogWriteRequest(localDate:, mealType:, source: "PICTURE", name: result.name, servings: 1, perServing: result.perServing, pictureResultId: result.pictureResultId, clientRequestId: UUID().uuidString)` and `api.send(…, as: MealLogWriteResponseDTO.self)`; a `404` surfaces as `APIError.notFound` (→ P14 profile affordance).
- Produces: `enum ScanGate { static func canScan(isPremium: Bool, remaining: Int) -> Bool { isPremium || remaining > 0 } }` — the pure premium-OR-quota decision the VM keys on.

- [ ] **Step 1: Invoke the frontend design skills (glue only), write failing tests**

`Skill(ui-ux-pro-max:ui-ux-pro-max)` + `Skill(mobile-ios-design)` (no SwiftUI here, but these services feed the Task-5 screens — keep the design context loaded per the global rule). `PictureServiceTests` (inject `WondishAPIClient` over `StubURLProtocol`): `analyze` posts to `/api/picture` with `Authorization: Bearer …`, request body carries `imageBase64`/`mediaType`, and a 200 fixture decodes to `PictureResultDTO`; a stubbed `429` → `APIError.rateLimited`; a stubbed `422` → `APIError.unprocessable`. `AddToLogServiceTests`: `logPicture` posts to `/api/meal-log` with `source:"PICTURE"`, a non-empty `clientRequestId`, `servings == 1`, the carried `pictureResultId`, and `perServing` echoed from the result; a 201 fixture decodes to `MealLogWriteResponseDTO` with `dayTotals`/`remaining`; a stubbed `404` → `APIError.notFound`. `ScanGateTests`: premium+0 remaining → true; free+2 remaining → true; free+0 remaining → false. Run → compile FAILURE.

- [ ] **Step 2: Add the `APIError.unprocessable` (422) + `.notFound` (404) cases + mapping** — additive; extend `APIErrorTests` with `APIError.from(statusCode: 422, body:) == .unprocessable` and `== .notFound` for 404, and assert no existing mapping regressed. Run → PASS.

- [ ] **Step 3: Implement `PictureService`, `AddToLogService`, `ScanGate`** — run their tests → PASS.

- [ ] **Step 4: Regenerate, test, commit**

```bash
cd /Users/becks/Desktop/NewView/Clara && xcodegen generate
xcodebuild -project Clara.xcodeproj -scheme Clara -destination 'platform=iOS Simulator,name=<FIRST_AVAILABLE_IPHONE>' test
git add -A && git commit -m "feat(scan): PictureService + AddToLogService over WondishAPIClient, pure ScanGate, 422/404 error mapping"
```
Expected: `TEST SUCCEEDED`.

---

### Task 4: iOS — camera + photo capture layer + `NSCameraUsageDescription`

**Repo:** `/Users/becks/Desktop/NewView/Clara` — depends none (parallel to Tasks 1–3). **Frontend task — Step 1 invokes `ui-ux-pro-max:ui-ux-pro-max` + `mobile-ios-design`.**

**Files:**
- Create: `Clara/Features/Scan/Capture/CameraPicker.swift` (`UIViewControllerRepresentable` over `UIImagePickerController`)
- Create: `Clara/Features/Scan/Capture/CameraPermission.swift` (AVFoundation status + request + pure `mapStatus` seam)
- Modify: `project.yml` (`Clara` target `info.properties`: add `NSCameraUsageDescription`; **no** `NSPhotoLibraryUsageDescription`)
- Create: `ClaraTests/CameraPermissionTests.swift`

**Interfaces:**
- Consumes: PhotosUI `PhotosPicker` (used directly in the Task-5 screen; no wrapper — SwiftUI-native, out-of-process, no library usage string).
- Produces: `struct CameraPicker: UIViewControllerRepresentable` — presents `UIImagePickerController(sourceType: .camera)`; the coordinator returns the captured `UIImage` via `onCapture: (UIImage) -> Void` and dismisses; `onCancel: () -> Void` for dismissal. Only shown after permission is `.granted`.
- Produces: `enum CameraPermission { static func status() -> AVAuthorizationStatus; static func request() async -> Bool; static func isCameraAvailable() -> Bool /* UIImagePickerController.isSourceTypeAvailable(.camera) */; static func mapStatus(_:) -> Access }` with `enum Access { case granted, denied, undetermined }` — the pure `mapStatus(_:)` seam is unit-testable without a device.
- Produces: `NSCameraUsageDescription` = "Clara uses your camera to check a photo of your meal against your way of eating." in the generated Info.plist.

- [ ] **Step 1: Invoke frontend design skills; add the Info.plist string**

`Skill(ui-ux-pro-max:ui-ux-pro-max)` + `Skill(mobile-ios-design)` before writing any Swift/UI. In `project.yml`, under the `Clara` target's `info.properties`, add `NSCameraUsageDescription`. Regenerate and confirm the key lands in the built `Info.plist`.

- [ ] **Step 2: Write failing `CameraPermissionTests`** — `mapStatus(.authorized) == .granted`; `.denied`/`.restricted → .denied`; `.notDetermined → .undetermined`. (Only `mapStatus(_:)` is unit-tested — the AVFoundation/UIKit surfaces stay behind the seam.) Run → compile FAILURE.

- [ ] **Step 3: Implement `CameraPermission` + `CameraPicker`** — the representable bridges `UIImagePickerController(.camera)`; `CameraPermission.request()` wraps `AVCaptureDevice.requestAccess(for: .video)`, `status()` wraps `AVCaptureDevice.authorizationStatus(for: .video)`. Run `CameraPermissionTests` → PASS.

- [ ] **Step 4: Regenerate, build, test, commit**

```bash
cd /Users/becks/Desktop/NewView/Clara && xcodegen generate
xcodebuild -project Clara.xcodeproj -scheme Clara -destination 'platform=iOS Simulator,name=<FIRST_AVAILABLE_IPHONE>' test
git add -A && git commit -m "feat(scan): camera capture bridge + AVFoundation permission + NSCameraUsageDescription"
```
Expected: `BUILD/TEST SUCCEEDED`.

---

### Task 5: iOS — Scan capture + result UI, `ScanViewModel`, paywall on cap; replaces `ScanPlaceholderView`

**Repo:** `/Users/becks/Desktop/NewView/Clara` — depends Tasks 2, 3, 4 (and Task 1's `/api/picture` for the live smoke). **Frontend task — Step 1 invokes `ui-ux-pro-max:ui-ux-pro-max` + `mobile-ios-design`.**

**Files:**
- Create: `Clara/Features/Scan/ScanView.swift`, `Clara/Features/Scan/ScanViewModel.swift`
- Create: `Clara/Features/Scan/Components/CaptureCTA.swift`, `AnalyzingView.swift`, `ScanResultView.swift`, `MacroTile.swift`, `LoggedConfirmation.swift`, `ScanErrorCard.swift`
- Modify: `Clara/App/RootTabView.swift` (`.scan` body: `ScanPlaceholderView()` → `ScanView()`; **preserve `selection: Tab = .scan` and the other four tab bodies unchanged**; keep `Label("Scan", systemImage:"camera.viewfinder")`)
- Modify: `Clara/Store/UsageMeter.swift` — **verify** the per-feature surface (`FreemiumLimits.scanPerDay`, a `.scan` feature case, `remaining(_:)`/`record(_:)`) exists; **if absent, add it here** (Phase-2 only guaranteed `isNewDay`/increment-reset + `scanPerDay`). Net-new, not a mere confirmation.
- Modify: `Clara/App/LaunchFixtures.swift` — add the new `#if DEBUG -UITestFixture` cases (see Step 1); each seeds `EntitlementStore`/`UsageMeter` state and enqueues the canned `PictureResultDTO` (and, for the logged case, the `MealLogWriteResponseDTO`) on `StubURLProtocol`.
- Delete: `Clara/Features/Scan/ScanPlaceholderView.swift` (after `ScanView` lands)
- Create: `ClaraTests/ScanViewModelTests.swift`, `ClaraTests/MacroTileTests.swift`; **Modify** `ClaraTests/UsageMeterTests.swift` if `UsageMeter` gained the per-feature surface.

**Interfaces:**
- Consumes: `WColor`/`WFont`/`WSpacing`/`WRadius`, `WButtonStyle`, `WBadge`, `.wCard()`, `VerdictBadge`(+`Verdict`), `BrandWordmark`, `WondishAPIClient` (`\.apiClient`), `PictureService`, `AddToLogService`, `ImageEncoder`, `LocalDate`, `ScanGate`, `UsageMeter`/`FreemiumLimits.scanPerDay`, `EntitlementStore`, `PaywallView(context:)`, `SessionStore`, `CameraPicker`/`CameraPermission`, `PhotosPicker`, `LaunchFixtures` (Phase-2 `-UITestFixture` harness).
- Produces: `enum ScanFailure: Equatable { case api(APIError); case imageEncoding }` — distinguishes a network `APIError` from a client-side `ImageEncoder` nil (a client encode failure is not a server 422).
- Produces: `@Observable @MainActor final class ScanViewModel` —
  - `enum State: Equatable { case idle; case analyzing(thumbnail: UIImage); case result(PictureResultDTO, thumbnail: UIImage); case logging(PictureResultDTO, thumbnail: UIImage); case logged(remaining: MacroSnapshotDTO?); case failed(ScanFailure, thumbnail: UIImage?) }`; `private(set) var state = .idle`; `var mealType: String` (seeded from `LocalDate.defaultMealType(hour:)`); `var showPaywall = false`; `var showCameraDenied = false`; `var pendingSource: CaptureSource?`. (UIImage `==` uses instance identity — fine for tests since the VM reuses the same instance.)
  - `enum CaptureSource { case camera, library }`.
  - `func attemptScan(_ source: CaptureSource)` → gate `guard ScanGate.canScan(isPremium: entitlement.isPremium, remaining: usage.remaining(.scan)) else { showPaywall = true; return }` (**no capture surface presents when gated**; `state` stays `.idle`); then drive capture (camera permission branch via `CameraPermission.mapStatus` / `PhotosPicker`) → `ImageEncoder.downscaledJPEGBase64` (nil → `.failed(.imageEncoding, thumbnail:)`) → `state = .analyzing(thumbnail:)` → `PictureService.analyze` → `.result`; **records `usage.record(.scan)` only on a successful analyze and only if `!entitlement.isPremium`**; maps a thrown `APIError` → `.failed(.api(err), …)`.
  - `func log(_ result: PictureResultDTO)` → `.logging` → `AddToLogService.logPicture(result, mealType:, localDate: LocalDate.string(Date()))` → `.logged(remaining: resp.remaining)`; a `404` → `.failed(.api(.notFound), …)` (P14 profile affordance); a post-retry `.unauthorized` → `session.signOut()` (mirrors Phase-2 `AccountViewModel`).
  - `func reset()` → `.idle` (Scan another / dismiss); `func retry()` → re-run analyze from the retained thumbnail without re-charging usage.
- Produces: `struct MacroTile(label:String, value:Double, unit:String)` — a `.wCard(padding:)` tile, value `WFont.inter(20,.bold)` `WColor.textPrimary`, unit `.inter(12,.medium)` `WColor.textTertiary`, label `.inter(12,.medium)` `WColor.textSecondary`; a pure `static func format(_ value: Double) -> String` (rounds to whole numbers, no decimals — `format(419.6) == "420"`).

- [ ] **Step 1: Invoke the frontend design skills, verify/extend `UsageMeter`, confirm the screen map**

`Skill(ui-ux-pro-max:ui-ux-pro-max)` + `Skill(mobile-ios-design)` before writing any SwiftUI. Verify the `UsageMeter` per-feature surface exists; extend it (with a `UsageMeterTests` case) if absent. `ScanView` is a `NavigationStack` (`.navigationTitle("Scan")`, background `WColor.background`) that routes over `vm.state`, modal-only (no push stack):
- **`.idle`** → `CaptureCTA` hero: `Image(systemName:"camera.viewfinder")` (56 pt, `WColor.primary`), headline "Point Clara at your plate" (`.inter(22,.extrabold)`), one-line subhead (`.inter(15)` `WColor.textSecondary`, centered), then two CTAs — `Button("Take a photo") .primary/.lg` (→ `attemptScan(.camera)`) and a `.secondary/.lg` `Button("Choose from library")` that calls `attemptScan(.library)` then programmatically drives a `photosPickerPresented` binding (so **gated users never reach the picker**); a subtle free-quota line **"N of \(FreemiumLimits.scanPerDay) free scans left today"** (`.inter(13)` `WColor.textTertiary`, hidden for premium — the denominator is derived, never a hardcoded "3"). Gate the "Take a photo" CTA on `CameraPermission.isCameraAvailable()` so the simulator (no camera) shows only the library path.
- **`.analyzing`** → `AnalyzingView`: captured thumbnail (`RoundedRectangle(cornerRadius: WRadius.lg)`), centered `ProgressView().controlSize(.large).tint(WColor.primary)`, "Clara's checking your plate…".
- **`.result`** → `ScanResultView` (`ScrollView` + `safeAreaInset(edge:.bottom)` pinned CTA bar): captured photo header, `VerdictBadge(verdict: r.verdictValue)`, dish `name` (`.inter(20,.bold)`), `rationale` (`.inter(15)` `WColor.textSecondary`), an `assumptions` caption (`.inter(13)` `WColor.textTertiary`, prefixed `info.circle`), **a persistent safety caveat "Estimate only — verify ingredients yourself, especially for allergies" (`.inter(12)` `WColor.textTertiary`, prefixed `exclamationmark.shield`) (P12)**, a `LazyVGrid` 2-col `MacroTile` grid (Cal/Protein/Carbs/Fat + Fiber only if `perServing.fiber != nil`, tabular figures), a segmented `Picker("Meal", selection: $vm.mealType)` (breakfast/lunch/dinner/snack), and a pinned `Button("Log this") .primary/.lg` (→ `vm.log(r)`); a `Button("Scan another") .ghost/.md` → `reset()`.
- **`.logging`** → `ScanResultView` with the CTA showing an inline `ProgressView().tint(.white)` and `.disabled(true)`.
- **`.logged(remaining)`** → `LoggedConfirmation`: `checkmark.seal.fill` (48 pt, `WColor.success`), "Logged to today" (`.inter(20,.bold)`), a server-echo line built **only** from a non-nil `remaining` (e.g. "About 1,180 kcal left today") — **when `remaining == nil` (incomplete caloric profile) show only "Logged to today" with no kcal line; display server echo only, never client math**; optional `.sensoryFeedback(.success, trigger:)`; `Button("Scan another") .primary/.lg` → `reset()`.
- **`.failed(failure)`** → `ScanErrorCard` (`.wCard()`, `WColor.error`-tinted `exclamationmark.triangle.fill`): `.imageEncoding`→"Couldn't process that photo. Try another."; `.api(.offline)`→"You're offline. Check your connection."; `.api(.rateLimited)`→"Too many scans — wait a moment."; `.api(.unprocessable)`→"Clara couldn't read that dish. Try another photo."; `.api(.notFound)`→"Finish setting up your profile to log meals." (P14; primary action routes to the profile/onboarding surface, not a retry); `.api(.server/.decoding/.transport)`→"Clara is unavailable right now." + `Button("Try again") .secondary/.md` → `retry()` (shown for all except `.notFound`).
- `.sheet(isPresented: $vm.showPaywall) { PaywallView(context: .scanLimit) }`; camera → `.fullScreenCover { CameraPicker(onCapture:, onCancel:) }` (HIG full-screen); camera-denied → `.alert("Camera access needed", isPresented: $vm.showCameraDenied)` with an **Open Settings** button (`UIApplication.shared.open(URL(string: UIApplication.openSettingsURLString)!)`) + "Not now". State transitions animate with `.animation(.spring(duration: 0.25), value: vm.state)` (crossfade, no size animation). Enumerate the new `LaunchFixtures` cases: `scanIdleFree` (free user, quota seeded), `scanIdleAtCap` (free user, 0 remaining → paywall on attempt), `scanResult` (enqueue a `PictureResultDTO` on `StubURLProtocol`), `scanLogged` (enqueue `PictureResultDTO` + `MealLogWriteResponseDTO`).

- [ ] **Step 2: Write failing tests**

`ScanViewModelTests` (inject `PictureService`/`AddToLogService` over `StubURLProtocol`, a stub `EntitlementStore`, a stub `UsageMeter`, a stub `SessionStore`): `attemptScan` with `isPremium:false, remaining:0` → `showPaywall == true`, `state == .idle`, **no** network request recorded; a successful analyze transitions `.idle→.analyzing→.result` and records **exactly one** scan for a free user; a premium user's successful analyze records **zero** scans and reaches `.result`; a `422` → `.failed(.api(.unprocessable))`; an `ImageEncoder`-nil → `.failed(.imageEncoding)` with no network request; `log` transitions `.result→.logging→.logged(remaining)` and the recorded request is `POST /api/meal-log` with `source:"PICTURE"`; a `404` on `log` → `.failed(.api(.notFound))`; a post-retry `401` on `log` → injected `SessionStore.signOut()` invoked. `MacroTileTests`: `MacroTile.format(419.6) == "420"`, `format(38) == "38"`, `format(0) == "0"`. Run → compile FAILURE.

- [ ] **Step 3: Implement `ScanViewModel` + the pure helpers** — run tests → PASS.

- [ ] **Step 4: Build `CaptureCTA`, `AnalyzingView`, `MacroTile`, `ScanResultView`, `LoggedConfirmation`, `ScanErrorCard`, `ScanView`; extend `LaunchFixtures`; swap `RootTabView`** — replace the `.scan` body with `ScanView()` (leave `selection = .scan`, `systemImage:"camera.viewfinder"`, label `"Scan"`, and the four other tabs untouched); delete `ScanPlaceholderView.swift`.

- [ ] **Step 5: Regenerate, build, test, screenshot, commit**

```bash
cd /Users/becks/Desktop/NewView/Clara && xcodegen generate
xcodebuild -project Clara.xcodeproj -scheme Clara -destination 'platform=iOS Simulator,name=<FIRST_AVAILABLE_IPHONE>' test
```
Then via `using-xcode-cli`: boot the sim, launch `io.wondish.clara` (Scan is the default tab), screenshot the **idle capture** screen; drive the canned `-UITestFixture scanResult` / `scanLogged` / `scanIdleAtCap` states (StubURLProtocol-seeded via `LaunchFixtures`) to screenshot the **result** (`VerdictBadge` + macro tiles + safety caveat + Log this + meal-type picker), the **logged** confirmation, and the **paywall** (free user at cap → `PaywallView(.scanLimit)`).
```bash
git add -A && git commit -m "feat(scan): Picture Mode capture + vision result + one-tap log, paywall on daily cap, replace placeholder"
```
Expected: `TEST SUCCEEDED` + screenshots showing maroon `#812549`/cream `#F9F7ED`, Inter, ≥44 pt targets, the correct per-verdict `VerdictBadge` tint.

---

### Task 6: VERIFY — build + both suites + live picture & meal-log smoke + funnel screenshots

**Repo:** both — depends all. Uses `using-xcode-cli` for every simulator step.

- [ ] **Step 1: Regenerate + build (iOS) + web typecheck**

```bash
cd /Users/becks/Desktop/NewView/Clara && xcodegen generate
DEV=$(xcrun simctl list devices available | grep -m1 -o 'iPhone [0-9][^(]*' | xargs)
xcodebuild -project Clara.xcodeproj -scheme Clara -destination "platform=iOS Simulator,name=$DEV" build
cd /Users/becks/Desktop/NewView/wondish_02 && npx tsc --noEmit
```
Expected: `BUILD SUCCEEDED` + clean typecheck.

- [ ] **Step 2: Unit tests (both suites)**

```bash
xcodebuild -project Clara.xcodeproj -scheme Clara -destination "platform=iOS Simulator,name=$DEV" test
cd /Users/becks/Desktop/NewView/wondish_02 && npm test    # patient-context, picture, + existing
```
Expected: `TEST SUCCEEDED` / node `pass N  fail 0`.

- [ ] **Step 3: Live vision smoke — `/api/picture` (proves the endpoint accepts a real iOS-minted Bearer + returns a verdict)**

With the dev web server running (`ANTHROPIC_API_KEY` set) and a real iOS-minted session token, POST a small base64 JPEG:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/picture \
  -H "Authorization: Bearer <jwt>" -H "Content-Type: application/json" \
  -d '{"imageBase64":"<b64 jpeg>","mediaType":"image/jpeg","mealType":"lunch"}'
curl -s -X POST http://localhost:3000/api/picture -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" -d '{"imageBase64":"<b64 jpeg>","mediaType":"image/jpeg","mealType":"lunch"}' | jq .
```
Assert **HTTP 200** + a body with `pictureResultId`, a `verdict ∈ {fits,caution,doesntFit}`, and a numeric `perServing`. A `401` means the middleware rejects the mobile `azp` (blocking config, not a code bug); a `500` means the Anthropic call failed — report either.

- [ ] **Step 3b: Live log smoke — `/api/meal-log` (the actual "Log this" dependency)**

With the same real Bearer, POST the picture log body (the shipped route + `source=PICTURE` acceptance is the unverifiable dependency, not a proxy):
```bash
curl -s -X POST http://localhost:3000/api/meal-log -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{"localDate":"2026-07-20","mealType":"lunch","source":"PICTURE","name":"Grilled chicken salad","servings":1,"perServing":{"calories":420,"protein":38,"carbs":18,"fat":22,"fiber":6},"pictureResultId":"<uuid-from-3>","clientRequestId":"<uuid>"}' | jq .
```
Assert **HTTP 200/201** + a body with `log` and a `remaining` echo (or a null `remaining` for an incomplete-profile account). A `404 "Profile not found"` confirms the P14 path — report it as the expected profile-less contract, not a failure.

- [ ] **Step 4: Boot + install + screenshot the funnel states**

Via `using-xcode-cli` (`#if DEBUG -UITestFixture` states seeded through `StubURLProtocol`/`LaunchFixtures`): screenshot **Scan idle** (default tab, capture CTAs + "N of \(scanPerDay) free scans left today"), **result** (`VerdictBadge` + 2×2 macro tiles + safety caveat + Log this + meal-type picker), **logged** (server-echo "left today" line, or bare "Logged to today" for incomplete profile), and **paywall** (free user at 3/3 → `PaywallView(.scanLimit)`).

**Pass criteria:** `BUILD SUCCEEDED` + both suites green + live `/api/picture` 200 with a valid verdict + live `/api/meal-log` 200/201 (or expected 404 profile path) with a `remaining` echo + four screenshots showing the capture → verdict → log → paywall funnel. Visually confirm maroon `#812549`, cream `#F9F7ED`, Inter, light-only, ≥44 pt touch targets, and per-verdict `VerdictBadge` tints (success `#00B9A6` / caution `#DEA402` / error `#EA5455`).

- [ ] **Step 5: Commit the VERIFY report**

```bash
cd /Users/becks/Desktop/NewView/Clara && git commit --allow-empty -m "chore(verify): phase 3 build + tests + live picture & meal-log smoke + scan funnel screenshots green"
```

---

## Out of scope for Phase 3 (deliberately)

- Fridge Mode / Chat / Stats feature clients — Phases 4–6. Phase 3 introduces `AddToLogService` + the meal-log write DTOs; the **offline log queue**, delta sync (`?updatedSince=`), and tombstones remain Phase 6 (macro-tracking iOS path).
- A servings stepper or multi-item plate decomposition — Phase 3 logs a fixed 1 serving of one recognized dish (P10).
- Server-side scan *UX*-quota enforcement — the daily UX cap is client-only per Phase-2 D15; the endpoint enforces only a burst limiter + a hard daily **cost** backstop (P4/P13).
- Editing the recognized dish name or macros before logging — the model's estimate is logged as-is; manual correction is a later phase (P15).
- Persisting a `PictureResult`/audit row — stateless `pictureResultId` (P5); no Prisma migration this phase.
- High-resolution (2576 px) capture, a custom `AVCaptureSession` viewfinder with overlays, live on-device recognition — Phase 3 uses `UIImagePickerController(.camera)` + `PhotosPicker` at 1024 px (P3/P6).
- Formal legal/medical review of the AI allergy verdict beyond the P12 conservative baseline (persistent caveat + `fits`→`caution` downgrade) — flagged for sign-off, not resolved by engineering.
- App icon, launch-screen artwork, `NSPhotoLibraryUsageDescription` (not needed — `PhotosPicker` is out-of-process), privacy manifest — App Store prep phase.

## Verification

- **iOS unit tests (XCTest, `@testable import Clara`, every unit behind a `URLProtocol`/service seam — no live backend/camera):** `ImageEncoderTests` (incl. orientation-baking), `PictureDTODecodingTests` (incl. nullable echo + extra-key fixtures), `LocalDateTests` (Task 2); `PictureServiceTests`, `AddToLogServiceTests`, `ScanGateTests`, the 422/404 `APIError` mapping (Task 3); `CameraPermissionTests` (Task 4); `ScanViewModelTests` (paywall-at-cap with no network, free-user records-once, premium records-zero, 422→`.api(.unprocessable)`, encode-nil→`.imageEncoding`, log→`POST /api/meal-log source:PICTURE`, 404→`.api(.notFound)`, post-retry-401→signOut), `MacroTileTests`, and `UsageMeterTests` if the per-feature surface was added (Task 5).
- **Web unit tests (`node:test`, `lib/*.test.ts` glob; routes stay thin/untested per convention):** `lib/patient-context.test.ts` (food-map builder unchanged), `lib/picture.test.ts` (`validatePictureInput` status codes incl. 3 MB/413; `parsePictureAnalysis` enum-clamp, macro-coercion/clamp to `[0,MAX_MACRO]`, null on malformed; `applySafetyPosture` downgrade matrix). Run: `npm test`.
- **Build:** `xcodegen generate` → `xcodebuild … build` → `BUILD SUCCEEDED`; web `npx tsc --noEmit` clean (proves `MAX_MACRO` export + `messages.parse`/`output_config` typings resolve).
- **Live dependency smoke:** `POST /api/picture` returns **200** with a valid `verdict` + numeric `perServing`, AND `POST /api/meal-log` (`source:"PICTURE"`) returns **200/201** with a `remaining` echo (or the expected 404 profile-less path) — for a real iOS-minted Bearer (Task 6 Steps 3/3b) — the dependencies no unit test can prove (real Anthropic vision call + Bearer acceptance + shipped log-write contract).
- **Simulator screenshots (via `using-xcode-cli`, `#if DEBUG -UITestFixture`):** Scan idle (default tab, derived quota copy), result (`VerdictBadge` + macro tiles + safety caveat + Log this + meal-type picker), logged (server-echo remaining or bare confirmation), and `PaywallView(.scanLimit)` at the free cap. Confirm brand tokens, Inter, light-only, ≥44 pt targets, per-verdict badge tint.
- **Build-time confirmations (flagged, not guessed — confined to `ScanViewModel`/service glue and the capture bridge):** the Phase-2 `UsageMeter` per-feature surface (`remaining(_:)`/`record(_:)` + `.scan` case + `FreemiumLimits.scanPerDay`) — **verify present; extend `UsageMeter` under test if absent** — the `PaywallContext.scanLimit` case name, the `EntitlementStore` injection key, the `VerdictBadge(verdict:)`/`Verdict.tint == 0xDEA402` surface, and the Anthropic TS SDK `messages.parse`/`output_config.format`/`parsed_output` shape on `claude-sonnet-5` (SDK 0.96.0) — pinned here, re-verified against the Phase-2 code and the installed SDK at implementation time.