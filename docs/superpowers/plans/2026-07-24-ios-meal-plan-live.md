# iOS Meal Plan Tab — Live Data Implementation Plan (Cycle A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Meal Plan center tab (Clara repo, shipped as placeholder in `78b1089`) to the live backend: today's menu only, shopping list underneath, swap, thumbs rating, and add-to-today's-log.

**Architecture:** New `MealPlanService` (protocol seam `MealPlanProviding`) over the existing `WondishAPIClient` actor, DTOs mirroring the web contracts byte-for-byte, an `@Observable @MainActor` `MealPlanViewModel` with the repo's generation-token race guard and client-request-id idempotency patterns, and a rewrite of `MealPlanView`/dish pager to render server data. The approved visual design is preserved; **the week strip is removed** (user directive 2026-07-24: today only, no day row).

**Tech Stack:** SwiftUI (iOS 17 floor), XCTest with `StubURLProtocol` + `StubTokenProvider`, Clerk Bearer auth via `SessionStore: TokenProviding`.

## Global Constraints

- Repo: `/Users/becks/Desktop/NewView/Clara`. Web contract source of truth: `/Users/becks/Desktop/NewView/wondish_02` (branch `main`).
- iOS deployment floor **17.0** — the zoom transition stays availability-gated exactly as shipped.
- **Server echoes only for intake numbers** (standing rule [[food-surfaces-sync-with-filters]] adjacent): the client never computes eaten/remaining macros. Summing *plan* calories for the summary card is allowed (web parity: `CalorieBadge` does the same).
- DTOs use **exact server key names** — the shared `JSONDecoder` has no `keyDecodingStrategy` and `dateDecodingStrategy = .iso8601`, which **cannot parse Prisma's fractional-second dates** (`2026-07-24T00:00:00.000Z`). Therefore **all date fields in new DTOs are `String`**, never `Date`.
- `xcodegen` is NOT installed on this machine. New files must be hand-registered in `Clara.xcodeproj/project.pbxproj` (4 insertion points each — see Task 6 Step 2; commit `78b1089` is the worked example).
- All existing tests must stay green (`xcodebuild test` on iPhone 17 Pro simulator UDID `9A2B71CC-987F-4A6F-8DB1-BF8F2341CCF1`); every task adds its own tests.
- Design tokens only (`WColor`/`WFont`/`WSpacing`/`WRadius`, `wCard()`, `WBadge`, `WButtonStyle`); SF Symbols, never emoji; light-mode lock stands.
- Commit after every task with the established `feat(meal-plan): …` style + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Backend contracts consumed (verified on wondish_02 `main`, all Bearer-ready via JSON-401 middleware)

| Call | Contract |
|---|---|
| `GET /api/meal-plan?date=YYYY-MM-DD` | `{ menus: MenuEntry[], mealPlanStartDate: ISO\|null, loggedRecipeIds: string[], mealRatings: {recipeId: 1\|-1}, dailyCalorieTarget: number\|null }` (`app/api/meal-plan/route.ts:92`) |
| `GET /api/meal-plan/alternatives?mealTypeId=&excludeRecipeId=&currentCalories=` | `{ alternatives: RecipeDTO[] }` — max 3 (`alternatives/route.ts:60`) |
| `PATCH /api/meal-plan/{menuId}/swap` body `{recipeId}` | updated menu row, `recipe` WITHOUT `ingredients` — client keeps the alternative object it already has (web parity, `SwapMealModal.tsx:46-50`) |
| `POST /api/journal/log-meal` body `{recipeId, mealTypeName, date, rating: 1\|-1}` | `{ ok, loggedRecipeIds, mealRatings }`; **toggle semantics** — same rating again deletes (undo) (`app/api/journal/log-meal/route.ts:99`) |
| `POST /api/meal-log` body `{localDate, mealType, source:"RECIPE", recipeId, servings, clientRequestId}` | `{ log, dayTotals, dayTarget, remaining }`, 201 create / 200 idempotent replay; server-priced, NO macro keys sent (`app/api/meal-log/route.ts:111`) |
| `POST /api/meal-plan/start-date` body `{startDate}` | `{ ok, count, startDate }`; 402/403 `Premium required`, 422 `Profile not complete`, 409 busy (`start-date/route.ts:64`) |
| `POST /api/meal-plan/regenerate` (no body) | `{ ok, count }`; same gates + 2-min anti-spam on READY plans |
| `GET /api/grocery-list?from=&to=` | `{ items: [{ingredientId, name, totalQuantity, unit\|null}] }` sorted by name (`app/api/grocery-list/route.ts:52`) |

`RecipeDTO` fields (web `types/index.ts:52-81`): `id, name, description?, imageUrl?, emoji?, calories?, protein?, carbs?, fat?, fiber?, prepTime?, cookTime?, servings?, tags: string[], family?, subFamily?, mealTypeId?, mealType?{id,name}, dishTypeId?, dishType?{id,name}, ethnicId?, ethnic?{id,name}, ingredients: [{ingredientId, ingredient{id,name,unit?}, quantity?, unit?}]`. `description` holds newline-separated steps, each optionally prefixed `"N. "`.

---

### Task 1: Meal-plan DTOs + decoding tests

**Files:**
- Create: `Clara/Features/MealPlan/MealPlanDTOs.swift`
- Test: `ClaraTests/MealPlanDTOTests.swift`

**Interfaces:**
- Produces: `MealPlanDayDTO { menus: [MenuEntryDTO], mealPlanStartDate: String?, loggedRecipeIds: [String], mealRatings: [String: Int], dailyCalorieTarget: Double? }`; `MenuEntryDTO: Identifiable { id, date: String, mealTypeId: String?, mealType: NamedRefDTO?, recipe: PlanRecipeDTO }`; `PlanRecipeDTO: Identifiable` (all fields above, dates-as-string N/A, numerics `Double?`, `prepTime/cookTime/servings` `Double?` too — Prisma ints decode fine into Double); `NamedRefDTO { id, name }`; `PlanIngredientDTO { ingredientId, ingredient: IngredientRefDTO, quantity: Double?, unit: String? }`; `IngredientRefDTO { id, name, unit: String? }`; `AlternativesDTO { alternatives: [PlanRecipeDTO] }`; `RateEchoDTO { ok: Bool, loggedRecipeIds: [String], mealRatings: [String: Int] }`; `GroceryListDTO { items: [GroceryItemDTO] }`; `GroceryItemDTO: Identifiable { ingredientId, name, totalQuantity: Double, unit: String? }` (`id` = `ingredientId`). Plus pure helpers `planSteps(from description: String?) -> [String]` (split on `\n`, strip `^\d+\.\s*`, drop blanks — mirrors `DailyMealPlanView.tsx:83-85`) and `mealTypeSlug(_ name: String?) -> String` (`Breakfast→breakfast` etc., unknown/nil → lowercased trimmed input or `"meal"` if empty — mirrors `:36-44`), and `mealTypeSortIndex(_ slug: String) -> Int` (breakfast 0, lunch 1, snack 2, dinner 3, else 4).

- [ ] **Step 1: Write the failing decoding tests**

`ClaraTests/MealPlanDTOTests.swift` — canned JSON mirrors the server literal (fractional-second dates, nulls, extra keys the client ignores):

```swift
import XCTest
@testable import Clara

final class MealPlanDTOTests: XCTestCase {
    static let dayJSON = Data("""
    {"menus":[{"id":"m1","date":"2026-07-24T07:00:00.000Z","mealTypeId":"mt1",
      "mealType":{"id":"mt1","name":"Breakfast"},"planVersion":3,"recipeId":"r1",
      "recipe":{"id":"r1","name":"Overnight Oats","description":"1. Stir oats.\\n2. Chill overnight.",
        "imageUrl":null,"emoji":null,"calories":380,"protein":14,"carbs":52,"fat":12,"fiber":8,
        "prepTime":10,"cookTime":0,"servings":1,"tags":["make-ahead"],"family":"oats","subFamily":null,
        "mealTypeId":"mt1","mealType":{"id":"mt1","name":"Breakfast"},
        "dishTypeId":"dt1","dishType":{"id":"dt1","name":"Bowl"},
        "ethnicId":"e1","ethnic":{"id":"e1","name":"American"},
        "ingredients":[{"ingredientId":"i1","quantity":50,"unit":"g",
          "ingredient":{"id":"i1","name":"Rolled oats","unit":"g"}}]}}],
     "mealPlanStartDate":"2026-07-20T07:00:00.000Z",
     "loggedRecipeIds":["r1"],"mealRatings":{"r1":1},"dailyCalorieTarget":2100}
    """.utf8)

    func testMealPlanDayDecodes() throws {
        let dto = try JSONDecoder().decode(MealPlanDayDTO.self, from: Self.dayJSON)
        XCTAssertEqual(dto.menus.count, 1)
        XCTAssertEqual(dto.menus[0].id, "m1")
        XCTAssertEqual(dto.menus[0].mealType?.name, "Breakfast")
        XCTAssertEqual(dto.menus[0].recipe.calories, 380)
        XCTAssertEqual(dto.menus[0].recipe.ingredients[0].ingredient.name, "Rolled oats")
        XCTAssertEqual(dto.mealPlanStartDate, "2026-07-20T07:00:00.000Z") // String, not Date
        XCTAssertEqual(dto.mealRatings["r1"], 1)
        XCTAssertEqual(dto.dailyCalorieTarget, 2100)
    }

    func testNullsAndEmptyDayDecode() throws {
        let empty = Data(#"{"menus":[],"mealPlanStartDate":null,"loggedRecipeIds":[],"mealRatings":{},"dailyCalorieTarget":null}"#.utf8)
        let dto = try JSONDecoder().decode(MealPlanDayDTO.self, from: empty)
        XCTAssertTrue(dto.menus.isEmpty)
        XCTAssertNil(dto.mealPlanStartDate)
        XCTAssertNil(dto.dailyCalorieTarget)
    }

    func testRateEchoAndGroceryDecode() throws {
        let rate = try JSONDecoder().decode(RateEchoDTO.self,
            from: Data(#"{"ok":true,"loggedRecipeIds":["r1","r2"],"mealRatings":{"r1":1,"r2":-1}}"#.utf8))
        XCTAssertEqual(rate.mealRatings["r2"], -1)
        let grocery = try JSONDecoder().decode(GroceryListDTO.self,
            from: Data(#"{"items":[{"ingredientId":"i1","name":"Avocado","totalQuantity":1.5,"unit":null}]}"#.utf8))
        XCTAssertEqual(grocery.items[0].totalQuantity, 1.5)
        XCTAssertNil(grocery.items[0].unit)
    }

    func testStepParsingAndSlugHelpers() {
        XCTAssertEqual(planSteps(from: "1. Stir oats.\n2. Chill overnight.\n"), ["Stir oats.", "Chill overnight."])
        XCTAssertEqual(planSteps(from: nil), [])
        XCTAssertEqual(mealTypeSlug("Breakfast"), "breakfast")
        XCTAssertEqual(mealTypeSlug(nil), "meal")
        XCTAssertEqual(mealTypeSortIndex("snack"), 2)
    }
}
```

- [ ] **Step 2: Run to verify failure** — `cd /Users/becks/Desktop/NewView/Clara && xcodebuild test -project Clara.xcodeproj -scheme Clara -destination "platform=iOS Simulator,id=9A2B71CC-987F-4A6F-8DB1-BF8F2341CCF1" -only-testing ClaraTests/MealPlanDTOTests 2>&1 | tail -5` — expect compile failure (types not defined). NOTE: the test file must first be registered in `project.pbxproj` (ClaraTests sources phase) — do that in this step, same 4-point hand-edit as Task 6 Step 2 but into the `ClaraTests` group/sources.

- [ ] **Step 3: Implement `MealPlanDTOs.swift`**

```swift
import Foundation

// Wire mirrors of the web meal-plan contracts (wondish_02 types/index.ts:52-89,
// app/api/meal-plan/route.ts:92, journal/log-meal/route.ts:99,
// grocery-list/route.ts:52). Dates stay String: the shared decoder's .iso8601
// cannot parse Prisma's fractional seconds, and no feature needs Date math.

struct NamedRefDTO: Decodable, Equatable { let id: String; let name: String }

struct IngredientRefDTO: Decodable, Equatable {
    let id: String
    let name: String
    let unit: String?
}

struct PlanIngredientDTO: Decodable, Equatable, Identifiable {
    let ingredientId: String
    let ingredient: IngredientRefDTO
    let quantity: Double?
    let unit: String?
    var id: String { ingredientId }
}

struct PlanRecipeDTO: Decodable, Equatable, Identifiable {
    let id: String
    let name: String
    let description: String?
    let calories: Double?
    let protein: Double?
    let carbs: Double?
    let fat: Double?
    let fiber: Double?
    let prepTime: Double?
    let cookTime: Double?
    let servings: Double?
    let tags: [String]?
    let mealType: NamedRefDTO?
    let dishType: NamedRefDTO?
    let ethnic: NamedRefDTO?
    let ingredients: [PlanIngredientDTO]?
}

struct MenuEntryDTO: Decodable, Equatable, Identifiable {
    let id: String
    let date: String
    let mealTypeId: String?
    let mealType: NamedRefDTO?
    let recipe: PlanRecipeDTO
}

struct MealPlanDayDTO: Decodable, Equatable {
    let menus: [MenuEntryDTO]
    let mealPlanStartDate: String?
    let loggedRecipeIds: [String]
    let mealRatings: [String: Int]
    let dailyCalorieTarget: Double?
}

struct AlternativesDTO: Decodable, Equatable { let alternatives: [PlanRecipeDTO] }

struct RateEchoDTO: Decodable, Equatable {
    let ok: Bool
    let loggedRecipeIds: [String]
    let mealRatings: [String: Int]
}

struct GroceryItemDTO: Decodable, Equatable, Identifiable {
    let ingredientId: String
    let name: String
    let totalQuantity: Double
    let unit: String?
    var id: String { ingredientId }
}

struct GroceryListDTO: Decodable, Equatable { let items: [GroceryItemDTO] }

// MARK: - Pure helpers (mirror DailyMealPlanView.tsx:36-44, 83-85)

func planSteps(from description: String?) -> [String] {
    guard let description else { return [] }
    return description.split(separator: "\n").map {
        $0.replacingOccurrences(of: #"^\d+\.\s*"#, with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
    }.filter { !$0.isEmpty }
}

func mealTypeSlug(_ name: String?) -> String {
    let trimmed = (name ?? "").trimmingCharacters(in: .whitespaces).lowercased()
    return trimmed.isEmpty ? "meal" : trimmed
}

func mealTypeSortIndex(_ slug: String) -> Int {
    switch slug {
    case "breakfast": return 0
    case "lunch": return 1
    case "snack": return 2
    case "dinner": return 3
    default: return 4
    }
}
```

- [ ] **Step 4: Register `MealPlanDTOs.swift` in pbxproj** (app target sources — 4-point hand-edit per Task 6 Step 2 recipe), run the Step-2 command, expect `Test Suite 'MealPlanDTOTests' passed`.

- [ ] **Step 5: Commit** — `git add Clara/Features/MealPlan/MealPlanDTOs.swift ClaraTests/MealPlanDTOTests.swift Clara.xcodeproj/project.pbxproj && git commit -m "feat(meal-plan): wire DTOs mirroring web contracts (dates-as-string)"`

---

### Task 2: MealPlanService + request-shape tests

**Files:**
- Create: `Clara/Features/MealPlan/MealPlanService.swift`
- Test: `ClaraTests/MealPlanServiceTests.swift`

**Interfaces:**
- Consumes: Task 1 DTOs; `WondishAPIClient.send(_:as:)` / `send(_:)`; `APIRequest(path:method:body:query:)`.
- Produces:
```swift
protocol MealPlanProviding: Sendable {
    func fetchDay(date: String) async throws -> MealPlanDayDTO
    func alternatives(mealTypeId: String, excludeRecipeId: String, currentCalories: Double) async throws -> [PlanRecipeDTO]
    func swap(menuId: String, recipeId: String) async throws
    func rate(recipeId: String, mealTypeName: String, date: String, rating: Int) async throws -> RateEchoDTO
    func startPlan(startDate: String) async throws
    func regeneratePlan() async throws
    func groceryList(from: String, to: String) async throws -> [GroceryItemDTO]
}
struct MealPlanService: MealPlanProviding { init(api: WondishAPIClient) }
```

- [ ] **Step 1: Write failing service tests** — follow `MealLogServiceTests` conventions exactly (`StubURLProtocol.reset()` in `setUp`, ephemeral session, `StubTokenProvider(fresh:"T0",refreshed:"T1")`, assert on `StubURLProtocol.recorded`):

```swift
import XCTest
@testable import Clara

final class MealPlanServiceTests: XCTestCase {
    override func setUp() { super.setUp(); StubURLProtocol.reset() }

    private func makeService() -> MealPlanService {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        let client = WondishAPIClient(baseURL: URL(string: "https://x.test")!,
                                      tokens: StubTokenProvider(fresh: "T0", refreshed: "T1"),
                                      session: URLSession(configuration: config))
        return MealPlanService(api: client)
    }

    func testFetchDaySendsDateQueryAndBearer() async throws {
        StubURLProtocol.enqueue(status: 200, body: MealPlanDTOTests.dayJSON)
        let dto = try await makeService().fetchDay(date: "2026-07-24")
        let req = try XCTUnwrap(StubURLProtocol.recorded.first)
        XCTAssertEqual(req.httpMethod, "GET")
        XCTAssertEqual(req.url?.path, "/api/meal-plan")
        XCTAssertEqual(req.url?.query, "date=2026-07-24")
        XCTAssertEqual(req.value(forHTTPHeaderField: "Authorization"), "Bearer T0")
        XCTAssertEqual(dto.menus.count, 1)
    }

    func testAlternativesQueryShape() async throws {
        StubURLProtocol.enqueue(status: 200, body: Data(#"{"alternatives":[]}"#.utf8))
        _ = try await makeService().alternatives(mealTypeId: "mt1", excludeRecipeId: "r1", currentCalories: 620)
        let url = try XCTUnwrap(StubURLProtocol.recorded.first?.url)
        XCTAssertEqual(url.path, "/api/meal-plan/alternatives")
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        XCTAssertEqual(Set(items.map(\.name)), ["mealTypeId", "excludeRecipeId", "currentCalories"])
        XCTAssertEqual(items.first { $0.name == "currentCalories" }?.value, "620") // integer string, web parity
    }

    func testSwapPatchesMenuWithRecipeBody() async throws {
        StubURLProtocol.enqueue(status: 200, body: Data(#"{"id":"m1"}"#.utf8))
        try await makeService().swap(menuId: "m1", recipeId: "r9")
        let req = try XCTUnwrap(StubURLProtocol.recorded.first)
        XCTAssertEqual(req.httpMethod, "PATCH")
        XCTAssertEqual(req.url?.path, "/api/meal-plan/m1/swap")
        let body = try XCTUnwrap(bodyJSON(req))
        XCTAssertEqual(body as? [String: String], ["recipeId": "r9"])
    }

    func testRatePostsExactBodyAndDecodesEcho() async throws {
        StubURLProtocol.enqueue(status: 200,
            body: Data(#"{"ok":true,"loggedRecipeIds":["r1"],"mealRatings":{"r1":-1}}"#.utf8))
        let echo = try await makeService().rate(recipeId: "r1", mealTypeName: "Lunch", date: "2026-07-24", rating: -1)
        let req = try XCTUnwrap(StubURLProtocol.recorded.first)
        XCTAssertEqual(req.url?.path, "/api/journal/log-meal")
        let body = try XCTUnwrap(bodyJSON(req) as? [String: Any])
        XCTAssertEqual(Set(body.keys), ["recipeId", "mealTypeName", "date", "rating"])
        XCTAssertEqual(body["rating"] as? Int, -1)
        XCTAssertEqual(echo.mealRatings["r1"], -1)
    }

    func testStartPlanAndRegeneratePaths() async throws {
        StubURLProtocol.enqueue(status: 200, body: Data(#"{"ok":true,"count":28,"startDate":"x"}"#.utf8))
        try await makeService().startPlan(startDate: "2026-07-24")
        XCTAssertEqual(StubURLProtocol.recorded[0].url?.path, "/api/meal-plan/start-date")
        StubURLProtocol.enqueue(status: 200, body: Data(#"{"ok":true,"count":28}"#.utf8))
        try await makeService().regeneratePlan()
        let regen = StubURLProtocol.recorded[1]
        XCTAssertEqual(regen.url?.path, "/api/meal-plan/regenerate")
        XCTAssertEqual(regen.httpMethod, "POST")
        XCTAssertNil(regen.value(forHTTPHeaderField: "Content-Type")) // no body
    }

    func testGroceryListWindowQuery() async throws {
        StubURLProtocol.enqueue(status: 200, body: Data(#"{"items":[]}"#.utf8))
        _ = try await makeService().groceryList(from: "2026-07-24", to: "2026-07-24")
        let url = try XCTUnwrap(StubURLProtocol.recorded.first?.url)
        XCTAssertEqual(url.path, "/api/grocery-list")
        XCTAssertEqual(url.query?.contains("from=2026-07-24"), true)
    }

    func test401RemintsOnceThenSucceeds() async throws {
        StubURLProtocol.enqueue(status: 401, body: Data(#"{"error":"Unauthorized"}"#.utf8))
        StubURLProtocol.enqueue(status: 200, body: Data(#"{"items":[]}"#.utf8))
        let tokens = StubTokenProvider(fresh: "T0", refreshed: "T1")
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        let client = WondishAPIClient(baseURL: URL(string: "https://x.test")!, tokens: tokens,
                                      session: URLSession(configuration: config))
        _ = try await MealPlanService(api: client).groceryList(from: "a", to: "a")
        XCTAssertEqual(StubURLProtocol.recorded.count, 2)
        XCTAssertEqual(tokens.forceRefreshCount, 1)
        XCTAssertEqual(StubURLProtocol.recorded[1].value(forHTTPHeaderField: "Authorization"), "Bearer T1")
    }

    private func bodyJSON(_ req: URLRequest) throws -> Any? {
        guard let stream = req.httpBodyStream else { return req.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) } }
        stream.open(); defer { stream.close() }
        var data = Data(); let buf = UnsafeMutablePointer<UInt8>.allocate(capacity: 4096); defer { buf.deallocate() }
        while stream.hasBytesAvailable { let n = stream.read(buf, maxLength: 4096); if n <= 0 { break }; data.append(buf, count: n) }
        return try JSONSerialization.jsonObject(with: data)
    }
}
```

(If `MealLogServiceTests` already has a shared body-reading helper, reuse it instead of redefining `bodyJSON` — check first.)

- [ ] **Step 2: Register test file in pbxproj, run** `-only-testing ClaraTests/MealPlanServiceTests` — expect compile failure (`MealPlanService` undefined).

- [ ] **Step 3: Implement `MealPlanService.swift`**

```swift
import Foundation

protocol MealPlanProviding: Sendable {
    func fetchDay(date: String) async throws -> MealPlanDayDTO
    func alternatives(mealTypeId: String, excludeRecipeId: String, currentCalories: Double) async throws -> [PlanRecipeDTO]
    func swap(menuId: String, recipeId: String) async throws
    func rate(recipeId: String, mealTypeName: String, date: String, rating: Int) async throws -> RateEchoDTO
    func startPlan(startDate: String) async throws
    func regeneratePlan() async throws
    func groceryList(from: String, to: String) async throws -> [GroceryItemDTO]
}

struct MealPlanService: MealPlanProviding {
    private let api: WondishAPIClient
    init(api: WondishAPIClient) { self.api = api }

    func fetchDay(date: String) async throws -> MealPlanDayDTO {
        try await api.send(APIRequest(path: "/api/meal-plan",
                                      query: [URLQueryItem(name: "date", value: date)]),
                           as: MealPlanDayDTO.self)
    }

    func alternatives(mealTypeId: String, excludeRecipeId: String, currentCalories: Double) async throws -> [PlanRecipeDTO] {
        try await api.send(APIRequest(path: "/api/meal-plan/alternatives", query: [
            URLQueryItem(name: "mealTypeId", value: mealTypeId),
            URLQueryItem(name: "excludeRecipeId", value: excludeRecipeId),
            URLQueryItem(name: "currentCalories", value: String(Int(currentCalories))),
        ]), as: AlternativesDTO.self).alternatives
    }

    /// Web parity (SwapMealModal.tsx:46-53): the PATCH response's recipe has no
    /// ingredients include, so the caller keeps the alternative it already
    /// holds — the body is deliberately discarded here.
    func swap(menuId: String, recipeId: String) async throws {
        struct Body: Encodable { let recipeId: String }
        try await api.send(APIRequest(path: "/api/meal-plan/\(menuId)/swap",
                                      method: .patch, body: Body(recipeId: recipeId)))
    }

    func rate(recipeId: String, mealTypeName: String, date: String, rating: Int) async throws -> RateEchoDTO {
        struct Body: Encodable { let recipeId: String; let mealTypeName: String; let date: String; let rating: Int }
        return try await api.send(APIRequest(path: "/api/journal/log-meal", method: .post,
                                             body: Body(recipeId: recipeId, mealTypeName: mealTypeName, date: date, rating: rating)),
                                  as: RateEchoDTO.self)
    }

    func startPlan(startDate: String) async throws {
        struct Body: Encodable { let startDate: String }
        try await api.send(APIRequest(path: "/api/meal-plan/start-date", method: .post, body: Body(startDate: startDate)))
    }

    func regeneratePlan() async throws {
        try await api.send(APIRequest(path: "/api/meal-plan/regenerate", method: .post))
    }

    func groceryList(from: String, to: String) async throws -> [GroceryItemDTO] {
        try await api.send(APIRequest(path: "/api/grocery-list", query: [
            URLQueryItem(name: "from", value: from),
            URLQueryItem(name: "to", value: to),
        ]), as: GroceryListDTO.self).items
    }
}
```

- [ ] **Step 4: Register in pbxproj, run tests** — expect `MealPlanServiceTests passed`.
- [ ] **Step 5: Commit** — `feat(meal-plan): MealPlanService over the seven web endpoints`

---

### Task 3: `MealLogService.logPlanRecipe` (add-to-today's-log for plan dishes)

**Files:**
- Modify: `Clara/Features/MealLog/MealLogService.swift`
- Test: extend `ClaraTests/MealLogServiceTests.swift`

**Interfaces:**
- Produces: `struct PlanRecipeLogInput: Equatable, Sendable { let recipeId: String; let localDate: String; let mealType: String; let clientRequestId: String }` and `func logPlanRecipe(_ input: PlanRecipeLogInput) async throws -> LogResponseDTO` added to `protocol MealLogging` and `MealLogService`. Wire body keys exactly: `localDate, mealType, source:"RECIPE", recipeId, servings, clientRequestId` with `servings: 1` — **no macro keys** (server prices RECIPE from the recipe row, `lib/meal-log.ts:214-251`).

- [ ] **Step 1: Write the failing test** (append to `MealLogServiceTests`, reusing its existing `makeService`/body helpers):

```swift
func testLogPlanRecipePostsExactBodyShapeNoMacroKeys() async throws {
    StubURLProtocol.enqueue(status: 201, body: Data(#"{"log":{"id":"l1","name":"Oats","servings":1},"dayTotals":{"calories":380,"protein":14,"carbs":52,"fat":12,"fiber":8}}"#.utf8))
    let service = makeService()
    let input = PlanRecipeLogInput(recipeId: "r1", localDate: "2026-07-24", mealType: "breakfast",
                                   clientRequestId: "cid-1")
    let echo = try await service.logPlanRecipe(input)
    let req = try XCTUnwrap(StubURLProtocol.recorded.first)
    XCTAssertEqual(req.httpMethod, "POST")
    XCTAssertEqual(req.url?.path, "/api/meal-log")
    let json = try XCTUnwrap(bodyJSON(req) as? [String: Any])
    XCTAssertEqual(Set(json.keys), ["localDate", "mealType", "source", "recipeId", "servings", "clientRequestId"])
    XCTAssertEqual(json["source"] as? String, "RECIPE")
    XCTAssertEqual(json["servings"] as? Double, 1)
    XCTAssertEqual(echo.dayTotals.calories, 380)
}
```

- [ ] **Step 2: Run** `-only-testing ClaraTests/MealLogServiceTests` — expect compile failure.
- [ ] **Step 3: Implement** — add to `MealLogService.swift`:

```swift
struct PlanRecipeLogInput: Equatable, Sendable {
    let recipeId: String
    let localDate: String
    let mealType: String
    let clientRequestId: String
}

// In protocol MealLogging:
func logPlanRecipe(_ input: PlanRecipeLogInput) async throws -> LogResponseDTO

// In MealLogService:
func logPlanRecipe(_ input: PlanRecipeLogInput) async throws -> LogResponseDTO {
    struct Body: Encodable {
        let localDate: String; let mealType: String; let source = "RECIPE"
        let recipeId: String; let servings: Double = 1; let clientRequestId: String
    }
    return try await api.send(APIRequest(path: "/api/meal-log", method: .post,
        body: Body(localDate: input.localDate, mealType: input.mealType,
                   recipeId: input.recipeId, clientRequestId: input.clientRequestId)),
        as: LogResponseDTO.self)
}
```

Also add `logPlanRecipe` to `FixtureMealLogging` and `FailOnceThenSucceedMealLogging` in `LaunchFixtures.swift` (record-and-succeed, returning a canned `LogResponseDTO` decoded from static JSON) — the protocol change won't compile without it.

- [ ] **Step 4: Run full `ClaraTests` suite** — all green (protocol conformance everywhere).
- [ ] **Step 5: Commit** — `feat(meal-plan): MealLogService.logPlanRecipe (source=RECIPE, server-priced)`

---

### Task 4: MealPlanViewModel — load / noPlan / failed + race guard

**Files:**
- Create: `Clara/Features/MealPlan/MealPlanViewModel.swift`
- Test: `ClaraTests/MealPlanViewModelTests.swift`

**Interfaces:**
- Consumes: `MealPlanProviding` (Task 2), `MealLogging` (Task 3), `localDateString(for:calendar:)` (exists in `MealLogService.swift`).
- Produces:
```swift
@Observable @MainActor final class MealPlanViewModel {
    enum State: Equatable { case loading, loaded, noPlan(hasExistingPlan: Bool), failed(APIError) }
    private(set) var state: State
    private(set) var menus: [MenuEntryDTO]          // sorted by mealTypeSortIndex
    private(set) var loggedRecipeIds: Set<String>   // journal semantics — drives "Logged" checkmark
    private(set) var mealRatings: [String: Int]
    private(set) var dailyCalorieTarget: Double?
    private(set) var groceryItems: [GroceryItemDTO] // non-fatal: [] on failure
    private(set) var recentlyLoggedRecipeIds: Set<String> // add-to-log success feedback
    private(set) var isStartingPlan: Bool
    private(set) var startPlanError: String?
    var plannedCalories: Double                      // sum of menus recipe.calories (plan display, web CalorieBadge parity)
    init(service: MealPlanProviding, mealLogging: MealLogging)
    func load(date: String = localDateString(for: Date())) async
    func retry() async
    func startOrRegeneratePlan() async               // start-date when no plan ever, regenerate otherwise; reload on success
}
```

- [ ] **Step 1: Write failing VM tests** — scripted service double, no network (repo convention):

```swift
import XCTest
@testable import Clara

@MainActor
final class MealPlanViewModelTests: XCTestCase {
    final class ScriptedPlanService: MealPlanProviding, @unchecked Sendable {
        var dayResult: Result<MealPlanDayDTO, APIError> = .failure(.transport)
        var groceryResult: Result<[GroceryItemDTO], APIError> = .success([])
        var startPlanError: APIError?
        var startPlanCalls = 0, regenerateCalls = 0
        func fetchDay(date: String) async throws -> MealPlanDayDTO { try dayResult.get() }
        func groceryList(from: String, to: String) async throws -> [GroceryItemDTO] { try groceryResult.get() }
        func startPlan(startDate: String) async throws { startPlanCalls += 1; if let e = startPlanError { throw e } }
        func regeneratePlan() async throws { regenerateCalls += 1 }
        func alternatives(mealTypeId: String, excludeRecipeId: String, currentCalories: Double) async throws -> [PlanRecipeDTO] { [] }
        func swap(menuId: String, recipeId: String) async throws {}
        func rate(recipeId: String, mealTypeName: String, date: String, rating: Int) async throws -> RateEchoDTO {
            RateEchoDTO(ok: true, loggedRecipeIds: [], mealRatings: [:])
        }
    }
    final class NoopMealLogging: MealLogging, @unchecked Sendable {
        func logRestaurantDish(_ input: RestaurantDishLogInput) async throws {}
        func logFridgeRecipe(_ input: FridgeLogInput) async throws -> LogResponseDTO { fatalError("unused") }
        func logPlanRecipe(_ input: PlanRecipeLogInput) async throws -> LogResponseDTO { fatalError("unused") }
    }

    static func day(menus: [MenuEntryDTO], start: String? = "2026-07-20T07:00:00.000Z") -> MealPlanDayDTO {
        MealPlanDayDTO(menus: menus, mealPlanStartDate: start, loggedRecipeIds: ["r1"],
                       mealRatings: ["r1": 1], dailyCalorieTarget: 2100)
    }
    static let breakfast = try! JSONDecoder().decode(MenuEntryDTO.self, from: Data("""
        {"id":"m1","date":"2026-07-24T07:00:00.000Z","mealTypeId":"mt1",
         "mealType":{"id":"mt1","name":"Breakfast"},
         "recipe":{"id":"r1","name":"Oats","calories":380,"ingredients":[]}}
        """.utf8))

    func testLoadSuccessSortsAndPopulates() async {
        let svc = ScriptedPlanService()
        svc.dayResult = .success(Self.day(menus: [Self.breakfast]))
        svc.groceryResult = .success([GroceryItemDTO(ingredientId: "i1", name: "Oats", totalQuantity: 50, unit: "g")])
        let vm = MealPlanViewModel(service: svc, mealLogging: NoopMealLogging())
        await vm.load(date: "2026-07-24")
        XCTAssertEqual(vm.state, .loaded)
        XCTAssertEqual(vm.menus.map(\.id), ["m1"])
        XCTAssertTrue(vm.loggedRecipeIds.contains("r1"))
        XCTAssertEqual(vm.dailyCalorieTarget, 2100)
        XCTAssertEqual(vm.groceryItems.count, 1)
        XCTAssertEqual(vm.plannedCalories, 380)
    }

    func testEmptyMenusNoStartDateIsNoPlanFirstTime() async {
        let svc = ScriptedPlanService()
        svc.dayResult = .success(Self.day(menus: [], start: nil))
        let vm = MealPlanViewModel(service: svc, mealLogging: NoopMealLogging())
        await vm.load(date: "2026-07-24")
        XCTAssertEqual(vm.state, .noPlan(hasExistingPlan: false))
    }

    func testEmptyMenusWithStartDateIsNoPlanExisting() async {
        let svc = ScriptedPlanService()
        svc.dayResult = .success(Self.day(menus: []))
        let vm = MealPlanViewModel(service: svc, mealLogging: NoopMealLogging())
        await vm.load(date: "2026-07-24")
        XCTAssertEqual(vm.state, .noPlan(hasExistingPlan: true))
    }

    func testGroceryFailureIsNonFatal() async {
        let svc = ScriptedPlanService()
        svc.dayResult = .success(Self.day(menus: [Self.breakfast]))
        svc.groceryResult = .failure(.server(status: 500))
        let vm = MealPlanViewModel(service: svc, mealLogging: NoopMealLogging())
        await vm.load(date: "2026-07-24")
        XCTAssertEqual(vm.state, .loaded)
        XCTAssertTrue(vm.groceryItems.isEmpty)
    }

    func testDayFailureIsFailed() async {
        let svc = ScriptedPlanService()
        svc.dayResult = .failure(.offline)
        let vm = MealPlanViewModel(service: svc, mealLogging: NoopMealLogging())
        await vm.load(date: "2026-07-24")
        XCTAssertEqual(vm.state, .failed(.offline))
    }

    func testStartPlanFirstTimeUsesStartDateThenReloads() async {
        let svc = ScriptedPlanService()
        svc.dayResult = .success(Self.day(menus: [], start: nil))
        let vm = MealPlanViewModel(service: svc, mealLogging: NoopMealLogging())
        await vm.load(date: "2026-07-24")
        svc.dayResult = .success(Self.day(menus: [Self.breakfast]))
        await vm.startOrRegeneratePlan()
        XCTAssertEqual(svc.startPlanCalls, 1)
        XCTAssertEqual(svc.regenerateCalls, 0)
        XCTAssertEqual(vm.state, .loaded)
    }

    func testStartPlanPremiumRequiredSurfacesError() async {
        let svc = ScriptedPlanService()
        svc.dayResult = .success(Self.day(menus: [], start: nil))
        svc.startPlanError = .premiumRequired
        let vm = MealPlanViewModel(service: svc, mealLogging: NoopMealLogging())
        await vm.load(date: "2026-07-24")
        await vm.startOrRegeneratePlan()
        XCTAssertNotNil(vm.startPlanError)
        XCTAssertEqual(vm.state, .noPlan(hasExistingPlan: false)) // stays on empty state
    }
}
```

Plus a stale-response race test using the repo's `Gate` actor pattern (copy the shape from `RestaurantsViewModelTests.swift:276+`): start `load()` gated, start a second `load()` that completes with menus A, open the gate for the first — assert final `menus` are A (generation guard discarded the stale write).

- [ ] **Step 2: Register test file, run** — expect compile failure.
- [ ] **Step 3: Implement `MealPlanViewModel.swift`** (load + start only; Task 5 adds actions):

```swift
import Foundation
import Observation

@Observable @MainActor
final class MealPlanViewModel {
    enum State: Equatable { case loading, noPlan(hasExistingPlan: Bool), loaded, failed(APIError) }

    private(set) var state: State = .loading
    private(set) var menus: [MenuEntryDTO] = []
    private(set) var loggedRecipeIds: Set<String> = []
    private(set) var mealRatings: [String: Int] = [:]
    private(set) var dailyCalorieTarget: Double?
    private(set) var groceryItems: [GroceryItemDTO] = []
    private(set) var recentlyLoggedRecipeIds: Set<String> = []
    private(set) var isStartingPlan = false
    private(set) var startPlanError: String?

    private let service: MealPlanProviding
    private let mealLogging: MealLogging
    private var loadGeneration = 0
    private(set) var currentDate: String = localDateString(for: Date())

    init(service: MealPlanProviding, mealLogging: MealLogging) {
        self.service = service
        self.mealLogging = mealLogging
    }

    var plannedCalories: Double { menus.reduce(0) { $0 + ($1.recipe.calories ?? 0) } }

    func load(date: String = localDateString(for: Date())) async {
        loadGeneration += 1
        let generation = loadGeneration
        currentDate = date
        state = .loading
        do {
            async let dayTask = service.fetchDay(date: date)
            async let groceryTask = try? service.groceryList(from: date, to: date) // non-fatal
            let day = try await dayTask
            let grocery = await groceryTask ?? []
            guard generation == loadGeneration else { return }
            menus = day.menus.sorted {
                mealTypeSortIndex(mealTypeSlug($0.mealType?.name)) < mealTypeSortIndex(mealTypeSlug($1.mealType?.name))
            }
            loggedRecipeIds = Set(day.loggedRecipeIds)
            mealRatings = day.mealRatings
            dailyCalorieTarget = day.dailyCalorieTarget
            groceryItems = grocery
            state = day.menus.isEmpty ? .noPlan(hasExistingPlan: day.mealPlanStartDate != nil) : .loaded
        } catch let error as APIError {
            guard generation == loadGeneration else { return }
            state = .failed(error)
        } catch {
            guard generation == loadGeneration else { return }
            state = .failed(.transport)
        }
    }

    func retry() async { await load(date: currentDate) }

    func startOrRegeneratePlan() async {
        guard !isStartingPlan, case .noPlan(let hasExistingPlan) = state else { return }
        isStartingPlan = true
        startPlanError = nil
        defer { isStartingPlan = false }
        do {
            if hasExistingPlan { try await service.regeneratePlan() }
            else { try await service.startPlan(startDate: currentDate) }
            await load(date: currentDate)
        } catch let error as APIError {
            startPlanError = Self.startPlanMessage(for: error)
        } catch {
            startPlanError = Self.startPlanMessage(for: .transport)
        }
    }

    nonisolated static func startPlanMessage(for error: APIError) -> String {
        switch error {
        case .premiumRequired: return "Meal plans are a Premium feature."
        case .server(422): return "Finish your profile on wondish.io first — the plan needs your details."
        case .conflict: return "A plan is already being generated — try again in a minute."
        case .offline: return "You're offline. Check your connection and try again."
        default: return "Couldn't generate your plan. Please try again."
        }
    }
}
```

- [ ] **Step 4: Register in pbxproj, run** `ClaraTests/MealPlanViewModelTests` — pass.
- [ ] **Step 5: Commit** — `feat(meal-plan): view model load/noPlan/failed with race guard`

---

### Task 5: VM actions — rate (echo replacement), add-to-log (idempotent), swap

**Files:**
- Modify: `Clara/Features/MealPlan/MealPlanViewModel.swift`
- Test: extend `ClaraTests/MealPlanViewModelTests.swift`

**Interfaces:**
- Produces (added to `MealPlanViewModel`):
```swift
private(set) var ratingInFlightRecipeID: String?
private(set) var loggingRecipeID: String?
private(set) var swapInFlightMenuID: String?
private(set) var actionError: String?           // transient banner text, clearable
func clearActionError()
func rate(menu: MenuEntryDTO, rating: Int) async          // POST journal/log-meal, replace logged/ratings from echo
func addToLog(menu: MenuEntryDTO) async                   // logPlanRecipe, per-recipe clientRequestId reuse-on-retry
func loadAlternatives(for menu: MenuEntryDTO) async -> [PlanRecipeDTO]?  // nil on failure (sets actionError)
func swap(menu: MenuEntryDTO, with recipe: PlanRecipeDTO) async -> Bool  // PATCH; on success replace menu.recipe locally
```

- [ ] **Step 1: Write failing tests** (extend the scripted service with `rateResult`, `alternativesResult`, `swapError`, recorded inputs; extend a `RecordingMealLogging` double that records `PlanRecipeLogInput`s and can fail once):

```swift
func testRateReplacesStateFromServerEcho() async {
    let svc = ScriptedPlanService()
    svc.dayResult = .success(Self.day(menus: [Self.breakfast]))
    svc.rateResult = RateEchoDTO(ok: true, loggedRecipeIds: [], mealRatings: [:]) // toggle-off echo
    let vm = MealPlanViewModel(service: svc, mealLogging: NoopMealLogging())
    await vm.load(date: "2026-07-24")
    await vm.rate(menu: Self.breakfast, rating: 1)   // r1 was rated 1 → server undoes
    XCTAssertTrue(vm.loggedRecipeIds.isEmpty)         // echo replaced, not merged
    XCTAssertTrue(vm.mealRatings.isEmpty)
}

func testAddToLogReusesClientRequestIdOnRetry() async {
    let svc = ScriptedPlanService()
    svc.dayResult = .success(Self.day(menus: [Self.breakfast]))
    let logging = RecordingMealLogging()
    logging.failuresRemaining = 1                     // first attempt throws .offline
    let vm = MealPlanViewModel(service: svc, mealLogging: logging)
    await vm.load(date: "2026-07-24")
    await vm.addToLog(menu: Self.breakfast)           // fails
    XCTAssertNotNil(vm.actionError)
    await vm.addToLog(menu: Self.breakfast)           // retry succeeds
    XCTAssertEqual(logging.planInputs.count, 2)
    XCTAssertEqual(logging.planInputs[0].clientRequestId, logging.planInputs[1].clientRequestId) // reused
    XCTAssertTrue(vm.recentlyLoggedRecipeIds.contains("r1"))
}

func testAddToLogSingleFlightWhileInFlight() async {
    let svc = ScriptedPlanService()
    svc.dayResult = .success(Self.day(menus: [Self.breakfast]))
    let gate = Gate()                                  // reuse the Gate actor from RestaurantsViewModelTests
    let logging = RecordingMealLogging()
    logging.gate = gate                                // logPlanRecipe awaits gate.wait() before returning
    let vm = MealPlanViewModel(service: svc, mealLogging: logging)
    await vm.load(date: "2026-07-24")
    addTeardownBlock { await gate.open() }
    let first = Task { await vm.addToLog(menu: Self.breakfast) }
    await Task.yield()                                 // let the first call reach the gate
    await vm.addToLog(menu: Self.breakfast)            // second call: guard loggingRecipeID → returns immediately
    await gate.open()
    await first.value
    XCTAssertEqual(logging.planInputs.count, 1)        // exactly one wire call
}

func testSwapSuccessReplacesRecipeLocally() async {
    let svc = ScriptedPlanService()
    svc.dayResult = .success(Self.day(menus: [Self.breakfast]))
    let vm = MealPlanViewModel(service: svc, mealLogging: NoopMealLogging())
    await vm.load(date: "2026-07-24")
    let alt = try! JSONDecoder().decode(PlanRecipeDTO.self,
        from: Data(#"{"id":"r9","name":"Shakshuka","calories":410,"ingredients":[]}"#.utf8))
    let ok = await vm.swap(menu: Self.breakfast, with: alt)
    XCTAssertTrue(ok)
    XCTAssertEqual(vm.menus[0].recipe.id, "r9")       // local merge, web parity
}

func testSwapFailureKeepsMenuAndSetsError() async {
    let svc = ScriptedPlanService()
    svc.dayResult = .success(Self.day(menus: [Self.breakfast]))
    svc.swapError = .conflict(reason: "same-day family rule")
    let vm = MealPlanViewModel(service: svc, mealLogging: NoopMealLogging())
    await vm.load(date: "2026-07-24")
    let alt = try! JSONDecoder().decode(PlanRecipeDTO.self, from: Data(#"{"id":"r9","name":"X","ingredients":[]}"#.utf8))
    let ok = await vm.swap(menu: Self.breakfast, with: alt)
    XCTAssertFalse(ok)
    XCTAssertEqual(vm.menus[0].recipe.id, "r1")
    XCTAssertNotNil(vm.actionError)
}
```

`MenuEntryDTO` needs a mutable-copy path for the swap merge — since DTOs are `let`-structs, implement the merge by rebuilding: add `func replacingRecipe(_ recipe: PlanRecipeDTO) -> MenuEntryDTO` as an extension in `MealPlanViewModel.swift` (memberwise re-init; add an internal memberwise `init` to `MenuEntryDTO` in Task 1 if the synthesized one is unavailable to tests).

- [ ] **Step 2: Run** — compile failure expected.
- [ ] **Step 3: Implement the actions** in `MealPlanViewModel`:

```swift
private var pendingLogRequestIDs: [String: String] = [:]   // recipeId → clientRequestId (FridgeViewModel pattern)

func clearActionError() { actionError = nil }

func rate(menu: MenuEntryDTO, rating: Int) async {
    let recipeID = menu.recipe.id
    guard ratingInFlightRecipeID == nil else { return }
    ratingInFlightRecipeID = recipeID
    defer { ratingInFlightRecipeID = nil }
    do {
        let echo = try await service.rate(recipeId: recipeID,
                                          mealTypeName: menu.mealType?.name ?? "Meal",
                                          date: currentDate, rating: rating)
        loggedRecipeIds = Set(echo.loggedRecipeIds)   // replace, never merge — server owns toggle semantics
        mealRatings = echo.mealRatings
    } catch {
        actionError = "Couldn't save your rating. Please try again."
    }
}

func addToLog(menu: MenuEntryDTO) async {
    let recipeID = menu.recipe.id
    guard loggingRecipeID == nil else { return }
    loggingRecipeID = recipeID
    defer { loggingRecipeID = nil }
    let requestID = pendingLogRequestIDs[recipeID] ?? UUID().uuidString.lowercased()
    pendingLogRequestIDs[recipeID] = requestID
    do {
        _ = try await mealLogging.logPlanRecipe(PlanRecipeLogInput(
            recipeId: recipeID, localDate: currentDate,
            mealType: mealTypeSlug(menu.mealType?.name), clientRequestId: requestID))
        pendingLogRequestIDs[recipeID] = nil
        recentlyLoggedRecipeIds.insert(recipeID)
    } catch let error as APIError {
        actionError = mealLogErrorMessage(for: error)   // existing pure helper
    } catch {
        actionError = mealLogErrorMessage(for: .transport)
    }
}

func loadAlternatives(for menu: MenuEntryDTO) async -> [PlanRecipeDTO]? {
    do {
        return try await service.alternatives(mealTypeId: menu.mealTypeId ?? menu.mealType?.id ?? "",
                                              excludeRecipeId: menu.recipe.id,
                                              currentCalories: menu.recipe.calories ?? 0)
    } catch {
        actionError = "Couldn't load swap options. Please try again."
        return nil
    }
}

func swap(menu: MenuEntryDTO, with recipe: PlanRecipeDTO) async -> Bool {
    guard swapInFlightMenuID == nil else { return false }
    swapInFlightMenuID = menu.id
    defer { swapInFlightMenuID = nil }
    do {
        try await service.swap(menuId: menu.id, recipeId: recipe.id)
        if let idx = menus.firstIndex(where: { $0.id == menu.id }) {
            menus[idx] = menus[idx].replacingRecipe(recipe)   // web parity: keep the alternative we hold
        }
        return true
    } catch {
        actionError = "That swap isn't allowed for today's plan. Try another dish."
        return false
    }
}
```

- [ ] **Step 4: Run full VM test file** — pass.
- [ ] **Step 5: Commit** — `feat(meal-plan): rate/add-to-log/swap actions with echo replacement + idempotency`

---

### Task 6: MealPlanView rewrite — live states, no week strip, shopping list

**Files:**
- Rewrite: `Clara/Features/MealPlan/MealPlanView.swift` (delete `PlanDay`/`planWeek`/`PlannedMeal`/`PlanIngredient` demo types and the `weekStrip`)
- Modify: `Clara/App/LaunchFixtures.swift` (cases `mealPlanLoaded`, `mealPlanNoPlan`, `mealPlanError` + `stubMealPlanProviding`)
- Modify: `Clara.xcodeproj/project.pbxproj` (already-registered files only — nothing new this task)

**Interfaces:**
- Consumes: `MealPlanViewModel` (Tasks 4-5), `LaunchFixtures.current?.stubMealPlanProviding` / `.stubMealLogging`, `@Environment(\.apiClient)`.
- Produces: `MealPlanView` (same type name — `RootTabView` untouched); private `DishPagerView`/`DishDetailPage` now take `[MenuEntryDTO]` + closures `onRate: (MenuEntryDTO, Int) -> Void`, `onAddToLog: (MenuEntryDTO) -> Void`, `onSwapTapped: (MenuEntryDTO) -> Void`.

Layout (approved design, minus week strip, plus shopping list):
1. Summary card — "TODAY, {formatted}" over `{plannedCalories} of {dailyCalorieTarget} kcal` (target row hidden when nil) + `"{logged}/{total} logged"` badge.
2. Meal cards — real `menus`: meal-type label = `mealType.name.uppercased()`, name, first tag or dishType as `WBadge`, kcal, "Logged" checkmark when `recipe.id ∈ loggedRecipeIds`, buttons Swap / "Log meal" (spinner while `loggingRecipeID == recipe.id`; "Added ✓" state when in `recentlyLoggedRecipeIds`). Card tap → zoom pager (unchanged mechanics, `-expandDish` arg now indexes `vm.menus`).
3. **Shopping list card** — `"SHOPPING LIST"` section label, one row per `groceryItems`: name left, `{totalQuantity formatted} {unit}` right (monospaced digits), tappable local-only strikethrough toggle (`@State private var checkedIngredientIds: Set<String>`), ≥44pt rows. Section hidden entirely when `groceryItems.isEmpty`.
4. States: `.loading` → redacted skeleton cards; `.failed` → message + "Try again" (`WButtonStyle` secondary) → `vm.retry()`; `.noPlan` → `calendar.badge.plus` icon, copy "No meal plan yet" / "No meals planned today", CTA "Start my meal plan"/"Regenerate plan" → `vm.startOrRegeneratePlan()` (spinner while `isStartingPlan`, `startPlanError` text below in `WColor.error`).
5. `actionError` → auto-dismissing banner (reuse the alert pattern from `SignedInView`: `.alert` bound to `vm.actionError != nil`, OK clears via `vm.clearActionError()`).

- [ ] **Step 1: Add fixtures.** In `LaunchFixtures.swift`: three new enum cases; `phase`/`me`/`cannedMeJSON` switch arms match `signedInPremium`; new accessor:

```swift
var stubMealPlanProviding: MealPlanProviding? {
    switch self {
    case .mealPlanLoaded: return FixtureMealPlanProviding(outcome: .loaded)
    case .mealPlanNoPlan: return FixtureMealPlanProviding(outcome: .noPlan)
    case .mealPlanError: return FixtureMealPlanProviding(outcome: .error)
    default: return nil
    }
}
```

`FixtureMealPlanProviding` (private struct in the same file): `.loaded` decodes a static 4-menu JSON day (breakfast/lunch/snack/dinner — reuse the Task 1 JSON shape, 4 entries, 2 logged, 1 rated) + 6 grocery items; `.noPlan` returns empty menus + nil start date; `.error` throws `.server(status: 500)`. `rate` echoes toggled state; `swap`/`startPlan` succeed; `alternatives` returns 2 canned recipes.

- [ ] **Step 2: Rewrite `MealPlanView`.** Resolution follows `RestaurantsView.attachViewModelIfNeeded` exactly:

```swift
@State private var vm: MealPlanViewModel?
@Environment(\.apiClient) private var apiClient

private func attachViewModelIfNeeded() {
    guard vm == nil else { return }
    #if DEBUG
    if let fixture = LaunchFixtures.current, let stub = fixture.stubMealPlanProviding {
        vm = MealPlanViewModel(service: stub, mealLogging: fixture.stubMealLogging ?? NoopFixtureFallbackLogging())
        return
    }
    #endif
    guard let apiClient else { return }
    vm = MealPlanViewModel(service: MealPlanService(api: apiClient),
                           mealLogging: MealLogService(api: apiClient))
}
// body: NavigationStack { content }.task { attachViewModelIfNeeded(); await vm?.load() }
```

(If `stubMealLogging` is nil for meal-plan fixtures, extend `FixtureMealLogging` availability to the three new cases instead of adding a fallback type — keep one stub path.)

Keep `DishPagerView` full-screen paging + zoom modifiers byte-identical; `DishDetailPage` now renders `menu.recipe`: chips from `ethnic?.name`/`dishType?.name` (hidden when nil), tiles from `prepTime`/`cookTime`/`servings` (em-dash when nil/0 — web parity), nutrition tiles from `calories/protein/carbs/fat` (tile hidden when nil, web parity), ingredients rows `ingredient.name` + `"{quantity} {unit ?? ingredient.unit}"` (quantity row absent when nil), steps from `planSteps(from: recipe.description)` (section hidden when empty), tags row from `tags`, add-to-log button + thumbs wired to the closures, thumb selected state from `mealRatings[recipe.id]`.

- [ ] **Step 3: Build + fixture screenshots.**

```bash
cd /Users/becks/Desktop/NewView/Clara && xcodebuild -project Clara.xcodeproj -scheme Clara \
  -destination "platform=iOS Simulator,id=9A2B71CC-987F-4A6F-8DB1-BF8F2341CCF1" -derivedDataPath build/dd -quiet build
xcrun simctl install 9A2B71CC-987F-4A6F-8DB1-BF8F2341CCF1 build/dd/Build/Products/Debug-iphonesimulator/Clara.app
# one launch+screenshot per fixture:
xcrun simctl launch 9A2B71CC-987F-4A6F-8DB1-BF8F2341CCF1 io.wondish.clara -UITestFixture mealPlanLoaded -tab mealplan
xcrun simctl io 9A2B71CC-987F-4A6F-8DB1-BF8F2341CCF1 screenshot /tmp/mp-loaded.png   # repeat for mealPlanNoPlan, mealPlanError, and -expandDish 1
```

Read each screenshot; verify: no week strip, shopping list under meals, empty/error states render, pager shows real recipe fields.

- [ ] **Step 4: Run full test suite** — green.
- [ ] **Step 5: Commit** — `feat(meal-plan): live MealPlanView — today-only, shopping list, fixtures`

---

### Task 7: Swap sheet in the pager + end-to-end polish

**Files:**
- Modify: `Clara/Features/MealPlan/MealPlanView.swift` (add `SwapSheet`)

**Interfaces:**
- Consumes: `vm.loadAlternatives(for:)`, `vm.swap(menu:with:)`.
- Produces: private `SwapSheet: View` — presented via `.sheet` from both the card's Swap button and the pager page's swap affordance.

- [ ] **Step 1: Implement `SwapSheet`.** `@State` phases: `loadingAlternatives` (redacted rows) → list of up to 3 alternative cards (name, kcal, dishType badge, per-row "Choose" `WButtonStyle` primary sm) → on choose: spinner on that row, `await vm.swap(menu:with:)`; success dismisses the sheet (and the pager page re-renders from `vm.menus`); failure keeps sheet open, `vm.actionError` alert shows. Empty alternatives → "No swaps available for this meal today." + Close. Sheet gets `.presentationDetents([.medium])` and an explicit Close button (modal-escape guideline).

- [ ] **Step 2: Wire the pager.** `DishPagerView` takes `vm` (or the closures + `menus` binding); pages re-render post-swap because `vm.menus` is the source of truth. The "Swap" affordance on `DishDetailPage` replaces nothing visually — reuse the existing secondary button slot.

- [ ] **Step 3: Manual verification pass** on fixture `mealPlanLoaded`: tap card → pager zooms; swap → sheet → choose → dish updates in place; thumbs toggle (tap twice = undo); Log meal → "Added ✓". Screenshot each state and read them.

- [ ] **Step 4: Full suite + build one last time** — green.
- [ ] **Step 5: Commit + ledger.** `feat(meal-plan): swap sheet + pager wiring — Meal Plan tab fully live`. Append a CYCLE close-out entry to `/Users/becks/Desktop/NewView/wondish_02/.superpowers/sdd/progress.md` (established ledger).

---

## Self-review notes

- The GET response has **no** `stale`/`status` field — plan-staleness UI is out of scope this cycle (status endpoint exists if wanted later).
- `loggedRecipeIds` is **journal** semantics (rating-driven), matching web; `addToLog` writes the separate intake tracker and only drives the transient "Added ✓" state. These are deliberately not conflated.
- `-expandDish` debug arg switches from demo array to `vm.menus` indexing; guard `indices.contains`.
- Live smoke against `www.wondish.io` uses the user's uncommitted `Debug.xcconfig` override — no fixture needed, but note start-date/regenerate are **premium-gated** on the server.
