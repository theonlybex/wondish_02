import { NextResponse } from "next/server";
import { resolveClaraCaller } from "@/lib/clara/caller";
import { memoryStore } from "@/lib/clara/skills/memory";

// "What Clara remembers" — list and clear-all. Patient comes from Clerk auth only.
export async function GET() {
  try {
    const caller = await resolveClaraCaller();
    if (!caller.ok) return caller.response;
    if (!caller.patient) return NextResponse.json({ items: [] });

    const items = await memoryStore.list(caller.patient.id);
    return NextResponse.json({ items });
  } catch (err) {
    console.error("[clara-memories] list", err);
    return NextResponse.json({ error: "Could not load memories" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const caller = await resolveClaraCaller();
    if (!caller.ok) return caller.response;
    if (!caller.patient) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const deleted = await memoryStore.clear(caller.patient.id);
    return NextResponse.json({ deleted });
  } catch (err) {
    console.error("[clara-memories] clear", err);
    return NextResponse.json({ error: "Could not clear memories" }, { status: 500 });
  }
}
