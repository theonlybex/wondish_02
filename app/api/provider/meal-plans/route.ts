import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { format } from "date-fns";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";
import { parseLocalDateStrict } from "@/lib/journal";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
  } catch (err) {
    return adminErrorResponse(err);
  }

  const { searchParams } = new URL(req.url);
  const dateParam = searchParams.get("date");
  // Local-date parse (audit Task 15): bare new Date(param) UTC-shifted the
  // day boundary and 500'd on garbage input.
  let date: Date;
  if (dateParam) {
    const parsed = parseLocalDateStrict(dateParam);
    if (!parsed) return NextResponse.json({ error: "date must be a YYYY-MM-DD string" }, { status: 400 });
    date = parsed;
  } else {
    date = new Date();
  }
  date.setHours(0, 0, 0, 0);
  const dateEnd = new Date(date);
  dateEnd.setHours(23, 59, 59, 999);

  const menus = await prisma.menu.findMany({
    where: { date: { gte: date, lte: dateEnd } },
    include: {
      recipe: true,
      mealType: true,
      patient: {
        include: {
          account: { select: { firstName: true, lastName: true, email: true } },
        },
      },
    },
    orderBy: [{ patient: { account: { firstName: "asc" } } }, { mealType: { name: "asc" } }],
  });

  // Only the active plan version per patient (blue/green: ignore in-flight versions).
  const activeMenus = menus.filter((m) => m.planVersion === m.patient.activePlanVersion);
  return NextResponse.json({ menus: activeMenus });
}
