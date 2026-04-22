import { NextRequest, NextResponse } from "next/server";

const VALID_LOCALES = ["en", "ru", "es"] as const;

export async function POST(req: NextRequest) {
  let locale: unknown;
  try {
    const body = await req.json() as Record<string, unknown>;
    locale = body?.locale;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!VALID_LOCALES.includes(locale as (typeof VALID_LOCALES)[number])) {
    return NextResponse.json({ error: "Invalid locale" }, { status: 400 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set("NEXT_LOCALE", locale as string, {
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}
