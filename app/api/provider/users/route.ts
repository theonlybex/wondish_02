import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // For now, return all patients (provider sees all in their company)
  // In production, filter by company/provider assignment
  const patients = await prisma.patient.findMany({
    include: {
      account: { select: { firstName: true, lastName: true, email: true, companyId: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ patients });
}
