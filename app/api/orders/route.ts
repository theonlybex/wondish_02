import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Single round-trip via the Clerk id relation (was account-then-patient).
  const patient = await prisma.patient.findFirst({ where: { account: { clerkId: userId } } });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  // Clamped: NaN/negative params previously reached Prisma as a NaN skip
  // (500). Bad input falls back to defaults instead of erroring.
  const rawPage = parseInt(searchParams.get("page") ?? "1");
  const rawLimit = parseInt(searchParams.get("limit") ?? "10");
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;
  const limit = Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.min(rawLimit, 100) : 10;

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where: { patientId: patient.id },
      include: { items: true },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.order.count({ where: { patientId: patient.id } }),
  ]);

  return NextResponse.json({ orders, total, page, limit });
}
