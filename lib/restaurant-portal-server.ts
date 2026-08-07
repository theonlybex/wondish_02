// Phase 6a M2 — DB-bound portal helpers shared by the dish routes (route
// files may only export handlers, so these live here).
import { prisma } from "@/lib/db";
import type { PortalIngredientInput } from "@/lib/restaurant-portal";

export interface PortalDishRowLike {
  id: string;
  name: string;
  description: string | null;
  price: { toFixed(n: number): string } | null;
  currency: string;
  section: string;
  sortOrder: number;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  isRecommended: boolean;
  available: boolean;
  status: string;
  lastVerifiedAt: Date | null;
  ingredients: { name: string; quantity: number | null; unit: string | null; ingredientId: string | null }[];
}

export function serializePortalDish(d: PortalDishRowLike) {
  return {
    id: d.id,
    name: d.name,
    description: d.description,
    price: d.price ? d.price.toFixed(2) : null,
    currency: d.currency,
    section: d.section,
    sortOrder: d.sortOrder,
    calories: d.calories,
    protein: d.protein,
    carbs: d.carbs,
    fat: d.fat,
    fiber: d.fiber,
    isRecommended: d.isRecommended,
    available: d.available,
    status: d.status,
    lastVerifiedAt: d.lastVerifiedAt ? d.lastVerifiedAt.toISOString() : null,
    ingredients: d.ingredients,
  };
}

export type PortalDishDTO = ReturnType<typeof serializePortalDish>;

export interface DishRevisionRowLike {
  id: string;
  kind: string;
  status: string;
  name: string | null;
  ingredients: unknown; // Json column — PortalIngredientInput[] | null
  reviewNote: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
}

// Phase 6a M3 — a staged change awaiting (or back from) ops review.
export function serializeDishRevision(r: DishRevisionRowLike) {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    name: r.name,
    ingredients: (r.ingredients as PortalIngredientInput[] | null) ?? null,
    reviewNote: r.reviewNote,
    createdAt: r.createdAt.toISOString(),
    reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
  };
}

export type DishRevisionDTO = ReturnType<typeof serializeDishRevision>;

// Phase 6a M4 — one activity page (design §5.7), shared by the activity API
// route and the server-rendered first page. Newest first; humanized lines;
// cursor = last audit id of the previous page.
import { formatAuditEntry } from "@/lib/restaurant-activity";

const ACTIVITY_PAGE_SIZE = 30;

export interface ActivityEntryDTO {
  id: string;
  actor: string;
  line: string;
  createdAt: string;
}

export async function getActivityPage(
  restaurantId: string,
  cursor: string | null
): Promise<{ entries: ActivityEntryDTO[]; nextCursor: string | null }> {
  const rows = await prisma.restaurantAuditLog.findMany({
    where: { restaurantId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: ACTIVITY_PAGE_SIZE + 1, // one extra decides nextCursor deterministically
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, ACTIVITY_PAGE_SIZE);
  const nextCursor = rows.length > ACTIVITY_PAGE_SIZE ? page[page.length - 1].id : null;

  // Resolve dish names + actor labels in two batched lookups. Deleted or
  // renamed dishes still resolve — soft delete keeps the row.
  const dishIds = Array.from(
    new Set(
      page
        .filter((r) => (r.entity === "dish" || r.entity === "ingredients") && r.entityId)
        .map((r) => r.entityId as string)
    )
  );
  const accountIds = Array.from(new Set(page.map((r) => r.accountId)));
  const [dishes, accounts] = await Promise.all([
    prisma.restaurantDish.findMany({
      where: { id: { in: dishIds } },
      select: { id: true, name: true },
    }),
    prisma.account.findMany({
      where: { id: { in: accountIds } },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        roles: { select: { role: { select: { name: true } } } },
      },
    }),
  ]);
  const dishName = new Map(dishes.map((d) => [d.id, d.name]));
  const actorLabel = new Map(
    accounts.map((a) => {
      const isOps = a.roles.some((r) => r.role.name === "SUPER");
      const name = `${a.firstName} ${a.lastName}`.trim();
      return [a.id, isOps ? "Wondish ops" : name || a.email];
    })
  );

  return {
    entries: page.map((r) => ({
      id: r.id,
      actor: actorLabel.get(r.accountId) ?? "Someone",
      line: formatAuditEntry(
        { entity: r.entity, action: r.action, diff: r.diff },
        r.entityId ? (dishName.get(r.entityId) ?? null) : null
      ),
      createdAt: r.createdAt.toISOString(),
    })),
    nextCursor,
  };
}

// Free-text ingredient rows (no catalog id) file an IngredientRequest so ops
// can grow the catalog (design §5.4). Deduped against open requests.
export async function fileIngredientRequests(
  restaurantId: string,
  accountId: string,
  rows: PortalIngredientInput[]
): Promise<void> {
  const freeText = rows.filter((r) => r.ingredientId === null).map((r) => r.name);
  if (freeText.length === 0) return;
  const existing = await prisma.ingredientRequest.findMany({
    where: { restaurantId, status: "PENDING", name: { in: freeText } },
    select: { name: true },
  });
  const known = new Set(existing.map((e) => e.name));
  const toFile = freeText.filter((n) => !known.has(n));
  if (toFile.length) {
    await prisma.ingredientRequest.createMany({
      data: toFile.map((name) => ({ name, restaurantId, requestedBy: accountId })),
    });
  }
}
