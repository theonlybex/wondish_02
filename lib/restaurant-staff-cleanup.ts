// Deleting a restaurant cascades its RestaurantStaff rows away (onDelete:
// Cascade), which bypasses removeStaffMember's last-restaurant role cleanup.
// Without this, an account whose only restaurant was deleted keeps the global
// RESTAURANT_ADMIN role and gets routed to a portal it can never enter.
//
// Pure so the decision is testable without a database: given the accounts that
// staffed the deleted restaurant and a groupBy of the staff rows they have
// LEFT, say which ones now hold no restaurant at all.

export function orphanedStaffAccountIds(
  staffedAccountIds: string[],
  remaining: Array<{ accountId: string; count: number }>
): string[] {
  const stillStaffing = new Set(
    remaining.filter((r) => r.count > 0).map((r) => r.accountId)
  );
  return Array.from(new Set(staffedAccountIds)).filter((id) => !stillStaffing.has(id));
}
