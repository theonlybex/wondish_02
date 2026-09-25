import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import Anthropic from "@anthropic-ai/sdk";
import { createAnthropic, claraBusyStatus, CLARA_BUSY_MESSAGE } from "@/lib/anthropic";
import { prisma } from "@/lib/db";
import { displayDishName } from "@/lib/dish-name";
import {
  derivePatientBans,
  buildDietMatchers,
  PATIENT_DIET_INCLUDE,
} from "@/lib/diet-match";
import {
  validateFridgeRecipeSnapshot,
  applyAllergenFilter,
  SUGGEST_RECIPES_SCHEMA,
  type FridgeRecipe,
} from "@/lib/fridge";
import {
  passesSanity,
  persistValidatedRecipes,
  normalizeCuisine,
  CLARA_RECIPE_TAG,
  toPlausibleDish,
  descriptionPromisesMissingFood,
  cooksWithUnlistedFat,
  pricedMacros,
} from "@/lib/clara/recipe-generation";
import { dishProblem, catalogFoodVocabulary, BREAKFAST_MAX_MINUTES } from "@/lib/dish-plausibility";
import { dishProtein, dishProteinOfNames, dishCarbBase, MAX_SAME_PROTEIN_PER_DAY, MAX_SAME_CARB_BASE_PER_DAY } from "@/lib/meal-plan";
import {
  resolveMacroProfile,
  getMacroPercentages,
} from "@/lib/caloric-engine";
import { guardAiSpend } from "@/lib/ai-budget";
import { rateLimit } from "@/lib/rate-limit";
import { buildFoodMapText } from "@/lib/food-map";
import { fitBasket, freeStaplesFor } from "@/lib/clara/recipe-generation";

// POST /api/meal-plan/[menuId]/clara-swap — the user asks Clara for something
// else in this slot ("what would you like instead?") and Clara generates a
// single replacement dish that fits: same meal type, ~same calories, the
// patient's macro profile and diet bans, plus the user's free-text request and
// optional cuisine. Deterministic gates (allergen filter + macro/calorie
// sanity) run after generation, then it replaces the menu row.
//
// AI-billed (Haiku) → guarded by the per-user daily swap quota + global ceiling.

export const maxDuration = 30;

export async function POST(
  req: NextRequest,
  { params }: { params: { menuId: string } }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "Clara is not configured in this environment." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { request: rawRequest, cuisine: rawCuisine } = (body ?? {}) as {
    request?: unknown;
    cuisine?: unknown;
  };
  const request = typeof rawRequest === "string" ? rawRequest.trim().slice(0, 300) : "";
  const cuisine = normalizeCuisine(rawCuisine);

  const patient = await prisma.patient.findFirst({
    where: { account: { clerkId: userId } },
    include: PATIENT_DIET_INCLUDE,
  });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const menu = await prisma.menu.findFirst({
    where: { id: params.menuId, patientId: patient.id, planVersion: patient.activePlanVersion },
    // The dish's name and ingredients as well as its calories: the swap has to
    // be able to tell whether a candidate IS what it is replacing.
    include: {
      recipe: {
        select: {
          calories: true,
          name: true,
          ingredients: { select: { ingredient: { select: { name: true } } } },
        },
      },
      mealType: true,
    },
  });
  if (!menu || !menu.mealTypeId || !menu.mealType) {
    return NextResponse.json({ error: "Menu not found" }, { status: 404 });
  }

  // One Clara swap per slot at a time (S12). The window equals this route's
  // maxDuration (30s), so it covers the slowest legitimate run without
  // outliving it by much; a double-tap's second request is refused before it
  // can generate a second public recipe for this slot.
  //
  // Spend-adjacent lock: it is the only guard against a double-tap persisting
  // a duplicate PUBLIC recipe (and paying Anthropic twice), so it carries the
  // "ai-" prefix that makes lib/rate-limit.ts degrade it to the per-instance
  // counter on a backend error rather than failing open like a burst bucket.
  const inflight = await rateLimit("ai-clara-swap-inflight", `${userId}:${params.menuId}`, 1, 30);
  if (!inflight.success) {
    return NextResponse.json(
      { error: "Clara is still working on this dish, or just changed it — give her a moment before asking again." },
      { status: 409 }
    );
  }

  // Charge-before-model, still: the allowance is the Anthropic bill cap, and a
  // failed attempt has already paid for its tokens.
  //
  // A QA account lost all three of its daily swaps to three refusals that
  // changed nothing, and the right answer — bill only on delivery, bound the
  // token spend with a separate cheap attempt counter — does not fit the $30
  // per paying user per month ceiling this table is built to (lib/ai-budget.
  // test.ts): any second bucket, at any useful size, puts premium worst case at
  // $31-33. So the reliability comes from the model call instead (see the
  // candidate count in the prompt below), and the refusal now says plainly that
  // the attempt was spent. If that trade is wrong, the lever is the ceiling or
  // the swap limit, not a hidden extra bucket.
  const guard = await guardAiSpend(userId, "swap");
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });

  const targetCalories = menu.recipe.calories && menu.recipe.calories > 0
    ? Math.round(menu.recipe.calories)
    : 500;
  const mealTypeName = menu.mealType.name;

  // The catalog's food vocabulary, so a swapped dish's name is held to the
  // same promise as a generated one ("…with Brown Rice" must contain it).
  const catalogFoodTokens = catalogFoodVocabulary(
    (await prisma.ingredient.findMany({ select: { name: true } })).map((i) => i.name)
  );

  // What else the user is eating today. The swap used to be blind to it, so
  // swapping two slots on one day produced ground turkey in all three
  // (QA 2026-09-24) — each call was individually reasonable and the day was not.
  const sameDay = await prisma.menu.findMany({
    where: {
      patientId: patient.id,
      planVersion: patient.activePlanVersion,
      date: menu.date,
      id: { not: menu.id },
    },
    select: {
      recipe: {
        select: {
          fat: true,
          calories: true,
          ingredients: { select: { ingredient: { select: { name: true } } } },
        },
      },
    },
  });
  // Counted, not just listed: the prompt asks Clara for a different protein
  // and she is free to ignore it, which she did — a swap put chicken in 3 of
  // 4 slots on a day that already had two (QA 2026-09-24). Asking is the
  // optimisation; the count below is the rule.
  const proteinCounts = new Map<string, number>();
  for (const m of sameDay) {
    const p = dishProtein(m.recipe?.ingredients ?? []);
    if (p) proteinCounts.set(p, (proteinCounts.get(p) ?? 0) + 1);
  }
  const otherProteins = Array.from(proteinCounts.keys());
  // The same count for the day's starch. Two swaps on one day put basmati rice
  // into a third slot behind two brown-rice dishes (QA cycle 7) — the protein
  // rule was enforced and the starch rule existed only in the builder.
  const starchCounts = new Map<string, number>();
  for (const m of sameDay) {
    const b = dishCarbBase(m.recipe?.ingredients ?? []);
    if (b) starchCounts.set(b, (starchCounts.get(b) ?? 0) + 1);
  }
  const overusedStarch = new Set(
    Array.from(starchCounts.entries())
      .filter(([, n]) => n >= MAX_SAME_CARB_BASE_PER_DAY)
      .map(([b]) => b)
  );
  const overusedProteins = new Set(
    Array.from(proteinCounts.entries())
      .filter(([, n]) => n >= MAX_SAME_PROTEIN_PER_DAY)
      .map(([p]) => p)
  );

  // Same macro target + bans the plan builder uses.
  const macroProfile = resolveMacroProfile(
    patient.healthConditions.map((hc) => hc.condition.name),
    patient.motivations.map((pm) => pm.motivation.name)
  );
  const macro = getMacroPercentages(macroProfile);

  // How much fat the REST of the day already carries, and what the day's fat
  // budget is.
  //
  // The swap validated each dish on its own. QA swapped dinner, lunch and the
  // snack and watched the day reach "Fat 87g of 54g · 161%" — every individual
  // dish reasonable, the day not, which is the lesson the plan builder learnt in
  // cycle 10 and which went into the BUILDER only. A swap is a slot-filler like
  // any other and belongs under the same rule.
  //
  // The day's fat target is derived from what the day actually plans to eat
  // (the other dishes plus this slot's target), so it needs no calorie engine
  // here and cannot drift from the rail: fat is `macro.fat` of those calories.
  const otherFatG = sameDay.reduce((sum, m) => sum + (m.recipe?.fat ?? 0), 0);
  const dayCalories = sameDay.reduce((sum, m) => sum + (m.recipe?.calories ?? 0), 0) + targetCalories;
  const dayFatBudgetG = dayCalories > 0 ? (dayCalories * macro.fat) / 9 : 0;
  // 1.3x, not 1.0: the catalog's dishes run fat-heavy and a hard equality would
  // refuse almost everything, which costs the user their swap. This refuses the
  // candidate that takes a day well past its target, not the one that nudges it.
  const DAY_FAT_TOLERANCE = 1.3;
  const { allergyNames, exactBanned } = derivePatientBans(patient);
  const matchers = buildDietMatchers({ allergyNames, exactBanned });
  const bannedNames = [...allergyNames, ...exactBanned.map((b) => b.name)];

  // Basket constraint, same as week generation: a swapped dish must be
  // cookable from what the user owns (plus free staples). Before 2026-09-11
  // swaps ignored the basket and brought in lemon, tahini etc.
  const pantry = await prisma.patientPantryItem.findMany({ where: { patientId: patient.id }, select: { ingredient: { select: { name: true } } } });
  const basket = pantry.map((p) => p.ingredient.name);
  const freeStaples = freeStaplesFor(matchers);
  const basketLine = basket.length > 0
    ? `- Every dish may use ONLY these ingredients${freeStaples.length ? ` (plus ${freeStaples.join(", ")})` : ""}: ${basket.join(", ")}. Use no other ingredient — if the request needs one you don't have, make the closest dish from this list.`
    : ``;

  const system = [
    // FOUR candidates, not one. Every gate the plan builder applies now runs
    // here too — diet, basket, salt, timings, the title's promise, the day's
    // proteins, the arithmetic — and with a single candidate one miss meant a
    // total failure: a QA account got 422 on three consecutive swaps, each
    // billed against a 3-per-day allowance, with a message blaming the user's
    // ingredients for a chicken dish their basket plainly supported. Asking for
    // two costs a little more output on one call and turns "all or nothing"
    // into "best of two" — four would be better and does not fit the budget.
    `You are Clara, Wondish's nutrition assistant. Suggest TWO different ${cuisine ? cuisine + " " : ""}${mealTypeName.toLowerCase()} dishes to replace one the user didn't want. Vary the protein and the method between them; the app picks whichever fits the rest of the day.`,
    `Rules:`,
    `- mealType must be exactly "${mealTypeName}".`,
    `- Target ≈${targetCalories} kcal per serving (within ±20%).`,
    `- Aim near this macro split by calories: ~${Math.round(macro.protein)}% protein, ~${Math.round(macro.carbs)}% carbs, ~${Math.round(macro.fat)}% fat.`,
    `- Everyday home-cookable dish; usesIngredients lists EVERY ingredient (common, individually named); leave missingIngredients empty.`,
    `- perServing macros must be realistic and self-consistent (protein*4 + carbs*4 + fat*9 must explain the calories).`,
    `- If a step sears, fries, sautés or browns anything, the fat used must appear in usesIngredients with its amount.`,
    `- Salt must not exceed 1 teaspoon per serving.`,
    mealTypeName.toLowerCase() === "breakfast"
      ? `- This is BREAKFAST: morning food, under ${BREAKFAST_MAX_MINUTES} minutes prep+cook in total, and nothing that has to be started the night before. Eggs, oats, toast, yoghurt, fruit, a quick scramble or hash. Not a braise, a roast or a rice bowl.`
      : ``,
    otherProteins.length > 0
      ? `- The rest of this day already uses ${otherProteins.join(" and ")}. Use a DIFFERENT main protein so the day isn't the same thing three times.`
      : ``,
    cuisine ? `- The dish must be authentic ${cuisine} cuisine.` : ``,
    request ? `- Honour the user's request: "${request}".` : `- Pick something appealing and different.`,
    basketLine,
    bannedNames.length > 0 ? `- NEVER include these ingredients or anything containing them: ${bannedNames.join(", ")}.` : ``,
    // Conditions without ingredient bans (GERD, IBS, PCOS…) only reach the
    // model through this profile text — see the 2026-09-11 condition audit.
    `\nThe diner's profile (respect every line, especially condition guidance):\n${buildFoodMapText(patient)}`,
  ].join("\n");

  let candidate: FridgeRecipe | null = null;
  const rejections: string[] = [];
  try {
    // 20s x 1 attempt fits under this route's maxDuration = 30 with room for the DB work.
    const anthropic = createAnthropic({ timeout: 20_000, maxRetries: 0 });
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 3072, // two candidate dishes with their steps
      thinking: { type: "disabled" },
      system,
      tools: [
        {
          name: "suggest_recipes",
          description: "Return exactly one replacement dish.",
          input_schema: SUGGEST_RECIPES_SCHEMA,
        },
      ],
      tool_choice: { type: "tool", name: "suggest_recipes" },
      messages: [{ role: "user", content: request || "Give me a different dish for this slot." }],
    });
    const toolUse = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const rawList = (toolUse?.input as { recipes?: unknown } | undefined)?.recipes;
    const parsed = Array.isArray(rawList)
      ? rawList.map((item) => validateFridgeRecipeSnapshot(item)).filter((r): r is FridgeRecipe => r !== null)
      : [];
    // Deterministic gates: diet-safe + within the basket (names rewritten to
    // the pantry's catalog spelling) + sane numbers. The model's claim is
    // never trusted.
    // The swap has to clear the same bar as a generated plan dish. Until
    // 2026-09-24 it checked only diet, basket and numeric sanity, so a swap
    // could put back exactly what the plan builder refuses: a QA run swapped a
    // breakfast and got a 35-minute bowl whose first step was "cook brown rice
    // (about 45 minutes ahead)". dishProblem covers salt, seasoning quantities,
    // the breakfast ceiling and the title's promise; the two generation-only
    // checks apply here too, because Clara is in the loop and can be asked again.
    const survivors = applyAllergenFilter(parsed, matchers);
    if (process.env.AI_DEBUG || survivors.length === 0) {
      console.info(`[clara-swap] parsed=${parsed.length} afterAllergen=${survivors.length}`);
    }
    // Each rejection is named, so a 422 is explainable instead of guessed at.
    // What we are replacing, so the swap cannot hand it straight back. QA asked
    // to swap "Herb-Roasted Chicken Thighs with Roasted Vegetables" and got
    // "Herb-Roasted Chicken Thighs with Roasted Vegetables" — 566 kcal became
    // 484 with the same nine ingredients — spending one of three daily swaps for
    // no visible change. Matched on the NAME and on the ingredient set, because
    // a re-costed copy under the same name is the shape it actually took.
    const replacedName = displayDishName(menu.recipe.name).trim().toLowerCase();
    const replacedIngredients = new Set(
      (menu.recipe.ingredients ?? []).map((ri) => ri.ingredient.name.trim().toLowerCase())
    );
    const isTheSameDish = (r: FridgeRecipe): boolean => {
      if (displayDishName(r.name).trim().toLowerCase() === replacedName) return true;
      const used = r.usesIngredients.map((n) => n.trim().toLowerCase());
      if (used.length === 0 || used.length !== replacedIngredients.size) return false;
      return used.every((n) => replacedIngredients.has(n));
    };

    for (const r of survivors) {
      const why =
        isTheSameDish(r)
          ? "same-dish-as-before"
          : basket.length > 0 && !fitBasket(r, basket)
          ? "out-of-basket"
          : !passesSanity(r)
            ? "implausible-numbers"
            : overusedProteins.has(dishProteinOfNames(r.usesIngredients) ?? "")
              ? "third-helping-of-the-day's-protein"
              : (() => {
                  const dish = toPlausibleDish(r, mealTypeName);
                  const priced = pricedMacros(r);
                  if (priced) {
                    dish.macros = { protein: priced.protein, carbs: priced.carbs, fat: priced.fat };
                    dish.calories = priced.calories;
                  }
                  return dishProblem(dish, catalogFoodTokens);
                })() ??
                (descriptionPromisesMissingFood(r, catalogFoodTokens) ? "description-promises-missing-food" : null) ??
                (cooksWithUnlistedFat(r) ? "cooks-without-listing-fat" : null);
      if (!why) { candidate = r; break; }
      rejections.push(`${r.name}: ${why}`);
    }
  } catch (err) {
    const busy = claraBusyStatus(err);
    if (busy) return NextResponse.json({ error: CLARA_BUSY_MESSAGE }, { status: busy });
    return NextResponse.json({ error: "Clara couldn't swap that — try again." }, { status: 502 });
  }

  if (!candidate) {
    // Say what was actually rejected. "Couldn't make that from your
    // ingredients" was shown for every failure mode, including ones that had
    // nothing to do with the basket.
    console.info(
      `[clara-swap] no candidate for ${mealTypeName} (menu ${params.menuId}): ${rejections.join("; ") || "model returned nothing usable"}`
    );
    // Say what happened, including that it cost one of the day's swaps. The old
    // copy blamed the user's ingredients for every failure mode — a QA account
    // was told its basket couldn't make a chicken dish while holding two kinds
    // of chicken — and said nothing about the allowance it had just spent.
    const blamesBasket = rejections.some((r) => r.includes("out-of-basket"));
    return NextResponse.json(
      {
        error:
          basket.length > 0 && blamesBasket
            ? "Clara could only think of dishes that need something you don't have. That used one of today's swaps — add an ingredient or two under Ingredients and the next one has more to work with."
            : "Clara couldn't find an alternative that fits this slot. That used one of today's swaps — try again with a different request, or pick a cuisine to point her somewhere new.",
      },
      { status: 422 }
    );
  }

  // Persist under the slot's meal type (so it reads as that slot) + cuisine.
  const [createdId] = await persistValidatedRecipes(
    [{ recipe: candidate, mealTypeId: menu.mealTypeId }],
    [CLARA_RECIPE_TAG, "clara-swap"],
    "complete meal",
    cuisine
  );
  if (!createdId) {
    return NextResponse.json({ error: "Clara couldn't save that dish — try again." }, { status: 502 });
  }

  // Guarded write: the slot must still belong to this patient's ACTIVE plan
  // version. If a regenerate ran during the model call, the old row is gone
  // (or stale) and `update` would throw P2025 uncaught. Take the dish out of
  // the public catalog so a lost race doesn't leave junk for every other
  // user's plan builder.
  // Fresh read: the version captured before the model call may be stale if a
  // regenerate flipped it meanwhile; filtering on the live value shrinks the
  // lost-race window to a single query.
  const live = await prisma.patient.findUnique({ where: { id: patient.id }, select: { activePlanVersion: true } });
  const claimed = await prisma.menu.updateMany({
    where: { id: params.menuId, patientId: patient.id, planVersion: live?.activePlanVersion ?? patient.activePlanVersion },
    data: { recipeId: createdId },
  });
  if (claimed.count === 0) {
    await prisma.recipe
      .update({ where: { id: createdId }, data: { isPublic: false } })
      .catch((err) => console.error("[clara-swap] could not un-publish orphaned recipe", createdId, err));
    return NextResponse.json(
      { error: "Your plan changed while Clara was cooking — refresh the page and try again." },
      { status: 409 }
    );
  }

  // Return the new recipe in the shape the client's onSwapped expects.
  const recipe = await prisma.recipe.findUnique({
    where: { id: createdId },
    include: {
      mealType: true,
      dishType: true,
      ethnic: true,
      ingredients: { include: { ingredient: true } },
    },
  });
  return NextResponse.json({ recipe });
}
