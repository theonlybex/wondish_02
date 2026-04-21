import { NextRequest, NextResponse } from "next/server";

const VALID_LOCALES = ["en", "ru", "es"];

export async function POST(req: NextRequest) {
  const { locale } = await req.json();
  if (!VALID_LOCALES.includes(locale)) {
    return NextResponse.json({ error: "Invalid locale" }, { status: 400 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set("NEXT_LOCALE", locale, {
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
    sameSite: "lax",
  });
  return res;
}
