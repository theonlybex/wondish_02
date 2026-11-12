import { NextRequest, NextResponse } from "next/server";
import { resolveClaraCaller } from "@/lib/clara/caller";
import { makeCookService, parseCookBody } from "@/lib/clara/cook";
import { rateLimit } from "@/lib/rate-limit";

const service = makeCookService();

const NOT_FOUND = () => NextResponse.json({ error: "Conversation not found" }, { status: 404 });

// Each action is the person's own tap (Clara never calls this). Ownership is
// scoped inside every query: someone else's id is indistinguishable from a
// missing one (404). Rate limited like the other Clara routes, sized for a
// person cooking (start, done, answers and offline replays: 30 a minute). The
// body has no size helper in this repo; the recipe bounds in parseCookBody
// cap what is accepted.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const caller = await resolveClaraCaller();
    if (!caller.ok) return caller.response;

    const { success } = await rateLimit("clara-cook", caller.userId, 30, 60);
    if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });
    if (!caller.patient) return NOT_FOUND();

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const parsed = parseCookBody(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const result = await service.apply(params.id, caller.patient.id, parsed.value);
    if (!result.ok) {
      return result.status === 404 ? NOT_FOUND() : NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[clara-cook] post", err);
    return NextResponse.json({ error: "Could not update that cooking session" }, { status: 500 });
  }
}
