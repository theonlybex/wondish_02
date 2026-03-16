import { auth, currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";

export async function getAccount() {
  const { userId } = await auth();
  if (!userId) return null;
  return prisma.account.findUnique({
    where: { clerkId: userId },
    include: { subscription: true, roles: { include: { role: true } } },
  });
}

export async function getOrCreateAccount() {
  const { userId } = await auth();
  if (!userId) return null;

  const existing = await prisma.account.findUnique({ where: { clerkId: userId } });
  if (existing) return existing;

  const clerkUser = await currentUser();
  if (!clerkUser) return null;

  return prisma.account.create({
    data: {
      clerkId: userId,
      email: clerkUser.emailAddresses[0]?.emailAddress ?? "",
      firstName: clerkUser.firstName ?? "",
      lastName: clerkUser.lastName ?? "",
      agreedTerms: true,
      subscription: { create: { plan: "FREE", status: "ACTIVE" } },
    },
  });
}
