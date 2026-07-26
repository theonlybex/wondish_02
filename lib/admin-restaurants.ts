// ─── Wondish Admin Restaurants (validation + write shaping) ─────────────────
// The single home for admin-side restaurant/dish request validation shared by
// app/api/admin/restaurants/**. Routes stay thin: requireAdmin() → parse via
// these pure functions → Prisma write → JSON. Mirrors the lib/meal-log.ts /
// lib/restaurants.ts ParseResult convention (ok/error/status), kept in its
// own module (rather than folded into lib/restaurants.ts) so the
// consumer-facing serializer module — and its E4 contract — stays untouched.
//
// Cycle 3 Engine Task E5 (.superpowers/sdd/restaurants-e5-brief.md).
// ────────────────────────────────────────────────────────────────────────────

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; status: number };

const ok = <T>(value: T): ParseResult<T> => ({ ok: true, value });
const fail = (error: string, status = 400): ParseResult<never> => ({ ok: false, error, status });

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// ─── slugify — name → URL-safe slug ─────────────────────────────────────────
// Lowercases, strips anything that isn't alphanumeric, collapses runs of
// separators into a single hyphen, and trims leading/trailing hyphens. Pure
// and DB-free — uniqueness is enforced by the `Restaurant.slug @unique`
// column and surfaced as a 409 by the route (Prisma P2002), not here.

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/['’]/g, "") // drop apostrophes rather than hyphenating them
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ─── Status enums ────────────────────────────────────────────────────────

// Mutable Restaurant scalars for admin POST/PATCH bodies (see lib/admin.ts
// pickFields). Excludes id/slug/status (route-validated explicitly), all
// relation keys (a nested "dishes" write would bypass the publish gate and
// its row lock), and timestamps.
export const RESTAURANT_MUTABLE_FIELDS = [
  "name", "neighborhood", "description", "imageUrl", "logoUrl", "addressLine",
  "city", "state", "postalCode", "latitude", "longitude", "ethnicId", "hours",
  "phone", "website",
] as const;

export const RESTAURANT_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
export type RestaurantStatusValue = (typeof RESTAURANT_STATUSES)[number];

export const DISH_STATUSES = ["DRAFT", "PUBLISHED"] as const;
export type DishStatusValue = (typeof DISH_STATUSES)[number];

export function isRestaurantStatus(v: unknown): v is RestaurantStatusValue {
  return typeof v === "string" && (RESTAURANT_STATUSES as readonly string[]).includes(v);
}

export function isDishStatus(v: unknown): v is DishStatusValue {
  return typeof v === "string" && (DISH_STATUSES as readonly string[]).includes(v);
}

// ─── coercePrice — string in, Decimal-ready string (or null) out ───────────
// `RestaurantDish.price` is stored as Prisma Decimal(10,2); Prisma accepts a
// plain numeric string for a Decimal field directly, so the validated string
// is passed straight through to `prisma.restaurantDish.{create,update}` — no
// Prisma.Decimal construction needed here (keeps this module Prisma-free,
// matching lib/restaurants.ts's structural-Priceish posture).
//
// The integer part is bounded to 8 digits: Decimal(10,2) holds at most
// 10 significant digits with 2 reserved for cents, so anything longer would
// overflow at write time and surface as an opaque Prisma 500 instead of
// this 400.

const PRICE_RE = /^\d{1,8}(\.\d{1,2})?$/;

export function coercePrice(raw: unknown): ParseResult<string | null> {
  if (raw === undefined || raw === null) return ok(null);
  if (typeof raw !== "string") return fail("price must be a string");
  const trimmed = raw.trim();
  if (trimmed === "") return ok(null);
  if (!PRICE_RE.test(trimmed)) {
    return fail("price must be a non-negative decimal string with up to 2 decimal places");
  }
  return ok(trimmed);
}

// ─── parseIngredients — shape validation + dedupe-by-name (replace-all) ───
// Validates the `ingredients: [{ name, quantity?, unit? }]` array the route
// uses for a replace-all nested write. Composite PK `(dishId, name)` makes
// duplicate names within one payload a write-time unique violation, so this
// dedupes here (last entry for a given name wins) rather than letting that
// surface as an opaque Prisma error.

export interface IngredientInput {
  name: string;
  quantity: number | null;
  unit: string | null;
}

export function parseIngredients(raw: unknown): ParseResult<IngredientInput[]> {
  if (!Array.isArray(raw)) return fail("ingredients must be an array");

  const byName = new Map<string, IngredientInput>();
  for (const item of raw) {
    if (!isObj(item)) return fail("each ingredient must be an object");

    if (typeof item.name !== "string" || item.name.trim().length === 0) {
      return fail("each ingredient requires a non-empty name");
    }
    const name = item.name.trim();

    let quantity: number | null = null;
    if (item.quantity !== undefined && item.quantity !== null) {
      if (typeof item.quantity !== "number" || !Number.isFinite(item.quantity) || item.quantity < 0) {
        return fail(`ingredient "${name}" quantity must be a non-negative number`);
      }
      quantity = item.quantity;
    }

    let unit: string | null = null;
    if (item.unit !== undefined && item.unit !== null) {
      if (typeof item.unit !== "string") {
        return fail(`ingredient "${name}" unit must be a string`);
      }
      unit = item.unit;
    }

    byName.set(name, { name, quantity, unit }); // last write wins on duplicate name
  }

  return ok(Array.from(byName.values()));
}

// ─── stripDishIdentityFields — dish PATCH `...rest` hygiene ────────────────
// The dish PATCH route spreads the body's remaining keys straight into
// `prisma.restaurantDish.update()`. `id` and `restaurantId` must never ride
// along: a payload carrying `restaurantId` would silently re-parent the dish
// to another restaurant (bypassing the URL's restaurant scope and its
// publish-gate row lock), and `id` would rewrite the primary key. Pure strip
// — every other key passes through untouched, so response shapes stay
// byte-identical for well-formed payloads.

export function stripDishIdentityFields<T extends Record<string, unknown>>(
  rest: T
): Omit<T, "id" | "restaurantId"> {
  const { id: _id, restaurantId: _restaurantId, ...clean } = rest;
  return clean;
}

// ─── checkDishPublishGate — spec-mandated publish gate ─────────────────────
// A RestaurantDish cannot be set to PUBLISHED (create or update) with an
// empty ingredient list. Callers resolve `ingredientCount` first: on create,
// the count of the (validated) incoming ingredients array; on update, the
// count of incoming ingredients if the body provides one, otherwise the
// dish's existing ingredient count fetched from the DB (so an update that
// doesn't touch ingredients can't silently bypass the gate).

export function checkDishPublishGate(status: string, ingredientCount: number): ParseResult<true> {
  if (status === "PUBLISHED" && ingredientCount === 0) {
    return fail("Cannot publish a dish with no ingredients");
  }
  return ok(true);
}
