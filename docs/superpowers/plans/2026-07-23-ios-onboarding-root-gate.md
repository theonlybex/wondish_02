# Clara iOS — Onboarding Sign-in Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Every task that creates or edits SwiftUI MUST invoke the `ui-ux-pro-max:ui-ux-pro-max` skill AND the `mobile-ios-design` skill before writing any Swift — non-negotiable global user rule.**

**Goal:** Signed-out users land on a full-screen Onboarding/Sign-in screen (the approved design mock) instead of the tab shell, and reach the tabs only with a live session — fixing the "app looks broken because sign-in is hidden in Account" UX seen in the production smoke test.

**Architecture:** A root gate in `ClaraApp` switches the window root on `SessionStore.Phase` (`.loading` → restoring view, `.signedOut` → `OnboardingView`, `.signedIn` → `RootTabView`). The onboarding screen is the already-committed design mock (`Clara/Features/Onboarding/OnboardingView.swift`, branch `onboarding-signin`) wired to the exact auth machinery `SignedOutView` already uses (`ClerkKitUI.AuthView` sheets + re-bootstrap on dismiss). No backend work — auth endpoints all exist.

**Tech Stack:** Swift 5.9 / SwiftUI, iOS 17, XcodeGen, XCTest, ClerkKit/ClerkKitUI v1.3.2.

## Global Constraints

- iOS repo `/Users/becks/Desktop/NewView/Clara`, branch `onboarding-signin` (already cut from `main` a415fa0, carries the mock commit). App/bundle id `io.wondish.clara`, iPhone-only, portrait, iOS 17, light-only.
- Reuse existing design tokens/components ONLY (`WColor`, `WFont.inter`, `WSpacing`, `wCard`, `WButtonStyle`, `BrandWordmark`); `ClerkKitUI.AuthView` is not brand-styleable — accepted (Phase-2 precedent).
- The approved mock's visual composition is the design contract — wiring must not change its layout/copy (controller screenshot-diffs at review).
- `Config/Debug.xcconfig` carries a LOCAL uncommitted production override — never commit/revert/stage it; stage files explicitly (no `git add -A`).
- All existing fixtures must keep working: seeded `signedIn` fixtures (restaurants/chat/account flows) land in the tab shell exactly as today.
- Test/verify: `xcodegen generate` (only when files added/removed) → `xcodebuild -project Clara.xcodeproj -scheme Clara -destination 'platform=iOS Simulator,name=iPhone 17 Pro' test`. Baseline 230/230 + the mock commit's state. Never wait >5 min on a build: kill, `xcrun simctl shutdown all`, retry once, then BLOCKED.

## Open decisions (RECOMMENDED defaults the plan is written against)

| # | Decision | RECOMMENDED default |
|---|---|---|
| O-D1 | `.loading` root | Reuse the existing `RestoringView` (Clara/Features/Account/AccountView.swift:81) with `session.retryBootstrap()` — identical restore/retry semantics as Account, now app-wide. |
| O-D2 | Account tab's `SignedOutView` after gating | Keep in place (unreachable in practice once the gate exists; zero-risk defensive fallback; deleting it is a later cleanup). |
| O-D3 | Guest/skip browsing | None — `/api/restaurants` requires auth server-side; the gate is absolute for v1. |
| O-D4 | Phase-transition animation | Single `.animation(.easeInOut(duration: 0.25), value:)` on the phase switch — no custom transition choreography in v1. |

---

### Task 1: Root gate — phase-driven window root

**Files:**
- Create: `Clara/App/RootGate.swift`
- Modify: `Clara/App/ClaraApp.swift` (the `WindowGroup` body, ~line 62, and removal of the temporary `-onboardingMock` hook the mock commit added)
- Test: `ClaraTests/RootGateTests.swift`

**Interfaces:**
- Consumes: `SessionStore.Phase` (`.loading | .signedOut | .signedIn`), `OnboardingView` (mock commit), `RootTabView`, `RestoringView`, `SessionStore.retryBootstrap()`.
- Produces: `enum RootDestination: Equatable { case restoring, onboarding, tabs }`, `func rootDestination(for phase: SessionStore.Phase) -> RootDestination` (pure), and `struct RootGate: View` — the new window root. Task 2 relies on `RootGate` rendering `OnboardingView()` for `.signedOut`.

- [ ] **Step 1: invoke `ui-ux-pro-max:ui-ux-pro-max` + `mobile-ios-design`** (root transition is a UI surface).
- [ ] **Step 2: Write the failing tests** in `ClaraTests/RootGateTests.swift`:

```swift
import XCTest
@testable import Clara

final class RootGateTests: XCTestCase {
    func testLoadingPhaseMapsToRestoring() {
        XCTAssertEqual(rootDestination(for: .loading), .restoring)
    }
    func testSignedOutPhaseMapsToOnboarding() {
        XCTAssertEqual(rootDestination(for: .signedOut), .onboarding)
    }
    func testSignedInPhaseMapsToTabs() {
        XCTAssertEqual(rootDestination(for: .signedIn), .tabs)
    }
}
```

- [ ] **Step 3: Run → FAIL** (`rootDestination` undefined). `xcodebuild … test -only-testing:ClaraTests/RootGateTests` → compile failure expected.
- [ ] **Step 4: Implement** `Clara/App/RootGate.swift`:

```swift
import SwiftUI

enum RootDestination: Equatable { case restoring, onboarding, tabs }

/// Pure phase→root mapping, unit-tested; `RootGate` is its thin View shell.
func rootDestination(for phase: SessionStore.Phase) -> RootDestination {
    switch phase {
    case .loading: return .restoring
    case .signedOut: return .onboarding
    case .signedIn: return .tabs
    }
}

struct RootGate: View {
    @Environment(SessionStore.self) private var session

    var body: some View {
        Group {
            switch rootDestination(for: session.phase) {
            case .restoring:
                RestoringView { await session.retryBootstrap() }
            case .onboarding:
                OnboardingView()
            case .tabs:
                RootTabView()
            }
        }
        .animation(.easeInOut(duration: 0.25), value: rootDestination(for: session.phase))
    }
}
```

- [ ] **Step 5: Rewire `ClaraApp`** — in the `WindowGroup`, replace `RootTabView()` with `RootGate()` (environment modifiers and `.task { await session.bootstrap() }` stay exactly where they are), and DELETE the temporary `#if DEBUG -onboardingMock` root-override hook added by the mock commit (the gate + the Task 3 fixture replace it).
- [ ] **Step 6: Run RootGateTests → PASS; run the FULL suite → all green** (seeded `signedIn` fixtures must still land in tabs — the suite plus one manual fixture launch in Task 3 verifies).
- [ ] **Step 7: Commit** `feat(onboarding): phase-driven root gate` (stage `Clara/App/RootGate.swift`, `Clara/App/ClaraApp.swift`, `ClaraTests/RootGateTests.swift`, `Clara.xcodeproj/project.pbxproj` only).

### Task 2: Wire the onboarding CTAs to Clerk auth

**Files:**
- Create: `Clara/Features/Onboarding/AuthSheetMode.swift` (extracted shared wrapper)
- Modify: `Clara/Features/Onboarding/OnboardingView.swift` (the mock — wiring only, zero layout/copy changes), `Clara/Features/Account/SignedOutView.swift` (drop its now-shared private wrapper)
- Test: covered by existing suite + Task 3 fixture screenshots (sheet presentation is ClerkKitUI-owned; the dismissal→bootstrap logic is exercised through the same pattern Account already ships)

**Interfaces:**
- Consumes: `ClerkKitUI.AuthView(mode:)`, `Clerk.shared.user`, `session.bootstrap()`, `AppConfig.baseURL`, `SafariView`/`SafariURL` (existing, from SignedOutView's file — reuse or move alongside if fileprivate).
- Produces: `struct AuthSheetMode: Identifiable { let id = UUID(); let mode: ClerkKitUI.AuthView.Mode }` shared by both `OnboardingView` and `SignedOutView`.

- [ ] **Step 1: skills.**
- [ ] **Step 2: Extract the wrapper** — move `SignedOutView`'s private `AuthSheetMode` into `Clara/Features/Onboarding/AuthSheetMode.swift` as an internal type; update `SignedOutView` to use it (delete its private copy). If `SafariURL` is also fileprivate there and the onboarding footer needs it, make it internal in place (do not move files).
- [ ] **Step 3: Wire `OnboardingView`** — replace the mock's no-op CTA closures:

```swift
@Environment(SessionStore.self) private var session
@State private var authSheet: AuthSheetMode?
@State private var safariURL: SafariURL?
// "Get started"      → authSheet = AuthSheetMode(mode: .signUp)
// "I already have an account" → authSheet = AuthSheetMode(mode: .signIn)
// Terms/Privacy      → safariURL = SafariURL(url: AppConfig.baseURL.appendingPathComponent("terms" / "privacy"))

.sheet(item: $authSheet, onDismiss: handleAuthSheetDismissed) { wrapped in
    ClerkKitUI.AuthView(mode: wrapped.mode)
}
.sheet(item: $safariURL) { wrapped in SafariView(url: wrapped.url) }

private func handleAuthSheetDismissed() {
    // AuthView self-dismisses on an active session (SignedOutView precedent);
    // a nil user here means the sheet was cancelled.
    guard Clerk.shared.user != nil else { return }
    Task { await session.bootstrap() }
}
```

- [ ] **Step 4: Run the FULL suite → green; build clean.** Manual trace in report: sign-in completes → `bootstrap()` → phase `.signedIn` → `RootGate` swaps to tabs (animation from Task 1).
- [ ] **Step 5: Commit** `feat(onboarding): live Clerk auth from onboarding CTAs`.

### Task 3: Fixture + screenshots + a11y pass

**Files:**
- Modify: `Clara/App/LaunchFixtures.swift` (add `case onboarding` — seeds `phase = .signedOut`, stub client; mirror the existing `signedOut` fixture if one exists, else add it), `ClaraTests` only if a pure helper emerges.

**Interfaces:**
- Consumes: `LaunchFixtures` DEBUG machinery (single `#if DEBUG` region), `RootGate` (Task 1).
- Produces: `-UITestFixture onboarding` launches straight into `OnboardingView` deterministically.

- [ ] **Step 1: skills. Step 2: Add the fixture case** (inside the existing `#if DEBUG` region; seeded signed-out phase, no network).
- [ ] **Step 3: Verify fixture matrix by launch + screenshot:** `onboarding` (normal + Dynamic Type XXL), one seeded `signedIn` fixture (e.g. `restaurantsLoaded`) proving tabs still load, and `-restaurantDetail` unaffected. Save to `.superpowers/sdd/onb-*.png` for controller visual check.
- [ ] **Step 4: A11y check on the wired screen:** VoiceOver labels on both CTAs and the footer links; decorative images `.accessibilityHidden(true)`; Dynamic Type XXL screenshot shows no truncated CTA copy.
- [ ] **Step 5: Full suite → green. Commit** `feat(onboarding): onboarding fixture + a11y polish`.

### Task 4: Verify (cycle endgame per protocol)

- [ ] **Step 1:** `xcodegen generate` → full build + full test suite green.
- [ ] **Step 2: Live smoke (production-pointed local build):** with the local `Debug.xcconfig` override in place, fresh-install launch (no fixture) must land on Onboarding; sign in with a real account (USER action — controller hands off); post-sign-in the tab shell appears and Restaurants loads the live Stockton list. Sign out from Account → returns to Onboarding.
- [ ] **Step 3:** Whole-branch review (fable) → fix waves → audit drill (fixture sweep + XXL + console) → merge `onboarding-signin` → `main` → push, per the standing cycle protocol.

## Out of scope

- Guest/skip mode (O-D3), Apple/Google SSO buttons (Clerk config change — separate decision), multi-page welcome carousel, deleting Account's `SignedOutView` (O-D2 cleanup later), any backend change.

## Verification checklist

Build green · full `ClaraTests` green (baseline + RootGate tests) · `onboarding` fixture screenshot normal + XXL with no truncation · seeded `signedIn` fixtures land in tabs unchanged · live smoke: fresh launch → onboarding → real sign-in → tabs → Restaurants loads production data → sign-out returns to onboarding · mock layout pixel-unchanged by wiring (screenshot diff vs approved mock).
