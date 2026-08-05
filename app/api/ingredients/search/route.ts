import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { RESTAURANT_ADMIN_ROLE } from "@/lib/restaurant-auth";
import { rateLimit } from "@/lib/rate-limit";

// Phase 6a M2 — catalog typeahead for the portal ingredient picker (design
// §5.4). Restricted to restaurant staff and ops; consumers never need it.
export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success } = await rateLimit("ingredients-search", userId, 120, 60);
  if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  const account = await prisma.account.findUnique({
    where: { clerkId: userId },
    include: { roles: { include: { role: true } } },
  });
  const allowed = account?.roles.some(
    (r) => r.role.name === "SUPER" || r.role.name === RESTAURANT_ADMIN_ROLE
  );
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ ingredients: [] });

  // Exact-prefix matches rank first, then substring matches, both A→Z.
  const rows = await prisma.ingredient.findMany({
    where: { name: { contains: q, mode: "insensitive" } },
    select: { id: true, name: true, unit: true },
    orderBy: { name: "asc" },
    take: 25,
  });
  const lower = q.toLowerCase();
  const ingredients = [
    ...rows.filter((r) => r.name.toLowerCase().startsWith(lower)),
    ...rows.filter((r) => !r.name.toLowerCase().startsWith(lower)),
  ].slice(0, 12);

  return NextResponse.json({ ingredients });
}
