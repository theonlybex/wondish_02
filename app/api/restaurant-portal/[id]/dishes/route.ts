import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { adminErrorResponse } from "@/lib/admin";
import { requireRestaurantStaff } from "@/lib/restaurant-auth";
import { auditRestaurantChange } from "@/lib/restaurant-audit";
import { coercePrice } from "@/lib/admin-restaurants";
import { parsePortalIngredients, parsePortalMacros } from "@/lib/restaurant-portal";
import {
  serializePortalDish,
  serializeDishRevision,
  fileIngredientRequests,
} from "@/lib/restaurant-portal-server";
import { rateLimit } from "@/lib/rate-limit";

// Phase 6a M2/M3 — staff dish list + create (design §5.2/§5.3/§6). Creates
// are always DRAFT; going live is PATCH { action: "submit" } + ops approval
// in /admin/review-queue. Each dish carries its pending revision (if any) so
// the menu manager can show "edits in review".

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireRestaurantStaff(params.id);
    const { success } = await rateLimit("restaurant-portal-read", ctx.account.id, 120, 60);
    if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

    const dishes = await prisma.restaurantDish.findMany({
      where: { restaurantId: params.id, deletedAt: null },
      orderBy: [{ section: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
      include: {
        ingredients: { select: { name: true, quantity: true, unit: true, ingredientId: true } },
        revisions: { where: { status: "PENDING" }, orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    return NextResponse.json({
      dishes: dishes.map((d) => ({
        ...serializePortalDish(d),
        pendingRevision: d.revisions[0] ? serializeDishRevision(d.revisions[0]) : null,
      })),
    });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireRestaurantStaff(params.id);
    const { success } = await rateLimit("restaurant-portal-write", ctx.account.id, 60, 60);
    if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const section = typeof body.section === "string" ? body.section.trim() : "";
    if (!name || !section) {
      return NextResponse.json({ error: "name and section are required" }, { status: 400 });
    }

    const price = coercePrice(body.price);
    if (!price.ok) return NextResponse.json({ error: price.error }, { status: 400 });

    const macros = parsePortalMacros(body);
    if (!macros.ok) return NextResponse.json({ error: macros.error }, { status: 400 });

    const ingredients = parsePortalIngredients(body.ingredients ?? []);
    if (!ingredients.ok) return NextResponse.json({ error: ingredients.error }, { status: 400 });

    const sortOrder =
      typeof body.sortOrder === "number" && Number.isInteger(body.sortOrder) && body.sortOrder >= 0
        ? body.sortOrder
        : 0;

    const dish = await prisma.restaurantDish.create({
      data: {
        restaurantId: params.id,
        name,
        section,
        description: typeof body.description === "string" && body.description.trim() ? body.description.trim() : null,
        price: price.value,
        currency: typeof body.currency === "string" && /^[A-Z]{3}$/.test(body.currency) ? body.currency : "USD",
        sortOrder,
        available: body.available === undefined ? true : Boolean(body.available),
        status: "DRAFT",
        calories: macros.value.calories ?? null,
        protein: macros.value.protein ?? null,
        carbs: macros.value.carbs ?? null,
        fat: macros.value.fat ?? null,
        fiber: macros.value.fiber ?? null,
        ingredients: ingredients.value.length
          ? {
              create: ingredients.value.map((i) => ({
                name: i.name,
                quantity: i.quantity,
                unit: i.unit,
                ingredientId: i.ingredientId,
              })),
            }
          : undefined,
      },
      include: { ingredients: { select: { name: true, quantity: true, unit: true, ingredientId: true } } },
    });

    await fileIngredientRequests(params.id, ctx.account.id, ingredients.value);
    await auditRestaurantChange(prisma, {
      restaurantId: params.id,
      accountId: ctx.account.id,
      entity: "dish",
      entityId: dish.id,
      action: "create",
      diff: { name, section },
    });

    return NextResponse.json({ dish: serializePortalDish(dish) }, { status: 201 });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
