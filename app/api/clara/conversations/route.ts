import { NextRequest, NextResponse } from "next/server";
import { resolveClaraCaller } from "@/lib/clara/caller";
import { makeConversationStore } from "@/lib/clara/conversations";

const store = makeConversationStore();

// Saved-chat list for the signed-in member. Patient comes from Clerk auth only.
export async function GET(req: NextRequest) {
  try {
    const caller = await resolveClaraCaller();
    if (!caller.ok) return caller.response;
    if (!caller.patient) return NextResponse.json({ items: [] });

    const cursor = req.nextUrl.searchParams.get("cursor") || undefined;
    const page = await store.list(caller.patient.id, cursor);
    return NextResponse.json(page);
  } catch (err) {
    console.error("[clara-conversations] list", err);
    return NextResponse.json({ error: "Could not load conversations" }, { status: 500 });
  }
}
