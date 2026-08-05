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
