// Phase 6a M1 — invite lifecycle, pure part
// (docs/restaurants/phase-6a-restaurant-admin-design.md §4). Acceptance
// rules live here (unit-tested); the routes stay thin Prisma/Clerk glue.

export const INVITE_TTL_DAYS = 30;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function inviteExpiresAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + INVITE_TTL_DAYS * 86400000);
}

export function isInviteExpired(createdAt: Date, now: Date): boolean {
  return now.getTime() >= inviteExpiresAt(createdAt).getTime();
}

export interface InviteLike {
  status: string;
  email: string;
  createdAt: Date;
}

// Phase 6a §4D — ops direct staff assignment, decision rules. Mirrors
// accept-invite's tier semantics: assignments only ever raise the tier,
// never demote. "invite" means no account exists for the email, so the
// caller falls back to the invite flow.
export type DirectAssignPlan =
  | { action: "invite" }
  | { action: "assign" }
  | { action: "promote" }
  | { action: "already"; error: string };

const DIRECT_ASSIGN_RANK: Record<"OWNER" | "MANAGER", number> = { MANAGER: 0, OWNER: 1 };

export function planDirectAssign(args: {
  accountExists: boolean;
  existingRole: "OWNER" | "MANAGER" | null;
  requestedRole: "OWNER" | "MANAGER";
}): DirectAssignPlan {
  if (!args.accountExists) return { action: "invite" };
  if (args.existingRole === null) return { action: "assign" };
  if (DIRECT_ASSIGN_RANK[args.existingRole] < DIRECT_ASSIGN_RANK[args.requestedRole]) {
    return { action: "promote" };
  }
  return {
    action: "already",
    error: `That email is already ${args.existingRole} of this restaurant`,
  };
}

/// An Account ROW is not a usable account. Rows exist with `clerkId: null`
/// — imported/provisioned shells nobody has ever signed up for. Treating one
/// as "the account exists" makes staff tooling lie twice: a direct assign
/// reports success for someone who cannot sign in, and the invite path skips
/// the Clerk email because it thinks they already have an account, so the
/// invite is never delivered. Only a claimed row means a real person.
export function isClaimedAccount(account: { clerkId: string | null } | null): boolean {
  return account !== null && account.clerkId !== null;
}

/// Invite tiers a direct assignment may resolve: only at or below the
/// assigned role. A higher-tier pending invite outranks the assignment and
/// stays claimable — accepting it later just promotes (promote-only rules).
export function supersedableInviteRoles(
  assignedRole: "OWNER" | "MANAGER"
): ("OWNER" | "MANAGER")[] {
  return assignedRole === "OWNER" ? ["OWNER", "MANAGER"] : ["MANAGER"];
}

/// null when the signed-in user may accept `invite`; otherwise a user-facing
/// error string. Email comparison is case-insensitive; a mismatch names the
/// invited address (the invitee knows it — it's in their inbox) so they can
/// sign in with the right account.
export function validateInviteAcceptance(
  invite: InviteLike,
  signedInEmail: string,
  now: Date
): string | null {
  if (invite.status !== "PENDING") return "This invite is no longer valid";
  if (isInviteExpired(invite.createdAt, now)) {
    return "This invite has expired — ask for a new one";
  }
  if (normalizeEmail(signedInEmail) !== normalizeEmail(invite.email)) {
    return `This invite was sent to ${invite.email} — sign in with that email to accept it`;
  }
  return null;
}
