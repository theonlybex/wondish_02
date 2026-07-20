# Clara iOS Phase 1 — Project Setup + Design System Port (+ Clara backend hardening)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the native **Clara** iOS app (Swift + SwiftUI, iPhone-only) as a **separate project in its own folder and git repo** at `/Users/becks/Desktop/NewView/Clara`, with the full Wondish web design system ported as SwiftUI tokens/components and a 5-tab HIG shell — and fix the known Clara backend bugs (C1–C5 + wrong model id) in the web repo so later phases build on a working chat endpoint.

**Architecture:** The iOS app is a standalone repo generated deterministically from an XcodeGen `project.yml`. Design tokens come 1:1 from the web repo's `Landing page designs/wondish-css-guide.md` / `tailwind.config.ts` into a single `Theme.swift`, consumed by a small set of reusable components (`WButton`, `WBadge`, `WCard`, `WTextField`, `VerdictBadge`, `BrandWordmark`). The Clara backend fixes live in the web repo (`/Users/becks/Desktop/NewView/wondish_02`) on a feature branch, extracting testable logic into `lib/chat-history.ts` covered by the repo's existing `node --test` runner.

**Tech Stack:** Swift 5.9+ / SwiftUI, iOS 17.0 deployment target, XcodeGen, XCTest; web side: Next.js 14, TypeScript, Anthropic SDK.

## Global Constraints

- iOS app location: `/Users/becks/Desktop/NewView/Clara` — its own git repository, fully separate from the web repo. App (product + display) name: **Clara**. Bundle id: `io.wondish.clara`.
- Web repo (Task 1 only): `/Users/becks/Desktop/NewView/wondish_02`, on branch `clara-backend-fixes`.
- Swift + SwiftUI only; no cross-platform frameworks.
- iPhone only (`TARGETED_DEVICE_FAMILY = 1`), portrait only, App Store distribution target.
- Reuse the existing backend; no new endpoints in this phase.
- English only (no i18n scaffolding in the app yet).
- Brand tokens are fixed (Wondish brand): primary `#812549`, primary-light `#B75E78`, primary-dark `#5F1C35`, background `#F9F7ED`, secondary cream `#F5F1DD`, border `#EAE4CA`, text `#1E1A1A`, secondary text `#4F4A4A`, tertiary `#848181`, placeholder `#A8A4B5`, success `#00B9A6`, warning `#FDC221`, error `#EA5455`.
- Typography: Inter 400/500/600/700/800, bundled; graceful fallback to the system font if registration fails.
- Anthropic model id everywhere: `claude-sonnet-5` (decided post-review 2026-07-19: newest Sonnet, high-res vision for ingredient recognition, same price tier as 4.6; supersedes the earlier `claude-sonnet-4-5` constraint which was based on a wrong belief that `claude-sonnet-4-6` was invalid). Note: Sonnet 5 rejects non-default `temperature`/`top_p`/`top_k` and runs adaptive thinking by default when `thinking` is omitted.
- iOS HIG: SF Symbols (no emoji icons), ≥44pt touch targets, bottom tab bar ≤5 items with labels, respect safe areas, support Dynamic Type.
- Web repo test command: `npm test` (runs `node --import tsx --test lib/*.test.ts data/*.test.ts middleware.test.ts`).

---

### Task 1: Clara backend hardening (web repo — fixes C1–C5 + model id)

**Repo:** `/Users/becks/Desktop/NewView/wondish_02` — create and work on branch `clara-backend-fixes` (branched from `main`).

**Files:**
- Create: `lib/chat-history.ts`
- Create: `lib/chat-history.test.ts`
- Modify: `app/api/dish-checker/route.ts`
- Modify: `components/dish-checker/DishCheckerClient.tsx`

**Interfaces:**
- Produces: `sanitizeChatHistory(input: unknown): { role: "user" | "assistant"; content: string }[] | null` in `lib/chat-history.ts` — returns `null` for invalid payloads; otherwise drops non-user/assistant roles and empty contents, drops leading assistant messages (C2), truncates each message to 4000 chars, and keeps only the last 20 messages (C5). The dish-checker route consumes this; the iOS Clara client in Phase 5 relies on this server-side tolerance.

- [ ] **Step 0: Create the branch**

```bash
cd /Users/becks/Desktop/NewView/wondish_02 && git checkout -b clara-backend-fixes
```

- [ ] **Step 1: Write the failing test**

Create `lib/chat-history.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeChatHistory } from "./chat-history";

test("returns null for non-array payloads", () => {
  assert.equal(sanitizeChatHistory(undefined), null);
  assert.equal(sanitizeChatHistory("hi"), null);
  assert.equal(sanitizeChatHistory({ messages: [] }), null);
});

test("drops leading assistant messages so the first message is from the user (C2)", () => {
  const result = sanitizeChatHistory([
    { role: "assistant", content: "Hi, I'm Clara!" },
    { role: "user", content: "Can I eat paella?" },
    { role: "assistant", content: "Let me check." },
  ]);
  assert.deepEqual(result, [
    { role: "user", content: "Can I eat paella?" },
    { role: "assistant", content: "Let me check." },
  ]);
});

test("filters invalid roles and empty content", () => {
  const result = sanitizeChatHistory([
    { role: "system", content: "ignore me" },
    { role: "user", content: "   " },
    { role: "user", content: "real question" },
  ]);
  assert.deepEqual(result, [{ role: "user", content: "real question" }]);
});

test("truncates each message to 4000 chars", () => {
  const result = sanitizeChatHistory([{ role: "user", content: "x".repeat(5000) }]);
  assert.equal(result?.[0].content.length, 4000);
});

test("keeps only the last 20 messages, still starting with a user message (C5)", () => {
  const long = Array.from({ length: 30 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `msg ${i}`,
  }));
  const result = sanitizeChatHistory(long);
  assert.equal(result!.length, 20);
  assert.equal(result![0].role, "user");
  assert.equal(result![result!.length - 1].content, "msg 29");
});

test("returns empty array when nothing survives (caller should 400)", () => {
  assert.deepEqual(sanitizeChatHistory([{ role: "assistant", content: "hello" }]), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test lib/chat-history.test.ts`
Expected: FAIL — `Cannot find module './chat-history'`.

- [ ] **Step 3: Write the implementation**

Create `lib/chat-history.ts`:

```ts
export type ChatMessage = { role: "user" | "assistant"; content: string };

const MAX_MESSAGE_CHARS = 4000;
const MAX_MESSAGES = 20;

/**
 * Normalizes an untrusted chat history payload for the Anthropic Messages API.
 * Returns null when the payload is not an array. The result always starts
 * with a user message (Anthropic rejects leading assistant messages) and is
 * capped to the most recent MAX_MESSAGES entries.
 */
export function sanitizeChatHistory(input: unknown): ChatMessage[] | null {
  if (!Array.isArray(input)) return null;

  const valid = input
    .filter(
      (m): m is { role: string; content: string } =>
        !!m &&
        typeof m === "object" &&
        (m as { role?: unknown }).role !== undefined &&
        typeof (m as { content?: unknown }).content === "string"
    )
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim().length > 0)
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content.slice(0, MAX_MESSAGE_CHARS),
    }));

  let recent = valid.slice(-MAX_MESSAGES);
  while (recent.length > 0 && recent[0].role === "assistant") {
    recent = recent.slice(1);
  }
  return recent;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test lib/chat-history.test.ts`
Expected: PASS (6 tests). Note the "last 20" test: slicing the last 20 of the 30-message fixture lands on `msg 10` (user), so no extra trimming occurs; the leading-assistant guard is still exercised by the C2 test.

- [ ] **Step 5: Wire the route to the helper, add stream error handling (C3), fix the model id**

Modify `app/api/dish-checker/route.ts`:

1. Replace the inline message validation/filtering/truncation block with:

```ts
import { sanitizeChatHistory } from "@/lib/chat-history";
// ...inside POST, after parsing the JSON body:
const history = sanitizeChatHistory(body?.messages);
if (history === null || history.length === 0) {
  return NextResponse.json({ error: "Invalid messages" }, { status: 400 });
}
```

2. Change the model id in the `anthropic.messages.stream({...})` call from `"claude-sonnet-4-6"` to `"claude-sonnet-4-5"`.

3. Wrap the streaming loop so mid-stream failures propagate instead of closing the stream as a success (C3). The `ReadableStream`'s `start(controller)` body becomes:

```ts
try {
  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      controller.enqueue(encoder.encode(event.delta.text));
    }
  }
  controller.close();
} catch (err) {
  console.error("dish-checker stream error", err);
  controller.error(err);
}
```

4. Before starting the stream, keep/extend the existing error paths so Anthropic API errors thrown when creating the stream return JSON: catch `Anthropic.APIError` and map `status 429` → `NextResponse.json({ error: "Clara is busy, try again in a moment" }, { status: 429 })`, `status 529` → same message with status 503, anything else → 500 `{ error: "Clara is unavailable right now" }`.

- [ ] **Step 6: Fix the web client (C2 sender side + C4 decoder)**

Modify `components/dish-checker/DishCheckerClient.tsx`:

1. Where the request body is built from `history`, exclude the canned greeting so the server never receives a leading assistant message (defense in depth alongside the server fix): send `messages: history.filter((m, i) => !(i === 0 && m.role === "assistant"))`.
2. In the stream-reading loop, change `decoder.decode(value)` to `decoder.decode(value, { stream: true })` so multi-byte characters (✅/❌) split across chunks render correctly (C4).
3. In the same loop's completion path, surface stream failures: wrap the reader loop in `try/catch` and on error replace the empty assistant placeholder content with `"Sorry — something went wrong. Please try again."`.

- [ ] **Step 7: Verify C1 (API key) and run the full web test suite**

Run: `grep -l "ANTHROPIC_API_KEY" .env .env.local 2>/dev/null; grep "ANTHROPIC_API_KEY" .env.example`
Expected: `.env.example` lists it. If no local env file defines it, report this to the user (they must set it in local/prod env; do not invent a key).

Run: `npm test`
Expected: all existing tests plus the 6 new chat-history tests PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/chat-history.ts lib/chat-history.test.ts app/api/dish-checker/route.ts components/dish-checker/DishCheckerClient.tsx
git commit -m "fix(dish-checker): sanitize chat history, surface stream errors, correct model id (C1-C5)"
```

---

### Task 2: Clara iOS project scaffold (separate repo, XcodeGen, empty app that builds)

**Repo:** `/Users/becks/Desktop/NewView/Clara` (created in this task; all remaining tasks work here).

**Files:**
- Create: `/Users/becks/Desktop/NewView/Clara/.gitignore`
- Create: `/Users/becks/Desktop/NewView/Clara/project.yml`
- Create: `/Users/becks/Desktop/NewView/Clara/Clara/App/ClaraApp.swift`
- Create: `/Users/becks/Desktop/NewView/Clara/Clara/App/RootTabView.swift` (placeholder; fleshed out in Task 5)
- Create: `/Users/becks/Desktop/NewView/Clara/ClaraTests/SmokeTests.swift`

**Interfaces:**
- Produces: a `Clara.xcodeproj` generated by `xcodegen generate` from `project.yml`; app target `Clara` (bundle id `io.wondish.clara`, display name "Clara"), test target `ClaraTests`. All later tasks add files under `Clara/**` and re-run `xcodegen generate`. The generated `.xcodeproj` is committed so the project opens in Xcode without tooling.

- [ ] **Step 1: Install XcodeGen (not currently installed) and init the repo**

```bash
brew install xcodegen
mkdir -p /Users/becks/Desktop/NewView/Clara && cd /Users/becks/Desktop/NewView/Clara && git init
```
Expected: `xcodegen --version` prints a version; empty git repo initialized. If brew fails, stop and report — do not hand-write a pbxproj.

- [ ] **Step 2: Write .gitignore and the project spec**

Create `/Users/becks/Desktop/NewView/Clara/.gitignore`:

```
build/
DerivedData/
xcuserdata/
.DS_Store
```

Create `/Users/becks/Desktop/NewView/Clara/project.yml`:

```yaml
name: Clara
options:
  bundleIdPrefix: io.wondish
  createIntermediateGroups: true
  deploymentTarget:
    iOS: "17.0"
settings:
  base:
    SWIFT_VERSION: "5.9"
    TARGETED_DEVICE_FAMILY: "1"
    CODE_SIGN_STYLE: Automatic
targets:
  Clara:
    type: application
    platform: iOS
    sources:
      - Clara
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: io.wondish.clara
        MARKETING_VERSION: 0.1.0
        CURRENT_PROJECT_VERSION: 1
        GENERATE_INFOPLIST_FILE: YES
        INFOPLIST_KEY_UILaunchScreen_Generation: YES
        INFOPLIST_KEY_UISupportedInterfaceOrientations: UIInterfaceOrientationPortrait
        INFOPLIST_KEY_CFBundleDisplayName: Clara
  ClaraTests:
    type: bundle.unit-test
    platform: iOS
    sources:
      - ClaraTests
    dependencies:
      - target: Clara
```

(`UIAppFonts` is added in Task 3 when the fonts exist.)

- [ ] **Step 3: Write the app entry point**

Create `/Users/becks/Desktop/NewView/Clara/Clara/App/ClaraApp.swift`:

```swift
import SwiftUI

@main
struct ClaraApp: App {
    var body: some Scene {
        WindowGroup {
            RootTabView()
        }
    }
}
```

Create `/Users/becks/Desktop/NewView/Clara/Clara/App/RootTabView.swift` (minimal placeholder, replaced in Task 5):

```swift
import SwiftUI

struct RootTabView: View {
    var body: some View {
        Text("Clara")
    }
}

#Preview {
    RootTabView()
}
```

- [ ] **Step 4: Write a smoke test**

Create `/Users/becks/Desktop/NewView/Clara/ClaraTests/SmokeTests.swift`:

```swift
import XCTest
@testable import Clara

final class SmokeTests: XCTestCase {
    func testAppModuleLoads() {
        XCTAssertTrue(true)
    }
}
```

- [ ] **Step 5: Generate and build**

```bash
cd /Users/becks/Desktop/NewView/Clara && xcodegen generate
xcodebuild -project Clara.xcodeproj -scheme Clara -destination 'generic/platform=iOS Simulator' build
```
Expected: `BUILD SUCCEEDED`.

- [ ] **Step 6: Commit**

```bash
cd /Users/becks/Desktop/NewView/Clara
git add -A
git commit -m "feat: scaffold Clara iOS app via XcodeGen (iPhone-only, iOS 17)"
```

---

### Task 3: Design tokens — Theme.swift + bundled Inter fonts

**Repo:** `/Users/becks/Desktop/NewView/Clara`

**Files:**
- Create: `Clara/DesignSystem/Theme.swift`
- Create: `Clara/Resources/Fonts/Inter-Regular.ttf`, `Inter-Medium.ttf`, `Inter-SemiBold.ttf`, `Inter-Bold.ttf`, `Inter-ExtraBold.ttf` (downloaded)
- Modify: `project.yml` (add `info` block with `UIAppFonts`)
- Create: `ClaraTests/ThemeTests.swift`

**Interfaces:**
- Produces (used by every later UI task):
  - `Color(hex: UInt32)` initializer
  - `enum WColor` — static `Color` tokens: `primary`, `primaryLight`, `primaryDark`, `background`, `surface` (white), `surfaceSecondary`, `border`, `textPrimary`, `textSecondary`, `textTertiary`, `placeholder`, `success`, `warning`, `error`, and `brandGradient: LinearGradient`
  - `enum WFont` — `static func inter(_ size: CGFloat, _ weight: WFont.Weight) -> Font` with `Weight` cases `regular, medium, semibold, bold, extrabold`; falls back to `Font.system` when Inter isn't registered
  - `enum WSpacing` — `xs: CGFloat = 4, sm = 8, md = 12, lg = 16, xl = 24, xxl = 32, xxxl = 48`
  - `enum WRadius` — `sm: CGFloat = 8, md = 12, lg = 16, card = 24, pill = 9999`

- [ ] **Step 1: Write the failing token tests**

Create `ClaraTests/ThemeTests.swift`:

```swift
import XCTest
import SwiftUI
@testable import Clara

final class ThemeTests: XCTestCase {
    func testHexInitializerProducesExpectedComponents() {
        let color = UIColor(Color(hex: 0x812549))
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        color.getRed(&r, green: &g, blue: &b, alpha: &a)
        XCTAssertEqual(r, 129.0 / 255.0, accuracy: 0.001)
        XCTAssertEqual(g, 37.0 / 255.0, accuracy: 0.001)
        XCTAssertEqual(b, 73.0 / 255.0, accuracy: 0.001)
        XCTAssertEqual(a, 1.0, accuracy: 0.001)
    }

    func testSpacingScaleIsFourPointBased() {
        XCTAssertEqual(WSpacing.xs, 4)
        XCTAssertEqual(WSpacing.lg, 16)
        XCTAssertEqual(WSpacing.xxxl, 48)
    }

    func testInterFontFallsBackGracefully() {
        // Must not crash whether or not Inter registered.
        _ = WFont.inter(16, .semibold)
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run (using a concrete simulator — list with `xcrun simctl list devices available | grep iPhone` and substitute the first name):
```bash
cd /Users/becks/Desktop/NewView/Clara
xcodebuild -project Clara.xcodeproj -scheme Clara -destination 'platform=iOS Simulator,name=<FIRST_AVAILABLE_IPHONE>' test
```
Expected: compile FAILURE — `WColor`/`WSpacing`/`WFont` not defined.

- [ ] **Step 3: Download Inter static TTFs**

```bash
cd /private/tmp/claude-501/-Users-becks-Desktop-NewView-wondish-02/a7f20b3c-c93e-41d1-a385-64126daff63b/scratchpad
curl -L -o inter.zip https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip
unzip -o inter.zip -d inter
find inter -name "Inter-Regular.ttf" -o -name "Inter-Medium.ttf" -o -name "Inter-SemiBold.ttf" -o -name "Inter-Bold.ttf" -o -name "Inter-ExtraBold.ttf"
```
Expected: five static TTF paths (in the release's `extras/ttf/` or similar). Copy them:
```bash
mkdir -p /Users/becks/Desktop/NewView/Clara/Clara/Resources/Fonts
cp <found paths> /Users/becks/Desktop/NewView/Clara/Clara/Resources/Fonts/
```
If the download fails (offline), skip this step and Step 5's `UIAppFonts` — `WFont` falls back to the system font by design; note it in the task report.

- [ ] **Step 4: Write Theme.swift**

Create `Clara/DesignSystem/Theme.swift`:

```swift
import SwiftUI

// MARK: - Color hex

extension Color {
    /// Color from 0xRRGGBB. Tokens below mirror the web app's
    /// tailwind.config.ts / "Landing page designs/wondish-css-guide.md"
    /// in the wondish_02 repo — keep in sync.
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255.0,
            green: Double((hex >> 8) & 0xFF) / 255.0,
            blue: Double(hex & 0xFF) / 255.0,
            opacity: 1.0
        )
    }
}

// MARK: - Tokens

enum WColor {
    static let primary = Color(hex: 0x812549)
    static let primaryLight = Color(hex: 0xB75E78)
    static let primaryDark = Color(hex: 0x5F1C35)

    static let background = Color(hex: 0xF9F7ED)
    static let surface = Color.white
    static let surfaceSecondary = Color(hex: 0xF5F1DD)
    static let border = Color(hex: 0xEAE4CA)

    static let textPrimary = Color(hex: 0x1E1A1A)
    static let textSecondary = Color(hex: 0x4F4A4A)
    static let textTertiary = Color(hex: 0x848181)
    static let placeholder = Color(hex: 0xA8A4B5)

    static let success = Color(hex: 0x00B9A6)
    static let warning = Color(hex: 0xFDC221)
    static let error = Color(hex: 0xEA5455)

    static let brandGradient = LinearGradient(
        colors: [Color(hex: 0x812549), Color(hex: 0x5F1C35), Color(hex: 0x71203F)],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )
}

enum WFont {
    enum Weight: String, CaseIterable {
        case regular = "Inter-Regular"
        case medium = "Inter-Medium"
        case semibold = "Inter-SemiBold"
        case bold = "Inter-Bold"
        case extrabold = "Inter-ExtraBold"

        var systemWeight: Font.Weight {
            switch self {
            case .regular: return .regular
            case .medium: return .medium
            case .semibold: return .semibold
            case .bold: return .bold
            case .extrabold: return .heavy
            }
        }
    }

    private static let interAvailable: Bool =
        UIFont(name: Weight.regular.rawValue, size: 16) != nil

    /// Inter when bundled/registered, otherwise the system font at the same
    /// weight so the app never renders with a missing font.
    static func inter(_ size: CGFloat, _ weight: Weight = .regular) -> Font {
        interAvailable
            ? .custom(weight.rawValue, size: size)
            : .system(size: size, weight: weight.systemWeight)
    }
}

enum WSpacing {
    static let xs: CGFloat = 4
    static let sm: CGFloat = 8
    static let md: CGFloat = 12
    static let lg: CGFloat = 16
    static let xl: CGFloat = 24
    static let xxl: CGFloat = 32
    static let xxxl: CGFloat = 48
}

enum WRadius {
    static let sm: CGFloat = 8
    static let md: CGFloat = 12
    static let lg: CGFloat = 16
    static let card: CGFloat = 24
    static let pill: CGFloat = 9999
}
```

- [ ] **Step 5: Register fonts in project.yml**

In `project.yml`, inside the `Clara` target add an `info` block (XcodeGen switches from `GENERATE_INFOPLIST_FILE` to a generated plist file — remove the `GENERATE_INFOPLIST_FILE` and `INFOPLIST_KEY_*` settings and move them into `info.properties`):

```yaml
    info:
      path: Clara/Info.plist
      properties:
        CFBundleDisplayName: Clara
        UILaunchScreen: {}
        UISupportedInterfaceOrientations: [UIInterfaceOrientationPortrait]
        UIAppFonts:
          - Inter-Regular.ttf
          - Inter-Medium.ttf
          - Inter-SemiBold.ttf
          - Inter-Bold.ttf
          - Inter-ExtraBold.ttf
```

(The `Resources` folder is already inside `Clara/` and therefore picked up by the existing `sources: [Clara]`.)

- [ ] **Step 6: Regenerate, run tests to verify they pass**

```bash
cd /Users/becks/Desktop/NewView/Clara && xcodegen generate
xcodebuild -project Clara.xcodeproj -scheme Clara -destination 'platform=iOS Simulator,name=<FIRST_AVAILABLE_IPHONE>' test
```
Expected: `TEST SUCCEEDED`, ThemeTests + SmokeTests pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/becks/Desktop/NewView/Clara
git add -A
git commit -m "feat: port Wondish design tokens (colors, Inter type, spacing, radius)"
```

---

### Task 4: Core components — WButton, WBadge, WCard, WTextField, VerdictBadge, BrandWordmark

**Repo:** `/Users/becks/Desktop/NewView/Clara`

**Files:**
- Create: `Clara/DesignSystem/WButton.swift`
- Create: `Clara/DesignSystem/WBadge.swift`
- Create: `Clara/DesignSystem/WCard.swift`
- Create: `Clara/DesignSystem/WTextField.swift`
- Create: `Clara/DesignSystem/VerdictBadge.swift`
- Create: `Clara/DesignSystem/BrandWordmark.swift`
- Create: `Clara/DesignSystem/ComponentGallery.swift` (debug/preview screen)

**Interfaces:**
- Consumes: `WColor`, `WFont`, `WSpacing`, `WRadius` from Task 3.
- Produces (used by all feature screens in Phases 3–6):
  - `WButtonStyle(variant:size:)` — `ButtonStyle`; `Variant` cases `primary, secondary, ghost, danger`; `Size` cases `sm, md, lg`
  - `WBadge(text:variant:)` — `View`; `Variant` cases `primary, success, warning, error, info, neutral`
  - `View.wCard()` — modifier: white surface, 1px `WColor.border`, `WRadius.lg` corners
  - `WTextField(label:placeholder:text:)` — labeled input matching web `Input.tsx`
  - `Verdict` enum: `case fits, caution, doesntFit` and `VerdictBadge(verdict:)` — the Picture Mode verdict UI primitive
  - `BrandWordmark(color:)` — the "Wondish" wordmark (Inter ExtraBold text placeholder until the SVG is exported to PDF in App Store prep)

- [ ] **Step 1: Write WButton**

Create `Clara/DesignSystem/WButton.swift`:

```swift
import SwiftUI

struct WButtonStyle: ButtonStyle {
    enum Variant { case primary, secondary, ghost, danger }
    enum Size { case sm, md, lg }

    var variant: Variant = .primary
    var size: Size = .md

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(WFont.inter(fontSize, .semibold))
            .padding(.horizontal, hPadding)
            .frame(minHeight: minHeight)
            .background(background)
            .foregroundStyle(foreground)
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .opacity(configuration.isPressed ? 0.85 : 1)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.spring(duration: 0.2), value: configuration.isPressed)
    }

    private var fontSize: CGFloat { size == .sm ? 13 : 15 }
    private var hPadding: CGFloat {
        switch size { case .sm: return 12; case .md: return 16; case .lg: return 24 }
    }
    // 44pt minimum touch target on md/lg (HIG).
    private var minHeight: CGFloat { size == .sm ? 36 : 48 }
    private var cornerRadius: CGFloat { size == .sm ? WRadius.sm : WRadius.md }

    private var background: some ShapeStyle {
        switch variant {
        case .primary: return AnyShapeStyle(WColor.primary)
        case .secondary: return AnyShapeStyle(WColor.surfaceSecondary)
        case .ghost: return AnyShapeStyle(Color.clear)
        case .danger: return AnyShapeStyle(WColor.error.opacity(0.1))
        }
    }

    private var foreground: Color {
        switch variant {
        case .primary: return .white
        case .secondary: return WColor.primary
        case .ghost: return WColor.primary
        case .danger: return WColor.error
        }
    }
}

#Preview {
    VStack(spacing: WSpacing.lg) {
        Button("Scan a meal") {}.buttonStyle(WButtonStyle(variant: .primary, size: .lg))
        Button("Secondary") {}.buttonStyle(WButtonStyle(variant: .secondary))
        Button("Delete") {}.buttonStyle(WButtonStyle(variant: .danger, size: .sm))
    }
    .padding()
    .background(WColor.background)
}
```

- [ ] **Step 2: Write WBadge**

Create `Clara/DesignSystem/WBadge.swift`:

```swift
import SwiftUI

struct WBadge: View {
    enum Variant { case primary, success, warning, error, info, neutral }

    let text: String
    var variant: Variant = .neutral

    var body: some View {
        Text(text)
            .font(WFont.inter(12, .semibold))
            .padding(.horizontal, 10)
            .padding(.vertical, 3)
            .background(tint.opacity(0.12))
            .foregroundStyle(tint)
            .clipShape(Capsule())
    }

    private var tint: Color {
        switch variant {
        case .primary: return WColor.primary
        case .success: return WColor.success
        case .warning: return Color(hex: 0xDEA402) // darker yellow for 4.5:1 text contrast
        case .error: return WColor.error
        case .info: return WColor.success
        case .neutral: return WColor.textSecondary
        }
    }
}

#Preview {
    HStack {
        WBadge(text: "Breakfast", variant: .warning)
        WBadge(text: "Lunch", variant: .success)
        WBadge(text: "Dinner", variant: .primary)
    }
    .padding()
    .background(WColor.background)
}
```

- [ ] **Step 3: Write WCard modifier**

Create `Clara/DesignSystem/WCard.swift`:

```swift
import SwiftUI

/// Flat white card with hairline border — mirrors the web
/// `bg-white border border-[#EAE4CA] rounded-2xl` idiom. No shadows (flat UI).
struct WCardModifier: ViewModifier {
    var padding: CGFloat = WSpacing.xl

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(WColor.surface)
            .clipShape(RoundedRectangle(cornerRadius: WRadius.lg, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: WRadius.lg, style: .continuous)
                    .strokeBorder(WColor.border, lineWidth: 1)
            )
    }
}

extension View {
    func wCard(padding: CGFloat = WSpacing.xl) -> some View {
        modifier(WCardModifier(padding: padding))
    }
}
```

- [ ] **Step 4: Write WTextField**

Create `Clara/DesignSystem/WTextField.swift`:

```swift
import SwiftUI

struct WTextField: View {
    let label: String
    let placeholder: String
    @Binding var text: String

    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: WSpacing.sm) {
            Text(label)
                .font(WFont.inter(14, .medium))
                .foregroundStyle(WColor.textPrimary)
            TextField(placeholder, text: $text)
                .font(WFont.inter(15))
                .focused($focused)
                .padding(.horizontal, 14)
                .frame(minHeight: 44)
                .background(WColor.surface)
                .clipShape(RoundedRectangle(cornerRadius: WRadius.md, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: WRadius.md, style: .continuous)
                        .strokeBorder(focused ? WColor.primary : WColor.border,
                                      lineWidth: focused ? 2 : 1)
                )
        }
    }
}

#Preview {
    struct Demo: View {
        @State var value = ""
        var body: some View {
            WTextField(label: "Email", placeholder: "you@example.com", text: $value)
                .padding()
                .background(WColor.background)
        }
    }
    return Demo()
}
```

- [ ] **Step 5: Write VerdictBadge (Picture Mode primitive)**

Create `Clara/DesignSystem/VerdictBadge.swift`:

```swift
import SwiftUI

enum Verdict {
    case fits, caution, doesntFit

    var label: String {
        switch self {
        case .fits: return "Fits your plan"
        case .caution: return "Caution"
        case .doesntFit: return "Doesn't fit"
        }
    }

    var systemImage: String {
        switch self {
        case .fits: return "checkmark.seal.fill"
        case .caution: return "exclamationmark.triangle.fill"
        case .doesntFit: return "xmark.seal.fill"
        }
    }

    var tint: Color {
        switch self {
        case .fits: return WColor.success
        case .caution: return Color(hex: 0xDEA402)
        case .doesntFit: return WColor.error
        }
    }
}

struct VerdictBadge: View {
    let verdict: Verdict

    var body: some View {
        Label(verdict.label, systemImage: verdict.systemImage)
            .font(WFont.inter(14, .semibold))
            .padding(.horizontal, WSpacing.md)
            .padding(.vertical, WSpacing.sm)
            .background(verdict.tint.opacity(0.12))
            .foregroundStyle(verdict.tint)
            .clipShape(Capsule())
            .accessibilityLabel("Verdict: \(verdict.label)")
    }
}

#Preview {
    VStack(spacing: WSpacing.md) {
        VerdictBadge(verdict: .fits)
        VerdictBadge(verdict: .caution)
        VerdictBadge(verdict: .doesntFit)
    }
    .padding()
    .background(WColor.background)
}
```

- [ ] **Step 6: Write BrandWordmark**

Create `Clara/DesignSystem/BrandWordmark.swift`:

```swift
import SwiftUI

/// Text-based wordmark stand-in. The real vector wordmark
/// (wondish_02 repo: "Landing page designs/Wondish-logo.svg") gets exported
/// to a PDF asset during App Store prep; keep this API so call sites don't change.
struct BrandWordmark: View {
    var color: Color = WColor.primary
    var size: CGFloat = 28

    var body: some View {
        Text("Wondish")
            .font(WFont.inter(size, .extrabold))
            .kerning(-0.5)
            .foregroundStyle(color)
            .accessibilityLabel("Wondish")
    }
}
```

- [ ] **Step 7: Write the component gallery**

Create `Clara/DesignSystem/ComponentGallery.swift`:

```swift
import SwiftUI

/// Internal visual QA screen: every design-system primitive in one scroll.
struct ComponentGallery: View {
    @State private var sample = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: WSpacing.xl) {
                BrandWordmark()
                Button("Primary lg") {}.buttonStyle(WButtonStyle(variant: .primary, size: .lg))
                Button("Secondary md") {}.buttonStyle(WButtonStyle(variant: .secondary))
                Button("Danger sm") {}.buttonStyle(WButtonStyle(variant: .danger, size: .sm))
                HStack {
                    WBadge(text: "Breakfast", variant: .warning)
                    WBadge(text: "Lunch", variant: .success)
                    WBadge(text: "Snack", variant: .info)
                }
                VStack(spacing: WSpacing.md) {
                    VerdictBadge(verdict: .fits)
                    VerdictBadge(verdict: .caution)
                    VerdictBadge(verdict: .doesntFit)
                }
                WTextField(label: "Email", placeholder: "you@example.com", text: $sample)
                Text("Card content")
                    .font(WFont.inter(15))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .wCard()
            }
            .padding(WSpacing.xl)
        }
        .background(WColor.background)
    }
}

#Preview { ComponentGallery() }
```

- [ ] **Step 8: Regenerate, build, run existing tests**

```bash
cd /Users/becks/Desktop/NewView/Clara && xcodegen generate
xcodebuild -project Clara.xcodeproj -scheme Clara -destination 'platform=iOS Simulator,name=<FIRST_AVAILABLE_IPHONE>' test
```
Expected: `TEST SUCCEEDED` (components compile; ThemeTests still green).

- [ ] **Step 9: Commit**

```bash
cd /Users/becks/Desktop/NewView/Clara
git add -A
git commit -m "feat: design-system components (button, badge, card, field, verdict, wordmark)"
```

---

### Task 5: App shell — 5-tab RootTabView with themed placeholders

**Repo:** `/Users/becks/Desktop/NewView/Clara`

**Files:**
- Modify: `Clara/App/RootTabView.swift`
- Create: `Clara/Features/Scan/ScanPlaceholderView.swift`
- Create: `Clara/Features/Fridge/FridgePlaceholderView.swift`
- Create: `Clara/Features/Chat/ChatPlaceholderView.swift`
- Create: `Clara/Features/Stats/StatsPlaceholderView.swift`
- Create: `Clara/Features/Account/AccountPlaceholderView.swift`

**Interfaces:**
- Consumes: Task 3 tokens, Task 4 components.
- Produces: `RootTabView` with `Tab` enum (`scan, fridge, chat, stats, account`); **Scan is the default selected tab** so Picture Mode is zero taps from launch. Each placeholder view is replaced wholesale in its feature phase — later phases keep the file paths.

- [ ] **Step 1: Write the placeholder views**

Each placeholder follows this pattern (repeat for all five — Scan shown fully, then the variant lines for the others):

Create `Clara/Features/Scan/ScanPlaceholderView.swift`:

```swift
import SwiftUI

struct ScanPlaceholderView: View {
    var body: some View {
        NavigationStack {
            VStack(spacing: WSpacing.xl) {
                Image(systemName: "camera.viewfinder")
                    .font(.system(size: 56, weight: .light))
                    .foregroundStyle(WColor.primary)
                Text("Point Clara at your plate")
                    .font(WFont.inter(22, .extrabold))
                    .foregroundStyle(WColor.textPrimary)
                Text("Snap a photo and Clara checks it against your way of eating.")
                    .font(WFont.inter(15))
                    .foregroundStyle(WColor.textSecondary)
                    .multilineTextAlignment(.center)
                Button("Coming in Phase 3") {}
                    .buttonStyle(WButtonStyle(variant: .secondary))
                    .disabled(true)
            }
            .padding(WSpacing.xxl)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(WColor.background)
            .navigationTitle("Scan")
        }
    }
}
```

The other four use the same skeleton with these substitutions:

| File | symbol | title text | nav title | phase button |
|---|---|---|---|---|
| `FridgePlaceholderView.swift` | `refrigerator` | "What's in your fridge?" | "Fridge" | "Coming in Phase 4" |
| `ChatPlaceholderView.swift` | `bubble.left.and.text.bubble.right` | "Ask Clara anything" | "Clara" | "Coming in Phase 5" |
| `StatsPlaceholderView.swift` | `chart.bar.xaxis` | "Your progress" | "Stats" | "Coming in Phase 6" |
| `AccountPlaceholderView.swift` | `person.crop.circle` | "Your account" | "Account" | "Coming in Phase 2" |

(Body copy: one friendly sentence each.)

- [ ] **Step 2: Write RootTabView**

Replace `Clara/App/RootTabView.swift`:

```swift
import SwiftUI

struct RootTabView: View {
    enum Tab { case scan, fridge, chat, stats, account }

    @State private var selection: Tab = .scan

    init() {
        // Cream tab bar with hairline top border, matching the web chrome.
        let appearance = UITabBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = UIColor(WColor.background)
        appearance.shadowColor = UIColor(WColor.border)
        UITabBar.appearance().standardAppearance = appearance
        UITabBar.appearance().scrollEdgeAppearance = appearance
    }

    var body: some View {
        TabView(selection: $selection) {
            ScanPlaceholderView()
                .tabItem { Label("Scan", systemImage: "camera.viewfinder") }
                .tag(Tab.scan)
            FridgePlaceholderView()
                .tabItem { Label("Fridge", systemImage: "refrigerator") }
                .tag(Tab.fridge)
            ChatPlaceholderView()
                .tabItem { Label("Clara", systemImage: "bubble.left.and.text.bubble.right") }
                .tag(Tab.chat)
            StatsPlaceholderView()
                .tabItem { Label("Stats", systemImage: "chart.bar.xaxis") }
                .tag(Tab.stats)
            AccountPlaceholderView()
                .tabItem { Label("Account", systemImage: "person.crop.circle") }
                .tag(Tab.account)
        }
        .tint(WColor.primary)
    }
}

#Preview { RootTabView() }
```

- [ ] **Step 3: Regenerate, build, boot a simulator, screenshot**

```bash
cd /Users/becks/Desktop/NewView/Clara && xcodegen generate
xcodebuild -project Clara.xcodeproj -scheme Clara -destination 'platform=iOS Simulator,name=<FIRST_AVAILABLE_IPHONE>' build
```
Expected: `BUILD SUCCEEDED`.

Then (using the `using-xcode-cli` skill at execution time): boot the simulator, install and launch `io.wondish.clara`, and capture screenshots of all five tabs to the scratchpad for the VERIFY report.

- [ ] **Step 4: Run the full iOS test suite one final time**

```bash
xcodebuild -project Clara.xcodeproj -scheme Clara -destination 'platform=iOS Simulator,name=<FIRST_AVAILABLE_IPHONE>' test
```
Expected: `TEST SUCCEEDED`.

- [ ] **Step 5: Commit**

```bash
cd /Users/becks/Desktop/NewView/Clara
git add -A
git commit -m "feat: 5-tab HIG shell with Scan as default tab"
```

---

## Out of scope for Phase 1 (deliberately)

- Auth/networking layer, Clerk iOS SDK — Phase 2.
- App icon, launch-screen artwork, camera permission strings, privacy manifest — App Store prep phase.
- Exporting the SVG wordmark to a PDF asset — App Store prep (text wordmark stands in).
- Premium gating / paywall UX — designed in Phase 2 alongside auth (DB `Subscription` check; freemium funnel decided there).
- Any new backend endpoints.
