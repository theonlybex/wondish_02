import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { guardClaraAppSpend } from "@/lib/ai-budget";
import { createAnthropic } from "@/lib/anthropic";
import { resolveClaraCaller } from "@/lib/clara/caller";
import { parsePhoto } from "@/lib/clara/photo";
import { PROFILE_INCOMPLETE_ERROR } from "@/lib/clara/chat-service";
import { estimateQuickLog, parseQuickLogBody, quickLogTotals, quickLogUpsertArgs } from "@/lib/clara/quick-log";

// POST /api/clara/quick-log  { meal, today, requestId, note?, photo? }
// A meal reminder answered in one step (2026-11-20): the words typed under
// the notification, or one photo, are estimated and logged at once. The app
// does not open for a typed answer and Clara asks nothing.
export const maxDuration = 60;

const anthropic = createAnthropic({ timeout: 40_000, maxRetries: 0 });

export async function POST(req: NextRequest) {
  try {
    const caller = await resolveClaraCaller();
    if (!caller.ok) return caller.response;
    const { success } = await rateLimit("clara-quick-log", caller.userId, 10, 60);
    if (!success) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }
    const body = parseQuickLogBody(raw);
    if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 });
    const photo = parsePhoto((raw as Record<string, unknown>).photo);
    if (!photo.ok) return NextResponse.json({ error: photo.error }, { status: 400 });
    if (!body.value.note && !photo.photo) return NextResponse.json({ error: "A note or a photo is required" }, { status: 400 });

    if (!caller.patient) {
      return NextResponse.json({ error: PROFILE_INCOMPLETE_ERROR, code: "PROFILE_INCOMPLETE" }, { status: 409 });
    }

    // A retry of a request that already logged: the same row, no second model call.
    const existing = await prisma.mealLog.findFirst({
      where: { patientId: caller.patient.id, clientRequestId: `quick:${body.value.requestId}`, deletedAt: null },
    });
    if (existing) return NextResponse.json({ logged: view(existing) });

    const guard = await guardClaraAppSpend(caller.userId);
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });

    const estimate = await estimateQuickLog(anthropic, {
      meal: body.value.meal,
      ...(body.value.note ? { note: body.value.note } : {}),
      ...(photo.photo ? { photo: photo.photo } : {}),
    });
    if (!estimate) return NextResponse.json({ error: "Clara could not read that" }, { status: 502 });
    if (!estimate.isMeal || estimate.foods.length === 0) {
      return NextResponse.json({ error: "That does not look like a meal", code: "NOT_A_MEAL" }, { status: 422 });
    }

    const totals = quickLogTotals(estimate.foods);
    const upsert = quickLogUpsertArgs(caller.patient.id, body.value, estimate, totals, photo.photo?.id);
    if (!upsert.ok) return NextResponse.json({ error: upsert.error }, { status: 400 });
    const row = await prisma.mealLog.upsert(upsert.args);
    return NextResponse.json({ logged: view(row) });
  } catch (err) {
    console.error("[clara-quick-log]", err);
    return NextResponse.json({ error: "Clara is unavailable right now" }, { status: 500 });
  }
}

function view(row: { id: string; name: string; mealType: string; localDate: string; calories: number | null; protein: number | null; carbs: number | null; fat: number | null }) {
  const round = (v: number | null, d: number) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
  return {
    id: row.id,
    name: row.name,
    mealType: row.mealType,
    date: row.localDate,
    calories: round(row.calories, 0),
    protein: round(row.protein, 1),
    carbs: round(row.carbs, 1),
    fat: round(row.fat, 1),
  };
}
