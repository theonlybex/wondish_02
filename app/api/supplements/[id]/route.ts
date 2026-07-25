import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateSupplementBody } from "@/lib/supplements";

/** 404s unless the supplement exists, is live, and belongs to the caller. */
async function resolveOwnedSupplement(userId: string, id: string) {
  const patient = await prisma.patient.findFirst({ where: { account: { clerkId: userId } } });
  if (!patient) return null;
  const supplement = await prisma.supplement.findFirst({
    where: { id, patientId: patient.id, deletedAt: null },
  });
  return supplement ? { patient, supplement } : null;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const owned = await resolveOwnedSupplement(userId, params.id);
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const v = validateSupplementBody(body, { partial: true });
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const updated = await prisma.supplement.update({
    where: { id: owned.supplement.id },
    data: {
      ...(v.name !== undefined ? { name: v.name } : {}),
      ...(v.dosage !== undefined ? { dosage: v.dosage } : {}),
      ...(v.timeSlot !== undefined ? { timeSlot: v.timeSlot } : {}),
    },
  });
  return NextResponse.json({
    supplement: { id: updated.id, name: updated.name, dosage: updated.dosage, timeSlot: updated.timeSlot },
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const owned = await resolveOwnedSupplement(userId, params.id);
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Soft delete: history keeps showing what was actually taken.
  await prisma.supplement.update({ where: { id: owned.supplement.id }, data: { deletedAt: new Date() } });
  return NextResponse.json({ ok: true });
}
