import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";

export async function requireAdmin() {
  const { userId } = await auth();
  if (!userId) throw new Error("UNAUTHORIZED");

  const account = await prisma.account.findUnique({
    where: { clerkId: userId },
    include: { roles: { include: { role: true } } },
  });
  if (!account) throw new Error("UNAUTHORIZED");

  const isAdmin = account.roles.some((r) => r.role.name === "SUPER");
  if (!isAdmin) throw new Error("FORBIDDEN");

  return account;
}

export function adminErrorResponse(err: unknown) {
  const message = err instanceof Error ? err.message : "Internal error";
  if (message === "UNAUTHORIZED") return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (message === "FORBIDDEN") return Response.json({ error: "Forbidden" }, { status: 403 });
  return Response.json({ error: message }, { status: 500 });
}
