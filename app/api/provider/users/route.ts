import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const patients = await prisma.patient.findMany({
    include: {
      account: { select: { firstName: true, lastName: true, email: true, companyId: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ patients });
}
