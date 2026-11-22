import { NextRequest, NextResponse } from "next/server";
import { resolveClaraCaller } from "@/lib/clara/caller";
import { applyRulesBody, prismaRulesDeps, rulesView } from "@/lib/clara/skills/rules";
import { rateLimit } from "@/lib/rate-limit";

// "How Clara cooks" in the app's settings.
// GET -> { system: [{ key, title, detail, on }], mine: [{ id, text, on, checked }] }
// PUT { system?: { key: boolean }, mine?: [{ id?, text, on? }] } -> the same
//   `system` changes only the switches it names. `mine`, when sent, is the whole
//   list of the person's own rules (one left out is deleted; one without an id is new).
// A rule of the person's never overrides their allergies or diet: those are in the
// profile and are checked on every dish whatever is saved here.

async function gate() {
  const caller = await resolveClaraCaller();
  if (!caller.ok) return { error: caller.response };
  const { success } = await rateLimit("clara-rules", caller.userId, 60, 60);
  if (!success) return { error: NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 }) };
  if (!caller.patient) return { error: NextResponse.json({ error: "Profile not found" }, { status: 404 }) };
  return { patientId: caller.patient.id };
}

export async function GET() {
  try {
    const g = await gate();
    if ("error" in g) return g.error;
    const rules = await prismaRulesDeps.load(g.patientId);
    if (!rules) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    return NextResponse.json(rulesView(rules));
  } catch (err) {
    console.error("[clara-rules] get", err);
    return NextResponse.json({ error: "Could not load your rules" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const g = await gate();
    if ("error" in g) return g.error;
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const current = await prismaRulesDeps.load(g.patientId);
    if (!current) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    const next = applyRulesBody(current, raw);
    if (!next) return NextResponse.json({ error: "Body must be { system?: { key: boolean }, mine?: [{ id?, text, on? }] } with rules of at most 120 characters, 15 at most." }, { status: 422 });
    await prismaRulesDeps.save(g.patientId, next);
    return NextResponse.json(rulesView(next));
  } catch (err) {
    console.error("[clara-rules] put", err);
    return NextResponse.json({ error: "Could not save your rules" }, { status: 500 });
  }
}
