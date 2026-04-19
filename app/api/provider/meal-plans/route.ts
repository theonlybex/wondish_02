import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { format } from "date-fns";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
  } catch (err) {
    return adminErrorResponse(err);
  }

  const { searchParams } = new URL(req.url);
  const dateParam = searchParams.get("date");
  const date = dateParam ? new Date(dateParam) : new Date();
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

  return NextResponse.json({ menus });
}
