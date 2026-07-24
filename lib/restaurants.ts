// ─── Wondish Restaurants Core (list/detail query + serialization) ───────────
// The single home for consumer restaurant-directory request validation,
// cursor encode/decode, Prisma where/orderBy building, and DTO serialization
// (with server-computed diet-match verdicts). Routes (app/api/restaurants/*)
// stay thin: auth → rate-limit → derive matchers once → Prisma fetch →
// delegate to these pure functions → serialize response. Mirrors the
// lib/meal-log.ts precedent (thin-route-over-tested-pure-lib).
//
// Wire contract of record: docs/superpowers/plans/2026-07-22-ios-restaurants-tab.md
// Task 1, pinned into .superpowers/sdd/restaurants-e4-brief.md. Every
// serializer below emits EXACTLY those field names/shapes — see
// restaurants.test.ts for byte-exact assertions.
// ────────────────────────────────────────────────────────────────────────────

import { evaluateDishAgainstProfile, type DietMatchers, type Violation } from "@/lib/diet-match";

// ─── Result type (mirrors lib/meal-log.ts's ParseResult convention) ────────

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; status: number };

const fail = (error: string, status = 400): ParseResult<never> => ({ ok: false, error, status });

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// ─── List cursor — compound (name, id), opaque, same posture as the ────────
// meal-log delta-sync cursor (lib/meal-log.ts encodeDeltaCursor/decodeDeltaCursor).
// List order is `name asc, id asc` (name is not unique), so the cursor must
// carry both to resume exactly where the prior page left off.

export interface ListCursor {
  name: string;
  id: string;
}

export function encodeListCursor(name: string, id: string): string {
  const json = JSON.stringify({ n: name, i: id });
  return Buffer.from(json, "utf8").toString("base64url");
}

export function decodeListCursor(raw: string): ListCursor | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  let json: string;
  try {
    json = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    return null;
  }
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isObj(obj) || typeof obj.n !== "string" || typeof obj.i !== "string" || obj.i.length === 0) {
    return null;
  }
  return { name: obj.n, id: obj.i };
}

// ─── List query parsing — filters passthrough, limit clamp, cursor decode ──

const DEFAULT_LIMIT = 25;
const MIN_LIMIT = 1;
const MAX_LIMIT = 50;

export interface RawListQueryParams {
  cuisine: string | null;
  neighborhood: string | null;
  cursor: string | null;
  limit: string | null;
}

export interface ListQuery {
  cuisine: string | null;
  neighborhood: string | null;
  cursor: ListCursor | null;
  limit: number;
}

// Non-numeric/absent limit falls back to the default; any parseable number is
// clamped into [MIN_LIMIT, MAX_LIMIT]. Only a malformed cursor 400s (repo
// convention) — limit/cuisine/neighborhood are permissive by design (v1 has
// no allow-list to validate cuisine/neighborhood against here; the DB query
// simply returns zero rows for a bogus value).
function parseLimit(raw: string | null): number {
  // Empty/whitespace counts as absent: Number("") === 0, which previously
  // clamped to MIN_LIMIT (1) instead of falling back to the default.
  if (raw == null || raw.trim() === "") return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.trunc(n)));
}

export function parseListQuery(raw: RawListQueryParams): ParseResult<ListQuery> {
  let cursor: ListCursor | null = null;
  if (raw.cursor != null && raw.cursor !== "") {
    const decoded = decodeListCursor(raw.cursor);
    if (!decoded) return fail("cursor is malformed");
    cursor = decoded;
  }
  return {
    ok: true,
    value: {
      cuisine: raw.cuisine ?? null,
      neighborhood: raw.neighborhood ?? null,
      cursor,
      limit: parseLimit(raw.limit),
    },
  };
}

// ─── Pagination — fetch limit+1 rows, slice+cursor computed here ───────────
// Fetching one extra row lets the route decide `nextCursor` correctly in a
// single query (vs. the meal-log delta convention of returning a cursor on
// every full page and letting the client discover the empty last page) — the
// contract here pins `nextCursor: null` on the actual last page.

export function paginateListRows<T extends { name: string; id: string }>(
  rows: readonly T[],
  limit: number
): { pageRows: T[]; nextCursor: string | null } {
  if (rows.length > limit) {
    const pageRows = rows.slice(0, limit);
    const last = pageRows[pageRows.length - 1];
    return { pageRows, nextCursor: encodeListCursor(last.name, last.id) };
  }
  return { pageRows: rows.slice(), nextCursor: null };
}

// ─── Prisma where/orderBy for the list query ───────────────────────────────
// Published-only everywhere (controller resolution); cuisine filters by
// `ethnicId` literally (v1 client doesn't use it); neighborhood is an exact
// string match. Cursor adds the same compound tie-break shape as the
// meal-log delta cursor (buildDeltaWhere) — `name > cursor.name` OR
// `(name = cursor.name AND id > cursor.id)` — required because `name` alone
// is not unique.

export interface RestaurantWhereFilters {
  cuisine: string | null;
  neighborhood: string | null;
}

export function buildRestaurantListWhere(
  filters: RestaurantWhereFilters,
  cursor: ListCursor | null
): Record<string, unknown> {
  const where: Record<string, unknown> = { status: "PUBLISHED" };
  if (filters.cuisine) where.ethnicId = filters.cuisine;
  if (filters.neighborhood) where.neighborhood = filters.neighborhood;
  if (cursor) {
    where.OR = [{ name: { gt: cursor.name } }, { name: cursor.name, id: { gt: cursor.id } }];
  }
  return where;
}

// Matching orderBy — MUST pair with buildRestaurantListWhere for a stable
// total order (name asc, id asc — recommended by the controller resolution).
export const RESTAURANT_LIST_ORDER_BY = [{ name: "asc" as const }, { id: "asc" as const }];

// ─── Cuisine facet — distinct, sorted, nulls dropped ───────────────────────
// Server facet list is computed across ALL published restaurants (never
// page-derived) — the route queries independently of the paginated list.

export function buildCuisineFacet(names: readonly (string | null)[]): string[] {
  const distinct = new Set<string>();
  for (const n of names) {
    if (n) distinct.add(n);
  }
  return Array.from(distinct).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// ─── Price formatting — Decimal-shaped/number/string → "9.00" | null ───────
// Accepts a structural Decimal (has `.toFixed`), a plain number, or a numeric
// string — kept structural (not a `Prisma.Decimal` import) so this module has
// no Prisma dependency, matching lib/diet-match.ts's pure-module posture.

type Priceish = number | string | { toFixed(dp: number): string } | null | undefined;

export function formatPrice(price: Priceish): string | null {
  if (price == null) return null;
  if (typeof price === "number") return price.toFixed(2);
  if (typeof price === "string") {
    const n = Number(price);
    return Number.isFinite(n) ? n.toFixed(2) : null;
  }
  return price.toFixed(2);
}

// ─── Ingredient ordering — deterministic name asc ──────────────────────────

export function sortIngredientNames(names: readonly string[]): string[] {
  return [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// ─── Verdict — null ⇔ no profile; caution always literally false in v1 ────
// `matchers === null` is the single canonical "no profile" signal threaded
// through this module (see also computeMatchSummary below) — the route sets
// it once per request: `patient ? buildDietMatchers(derivePatientBans(patient)) : null`.
// A real profile with zero ban sources still yields a non-null (empty)
// matchers object, so verdicts compute normally (all pass) rather than null.

export interface Verdict {
  passed: boolean;
  caution: false;
  violations: Violation[];
}

export function computeVerdict(ingredientNames: readonly string[], matchers: DietMatchers | null): Verdict | null {
  if (matchers == null) return null;
  const { passed, violations } = evaluateDishAgainstProfile(ingredientNames as string[], matchers);
  return { passed, caution: false, violations };
}

// ─── matchSummary — over a restaurant's served (PUBLISHED + available) ────
// dishes: passed = count with zero violations, total = served-dish count.
// `matchers === null` (no profile) ⇒ null, same convention as computeVerdict.

export interface MatchSummary {
  passed: number;
  total: number;
}

export function computeMatchSummary(
  dishIngredientLists: readonly (readonly string[])[],
  matchers: DietMatchers | null
): MatchSummary | null {
  if (matchers == null) return null;
  let passed = 0;
  for (const ingredients of dishIngredientLists) {
    if (evaluateDishAgainstProfile(ingredients as string[], matchers).passed) passed++;
  }
  return { passed, total: dishIngredientLists.length };
}

// ─── Restaurant list-item serializer ───────────────────────────────────────

export interface RestaurantListRow {
  id: string;
  slug: string;
  name: string;
  neighborhood: string;
  cuisineName: string | null;
}

export interface RestaurantListItemDTO {
  id: string;
  slug: string;
  name: string;
  neighborhood: string;
  cuisine: string | null;
  matchSummary: MatchSummary | null;
}

export function serializeRestaurantListItem(
  row: RestaurantListRow,
  matchSummary: MatchSummary | null
): RestaurantListItemDTO {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    neighborhood: row.neighborhood,
    cuisine: row.cuisineName,
    matchSummary,
  };
}

// ─── Restaurant detail serializer ──────────────────────────────────────────

export interface RestaurantDetailRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  neighborhood: string;
  cuisineName: string | null;
}

export interface RestaurantDetailDTO {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  neighborhood: string;
  cuisine: string | null;
}

export function serializeRestaurantDetail(row: RestaurantDetailRow): RestaurantDetailDTO {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    neighborhood: row.neighborhood,
    cuisine: row.cuisineName,
  };
}

// ─── Dish serializer ────────────────────────────────────────────────────────

export interface DishRow {
  id: string;
  name: string;
  description: string | null;
  price: Priceish;
  currency: string;
  section: string;
  sortOrder: number;
  isRecommended: boolean;
}

export interface DishDTO {
  id: string;
  name: string;
  description: string | null;
  ingredients: string[];
  price: string | null;
  currency: string;
  section: string;
  sortOrder: number;
  isRecommended: boolean;
  verdict: Verdict | null;
}

export function serializeDish(
  row: DishRow,
  ingredientNames: readonly string[],
  matchers: DietMatchers | null
): DishDTO {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    ingredients: sortIngredientNames(ingredientNames),
    price: formatPrice(row.price),
    currency: row.currency,
    section: row.section,
    sortOrder: row.sortOrder,
    isRecommended: row.isRecommended,
    verdict: computeVerdict(ingredientNames, matchers),
  };
}
