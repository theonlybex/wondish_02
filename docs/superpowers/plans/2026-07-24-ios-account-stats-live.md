# iOS Account Stats — Live Data Implementation Plan (Cycle B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the demo numbers in the inline Account stats (ring, macro tiles, 7-day trend, today's log) with live server data from `GET /api/meal-log?date=` and `GET /api/journey`, today-only (no date navigation — user directive 2026-07-24).

**Architecture:** New `StatsService` (`StatsProviding` seam) reusing the existing envelope DTOs (`MacroSnapshotDTO`/`DailyTargetDTO`/`RemainingDTO` from `MealLogEnvelopeDTO.swift`), a `StatsViewModel` with the repo's state-enum + generation-guard patterns, and a stateful rewrite of `StatsView` that keeps the approved visual design. All intake numbers are **server echoes** — the client never sums macros (standing rule; iOS Phase 6 amendment: `target > 0` guard, unknown-source tolerance, trend kept as BarMark chart).

**Tech Stack:** SwiftUI (iOS 17 floor), Swift Charts (already imported by `StatsView`), XCTest + `StubURLProtocol`/`StubTokenProvider`.

## Global Constraints

- Repo: `/Users/becks/Desktop/NewView/Clara`; web contract source: `/Users/becks/Desktop/NewView/wondish_02` `main`. Execute AFTER Cycle A (`2026-07-24-ios-meal-plan-live.md`) — it introduces the pbxproj-registration recipe and test helpers this plan reuses.
- **Server echoes only**: ring/tiles/remaining come from `dayTotals`/`dayTarget`/`remaining`; trend bars from `journey.macroStats.dailyMacros`. No client-side macro sums.
- All date fields in new DTOs are `String` (Prisma fractional-second ISO vs `.iso8601` decoder — same rule as Cycle A). Day keys (`localDate`, `dailyMacros[].date`) are `YYYY-MM-DD` strings already.
- `xcodegen` absent — hand-register the 3 new files in `project.pbxproj` (4 insertion points each; example commit `78b1089`).
- Existing suite stays green; tokens-only styling; light-mode lock; commit per task (`feat(stats): …` + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`).

## Backend contracts consumed (verified on wondish_02 `main`, Bearer-ready)

| Call | Contract |
|---|---|
| `GET /api/meal-log?date=YYYY-MM-DD` | `{ date, logs: MealLogDTO[], byMealType, dayTotals, dayTarget, remaining }` (`app/api/meal-log/route.ts:143-160`). `dayTarget` may be null (incomplete caloric profile). |
| `GET /api/journey?from=&to=` | `{ stats, macroStats, entries }`; only `macroStats` is consumed: `{ dailyMacros: [{date, calories, protein, carbs, fat, incomplete}], target: {calories, protein, carbs, fat}\|null, avg…, days… }` (`lib/journey.ts:106-167`, `types/index.ts:152-163`). |

`MealLogDTO` per-entry (`lib/meal-log.ts:559-580`): `{ id, localDate, mealType, source, name, servings, unit?, clientRequestId?, perServing{…}, totals{calories,protein,carbs,fat,fiber,incomplete}, recipeId?, restaurantDishId?, …, deletedAt?, loggedAt, updatedAt }`. **No `kcal`, no `rating`, no `skipped` fields.** `source ∈ {MANUAL, RECIPE, PICTURE, FRIDGE, CUSTOM, RESTAURANT}` — decode as `String` and map leniently (Phase-6 amendment: unknown source must not crash decoding).

---

### Task 1: Stats DTOs + decoding tests

**Files:**
- Create: `Clara/Features/Stats/StatsDTOs.swift`
- Test: `ClaraTests/StatsDTOTests.swift`

**Interfaces:**
- Consumes: `MacroSnapshotDTO`, `DailyTargetDTO`, `RemainingDTO` (existing, `Features/MealLog/MealLogEnvelopeDTO.swift`).
- Produces:
```swift
struct StatsLogRowDTO: Decodable, Equatable, Identifiable { let id, mealType, source, name: String; let totals: MacroSnapshotDTO; let deletedAt: String? }
struct DayLogDTO: Decodable, Equatable { let date: String; let logs: [StatsLogRowDTO]; let dayTotals: MacroSnapshotDTO; let dayTarget: DailyTargetDTO?; let remaining: RemainingDTO? }
struct DailyMacroDTO: Decodable, Equatable { let date: String; let calories, protein, carbs, fat: Double; let incomplete: Bool? }
struct MacroTargetDTO: Decodable, Equatable { let calories, protein, carbs, fat: Double }
struct MacroStatsDTO: Decodable, Equatable { let dailyMacros: [DailyMacroDTO]; let target: MacroTargetDTO? }
struct JourneyDTO: Decodable, Equatable { let macroStats: MacroStatsDTO }   // stats/entries keys ignored
```

- [ ] **Step 1: Write the failing tests** (`ClaraTests/StatsDTOTests.swift`; register in pbxproj test target as part of this step):

```swift
import XCTest
@testable import Clara

final class StatsDTOTests: XCTestCase {
    static let dayJSON = Data("""
    {"date":"2026-07-24",
     "logs":[{"id":"l1","localDate":"2026-07-24","mealType":"breakfast","source":"RECIPE",
       "name":"Overnight Oats","servings":1,"unit":null,"clientRequestId":null,
       "perServing":{"calories":380,"protein":14,"carbs":52,"fat":12,"fiber":8,"incomplete":false},
       "totals":{"calories":380,"protein":14,"carbs":52,"fat":12,"fiber":8,"incomplete":false},
       "recipeId":"r1","restaurantDishId":null,"deletedAt":null,
       "loggedAt":"2026-07-24T15:01:02.123Z","updatedAt":"2026-07-24T15:01:02.123Z"}],
     "byMealType":{"breakfast":[],"lunch":[],"dinner":[],"snack":[]},
     "dayTotals":{"calories":1430,"protein":82,"carbs":145,"fat":48,"fiber":22,"incomplete":false},
     "dayTarget":{"calories":2100,"protein":130,"carbs":210,"fat":70,"basis":"steady-state"},
     "remaining":{"calories":670,"protein":48,"carbs":65,"fat":22}}
    """.utf8)

    func testDayLogDecodes() throws {
        let dto = try JSONDecoder().decode(DayLogDTO.self, from: Self.dayJSON)
        XCTAssertEqual(dto.logs.count, 1)
        XCTAssertEqual(dto.logs[0].source, "RECIPE")
        XCTAssertEqual(dto.logs[0].totals.calories, 380)
        XCTAssertEqual(dto.dayTotals.calories, 1430)
        XCTAssertEqual(dto.dayTarget?.calories, 2100)
        XCTAssertEqual(dto.remaining?.calories, 670)
    }

    func testDayLogNilTargetAndUnknownSourceDecode() throws {
        let json = Data("""
        {"date":"2026-07-24",
         "logs":[{"id":"l2","localDate":"2026-07-24","mealType":"lunch","source":"HOLOGRAM",
           "name":"Future Meal","servings":1,
           "totals":{"calories":500,"protein":1,"carbs":2,"fat":3,"fiber":0}}],
         "dayTotals":{"calories":500,"protein":1,"carbs":2,"fat":3,"fiber":0},
         "dayTarget":null,"remaining":null}
        """.utf8)
        let dto = try JSONDecoder().decode(DayLogDTO.self, from: json)
        XCTAssertEqual(dto.logs[0].source, "HOLOGRAM")   // lenient String, no enum crash
        XCTAssertNil(dto.dayTarget)
    }

    func testJourneyDecodesMacroStatsOnly() throws {
        let json = Data("""
        {"stats":{"avgMood":3,"ignored":true},
         "macroStats":{"dailyMacros":[
            {"date":"2026-07-23","calories":2210,"protein":120,"carbs":200,"fat":60,"incomplete":false},
            {"date":"2026-07-24","calories":1430,"protein":82,"carbs":145,"fat":48,"incomplete":true}],
           "avgCalories":1820,"daysLogged":2,
           "target":{"calories":2100,"protein":130,"carbs":210,"fat":70}},
         "entries":[]}
        """.utf8)
        let dto = try JSONDecoder().decode(JourneyDTO.self, from: json)
        XCTAssertEqual(dto.macroStats.dailyMacros.count, 2)
        XCTAssertEqual(dto.macroStats.dailyMacros[1].incomplete, true)
        XCTAssertEqual(dto.macroStats.target?.protein, 130)
    }
}
```

- [ ] **Step 2: Run** `-only-testing ClaraTests/StatsDTOTests` — compile failure expected.
- [ ] **Step 3: Implement `StatsDTOs.swift`:**

```swift
import Foundation

// Wire mirrors of GET /api/meal-log?date= and GET /api/journey (wondish_02
// app/api/meal-log/route.ts:143-160, lib/journey.ts:106-167). Dates are
// String (Prisma fractional-second ISO vs .iso8601). `source` is a lenient
// String — unknown values render as neutral, never a decode crash (Phase-6
// amendment). Reuses MacroSnapshotDTO/DailyTargetDTO/RemainingDTO from
// MealLogEnvelopeDTO.swift.

struct StatsLogRowDTO: Decodable, Equatable, Identifiable {
    let id: String
    let mealType: String
    let source: String
    let name: String
    let totals: MacroSnapshotDTO
    let deletedAt: String?
}

struct DayLogDTO: Decodable, Equatable {
    let date: String
    let logs: [StatsLogRowDTO]
    let dayTotals: MacroSnapshotDTO
    let dayTarget: DailyTargetDTO?
    let remaining: RemainingDTO?
}

struct DailyMacroDTO: Decodable, Equatable {
    let date: String
    let calories: Double
    let protein: Double
    let carbs: Double
    let fat: Double
    let incomplete: Bool?
}

struct MacroTargetDTO: Decodable, Equatable { let calories, protein, carbs, fat: Double }

struct MacroStatsDTO: Decodable, Equatable {
    let dailyMacros: [DailyMacroDTO]
    let target: MacroTargetDTO?
}

struct JourneyDTO: Decodable, Equatable { let macroStats: MacroStatsDTO }
```

Note: `MacroSnapshotDTO`/`DailyTargetDTO`/`RemainingDTO` must be `Equatable` for these DTOs to be — if they aren't yet, add `Equatable` conformance in `MealLogEnvelopeDTO.swift` (additive, no behavior change).

- [ ] **Step 4: Register in pbxproj, run** — pass.
- [ ] **Step 5: Commit** — `feat(stats): day-log + journey DTOs (lenient source, string dates)`

---

### Task 2: StatsService + request tests

**Files:**
- Create: `Clara/Features/Stats/StatsService.swift`
- Test: `ClaraTests/StatsServiceTests.swift`

**Interfaces:**
- Produces:
```swift
protocol StatsProviding: Sendable {
    func dayLog(date: String) async throws -> DayLogDTO
    func journey(from: String, to: String) async throws -> JourneyDTO
}
struct StatsService: StatsProviding { init(api: WondishAPIClient) }
```

- [ ] **Step 1: Failing tests** (same harness as `MealPlanServiceTests`):

```swift
import XCTest
@testable import Clara

final class StatsServiceTests: XCTestCase {
    override func setUp() { super.setUp(); StubURLProtocol.reset() }

    private func makeService(tokens: StubTokenProvider = .init(fresh: "T0", refreshed: "T1")) -> StatsService {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        return StatsService(api: WondishAPIClient(baseURL: URL(string: "https://x.test")!,
                                                  tokens: tokens, session: URLSession(configuration: config)))
    }

    func testDayLogSendsDateQuery() async throws {
        StubURLProtocol.enqueue(status: 200, body: StatsDTOTests.dayJSON)
        let dto = try await makeService().dayLog(date: "2026-07-24")
        let req = try XCTUnwrap(StubURLProtocol.recorded.first)
        XCTAssertEqual(req.httpMethod, "GET")
        XCTAssertEqual(req.url?.path, "/api/meal-log")
        XCTAssertEqual(req.url?.query, "date=2026-07-24")
        XCTAssertEqual(dto.dayTotals.calories, 1430)
    }

    func testJourneySendsWindowQuery() async throws {
        StubURLProtocol.enqueue(status: 200,
            body: Data(#"{"stats":{},"macroStats":{"dailyMacros":[],"target":null},"entries":[]}"#.utf8))
        _ = try await makeService().journey(from: "2026-07-18", to: "2026-07-24")
        let url = try XCTUnwrap(StubURLProtocol.recorded.first?.url)
        XCTAssertEqual(url.path, "/api/journey")
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        XCTAssertEqual(items.first { $0.name == "from" }?.value, "2026-07-18")
        XCTAssertEqual(items.first { $0.name == "to" }?.value, "2026-07-24")
    }

    func test401RemintsOnce() async throws {
        StubURLProtocol.enqueue(status: 401, body: Data(#"{"error":"Unauthorized"}"#.utf8))
        StubURLProtocol.enqueue(status: 200, body: StatsDTOTests.dayJSON)
        let tokens = StubTokenProvider(fresh: "T0", refreshed: "T1")
        _ = try await makeService(tokens: tokens).dayLog(date: "2026-07-24")
        XCTAssertEqual(StubURLProtocol.recorded.count, 2)
        XCTAssertEqual(tokens.forceRefreshCount, 1)
    }
}
```

- [ ] **Step 2: Register, run** — compile failure.
- [ ] **Step 3: Implement:**

```swift
import Foundation

protocol StatsProviding: Sendable {
    func dayLog(date: String) async throws -> DayLogDTO
    func journey(from: String, to: String) async throws -> JourneyDTO
}

struct StatsService: StatsProviding {
    private let api: WondishAPIClient
    init(api: WondishAPIClient) { self.api = api }

    func dayLog(date: String) async throws -> DayLogDTO {
        try await api.send(APIRequest(path: "/api/meal-log",
                                      query: [URLQueryItem(name: "date", value: date)]),
                           as: DayLogDTO.self)
    }

    func journey(from: String, to: String) async throws -> JourneyDTO {
        try await api.send(APIRequest(path: "/api/journey", query: [
            URLQueryItem(name: "from", value: from),
            URLQueryItem(name: "to", value: to),
        ]), as: JourneyDTO.self)
    }
}
```

- [ ] **Step 4: Register, run** — pass.
- [ ] **Step 5: Commit** — `feat(stats): StatsService over meal-log day + journey window`

---

### Task 3: StatsViewModel — load, trend fill, presentation mapping

**Files:**
- Create: `Clara/Features/Stats/StatsViewModel.swift`
- Test: `ClaraTests/StatsViewModelTests.swift`

**Interfaces:**
- Consumes: `StatsProviding`; `localDateString(for:calendar:)` (existing); `WBadge.Variant`.
- Produces:
```swift
@Observable @MainActor final class StatsViewModel {
    enum State: Equatable { case loading, loaded(StatsData), failed(APIError) }
    struct StatsData: Equatable {
        let day: DayLogDTO
        let trend: [TrendDay]          // exactly 7, zero-filled, oldest→today
    }
    struct TrendDay: Equatable, Identifiable {
        let date: String               // YYYY-MM-DD (id)
        let label: String              // "Wed"
        let calories: Double
        var id: String { date }
    }
    private(set) var state: State
    init(service: StatsProviding)
    func load(today: Date = Date(), calendar: Calendar = .current) async
    func retry() async
    // Pure, unit-tested:
    nonisolated static func trendDays(from dailyMacros: [DailyMacroDTO], today: Date, calendar: Calendar) -> [TrendDay]
    nonisolated static func ringProgress(totals: MacroSnapshotDTO, target: DailyTargetDTO?) -> Double?   // nil when target nil or ≤0 (P6 guard); else clamped 0…1
    nonisolated static func sourceBadge(_ source: String) -> (text: String, variant: WBadge.Variant)
}
```

- [ ] **Step 1: Failing tests:**

```swift
import XCTest
@testable import Clara

@MainActor
final class StatsViewModelTests: XCTestCase {
    final class ScriptedStats: StatsProviding, @unchecked Sendable {
        var dayResult: Result<DayLogDTO, APIError> = .failure(.transport)
        var journeyResult: Result<JourneyDTO, APIError> = .failure(.transport)
        var recordedWindows: [(from: String, to: String)] = []
        func dayLog(date: String) async throws -> DayLogDTO { try dayResult.get() }
        func journey(from: String, to: String) async throws -> JourneyDTO {
            recordedWindows.append((from, to)); return try journeyResult.get()
        }
    }
    static let fixedToday = DateComponents(calendar: .init(identifier: .gregorian),
                                           year: 2026, month: 7, day: 24).date!  // a Friday

    func testLoadRequestsSevenDayWindowEndingToday() async {
        let svc = ScriptedStats()
        svc.dayResult = .success(try! JSONDecoder().decode(DayLogDTO.self, from: StatsDTOTests.dayJSON))
        svc.journeyResult = .success(JourneyDTO(macroStats: .init(dailyMacros: [], target: nil)))
        let vm = StatsViewModel(service: svc)
        await vm.load(today: Self.fixedToday)
        XCTAssertEqual(svc.recordedWindows.first?.from, "2026-07-18")
        XCTAssertEqual(svc.recordedWindows.first?.to, "2026-07-24")
        guard case .loaded(let data) = vm.state else { return XCTFail("expected loaded") }
        XCTAssertEqual(data.trend.count, 7)
    }

    func testTrendZeroFillsMissingDaysOldestFirst() {
        let macros = [DailyMacroDTO(date: "2026-07-23", calories: 2210, protein: 0, carbs: 0, fat: 0, incomplete: false),
                      DailyMacroDTO(date: "2026-07-24", calories: 1430, protein: 0, carbs: 0, fat: 0, incomplete: true)]
        let trend = StatsViewModel.trendDays(from: macros, today: Self.fixedToday, calendar: .init(identifier: .gregorian))
        XCTAssertEqual(trend.count, 7)
        XCTAssertEqual(trend.first?.date, "2026-07-18")
        XCTAssertEqual(trend.first?.calories, 0)          // zero-filled
        XCTAssertEqual(trend.last?.date, "2026-07-24")
        XCTAssertEqual(trend.last?.calories, 1430)
        XCTAssertEqual(trend.last?.label, "Fri")
    }

    func testRingProgressGuardsMissingOrZeroTarget() {
        let totals = MacroSnapshotDTO(calories: 1430, protein: 0, carbs: 0, fat: 0, fiber: 0, incomplete: nil)
        XCTAssertNil(StatsViewModel.ringProgress(totals: totals, target: nil))
        let zero = DailyTargetDTO(calories: 0, protein: 0, carbs: 0, fat: 0, profile: nil, basis: nil)
        XCTAssertNil(StatsViewModel.ringProgress(totals: totals, target: zero))       // P6 target>0 guard
        let target = DailyTargetDTO(calories: 2100, protein: 130, carbs: 210, fat: 70, profile: nil, basis: nil)
        XCTAssertEqual(StatsViewModel.ringProgress(totals: totals, target: target)!, 1430.0/2100.0, accuracy: 0.0001)
        let over = MacroSnapshotDTO(calories: 9000, protein: 0, carbs: 0, fat: 0, fiber: 0, incomplete: nil)
        XCTAssertEqual(StatsViewModel.ringProgress(totals: over, target: target), 1.0)  // clamped
    }

    func testSourceBadgeMapping() {
        XCTAssertEqual(StatsViewModel.sourceBadge("RECIPE").text, "Plan")
        XCTAssertEqual(StatsViewModel.sourceBadge("RESTAURANT").variant, .success)
        XCTAssertEqual(StatsViewModel.sourceBadge("FRIDGE").variant, .warning)
        XCTAssertEqual(StatsViewModel.sourceBadge("MANUAL").variant, .neutral)
        XCTAssertEqual(StatsViewModel.sourceBadge("HOLOGRAM").text, "Hologram")  // unknown → capitalized neutral
        XCTAssertEqual(StatsViewModel.sourceBadge("HOLOGRAM").variant, .neutral)
    }

    func testJourneyFailureIsNonFatalDayFailureIsFatal() async {
        let svc = ScriptedStats()
        svc.dayResult = .success(try! JSONDecoder().decode(DayLogDTO.self, from: StatsDTOTests.dayJSON))
        svc.journeyResult = .failure(.server(status: 500))
        let vm = StatsViewModel(service: svc)
        await vm.load(today: Self.fixedToday)
        guard case .loaded(let data) = vm.state else { return XCTFail("journey failure must not sink stats") }
        XCTAssertEqual(data.trend.filter { $0.calories > 0 }.count, 0)   // empty trend, ring still live
        svc.dayResult = .failure(.unauthorized)
        await vm.load(today: Self.fixedToday)
        XCTAssertEqual(vm.state, .failed(.unauthorized))
    }
}
```

Plus the `Gate`-actor stale-load race test (same shape as Cycle A Task 4). If `DailyTargetDTO`/`MacroSnapshotDTO` lack memberwise inits accessible to tests, add explicit `init`s in `MealLogEnvelopeDTO.swift`.

- [ ] **Step 2: Register, run** — compile failure.
- [ ] **Step 3: Implement `StatsViewModel.swift`:**

```swift
import Foundation
import Observation

@Observable @MainActor
final class StatsViewModel {
    enum State: Equatable { case loading, loaded(StatsData), failed(APIError) }

    struct TrendDay: Equatable, Identifiable {
        let date: String
        let label: String
        let calories: Double
        var id: String { date }
    }
    struct StatsData: Equatable {
        let day: DayLogDTO
        let trend: [TrendDay]
    }

    private(set) var state: State = .loading
    private let service: StatsProviding
    private var loadGeneration = 0

    init(service: StatsProviding) { self.service = service }

    func load(today: Date = Date(), calendar: Calendar = .current) async {
        loadGeneration += 1
        let generation = loadGeneration
        state = .loading
        let todayStr = localDateString(for: today, calendar: calendar)
        let fromStr = localDateString(for: calendar.date(byAdding: .day, value: -6, to: today) ?? today, calendar: calendar)
        do {
            async let dayTask = service.dayLog(date: todayStr)
            async let journeyTask = try? service.journey(from: fromStr, to: todayStr)  // trend is non-fatal
            let day = try await dayTask
            let journey = await journeyTask
            guard generation == loadGeneration else { return }
            let trend = Self.trendDays(from: journey?.macroStats.dailyMacros ?? [],
                                       today: today, calendar: calendar)
            state = .loaded(StatsData(day: day, trend: trend))
        } catch let error as APIError {
            guard generation == loadGeneration else { return }
            state = .failed(error)
        } catch {
            guard generation == loadGeneration else { return }
            state = .failed(.transport)
        }
    }

    func retry() async { await load() }

    // MARK: - Pure presentation

    nonisolated static func trendDays(from dailyMacros: [DailyMacroDTO], today: Date, calendar: Calendar) -> [TrendDay] {
        let byDate = Dictionary(uniqueKeysWithValues: dailyMacros.map { ($0.date, $0.calories) })
        let labelFormatter = DateFormatter()
        labelFormatter.calendar = calendar
        labelFormatter.locale = Locale(identifier: "en_US_POSIX")
        labelFormatter.dateFormat = "EEE"
        return (0..<7).reversed().compactMap { offset in
            guard let day = calendar.date(byAdding: .day, value: -offset, to: today) else { return nil }
            let key = localDateString(for: day, calendar: calendar)
            return TrendDay(date: key, label: labelFormatter.string(from: day), calories: byDate[key] ?? 0)
        }
    }

    /// Phase-6 amendment: never divide by a missing/zero target.
    nonisolated static func ringProgress(totals: MacroSnapshotDTO, target: DailyTargetDTO?) -> Double? {
        guard let target, target.calories > 0 else { return nil }
        return min(max(totals.calories / target.calories, 0), 1)
    }

    nonisolated static func sourceBadge(_ source: String) -> (text: String, variant: WBadge.Variant) {
        switch source {
        case "RECIPE": return ("Plan", .primary)
        case "RESTAURANT": return ("Restaurant", .success)
        case "FRIDGE": return ("Fridge", .warning)
        case "PICTURE": return ("Photo", .info)
        case "MANUAL": return ("Manual", .neutral)
        case "CUSTOM": return ("Custom", .neutral)
        default: return (source.capitalized, .neutral)   // unknown source tolerated (P6)
        }
    }
}
```

- [ ] **Step 4: Register, run VM tests** — pass.
- [ ] **Step 5: Commit** — `feat(stats): view model — day echo + zero-filled 7-day trend, target guards`

---

### Task 4: StatsView rewrite — live sections in Account

**Files:**
- Rewrite: `Clara/Features/Stats/StatsView.swift` (delete `DayCalories`/`weekCalories`/`LoggedMeal`/`todaysLog` demo data)
- Modify: `Clara/Features/Account/SignedInView.swift` (refresh trigger pass-through)
- Modify: `Clara/App/LaunchFixtures.swift` (cases `statsLoaded`, `statsEmptyDay`, `statsError` + `stubStatsProviding`)

**Interfaces:**
- Consumes: `StatsViewModel`, `LaunchFixtures.current?.stubStatsProviding`, `@Environment(\.apiClient)`.
- Produces: `StatsView(refreshID: Int)` — same embedding contract otherwise (plain `VStack` sections; `SignedInView` owns scroll/title).

Design mapping (visuals unchanged from the approved design):
- Ring card: `dayTotals.calories` (grouped formatting) over `dayTarget.calories`; sub-line `remaining.calories` → "N kcal left today" (hidden when `remaining` nil); when `ringProgress` is nil (no target) show the eaten number with caption "Set up your profile to get a daily target" and no ring fill.
- Macro tiles: protein/carbs/fat from `dayTotals` vs `dayTarget` grams (bar hidden when target nil).
- Trend card: `Chart` over `data.trend` (7 `BarMark`s, today's bar full `WColor.primary`, others 0.35 opacity); `RuleMark` at `dayTarget.calories` only when non-nil and > 0.
- Log card: rows from `day.logs` filtered `deletedAt == nil` — `mealType.uppercased()`, `name`, `WBadge(sourceBadge)`, `Int(totals.calories)` kcal; empty state "Nothing logged yet today." with `fork.knife` symbol; the demo "Add meal" button is removed (logging happens from Meal Plan / Restaurants / Cook).
- States: `.loading` → existing layout `.redacted(reason: .placeholder)` over zeroed data; `.failed` → compact card "Couldn't load your stats." + "Try again" button → `vm.retry()`.

- [ ] **Step 1: Fixtures.** Add the three cases (auth arms mirror `signedInPremium`); `FixtureStatsProviding` decodes `StatsDTOTests.dayJSON`-shaped canned data: `statsLoaded` = 4 logs + 7-day journey; `statsEmptyDay` = empty logs, zero totals, target present; `statsError` throws `.server(status: 500)`.

- [ ] **Step 2: Rewrite `StatsView`:**

```swift
struct StatsView: View {
    let refreshID: Int
    @State private var vm: StatsViewModel?
    @Environment(\.apiClient) private var apiClient

    var body: some View {
        content
            .task(id: refreshID) {
                attachViewModelIfNeeded()
                await vm?.load()
            }
    }

    private func attachViewModelIfNeeded() {
        guard vm == nil else { return }
        #if DEBUG
        if let stub = LaunchFixtures.current?.stubStatsProviding {
            vm = StatsViewModel(service: stub); return
        }
        #endif
        guard let apiClient else { return }
        vm = StatsViewModel(service: StatsService(api: apiClient))
    }
    // content switches on vm?.state ?? .loading → ring/tiles/trend/log sections (kept visuals)
}
```

- [ ] **Step 3: `SignedInView` wiring:**

```swift
@State private var statsRefreshID = 0
// in body: StatsView(refreshID: statsRefreshID)
// in .refreshable: await vm.refresh(); statsRefreshID += 1
```

(Also update the `#Preview` in `StatsView.swift` to `StatsView(refreshID: 0)`.)

- [ ] **Step 4: Build, run FULL suite, fixture screenshots** (`-UITestFixture statsLoaded -tab account`, then `statsEmptyDay`, `statsError`) — read each; verify ring/tiles/trend/log show fixture numbers, empty + error states render, pull-to-refresh reloads (manual check).
- [ ] **Step 5: Commit** — `feat(stats): live Account stats — server-echoed ring/tiles/trend/log`

---

### Task 5: Live smoke + cycle close-out

- [ ] **Step 1:** Build with the user's `Debug.xcconfig` prod override (already points at `www.wondish.io`), launch signed-in (no fixture), navigate to Account and Meal Plan; verify real data renders, screenshot both.
- [ ] **Step 2:** Full test suite one final time — green; note the count.
- [ ] **Step 3:** Commit any straggler fixes; append CYCLE close-out entry to `/Users/becks/Desktop/NewView/wondish_02/.superpowers/sdd/progress.md`; update auto-memory cycle history.

---

## Self-review notes

- `remaining`/`dayTarget` may be absent (profile incomplete) — every consumer above has an explicit nil branch; no `!` unwraps.
- Journey failure degrades to an empty (zero) trend rather than sinking the whole stats block — the day envelope is the primary echo.
- `deletedAt` filter on log rows: delta-sync semantics leak tombstones only in `updatedSince` mode, but the filter is cheap insurance and matches the DTO.
- `StatsView` keeps its "embeddable sections" contract — no ScrollView/NavigationStack — so `SignedInView` needs no structural change beyond the refresh id.
