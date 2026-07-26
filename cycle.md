# cycle.md — the Wondish development-cycle protocol

How we ship software here: one **cycle** = one screen or feature shipped end-to-end
(backend → iOS → audit → merge). This file is the contract of record for the *process*;
each cycle's *content* contract lives in its plan doc. Follow this protocol unless a
dated amendment in this file says otherwise.

Proven across: C1 Account, C2 Clara chat, C3 Restaurants, C4 Onboarding gate,
C5 Fridge/Cook, Cycles A+B (Meal Plan + Stats live), Supplements+Journal.

---

## 1. The two repos and the roles

| | |
|---|---|
| **wondish_02** (this repo) | Next.js App Router + Prisma/Neon backend + web app. Deploys to Vercel (www.wondish.io) on push to `main`. |
| **Clara** (`/Users/becks/Desktop/NewView/Clara`) | SwiftUI iOS app "Wondish" (Clara is the AI persona only). iOS 17+, tabs: Restaurants · Cook · Meal Plan (PlanHubView) · Clara · Account. |

**Roles.** The main Claude session is the **controller**: it decomposes, writes briefs,
dispatches subagents, adjudicates review findings, and keeps the ledger. Subagents are
**implementers** (one task each), **reviewers** (one per task), and **QA/audit** agents.
Implementers never inherit session history — every dispatch is a self-contained brief.

**Model tiering.** Mechanical/test-only work → small model (haiku/sonnet); normal tasks →
sonnet; risky or parity-critical reviews → opus; final whole-branch review → strongest
available model.

---

## 2. Cycle lifecycle

### Phase 0 — Spec & design (with the user)
1. Brainstorm the feature with the user (superpowers:brainstorming before any creative work).
2. For anything visual: produce a **mockup artifact** and get explicit user acceptance
   *before* the cycle starts (Supplements+Journal precedent).
3. Write the spec to `docs/superpowers/specs/YYYY-MM-DD-<name>-design.md` when the design
   warrants its own doc.

### Phase 1 — Plan doc (contract of record)
1. Write `docs/superpowers/plans/YYYY-MM-DD-<name>.md` (superpowers:writing-plans):
   task-by-task, with pinned wire contracts, file lists, and test expectations.
2. The plan doc is the **contract of record**. It is never silently edited after work
   starts — corrections and scope changes are appended as **dated amendment blocks**
   ("AMENDMENT YYYY-MM-DD: …") that supersede the original text. Mid-cycle user
   directives get the same treatment (C3 "chosen dishes count into macros" precedent).
3. Run a plan review (multi-agent for big plans) before execution; fold findings in as
   amendments.

### Phase 2 — Engine (backend, wondish_02)
1. Decompose into tasks E1..En. Order so each task's dependencies already exist
   (e.g., a migration/column a later task needs is pulled *into* the task that first
   touches it — C1 Task-1 lesson).
2. Per task: write a brief to `.superpowers/sdd/<task>-brief.md`, dispatch an implementer,
   **TDD** (superpowers:test-driven-development), commit, then dispatch an independent
   reviewer on the diff.
3. Migrations are **authored offline and additive only** (no drops/alters of live data);
   they apply via `prisma migrate deploy` at the release gate, never mid-cycle.
4. Standards: full suite green + `tsc` clean of *new* errors + build green after every task.

### Phase 3 — Surface (iOS, Clara)
1. Tasks T1..Tn, typically: DTOs → service → view model → view → integration.
2. Per new surface, ship all of:
   - **Fixtures**: offline fixture cases wired to launch arguments so every state
     (loaded/empty/error) renders without a network (`-tab mealplan`,
     `-segment supplements`, fixture names like `mealPlanLoaded`).
   - **Screenshot verification** by the controller for every fixture state.
   - View-model tests for logic (views themselves: screenshots, not unit tests).
3. Engine and Surface tasks in different repos with zero file overlap run **in parallel**
   (superpowers:dispatching-parallel-agents).
4. UI work invokes the `ui-ux-pro-max:ui-ux-pro-max` skill before editing view code
   (house rule), plus mobile-ios-design/expo-native-ui as relevant.

### Phase 4 — Review discipline
- Finding severities: **Critical / Important / Minor**.
- Critical+Important → a **fix wave** is dispatched immediately, then re-reviewed.
- Minors are **carried** (recorded in the ledger) to the final whole-branch review, where
  they are triaged ACCEPT (with reason) or fixed. Accepted minors become **post-merge
  tickets** listed in the cycle close-out — they are real backlog, not noise
  (they were paid down 2026-07-25).
- Reviewers verify, not trust: contract walks are byte-level; risky claims are hand-traced.
- Receiving review feedback: verify before implementing (superpowers:receiving-code-review).

### Phase 5 — Final review + Audit drill
1. **Final whole-branch review** on the strongest model over the full cycle diff:
   ready-to-merge verdict, triage of all carried minors, cross-repo contract check,
   release-hygiene check.
2. **Audit drill** (QA subagent, simulator): clean build + full suite, fixture sweep of
   every new state with screenshots, whole-tab sweep, Dynamic Type XXL pass, console
   hygiene, any review-committed integration tests (e.g., loopback streaming test).
   Live-network smokes that need deploy/user auth are *disclosed as release-gated*,
   not faked.

### Phase 6 — Merge, push, close out
1. Merge the work branch to `main` (ff where possible) in both repos; push both.
   (Clara pushes need the user's GitHub auth — origin `theonlybex/wondish_IOS`.)
2. Append the **cycle close-out block** to `.superpowers/sdd/progress.md`: commits, test
   counts, deviations from plan, gotchas learned, post-merge tickets, release gates,
   remaining user steps.
3. Update persistent memory with durable facts (gotchas, gates, decisions).

### Phase 7 — Release gate (user + controller)
Standing gate checklist before/at deploy:
- [ ] `prisma migrate deploy` (or `npx prisma migrate status` verification) against prod
      Neon **before** routes that need the new tables are exercised.
- [ ] Required env vars present in Vercel prod (e.g. `ANTHROPIC_API_KEY`).
- [ ] Clerk azp allowlist includes `io.wondish.clara`.
- [ ] Unauthenticated probes of new routes return JSON 401 (middleware taxonomy).
- [ ] **User step**: one interactive simulator sign-in (dev-loop reinstalls clear the
      Clerk session — known, not a bug), then live smoke of the new surfaces against
      www.wondish.io. Premium-gated flows need a premium account.

---

## 3. Artifacts and where they live

| Artifact | Location |
|---|---|
| Cycle ledger (append-only, **gitignored**) | `.superpowers/sdd/progress.md` |
| Task briefs / implementer reports | `.superpowers/sdd/*-brief.md`, `*-report.md` |
| Plan docs (committed, contract of record) | `docs/superpowers/plans/YYYY-MM-DD-*.md` |
| Spec/design docs | `docs/superpowers/specs/` |
| This protocol | `cycle.md` (repo root) |

---

## 4. Standing rules (all cycles)

1. **Food-surface sync rule**: every feature that filters/serves food derives bans via
   `lib/diet-match.ts` — word-boundary allergen matching, **server-enforced**. This is a
   named review dimension in every food cycle.
2. **Pinned wire contracts**: once a GET contract ships to iOS it is byte-frozen for
   valid inputs. New behavior rides opt-in query params (`?allMeals=1` precedent) so the
   default response stays byte-identical for existing clients.
3. **Server prices macros**: clients never send macro values for server-priced sources
   (RECIPE/RESTAURANT); the server snapshots from its own data; `clientRequestId` gives
   idempotent retry.
4. **Freemium/premium gates live server-side** (`lib/freemium.ts`, 402 before token
   spend). Client UI reacts to 402; it never enforces.
5. **iOS DTO dates stay `String`** — Prisma emits fractional-second ISO that the shared
   `.iso8601` decoder can't parse. Parse at the edge where needed.
6. **No xcodegen on this machine** — new Swift files are hand-registered in
   `project.pbxproj` (4-point insert: PBXBuildFile, PBXFileReference, group children,
   Sources phase).
7. **Config**: `Config/Debug.xcconfig` carries an intentional **uncommitted** prod
   override (www.wondish.io + real pk_test). Never commit, revert, or stage it.
   Release.xcconfig points at www.wondish.io (app.wondish.io does not resolve).
8. **SwiftUI gotchas** (recurring): `ScrollView.safeAreaInset(edge: .top)` suppresses the
   large nav title — host fixed headers in a `VStack` under `NavigationStack`; child views
   whose VM is attached after first render need `.task(id: vm == nil)` or load never fires.
9. **Skills are mandatory** where they apply: brainstorming before creative work,
   TDD before implementation, systematic-debugging before fixes, ui-ux-pro-max before
   frontend edits, verification-before-completion before any "done" claim.
10. **Evidence before assertions**: suite counts, build results, and screenshots are
    recorded in the ledger for every task; "complete" is never claimed without them.

---

## 5. Quick-start checklist for a new cycle

```
[ ] Brainstorm + user-approved mockup (artifact)
[ ] Spec doc (if visual/complex) → docs/superpowers/specs/
[ ] Plan doc → docs/superpowers/plans/  (+ plan review, amendments folded in)
[ ] Ledger section opened in .superpowers/sdd/progress.md
[ ] Engine tasks E1..En  (brief → TDD → implement → review → fix wave)
[ ] Surface tasks T1..Tn (parallel where disjoint; fixtures + launch args + screenshots)
[ ] Final whole-branch review (strong model) + minor triage
[ ] Audit drill (simulator QA)
[ ] Merge → push both repos
[ ] Close-out block in ledger + memory update + post-merge tickets listed
[ ] Release gate: migrations → env → 401 probes → user live smoke
```
