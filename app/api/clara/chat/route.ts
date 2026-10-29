import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { accountHasActivePremium } from "@/lib/auth";
import { guardClaraAppSpend } from "@/lib/ai-budget";
import { createAnthropic } from "@/lib/anthropic";
import { resolveClaraCaller } from "@/lib/clara/caller";
import { createAnthropicClient } from "@/lib/clara/anthropic-client";
import { parseClaraRequestOptions } from "@/lib/clara/request";
import { makeConversationStore } from "@/lib/clara/conversations";
import { prismaMemoryDeps } from "@/lib/clara/skills/memory";
import {
  startClaraAppTurn,
  parseClaraChatBody,
  claraAppSkills,
  PROFILE_INCOMPLETE_ERROR,
} from "@/lib/clara/chat-service";
import { encodeEvent } from "@/lib/clara/ndjson";

// Saved-chat Clara for web and iOS (spec §2). Five tool rounds, each its own
// request; maxDuration bounds the whole turn (same reasoning as dish-checker).
export const maxDuration = 300;

// Same network policy as dish-checker: 55s x 1 attempt, no SDK retries, so a
// 529 surfaces at once as "Clara is busy" instead of a platform-killed 504.
const anthropic = createAnthropic({ timeout: 55_000, maxRetries: 0 });

const store = makeConversationStore();

// Last-resort boundary: always answer JSON and always log why.
export async function POST(req: NextRequest) {
  try {
    return await handleChat(req);
  } catch (err) {
    console.error("[clara-chat] unhandled", err);
    return NextResponse.json({ error: "Clara is unavailable right now" }, { status: 500 });
  }
}

async function handleChat(req: NextRequest) {
  const caller = await resolveClaraCaller();
  if (!caller.ok) return caller.response;
  const { userId, account, patient } = caller;

  const { success } = await rateLimit("clara-chat", userId, 20, 60);
  if (!success) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment before asking again." },
      { status: 429 }
    );
  }

  // Validate before any spend.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const parsed = parseClaraChatBody(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const options = parseClaraRequestOptions(body);

  // No Patient row (onboarding unfinished) — answered before any spend.
  if (!patient) {
    return NextResponse.json({ error: PROFILE_INCOMPLETE_ERROR, code: "PROFILE_INCOMPLETE" }, { status: 409 });
  }

  // Clara's own hidden cap and pools (spec §2a) — never guardAiSpend("claraApp").
  const guard = await guardClaraAppSpend(userId);
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });

  const turn = await startClaraAppTurn(
    {
      store,
      memory: prismaMemoryDeps,
      client: createAnthropicClient(anthropic),
      skills: claraAppSkills(process.env.CLARA_SKILLS),
    },
    {
      patient,
      account,
      isPremium: accountHasActivePremium(account.subscriptions),
      conversationId: parsed.conversationId,
      message: parsed.message,
      options,
    }
  );
  if (!turn.ok) return NextResponse.json(turn.body, { status: turn.status });

  const events = turn.events;
  let cancelled = false;
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Drain to the end even if the client went away: the assistant row is
      // saved only once the loop has finished, and a member who closed the app
      // mid-reply should still find the answer in the saved chat.
      try {
        for await (const event of events) {
          if (cancelled) continue;
          try {
            controller.enqueue(encodeEvent(event));
          } catch {
            cancelled = true;
          }
        }
        if (!cancelled) controller.close();
      } catch (err) {
        console.error("[clara-chat] stream error", err);
        if (!cancelled) controller.error(err);
      }
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}
