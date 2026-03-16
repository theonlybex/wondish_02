import { NextResponse } from "next/server";

// Password reset is now handled by Clerk
export function POST() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
