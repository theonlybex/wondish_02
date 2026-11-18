import { NextResponse } from "next/server";
import { resolveClaraCaller } from "@/lib/clara/caller";
import { mealSuggestionNames } from "@/lib/clara/skills/dish";
import { parseTodayParam } from "@/lib/meal-log";
import { rateLimit } from "@/lib/rate-limit";

// GET /api/clara/meal-suggestions?today=YYYY-MM-DD
// One dish name for lunch and one for dinner, for the phone's meal
// notification ("How does <dish> sound for lunch, <name>?"). A local
// notification cannot call the server when it fires, so the app asks ahead
// and stores the names. No model call: the names come from the recipe
// library, filtered by the person's own food rules.
export async function GET(req: Request) {
  try {
    const caller = await resolveClaraCaller();
    if (!caller.ok) return caller.response;
    const { success } = await rateLimit("clara-meal-suggestions", caller.userId, 30, 60);
    if (!success) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    if (!caller.patient) return NextResponse.json({ suggestions: {} });

    const today = parseTodayParam(new URL(req.url).searchParams.get("today"));
    if (!today.ok) return NextResponse.json({ error: today.error }, { status: today.status });

    const suggestions = await mealSuggestionNames(caller.patient.id, today.value, ["lunch", "dinner"]);
    return NextResponse.json({ suggestions });
  } catch (err) {
    console.error("[clara-meal-suggestions]", err);
    return NextResponse.json({ error: "Could not load suggestions" }, { status: 500 });
  }
}
