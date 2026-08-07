// Phase 6a M3 — review workflow, pure
// (docs/restaurants/phase-6a-restaurant-admin-design.md §7). Verdict-affecting
// data (name, ingredients) on a PUBLISHED dish never changes without ops
// approval: those edits stage into a RestaurantDishRevision and swap in on
// approve. Everything else (price, availability, nutrition, description,
// sortOrder) stays instant. Same ParseResult posture as lib/restaurant-portal.
import type { PortalParseResult, PortalIngredientInput } from "./restaurant-portal";

function ok<T>(value: T): PortalParseResult<T> {
  return { ok: true, value };
}
function fail(error: string): PortalParseResult<never> {
  return { ok: false, error };
}

export interface StagedChanges {
  name: string | null; // null = unchanged
  ingredients: PortalIngredientInput[] | null; // null = unchanged
}

export interface ReviewSplit {
  instant: { name?: string; ingredients?: PortalIngredientInput[] };
  staged: StagedChanges | null;
}

function sameRow(a: PortalIngredientInput, b: PortalIngredientInput): boolean {
  return (
    a.quantity === b.quantity &&
    a.unit === b.unit &&
    a.ingredientId === b.ingredientId
  );
}

// Diff two ingredient lists by name (the composite-PK identity). `changed`
// means the name survived but quantity/unit/ingredientId moved — an
// ingredientId change matters because verdict matching moves off string luck.
export function ingredientDiff(
  before: PortalIngredientInput[],
  after: PortalIngredientInput[]
): { added: string[]; removed: string[]; changed: string[] } {
  const beforeByName = new Map(before.map((r) => [r.name, r]));
  const afterByName = new Map(after.map((r) => [r.name, r]));

  const added: string[] = [];
  const changed: string[] = [];
  afterByName.forEach((afterRow, name) => {
    const beforeRow = beforeByName.get(name);
    if (!beforeRow) added.push(name);
    else if (!sameRow(beforeRow, afterRow)) changed.push(name);
  });
  const removed: string[] = [];
  beforeByName.forEach((_row, name) => {
    if (!afterByName.has(name)) removed.push(name);
  });
  return { added, removed, changed };
}

function ingredientsEqual(a: PortalIngredientInput[], b: PortalIngredientInput[]): boolean {
  const d = ingredientDiff(a, b);
  return d.added.length === 0 && d.removed.length === 0 && d.changed.length === 0;
}

// Decide which requested changes apply to the dish row now and which stage
// into a pending revision. Only PUBLISHED dishes gate — DRAFT and
// PENDING_REVIEW dishes aren't live, and the review queue always shows a
// pending dish's *current* data, so instant edits there stay safe.
// No-op requests (same name, identical ingredient list) are dropped rather
// than staged, so the queue never fills with empty revisions.
export function splitReviewGated(args: {
  dishStatus: string;
  currentName: string;
  currentIngredients: PortalIngredientInput[];
  requestedName?: string;
  requestedIngredients?: PortalIngredientInput[] | null;
}): ReviewSplit {
  const { dishStatus, currentName, currentIngredients, requestedName } = args;
  const requestedIngredients = args.requestedIngredients ?? null;

  if (dishStatus !== "PUBLISHED") {
    const instant: ReviewSplit["instant"] = {};
    if (requestedName !== undefined) instant.name = requestedName;
    if (requestedIngredients) instant.ingredients = requestedIngredients;
    return { instant, staged: null };
  }

  const stagedName =
    requestedName !== undefined && requestedName !== currentName ? requestedName : null;
  const stagedIngredients =
    requestedIngredients && !ingredientsEqual(currentIngredients, requestedIngredients)
      ? requestedIngredients
      : null;

  if (stagedName === null && stagedIngredients === null) {
    return { instant: {}, staged: null };
  }
  return { instant: {}, staged: { name: stagedName, ingredients: stagedIngredients } };
}

export interface ReviewActionInput {
  action: "approve" | "reject";
  note: string | null;
}

// Ops decision body. Rejections always carry a note — "reject-with-note" is
// the contract the portal banner shows the restaurant.
export function parseReviewAction(raw: unknown): PortalParseResult<ReviewActionInput> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return fail("body must be an object");
  }
  const body = raw as Record<string, unknown>;
  if (body.action !== "approve" && body.action !== "reject") {
    return fail("action must be 'approve' or 'reject'");
  }
  let note: string | null = null;
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== "string") return fail("note must be a string");
    note = body.note.trim() || null;
  }
  if (body.action === "reject" && !note) {
    return fail("A note is required when rejecting — the restaurant sees it");
  }
  return ok({ action: body.action, note });
}

export interface ReviewOutcome {
  dishStatus: "PUBLISHED" | "DRAFT" | null; // null = leave status alone
  applyStaged: boolean; // swap the revision payload into the dish
  stampVerified: boolean; // set lastVerifiedAt (ops verified the list)
}

// Transition rules for an ops decision on a PENDING revision. The route owns
// the actual writes; this owns what is allowed and what must happen.
// `staged.stagedIngredientCount` is the EDIT payload's list length (null =
// ingredients not staged): the publish gate ("never live with zero
// ingredients") must hold at EDIT approval exactly as it does at publish —
// an empty ingredient list verdicts as safe for every allergy profile.
export function reviewDecision(
  kind: "PUBLISH" | "EDIT",
  action: "approve" | "reject",
  dish: { status: string; deletedAt: Date | null; ingredientCount: number },
  staged?: { stagedIngredientCount: number | null }
): PortalParseResult<ReviewOutcome> {
  if (dish.deletedAt !== null) return fail("This dish has been removed by the restaurant");

  if (kind === "PUBLISH") {
    if (dish.status !== "PENDING_REVIEW") {
      return fail("This dish is no longer awaiting publish review");
    }
    if (action === "approve") {
      if (dish.ingredientCount === 0) {
        return fail("Cannot publish a dish with no ingredients");
      }
      return ok({ dishStatus: "PUBLISHED", applyStaged: false, stampVerified: true });
    }
    return ok({ dishStatus: "DRAFT", applyStaged: false, stampVerified: false });
  }

  // EDIT — the dish stays live either way; approval swaps the payload in.
  if (action === "approve") {
    if (staged && staged.stagedIngredientCount === 0) {
      return fail("Cannot approve changes that would leave a live dish with no ingredients");
    }
    return ok({ dishStatus: null, applyStaged: true, stampVerified: true });
  }
  return ok({ dishStatus: null, applyStaged: false, stampVerified: false });
}
