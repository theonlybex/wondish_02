import { NextRequest, NextResponse } from "next/server";
import { resolveClaraCaller } from "@/lib/clara/caller";
import { memoryStore } from "@/lib/clara/skills/memory";

const NOT_FOUND = () => NextResponse.json({ error: "Memory not found" }, { status: 404 });

// Ownership-scoped inside the store: someone else's id is just a 404.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const caller = await resolveClaraCaller();
    if (!caller.ok) return caller.response;
    if (!caller.patient) return NOT_FOUND();

    const removed = await memoryStore.remove(caller.patient.id, params.id);
    if (!removed) return NOT_FOUND();
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error("[clara-memories] delete", err);
    return NextResponse.json({ error: "Could not forget that memory" }, { status: 500 });
  }
}
