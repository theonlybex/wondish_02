import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { sanitizeChatHistory } from "@/lib/chat-history";
import { accountHasActivePremium, getAccountWithSubscription } from "@/lib/auth";
import {
  CHAT_DAILY_FREE,
  CHAT_DAY_RATE_LIMIT_NAME,
  CHAT_DAY_RATE_LIMIT_WINDOW_SEC,
  chatQuotaExceededResponseBody,
} from "@/lib/freemium";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Per-user: max 20 requests / 60s (shared across instances via Upstash).
  // This burst check must fire first — cheaper than the account lookup below
  // and stops hammering clients before they cost us a DB round trip.
  const { success } = await rateLimit("dish-checker", userId, 20, 60);
  if (!success) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment before asking again." },
      { status: 429 }
    );
  }

  // Single account+subscription lookup serves both the credit gate below and
  // the patient/prompt lookups further down — do not duplicate this fetch.
  const account = await getAccountWithSubscription(userId);
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  // Credit gate (docs/superpowers/plans/2026-07-23-clara-ai-access-architecture.md):
  // premium accounts bypass the daily allowance entirely; free accounts get
  // CHAT_DAILY_FREE messages/day. Must run before any Anthropic call so a
  // gated request costs zero tokens.
  if (!accountHasActivePremium(account.subscriptions)) {
    const { success: withinDailyFree } = await rateLimit(
      CHAT_DAY_RATE_LIMIT_NAME,
      userId,
      CHAT_DAILY_FREE,
      CHAT_DAY_RATE_LIMIT_WINDOW_SEC
    );
    if (!withinDailyFree) {
      return NextResponse.json(chatQuotaExceededResponseBody(), { status: 402 });
    }
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const history = sanitizeChatHistory((body as { messages?: unknown })?.messages);
  if (history === null || history.length === 0) {
    return NextResponse.json({ error: "Invalid messages" }, { status: 400 });
  }

  const patient = await prisma.patient.findFirst({
    where: { accountId: account.id },
    include: {
      mealType: true,
      foodAllergies: {
        include: {
          food: { include: { bannedIngredients: true } },
        },
      },
      foodPreferences: {
        include: {
          food: { include: { bannedIngredients: true } },
        },
      },
      foodToAvoid: {
        include: { food: true },
      },
      healthConditions: {
        include: {
          condition: { include: { bannedIngredients: true } },
        },
      },
      motivations: {
        include: {
          motivation: { include: { bannedIngredients: true } },
        },
      },
    },
  });

  const foodMapText = buildFoodMapText(patient);
  const systemPrompt = buildSystemPrompt(account.firstName ?? "there", foodMapText);

  const stream = anthropic.messages.stream({
    model: "claude-sonnet-5",
    max_tokens: 1024,
    // Sonnet 5 defaults to adaptive thinking when the param is omitted; chat latency wants it off (C6).
    thinking: { type: "disabled" },
    system: systemPrompt,
    messages: history,
  });

  // The Anthropic stream connects asynchronously (`.stream()` never throws
  // synchronously), so we await the connection here to surface request-time
  // errors (rate limits, overload) as a clean JSON response instead of an
  // HTTP 200 that fails mid-stream.
  try {
    await stream.withResponse();
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      if (err.status === 429) {
        return NextResponse.json(
          { error: "Clara is busy, try again in a moment" },
          { status: 429 }
        );
      }
      if (err.status === 529) {
        return NextResponse.json(
          { error: "Clara is busy, try again in a moment" },
          { status: 503 }
        );
      }
    }
    return NextResponse.json({ error: "Clara is unavailable right now" }, { status: 500 });
  }

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        controller.close();
      } catch (err) {
        console.error("dish-checker stream error", err);
        controller.error(err);
      }
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildFoodMapText(patient: any): string {
  if (!patient) return "No specific dietary restrictions on file.";

  const lines: string[] = [];

  if (patient.mealType) {
    lines.push(`Dietary pattern: ${patient.mealType.name}`);
  }

  if (patient.foodAllergies?.length > 0) {
    const names = patient.foodAllergies.map((a: any) => a.food.name).join(", ");
    const banned = patient.foodAllergies.flatMap((a: any) =>
      a.food.bannedIngredients.map((b: any) => b.name)
    );
    lines.push(`Allergies: ${names}`);
    if (banned.length > 0) lines.push(`Restricted from allergies: ${banned.join(", ")}`);
  }

  if (patient.foodToAvoid?.length > 0) {
    lines.push(`Foods to avoid: ${patient.foodToAvoid.map((f: any) => f.food.name).join(", ")}`);
  }

  if (patient.foodPreferences?.length > 0) {
    const names = patient.foodPreferences.map((p: any) => p.food.name).join(", ");
    const banned = patient.foodPreferences.flatMap((p: any) =>
      p.food.bannedIngredients.map((b: any) => b.name)
    );
    lines.push(`Food preferences: ${names}`);
    if (banned.length > 0) lines.push(`Restricted from preferences: ${banned.join(", ")}`);
  }

  if (patient.healthConditions?.length > 0) {
    const names = patient.healthConditions.map((c: any) => c.condition.name).join(", ");
    const banned = patient.healthConditions.flatMap((c: any) =>
      c.condition.bannedIngredients.map((b: any) => b.name)
    );
    lines.push(`Health conditions: ${names}`);
    if (banned.length > 0) lines.push(`Restricted from conditions: ${banned.join(", ")}`);
  }

  if (patient.motivations?.length > 0) {
    const names = patient.motivations.map((m: any) => m.motivation.name).join(", ");
    const banned = patient.motivations.flatMap((m: any) =>
      m.motivation.bannedIngredients.map((b: any) => b.name)
    );
    lines.push(`Goals: ${names}`);
    if (banned.length > 0) lines.push(`Restricted from goals: ${banned.join(", ")}`);
  }

  return lines.length > 0 ? lines.join("\n") : "No specific dietary restrictions on file.";
}

function buildSystemPrompt(firstName: string, foodMapText: string): string {
  return `You are Clara, a warm and knowledgeable personal food advisor for ${firstName}.

${firstName}'s dietary profile:
${foodMapText}

Your behavior:
1. When asked about a dish or food, assume the most common ingredients and preparation method if not specified — state your assumptions briefly before evaluating.
2. Start with what works well for ${firstName}'s goals and profile (positive first).
3. Identify every conflict with their dietary profile and explain WHY it matters to their health.
4. If the dish can be adjusted: propose specific modifications and ask if they accept.
   - If accepted → confirm ACCEPTED ✅ with modifications noted.
   - If declined → confirm REJECTED ❌, suggest an alternative dish.
5. No conflicts → confirm PASSED ✅, explain why it is a great fit for their profile.
6. After your first message, do NOT re-introduce yourself or restate their profile. Continue the conversation naturally.
7. Be warm, encouraging, and educational. Never clinical or cold.
8. Keep responses concise — 3 to 5 sentences unless the user asks for more detail.
9. If the dietary profile is empty or incomplete, still give your best nutritional advice based on general healthy eating principles.
10. Never use markdown formatting — no bold (**), no headers (#), no bullet dashes or asterisks. Write in plain, conversational prose like a knowledgeable friend texting you.`;
}
