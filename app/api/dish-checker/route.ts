import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

type Message = { role: "user" | "assistant"; content: string };

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Per-user: max 20 requests / 60s (shared across instances via Upstash).
  const { success } = await rateLimit("dish-checker", userId, 20, 60);
  if (!success) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment before asking again." },
      { status: 429 }
    );
  }

  let messages: Message[] = [];
  try {
    const body = await req.json();
    messages = Array.isArray(body.messages) ? body.messages : [];
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (messages.length === 0) {
    return NextResponse.json({ error: "No messages provided" }, { status: 400 });
  }

  const account = await prisma.account.findUnique({
    where: { clerkId: userId },
    select: { id: true, firstName: true },
  });
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

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

  const validMessages = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .filter((m) => typeof m.content === "string" && m.content.trim().length > 0)
    .map((m) => ({ ...m, content: m.content.slice(0, 4000) }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stream = anthropic.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: systemPrompt,
    messages: validMessages,
  });

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          if (
            chunk.type === "content_block_delta" &&
            chunk.delta.type === "text_delta"
          ) {
            controller.enqueue(new TextEncoder().encode(chunk.delta.text));
          }
        }
      } finally {
        controller.close();
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
