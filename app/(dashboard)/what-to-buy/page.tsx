import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

// "What to buy" is a tab on the Ingredients screen, not a route — but the tab
// is LABELLED "What to buy", so /what-to-buy is the address a tester (and a
// search engine, and anyone typing what they see) reaches for, and it answered
// 404 (QA 2026-09-24). /grocery-list has redirected here since the two screens
// merged; this is the same courtesy for the name the UI actually shows.
export default async function WhatToBuyPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");
  redirect("/pantry?tab=buy");
}
