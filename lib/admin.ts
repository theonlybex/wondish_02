import { Session } from "next-auth";

export function requireAdmin(session: Session | null): void {
  if (!session) {
    throw new Error("UNAUTHORIZED");
  }
  if (!session.user.roles?.includes("SUPER")) {
    throw new Error("FORBIDDEN");
  }
}

export function adminErrorResponse(err: unknown) {
  const message = err instanceof Error ? err.message : "Internal error";
  if (message === "UNAUTHORIZED") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (message === "FORBIDDEN") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return Response.json({ error: message }, { status: 500 });
}
