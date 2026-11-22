import { NextRequest, NextResponse } from "next/server";
import { resolveClaraCaller } from "@/lib/clara/caller";
import { makeSwapHandlers } from "@/lib/clara/skills/dish";
import { parseSwapBody } from "@/lib/clara/swap-body";
import type { ClaraContext } from "@/lib/clara/types";
import { rateLimit } from "@/lib/rate-limit";

// POST /api/clara/dish/swap — the ingredients check before cooking.
//   { action: "options", recipe, ingredient }                          -> { options: [{ name, atHome }], protein }
//   { action: "apply", mealType, today, recipe, ingredient, replacement } -> { how, dish, steps }
//   { action: "without", mealType, today, recipe, ingredient }         -> { how: "new", dish, steps }
// Each is the person's own tap on "I don't have this". The exchanges on offer
// are chosen in code; `apply` only takes one of them, so no free text from the
// app reaches the generator. The changed dish passes the same gates as any dish.

const handlers = makeSwapHandlers();

export async function POST(req: NextRequest) {
  try {
    const caller = await resolveClaraCaller();
    if (!caller.ok) return caller.response;
    const { success } = await rateLimit("clara-dish-swap", caller.userId, 30, 60);
    if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });
    if (!caller.patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const body = parseSwapBody(raw);
    if (!body) return NextResponse.json({ error: "Invalid swap request" }, { status: 400 });

    const today = body.action === "options" ? new Date().toISOString().slice(0, 10) : body.today;
    const ctx = { patientId: caller.patient.id, today, surface: "ios", disabledSkills: [] } as unknown as ClaraContext;

    if (body.action === "options") {
      const r = await handlers.options(ctx, body);
      if (!r.ok) return NextResponse.json({ error: r.message }, { status: r.status });
      return NextResponse.json({ options: r.options, protein: r.protein });
    }
    const r = body.action === "apply" ? await handlers.apply(ctx, body) : await handlers.without(ctx, body);
    if (!r.ok) return NextResponse.json({ error: r.message }, { status: r.status });
    return NextResponse.json({ how: r.how, dish: r.dish, steps: r.steps });
  } catch (err) {
    console.error("[clara-dish-swap] post", err);
    return NextResponse.json({ error: "Could not change that dish" }, { status: 500 });
  }
}
