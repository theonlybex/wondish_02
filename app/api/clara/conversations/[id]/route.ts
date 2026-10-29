import { NextRequest, NextResponse } from "next/server";
import { resolveClaraCaller } from "@/lib/clara/caller";
import { makeConversationStore } from "@/lib/clara/conversations";

const store = makeConversationStore();

const NOT_FOUND = () => NextResponse.json({ error: "Conversation not found" }, { status: 404 });

// Both verbs are ownership-scoped inside the store: someone else's id is
// indistinguishable from a missing one (404).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const caller = await resolveClaraCaller();
    if (!caller.ok) return caller.response;
    if (!caller.patient) return NOT_FOUND();

    const conversation = await store.get(params.id, caller.patient.id);
    if (!conversation) return NOT_FOUND();
    return NextResponse.json(conversation);
  } catch (err) {
    console.error("[clara-conversations] get", err);
    return NextResponse.json({ error: "Could not load that conversation" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const caller = await resolveClaraCaller();
    if (!caller.ok) return caller.response;
    if (!caller.patient) return NOT_FOUND();

    const removed = await store.remove(params.id, caller.patient.id);
    if (!removed) return NOT_FOUND();
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error("[clara-conversations] delete", err);
    return NextResponse.json({ error: "Could not delete that conversation" }, { status: 500 });
  }
}
