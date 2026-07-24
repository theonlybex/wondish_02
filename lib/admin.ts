import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";

export async function requireAdmin() {
  const { userId } = await auth();
  if (!userId) throw new Error("UNAUTHORIZED");

  const account = await prisma.account.findUnique({
    where: { clerkId: userId },
    include: { roles: { include: { role: true } } },
  });
  if (!account) throw new Error("UNAUTHORIZED");

  const isAdmin = account.roles.some((r) => r.role.name === "SUPER");
  if (!isAdmin) throw new Error("FORBIDDEN");

  return account;
}

// Scalar-field allowlist filter for admin write bodies. Bodies were
// previously spread verbatim into prisma create/update, which accepts ANY
// Prisma key — including nested relation writes ("dishes": { update: ... })
// that bypass domain gates (e.g. the dish publish gate and its row lock).
// Unknown keys are silently dropped, matching the PATCH-tolerant convention.
export function pickFields(
  body: Record<string, unknown>,
  allowed: readonly string[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of allowed) {
    if (k in body) out[k] = body[k];
  }
  return out;
}

// Mutable scalars per model (identity, relation, and timestamp keys must
// never pass through). Restaurant's list lives in lib/admin-restaurants.ts.
export const RECIPE_MUTABLE_FIELDS = [
  "name", "description", "imageUrl", "emoji", "calories", "protein", "carbs",
  "fat", "fiber", "prepTime", "cookTime", "servings", "isPublic", "tags",
  "family", "subFamily", "dishTypeId", "mealTypeId", "ethnicId",
] as const;

export const ZIPCODE_MUTABLE_FIELDS = ["code", "city", "state", "country", "active"] as const;

export function adminErrorResponse(err: unknown) {
  const message = err instanceof Error ? err.message : "Internal error";
  if (message === "UNAUTHORIZED") return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (message === "FORBIDDEN") return Response.json({ error: "Forbidden" }, { status: 403 });
  return Response.json({ error: message }, { status: 500 });
}
