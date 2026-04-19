import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";

export async function GET() {
  try {
    await requireAdmin();
  } catch (err) {
    return adminErrorResponse(err);
  }

  const patients = await prisma.patient.findMany({
    include: {
      account: { select: { firstName: true, lastName: true, email: true, companyId: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ patients });
}
