import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { adminErrorResponse } from "@/lib/admin";
import { requireRestaurantStaff } from "@/lib/restaurant-auth";
import { auditRestaurantChange } from "@/lib/restaurant-audit";
import { coercePrice } from "@/lib/admin-restaurants";
import {
  PORTAL_DISH_MUTABLE_FIELDS,
  parsePortalIngredients,
  parsePortalMacros,
  portalStatusAction,
} from "@/lib/restaurant-portal";
import { serializePortalDish, fileIngredientRequests } from "@/lib/restaurant-portal-server";
import { rateLimit } from "@/lib/rate-limit";

// Phase 6a M2 — staff dish edit / status / soft delete (design §5.3, §7).
// M2 rules: scalar edits (price, nutrition, availability, description) are
// instant; "submit" → PENDING_REVIEW behind the ingredient publish gate
// (ops approves from the admin dish form until the M3 review queue);
// ingredient edits are instant + audited (the M3 hold-for-review staging
// area replaces that). DELETE is a soft delete — provenance survives.

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; dishId: string } }
) {
  try {
    const ctx = await requireRestaurantStaff(params.id);
    const { success } = await rateLimit("restaurant-portal-write", ctx.account.id, 60, 60);
    if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

    const dish = await prisma.restaurantDish.findFirst({
      where: { id: params.dishId, restaurantId: params.id, deletedAt: null },
      include: { ingredients: { select: { name: true } } },
    });
    if (!dish) return NextResponse.json({ error: "Dish not found" }, { status: 404 });

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

    const data: Record<string, unknown> = {};
    const diff: Record<string, unknown> = {};

    // Scalars — allowlisted, validated per field.
    for (const key of PORTAL_DISH_MUTABLE_FIELDS) {
      if (!(key in body)) continue;
      const v = body[key];
      switch (key) {
        case "name": {
          if (typeof v !== "string" || !v.trim()) {
            return NextResponse.json({ error: "name must be a non-empty string" }, { status: 400 });
          }
          data.name = v.trim();
          break;
        }
        case "section": {
          if (typeof v !== "string" || !v.trim()) {
            return NextResponse.json({ error: "section must be a non-empty string" }, { status: 400 });
          }
          data.section = v.trim();
          break;
        }
        case "description": {
          if (v !== null && typeof v !== "string") {
            return NextResponse.json({ error: "description must be a string or null" }, { status: 400 });
          }
          data.description = typeof v === "string" && v.trim() ? v.trim() : null;
          break;
        }
        case "price": {
          const price = coercePrice(v);
          if (!price.ok) return NextResponse.json({ error: price.error }, { status: 400 });
          data.price = price.value;
          break;
        }
        case "currency": {
          if (typeof v !== "string" || !/^[A-Z]{3}$/.test(v)) {
            return NextResponse.json({ error: "currency must be a 3-letter code" }, { status: 400 });
          }
          data.currency = v;
          break;
        }
        case "sortOrder": {
          if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
            return NextResponse.json({ error: "sortOrder must be a non-negative integer" }, { status: 400 });
          }
          data.sortOrder = v;
          break;
        }
        case "available": {
          data.available = Boolean(v);
          break;
        }
        default:
          break; // macros handled together below
      }
      if (key !== "calories" && key !== "protein" && key !== "carbs" && key !== "fat" && key !== "fiber") {
        diff[key] = { from: (dish as Record<string, unknown>)[key], to: data[key] };
      }
    }

    const macros = parsePortalMacros(body);
    if (!macros.ok) return NextResponse.json({ error: macros.error }, { status: 400 });
    for (const [key, value] of Object.entries(macros.value)) {
      data[key] = value;
      diff[key] = { from: (dish as Record<string, unknown>)[key], to: value };
    }

    // Ingredients — replace-all, same as the admin route.
    let parsedIngredients = null;
    if ("ingredients" in body) {
      const parsed = parsePortalIngredients(body.ingredients);
      if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
      parsedIngredients = parsed.value;
    }

    // Status action — gate runs against the effective ingredient count.
    const action = body.action;
    if (action !== undefined && action !== "submit" && action !== "unpublish") {
      return NextResponse.json({ error: "action must be 'submit' or 'unpublish'" }, { status: 400 });
    }
    if (action) {
      const count = parsedIngredients ? parsedIngredients.length : dish.ingredients.length;
      const next = portalStatusAction(action, dish.status, count);
      if (!next.ok) return NextResponse.json({ error: next.error }, { status: 400 });
      data.status = next.value;
      if (action === "submit") data.lastVerifiedAt = new Date();
      diff.status = { from: dish.status, to: next.value };
    }

    if (Object.keys(data).length === 0 && !parsedIngredients) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (parsedIngredients) {
        await tx.restaurantDishIngredient.deleteMany({ where: { dishId: dish.id } });
        if (parsedIngredients.length) {
          await tx.restaurantDishIngredient.createMany({
            data: parsedIngredients.map((i) => ({
              dishId: dish.id,
              name: i.name,
              quantity: i.quantity,
              unit: i.unit,
              ingredientId: i.ingredientId,
            })),
          });
        }
        diff.ingredients = {
          from: dish.ingredients.map((i) => i.name),
          to: parsedIngredients.map((i) => i.name),
        };
      }
      const row = await tx.restaurantDish.update({
        where: { id: dish.id },
        data,
        include: { ingredients: { select: { name: true, quantity: true, unit: true, ingredientId: true } } },
      });
      await auditRestaurantChange(tx, {
        restaurantId: params.id,
        accountId: ctx.account.id,
        entity: parsedIngredients ? "ingredients" : "dish",
        entityId: dish.id,
        action: action ?? "update",
        diff: diff as never,
      });
      return row;
    });

    if (parsedIngredients) {
      await fileIngredientRequests(params.id, ctx.account.id, parsedIngredients);
    }

    return NextResponse.json({ dish: serializePortalDish(updated) });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; dishId: string } }
) {
  try {
    const ctx = await requireRestaurantStaff(params.id);
    const { success } = await rateLimit("restaurant-portal-write", ctx.account.id, 60, 60);
    if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

    const dish = await prisma.restaurantDish.findFirst({
      where: { id: params.dishId, restaurantId: params.id, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!dish) return NextResponse.json({ error: "Dish not found" }, { status: 404 });

    await prisma.$transaction(async (tx) => {
      await tx.restaurantDish.update({ where: { id: dish.id }, data: { deletedAt: new Date() } });
      await auditRestaurantChange(tx, {
        restaurantId: params.id,
        accountId: ctx.account.id,
        entity: "dish",
        entityId: dish.id,
        action: "delete",
        diff: { name: dish.name },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
