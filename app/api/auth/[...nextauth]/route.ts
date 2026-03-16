import { NextResponse } from "next/server";

// NextAuth removed — authentication is now handled by Clerk
export function GET() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
export function POST() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
