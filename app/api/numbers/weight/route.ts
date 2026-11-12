// POST /api/numbers/weight  { date: "YYYY-MM-DD", weight: <lbs> }
//   ->  { weight: { value, unit } }
// A weigh-in that sets ONLY the day's weight; mood, energy, activity, notes,
// meals and symptoms logged that day stay as they are (unlike POST /api/journal).
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { recordWeighIn, syncPatientWeightFromJournal, validateWeighInBody, weightUnitLabel } from "@/lib/weigh-in";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success } = await rateLimit("numbers-write", userId, 60, 60);
  if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  const patient = await prisma.patient.findFirst({ where: { account: { clerkId: userId } } });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = validateWeighInBody(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error, field: parsed.field }, { status: parsed.status });

  await recordWeighIn(
    {
      findDayEntry: (patientId, gte, lte) =>
        prisma.journalEntry.findFirst({ where: { patientId, date: { gte, lte } }, select: { id: true } }),
      updateWeight: async (id, weight) => {
        await prisma.journalEntry.update({ where: { id }, data: { weight } });
      },
      createEntry: async (patientId, date, weight) => {
        await prisma.journalEntry.create({ data: { patientId, date, weight } });
      },
      syncPatient: () => syncPatientWeightFromJournal(prisma, patient),
    },
    { patientId: patient.id, date: parsed.date, weight: parsed.weight },
  );

  // The sync stores lbs on the patient, so this is what GET /api/numbers will report next.
  return NextResponse.json({ weight: { value: parsed.weight, unit: weightUnitLabel("lbs") } });
}
