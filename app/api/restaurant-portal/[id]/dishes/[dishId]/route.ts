import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
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
  type PortalIngredientInput,
} from "@/lib/restaurant-portal";
import { splitReviewGated } from "@/lib/restaurant-review";
import {
  serializePortalDish,
  serializeDishRevision,
  fileIngredientRequests,
} from "@/lib/restaurant-portal-server";
import { rateLimit } from "@/lib/rate-limit";

// Phase 6a M3 — staff dish edit / status / soft delete (design §5.3, §7).
// Review rules: scalar edits (price, nutrition, availability, description,
// sortOrder, section) are instant; name/ingredient edits on a PUBLISHED dish
// stage into a pending EDIT revision (the dish stays live on its previous
// data until ops approves in /admin/review-queue); "submit" moves a draft to
// PENDING_REVIEW and files a PUBLISH revision; "unpublish" is instant and
// resolves any pending revision (staged edits apply — the dish is no longer
// live, so they're safe, and re-publishing reviews everything anyway).
// DELETE is a soft delete — provenance survives.

const PENDING_REVISION_INCLUDE = {
  where: { status: "PENDING" as const },
  orderBy: { createdAt: "desc" as const },
  take: 1,
};

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
      include: {
        ingredients: { select: { name: true, quantity: true, unit: true, ingredientId: true } },
        revisions: PENDING_REVISION_INCLUDE,
      },
    });
    if (!dish) return NextResponse.json({ error: "Dish not found" }, { status: 404 });

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

    const data: Record<string, unknown> = {};
    const diff: Record<string, unknown> = {};

    // name is review-gated on live dishes — validate here, route below.
    let requestedName: string | undefined;
    if ("name" in body) {
      if (typeof body.name !== "string" || !body.name.trim()) {
        return NextResponse.json({ error: "name must be a non-empty string" }, { status: 400 });
      }
      requestedName = body.name.trim();
    }

    // Remaining scalars — allowlisted, validated per field, always instant.
    for (const key of PORTAL_DISH_MUTABLE_FIELDS) {
      if (key === "name" || !(key in body)) continue;
      const v = body[key];
      switch (key) {
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
        diff[key] = { from: (dish as unknown as Record<string, unknown>)[key], to: data[key] };
      }
    }

    const macros = parsePortalMacros(body);
    if (!macros.ok) return NextResponse.json({ error: macros.error }, { status: 400 });
    for (const [key, value] of Object.entries(macros.value)) {
      data[key] = value;
      diff[key] = { from: (dish as unknown as Record<string, unknown>)[key], to: value };
    }

    let parsedIngredients: PortalIngredientInput[] | null = null;
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

    if (Object.keys(data).length === 0 && !parsedIngredients && requestedName === undefined) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    // Review gating runs against the status the dish will have after this
    // request: an unpublishing dish is leaving the menu in this same
    // transaction, so its edits are safe to apply directly.
    const effectiveStatus = (data.status as string | undefined) ?? dish.status;
    const split = splitReviewGated({
      dishStatus: effectiveStatus,
      currentName: dish.name,
      currentIngredients: dish.ingredients,
      requestedName,
      requestedIngredients: parsedIngredients,
    });
    if (split.instant.name !== undefined) {
      data.name = split.instant.name;
      diff.name = { from: dish.name, to: split.instant.name };
    }
    const instantIngredients = split.instant.ingredients ?? null;

    const pendingRevision = dish.revisions[0] ?? null;
    const staging = effectiveStatus === "PUBLISHED" && (requestedName !== undefined || parsedIngredients !== null);

    const updated = await prisma.$transaction(async (tx) => {
      if (instantIngredients) {
        await tx.restaurantDishIngredient.deleteMany({ where: { dishId: dish.id } });
        if (instantIngredients.length) {
          await tx.restaurantDishIngredient.createMany({
            data: instantIngredients.map((i) => ({
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
          to: instantIngredients.map((i) => i.name),
        };
      }

      if (staging) {
        // Merge this request into the (single) pending EDIT revision: fields
        // present in the request replace their staged value; editing a field
        // back to its live value clears it. If everything nets out, the
        // revision is withdrawn.
        const priorEdit = pendingRevision?.kind === "EDIT" ? pendingRevision : null;
        const nextName = requestedName !== undefined ? (split.staged?.name ?? null) : (priorEdit?.name ?? null);
        const nextIngredients = parsedIngredients
          ? (split.staged?.ingredients ?? null)
          : ((priorEdit?.ingredients as unknown as PortalIngredientInput[] | null) ?? null);

        const nextIngredientsJson = nextIngredients
          ? (nextIngredients as unknown as Prisma.InputJsonValue)
          : Prisma.DbNull;

        if (nextName === null && nextIngredients === null) {
          if (priorEdit) {
            await tx.restaurantDishRevision.update({
              where: { id: priorEdit.id },
              data: { status: "CANCELLED" },
            });
          }
        } else if (priorEdit) {
          await tx.restaurantDishRevision.update({
            where: { id: priorEdit.id },
            data: {
              name: nextName,
              ingredients: nextIngredientsJson,
              submittedBy: ctx.account.id,
            },
          });
        } else {
          await tx.restaurantDishRevision.create({
            data: {
              dishId: dish.id,
              restaurantId: params.id,
              kind: "EDIT",
              submittedBy: ctx.account.id,
              name: nextName,
              ingredients: nextIngredientsJson,
            },
          });
        }
        diff.staged = {
          name: nextName,
          ingredients: nextIngredients ? nextIngredients.map((i) => i.name) : null,
        };
      }

      if (action === "submit") {
        await tx.restaurantDishRevision.create({
          data: {
            dishId: dish.id,
            restaurantId: params.id,
            kind: "PUBLISH",
            submittedBy: ctx.account.id,
          },
        });
      }

      if (action === "unpublish" && pendingRevision) {
        if (pendingRevision.kind === "EDIT") {
          // The dish is leaving the menu — staged edits apply now so the
          // staff's work survives; the next submit reviews the whole dish.
          if (pendingRevision.name) data.name = pendingRevision.name;
          const stagedRows = pendingRevision.ingredients as unknown as PortalIngredientInput[] | null;
          if (stagedRows) {
            await tx.restaurantDishIngredient.deleteMany({ where: { dishId: dish.id } });
            if (stagedRows.length) {
              await tx.restaurantDishIngredient.createMany({
                data: stagedRows.map((i) => ({
                  dishId: dish.id,
                  name: i.name,
                  quantity: i.quantity,
                  unit: i.unit,
                  ingredientId: i.ingredientId,
                })),
              });
            }
          }
        }
        await tx.restaurantDishRevision.update({
          where: { id: pendingRevision.id },
          data: { status: "CANCELLED" },
        });
      }

      const row = await tx.restaurantDish.update({
        where: { id: dish.id },
        data,
        include: {
          ingredients: { select: { name: true, quantity: true, unit: true, ingredientId: true } },
          revisions: PENDING_REVISION_INCLUDE,
        },
      });
      await auditRestaurantChange(tx, {
        restaurantId: params.id,
        accountId: ctx.account.id,
        entity: parsedIngredients ? "ingredients" : "dish",
        entityId: dish.id,
        action: action ?? (staging ? "stage" : "update"),
        diff: diff as never,
      });
      return row;
    });

    if (parsedIngredients) {
      await fileIngredientRequests(params.id, ctx.account.id, parsedIngredients);
    }

    const pending = updated.revisions[0] ?? null;
    return NextResponse.json({
      dish: serializePortalDish(updated),
      pendingRevision: pending ? serializeDishRevision(pending) : null,
      staged: staging && Boolean(split.staged),
    });
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
      await tx.restaurantDishRevision.updateMany({
        where: { dishId: dish.id, status: "PENDING" },
        data: { status: "CANCELLED" },
      });
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
