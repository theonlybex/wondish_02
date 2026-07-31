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
import { PATIENT_FOOD_MAP_INCLUDE, buildFoodMapText } from "@/lib/food-map";
import { startClaraLoop } from "@/lib/clara/loop";
import { createAnthropicClient } from "@/lib/clara/anthropic-client";
import { parseClaraRequestOptions } from "@/lib/clara/request";
import { resolveToday } from "@/lib/clara/dates";
import { maxToolRounds } from "@/lib/clara/budget";
import {
  ALL_SKILLS,
  resolveActiveSkills,
  buildToolDefs,
  buildSystemPrompt,
  findTool,
} from "@/lib/clara/registry";
import type { ClaraContext, ToolResult } from "@/lib/clara/types";

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

  // Ordering contract: validate-before-charge — body parsing/history validation
  // must run before the account fetch and daily credit gate below, so a
  // malformed/invalid request 400s without ever touching a user's quota.
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

  const patient = await prisma.patient.findFirst({
    where: { accountId: account.id },
    include: PATIENT_FOOD_MAP_INCLUDE,
  });

  // NOTE: `patient` may be null — an account can exist without a Patient row,
  // and this route has always answered for them (buildFoodMapText tolerates
  // null). That behavior is pinned: no 404. Such a caller simply gets no
  // toolbox, which reproduces the pre-loop response exactly.
  const options = parseClaraRequestOptions(body);
  const resolution = resolveToday(options.clientDate, options.tzOffsetMinutes, new Date());
  // A server-derived date is NOT the caller's: on a UTC deploy it would tell a
  // UTC-7 user it is already tomorrow. Assert a date only when they sent one.
  const promptToday = resolution.source === "server" ? null : resolution.localDate;

  const isPremium = accountHasActivePremium(account.subscriptions);
  const firstName = account.firstName ?? "there";

  const activeSkills = patient ? resolveActiveSkills(ALL_SKILLS, process.env.CLARA_SKILLS) : [];

  const ctx: ClaraContext | null = patient
    ? {
        patientId: patient.id,
        accountId: account.id,
        firstName,
        isPremium,
        today: resolution.localDate,
        surface: options.surface,
      }
    : null;

  const systemPrompt = buildSystemPrompt(
    firstName,
    buildFoodMapText(patient),
    activeSkills,
    promptToday
  );

  const execute = async (name: string, input: Record<string, unknown>): Promise<ToolResult> => {
    const tool = ctx ? findTool(activeSkills, name) : null;
    if (!tool || !ctx) return { ok: false, reason: "FAILED", message: `Unknown tool ${name}` };
    return tool.handler(ctx, input);
  };

  // Round 1 is opened here (not inside the stream) so connect-time errors —
  // rate limits, overload — still become clean JSON responses instead of an
  // HTTP 200 that dies mid-stream.
  let generator;
  try {
    generator = await startClaraLoop({
      client: createAnthropicClient(anthropic),
      system: systemPrompt,
      tools: buildToolDefs(activeSkills),
      messages: history,
      maxToolRounds: maxToolRounds(isPremium),
      execute,
      onError: (err) => console.error("clara loop error", err),
    });
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
        for await (const chunk of generator) {
          controller.enqueue(encoder.encode(chunk));
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
