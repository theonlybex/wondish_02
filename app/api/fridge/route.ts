import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { accountHasActivePremium, getOrCreateAccount } from "@/lib/auth";
import { FRIDGE_DAILY_FREE, FRIDGE_DAY_RATE_LIMIT_NAME, FRIDGE_DAY_RATE_LIMIT_WINDOW_SEC } from "@/lib/freemium";
import { PATIENT_FOOD_MAP_INCLUDE, buildFoodMapText } from "@/lib/food-map";
import { derivePatientBans, buildDietMatchers } from "@/lib/diet-match";
import {
  normalizeIngredients,
  buildFridgePrompt,
  parseFridgeRecipes,
  applyAllergenFilter,
  FRIDGE_SYSTEM_PROMPT,
  SUGGEST_RECIPES_SCHEMA,
} from "@/lib/fridge";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MAX_RECIPES = 3; // F-D4

// ─── POST /api/fridge — Anthropic tool-use recipe generation ────────────────
//
// Thin route over lib/fridge.ts (pure/tested) + lib/food-map.ts (pure/tested)
// + lib/diet-match.ts (pure/tested, F-D7 word-boundary allergen matchers).
// Mirrors app/api/dish-checker/route.ts's model/SDK call style and error
// taxonomy, and app/api/dish-checker/route.ts's gate-order discipline:
// validate the body BEFORE charging the daily credit (d37af47 — a hard-won
// review fix on the chat route; replicated here).
//
// Per the Cycle-5 execution amendment, photo input is not built this cycle:
// a supplied imageUrl is treated as unusable — the route proceeds chips-only
// and returns imageUsed: false; a chips-only request omits the field.
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Burst limit (F-D1) — cheaper than any DB round trip, fires first.
  const burst = await rateLimit("fridge", userId, 10, 60);
  if (!burst.success) {
    return NextResponse.json({ error: "Too many requests. Please wait a moment." }, { status: 429 });
  }

  // Ordering contract: validate-before-charge — body parsing/ingredient
  // validation must run before the account fetch and daily credit gate below,
  // so a malformed/invalid request 400s without ever touching a user's quota.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const ingredients = normalizeIngredients(b?.ingredients);
  const suppliedImageUrl = typeof b?.imageUrl === "string" ? b.imageUrl : undefined;
  const mealType = typeof b?.mealType === "string" ? b.mealType : undefined;

  if (ingredients.length === 0 && !suppliedImageUrl) {
    return NextResponse.json({ error: "Add at least one ingredient or a photo." }, { status: 400 });
  }

  // Photo input (F-D5) is not built this cycle: an imageUrl, if supplied, is
  // unusable server-side — proceed chips-only and disclose imageUsed: false
  // rather than silently degrading (fix 6 of the 2026-07-22 amendment).
  const imageUsed = suppliedImageUrl ? false : undefined;

  // F-D9: account resolution parity with dish-checker — a signed-in user with
  // no account row self-heals instead of hitting a hard 404.
  const account = await getOrCreateAccount(userId);

  // Profile check BEFORE the daily-credit charge (audit Task 18): a
  // missing-profile 404 used to burn one of the user's FRIDGE_DAILY_FREE
  // credits with nothing delivered.
  const patient = await prisma.patient.findFirst({
    where: { accountId: account.id },
    include: PATIENT_FOOD_MAP_INCLUDE,
  });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  // Credit gate (F-D2 server-side daily backstop — the ONLY freemium gate per
  // the Cycle-5 amendment; client-side UsageMeter/PaywallView are void). Must
  // run before any Anthropic call so a gated request costs zero tokens
  // (charge-before-model is the correct anti-race direction and stays).
  if (!accountHasActivePremium(account.subscriptions)) {
    const day = await rateLimit(FRIDGE_DAY_RATE_LIMIT_NAME, userId, FRIDGE_DAILY_FREE, FRIDGE_DAY_RATE_LIMIT_WINDOW_SEC);
    if (!day.success) {
      return NextResponse.json({ error: "Premium required" }, { status: 402 });
    }
  }

  const foodMapText = buildFoodMapText(patient);
  // F-D7: deterministic server-side allergen filter, independent of the
  // model's own self-certified fitsPlan/conflicts. Reuses lib/diet-match.ts's
  // word-boundary matchers — never a fresh hand-rolled ban union.
  const matchers = buildDietMatchers(derivePatientBans(patient));

  let msg: Anthropic.Message;
  try {
    msg = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 2048,
      // Sonnet 5 defaults to adaptive thinking when the param is omitted;
      // generation latency wants it off (C6, same as dish-checker).
      thinking: { type: "disabled" },
      system: FRIDGE_SYSTEM_PROMPT(foodMapText, MAX_RECIPES),
      tools: [
        {
          name: "suggest_recipes",
          description: "Return recipe suggestions usable from the supplied ingredients.",
          input_schema: SUGGEST_RECIPES_SCHEMA,
        },
      ],
      tool_choice: { type: "tool", name: "suggest_recipes" }, // F-D3
      messages: [{ role: "user", content: buildFridgePrompt(ingredients, mealType) }],
    });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      if (err.status === 429) {
        return NextResponse.json({ error: "Clara is busy, try again in a moment" }, { status: 429 });
      }
      if (err.status === 529) {
        return NextResponse.json({ error: "Clara is busy, try again in a moment" }, { status: 503 });
      }
    }
    return NextResponse.json({ error: "Clara is unavailable right now" }, { status: 500 });
  }

  const toolBlock = msg.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );
  const rawRecipes = toolBlock ? (toolBlock.input as { recipes?: unknown } | undefined)?.recipes : undefined;
  const parsed = parseFridgeRecipes(rawRecipes, MAX_RECIPES, mealType);
  if (parsed === null) {
    return NextResponse.json({ error: "Clara couldn't read that. Try again." }, { status: 502 });
  }

  const recipes = applyAllergenFilter(parsed, matchers); // F-D7 hard drop
  return NextResponse.json(imageUsed === undefined ? { recipes } : { recipes, imageUsed });
}
