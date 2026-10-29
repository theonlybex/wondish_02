import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAccountWithSubscription } from "@/lib/auth";
import { PATIENT_FOOD_MAP_INCLUDE } from "@/lib/food-map";

type Account = NonNullable<Awaited<ReturnType<typeof getAccountWithSubscription>>>;

async function findPatient(accountId: string) {
  return prisma.patient.findFirst({ where: { accountId }, include: PATIENT_FOOD_MAP_INCLUDE });
}

type Patient = Awaited<ReturnType<typeof findPatient>>;

/**
 * Who is calling a /api/clara/* route, resolved from Clerk auth only — no body
 * or tool input ever carries identity. 401 / 404 bodies match dish-checker.
 * `patient` may be null (onboarding unfinished); each route decides what that
 * means (the chat route answers 409 PROFILE_INCOMPLETE).
 */
export async function resolveClaraCaller(): Promise<
  | { ok: true; userId: string; account: Account; patient: Patient | null }
  | { ok: false; response: NextResponse }
> {
  const { userId } = await auth();
  if (!userId) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const account = await getAccountWithSubscription(userId);
  if (!account) {
    return { ok: false, response: NextResponse.json({ error: "Account not found" }, { status: 404 }) };
  }
  const patient = await findPatient(account.id);
  return { ok: true, userId, account, patient };
}
