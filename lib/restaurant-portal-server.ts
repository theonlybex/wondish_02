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
