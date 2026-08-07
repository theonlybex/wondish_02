// Phase 6a M2 — portal write validation, pure
// (docs/restaurants/phase-6a-restaurant-admin-design.md §5.3/§6/§7).
// Same posture as lib/admin-restaurants.ts: ParseResult in/out, no Prisma.
// Local result type (admin-restaurants' ParseResult carries an HTTP status
// on failure; portal callers always map failures to 400, so a plain error
// string is the whole contract here).
export type PortalParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function ok<T>(value: T): PortalParseResult<T> {
  return { ok: true, value };
}
function fail(error: string): PortalParseResult<never> {
  return { ok: false, error };
}
function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Scalar allowlist for staff dish writes. Deliberately excludes identity
// (id/restaurantId), workflow (status, deletedAt, lastVerifiedAt), ops-only
// levers (isRecommended, dishTypeId, mealTypeId) and relations — status
// changes only via portalStatusAction, ingredients only via
// parsePortalIngredients.
export const PORTAL_DISH_MUTABLE_FIELDS = [
  "name", "description", "price", "currency", "section", "sortOrder",
  "calories", "protein", "carbs", "fat", "fiber", "available",
] as const;

export interface PortalIngredientInput {
  name: string;
  quantity: number | null;
  unit: string | null;
  ingredientId: string | null;
}

// Mirrors lib/admin-restaurants.ts parseIngredients (dedupe-by-name for the
// composite PK, last write wins) plus the Phase 6a catalog link: an optional
// ingredientId. Free-text rows (ingredientId null) stay valid — they file an
// IngredientRequest at write time and get mapped by ops later.
export function parsePortalIngredients(raw: unknown): PortalParseResult<PortalIngredientInput[]> {
  if (!Array.isArray(raw)) return fail("ingredients must be an array");

  const byName = new Map<string, PortalIngredientInput>();
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
      if (typeof item.unit !== "string") return fail(`ingredient "${name}" unit must be a string`);
      unit = item.unit;
    }

    let ingredientId: string | null = null;
    if (item.ingredientId !== undefined && item.ingredientId !== null) {
      if (typeof item.ingredientId !== "string" || item.ingredientId.length === 0) {
        return fail(`ingredient "${name}" ingredientId must be a non-empty string`);
      }
      ingredientId = item.ingredientId;
    }

    byName.set(name, { name, quantity, unit, ingredientId });
  }

  return ok(Array.from(byName.values()));
}

const MACRO_KEYS = ["calories", "protein", "carbs", "fat", "fiber"] as const;
export type PortalMacros = Partial<Record<(typeof MACRO_KEYS)[number], number | null>>;

// Whole-dish macros. Blank stays null — an unknown macro is never a 0
// (matches the incomplete-snapshot convention everywhere else). The 20000
// cap is a sanity bound, not nutrition science.
export function parsePortalMacros(raw: unknown): PortalParseResult<PortalMacros> {
  if (!isObj(raw)) return fail("macros must be an object");
  const out: PortalMacros = {};
  for (const key of MACRO_KEYS) {
    if (!(key in raw) || raw[key] === undefined) continue;
    const v = raw[key];
    if (v === null) {
      out[key] = null;
      continue;
    }
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 20000) {
      return fail(`${key} must be a number between 0 and 20000, or null`);
    }
    out[key] = v;
  }
  return ok(out);
}

// Restaurant-profile allowlist for staff PATCH (design §5.5). Deliberately
// excludes name (display-only in v1 — renames go through ops), status/slug
// (ops levers), ethnicId and geo (ops/Phase-7). `neighborhood` is the only
// required column here; everything else nulls out when blanked.
const PROFILE_TEXT_FIELDS = [
  "description", "addressLine", "city", "state", "postalCode",
  "phone", "website", "hours",
] as const;
const PROFILE_URL_FIELDS = ["imageUrl", "logoUrl"] as const;
const PROFILE_MAX_LEN = 2000;

export type PortalProfilePatch = Partial<
  Record<(typeof PROFILE_TEXT_FIELDS)[number] | (typeof PROFILE_URL_FIELDS)[number], string | null> & {
    neighborhood: string;
  }
>;

export function parsePortalProfile(raw: unknown): PortalParseResult<PortalProfilePatch> {
  if (!isObj(raw)) return fail("body must be an object");
  const out: Record<string, string | null> = {};

  if ("neighborhood" in raw) {
    const v = raw.neighborhood;
    if (typeof v !== "string" || !v.trim()) return fail("neighborhood must be a non-empty string");
    if (v.length > PROFILE_MAX_LEN) return fail("neighborhood is too long");
    out.neighborhood = v.trim();
  }

  for (const key of PROFILE_TEXT_FIELDS) {
    if (!(key in raw)) continue;
    const v = raw[key];
    if (v === null) {
      out[key] = null;
      continue;
    }
    if (typeof v !== "string") return fail(`${key} must be a string or null`);
    if (v.length > PROFILE_MAX_LEN) return fail(`${key} is too long`);
    out[key] = v.trim() || null;
  }

  for (const key of PROFILE_URL_FIELDS) {
    if (!(key in raw)) continue;
    const v = raw[key];
    if (v === null) {
      out[key] = null;
      continue;
    }
    if (typeof v !== "string") return fail(`${key} must be a string or null`);
    const trimmed = v.trim();
    if (!trimmed) {
      out[key] = null;
      continue;
    }
    if (!/^https?:\/\//.test(trimmed) || trimmed.length > PROFILE_MAX_LEN) {
      return fail(`${key} must be an http(s) URL`);
    }
    out[key] = trimmed;
  }

  return ok(out as PortalProfilePatch);
}

// Staff status transitions (design §7). Submitting runs the Phase-1
// ingredient publish gate; approval to PUBLISHED is the admin review
// queue's job (/admin/review-queue).
export function portalStatusAction(
  action: "submit" | "unpublish",
  currentStatus: string,
  ingredientCount: number
): PortalParseResult<"PENDING_REVIEW" | "DRAFT"> {
  if (action === "submit") {
    if (currentStatus === "PUBLISHED") return fail("This dish is already live");
    if (currentStatus === "PENDING_REVIEW") return fail("This dish is already awaiting review");
    if (ingredientCount === 0) return fail("Cannot publish a dish with no ingredients");
    return ok("PENDING_REVIEW");
  }
  // unpublish
  if (currentStatus === "DRAFT") return fail("This dish is not published");
  return ok("DRAFT");
}
