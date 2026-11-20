import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { resolveClaraCaller } from "@/lib/clara/caller";
import { dietShareStore, type DietShare } from "@/lib/diet-share";
import { loadDietCard } from "@/lib/diet-card-db";

// "Share my diet" (2026-11-20): one link per person that opens their diet
// card for whoever cooks for them. The person comes from sign-in only.
//   GET    the current link (or null) and the card as the chef will see it
//   POST   { showConditions } turns sharing on, or changes what the link shows
//   DELETE turns the link off

function linkView(req: NextRequest, share: DietShare | null) {
  if (!share) return null;
  return {
    url: `${new URL(req.url).origin}/diet/${share.token}`,
    expiresAt: share.expiresAt,
    showConditions: share.showConditions,
  };
}

async function caller() {
  const c = await resolveClaraCaller();
  if (!c.ok) return { response: c.response } as const;
  const { success } = await rateLimit("diet-share", c.userId, 30, 60);
  if (!success) return { response: NextResponse.json({ error: "Too many requests" }, { status: 429 }) } as const;
  if (!c.patient) {
    return { response: NextResponse.json({ error: "Finish setting up your profile first", code: "PROFILE_INCOMPLETE" }, { status: 409 }) } as const;
  }
  return { patientId: c.patient.id } as const;
}

export async function GET(req: NextRequest) {
  try {
    const who = await caller();
    if ("response" in who) return who.response;
    const share = await dietShareStore.current(who.patientId);
    const card = await loadDietCard(who.patientId, share?.showConditions ?? false);
    return NextResponse.json({ link: linkView(req, share), card });
  } catch (err) {
    console.error("[diet-share] get", err);
    return NextResponse.json({ error: "Could not load your diet card" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const who = await caller();
    if ("response" in who) return who.response;
    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      // An empty body turns sharing on with conditions hidden.
    }
    const showConditions = typeof body === "object" && body !== null && (body as Record<string, unknown>).showConditions === true;
    const share = await dietShareStore.enable(who.patientId, showConditions);
    const card = await loadDietCard(who.patientId, share.showConditions);
    return NextResponse.json({ link: linkView(req, share), card });
  } catch (err) {
    console.error("[diet-share] post", err);
    return NextResponse.json({ error: "Could not create the link" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const who = await caller();
    if ("response" in who) return who.response;
    await dietShareStore.revoke(who.patientId);
    return NextResponse.json({ link: null });
  } catch (err) {
    console.error("[diet-share] delete", err);
    return NextResponse.json({ error: "Could not turn the link off" }, { status: 500 });
  }
}
