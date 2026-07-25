import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseLocalDateStrict } from "@/lib/journal";
import { validateSupplementBody } from "@/lib/supplements";

const SLOT_ORDER: Record<string, number> = { MORNING: 0, AFTERNOON: 1, EVENING: 2 };

async function resolvePatient(userId: string) {
  return prisma.patient.findFirst({ where: { account: { clerkId: userId } } });
}

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const patient = await resolvePatient(userId);
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const dateParam = req.nextUrl.searchParams.get("date");
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

  const rows = await prisma.supplement.findMany({
    where: { patientId: patient.id, deletedAt: null },
    include: { intakes: { where: { date: { gte: date, lte: dateEnd } }, select: { id: true } } },
    orderBy: { createdAt: "asc" },
  });

  const supplements = rows
    .map((s) => ({
      id: s.id,
      name: s.name,
      dosage: s.dosage,
      timeSlot: s.timeSlot,
      takenToday: s.intakes.length > 0,
    }))
    .sort((a, b) => (SLOT_ORDER[a.timeSlot] ?? 9) - (SLOT_ORDER[b.timeSlot] ?? 9));

  return NextResponse.json({ supplements });
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const patient = await resolvePatient(userId);
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const v = validateSupplementBody(body, { partial: false });
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const created = await prisma.supplement.create({
    data: { patientId: patient.id, name: v.name!, dosage: v.dosage ?? null, timeSlot: v.timeSlot! },
  });
  return NextResponse.json(
    { supplement: { id: created.id, name: created.name, dosage: created.dosage, timeSlot: created.timeSlot, takenToday: false } },
    { status: 201 },
  );
}
