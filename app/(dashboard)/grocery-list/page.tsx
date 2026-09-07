import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

// Grocery List merged into the Ingredients screen (2026-09-07) as a
// "What to buy" tab. The standalone screen is disabled — this redirects to
// /pantry. Original implementation backed up in git history; restore by
// reverting this file. The /api/grocery-list endpoint stays live (the tab
// still uses it).
export default async function GroceryListPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");
  redirect("/pantry?tab=buy");
}
