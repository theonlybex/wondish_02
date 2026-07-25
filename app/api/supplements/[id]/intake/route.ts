import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateIntakeBody } from "@/lib/supplements";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const patient = await prisma.patient.findFirst({ where: { account: { clerkId: userId } } });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  const supplement = await prisma.supplement.findFirst({
    where: { id: params.id, patientId: patient.id, deletedAt: null },
  });
  if (!supplement) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const v = validateIntakeBody(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  // Idempotent: upsert on (supplementId, date) when taking; deleteMany when untaking.
  if (v.taken) {
    await prisma.supplementIntake.upsert({
      where: { supplementId_date: { supplementId: supplement.id, date: v.date } },
      create: { supplementId: supplement.id, patientId: patient.id, date: v.date },
      update: {},
    });
  } else {
    await prisma.supplementIntake.deleteMany({
      where: { supplementId: supplement.id, date: v.date },
    });
  }
  return NextResponse.json({ ok: true, taken: v.taken });
}
