// Phase 6a M4 — activity screen + freshness nudge, pure
// (docs/restaurants/phase-6a-restaurant-admin-design.md §5.7, §7).
// RestaurantAuditLog rows become human-readable lines ("Maria updated Pad
// Thai: price 17.99 → 18.99" — the actor prefix is the caller's job), and
// the quarterly "verify your menu" rule lives here so the dashboard and any
// later email job agree on when a menu counts as stale.

export interface AuditEntryLike {
  entity: string;
  action: string;
  diff: unknown;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFromTo(v: unknown): v is { from: unknown; to: unknown } {
  return isObj(v) && "from" in v && "to" in v;
}

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v)) return `${v.length} items`;
  return String(v);
}

function fieldChanges(diff: Record<string, unknown>): string[] {
  const parts: string[] = [];
  for (const [field, change] of Object.entries(diff)) {
    if (field === "ingredients" || field === "staged") continue; // summarized separately
    if (!isFromTo(change)) continue;
    parts.push(`${field}: ${renderValue(change.from)} → ${renderValue(change.to)}`);
  }
  return parts;
}

const quoted = (name: string | null) => (name ? `"${name}"` : "a dish");

// One audit row → one line. `subjectName` is the dish name resolved from
// entityId (null when the row isn't about a dish or the dish is gone).
export function formatAuditEntry(entry: AuditEntryLike, subjectName: string | null): string {
  const diff = isObj(entry.diff) ? entry.diff : {};
  const subject = quoted(subjectName ?? (typeof diff.name === "string" ? diff.name : null));

  if (entry.entity === "dish" || entry.entity === "ingredients") {
    switch (entry.action) {
      case "create": {
        const name = typeof diff.name === "string" ? `"${diff.name}"` : subject;
        return typeof diff.section === "string" ? `added ${name} to ${diff.section}` : `added ${name}`;
      }
      case "update": {
        if (entry.entity === "ingredients" && isFromTo(diff.ingredients)) {
          const { from, to } = diff.ingredients;
          const counts =
            Array.isArray(from) && Array.isArray(to) ? ` (${from.length} → ${to.length} items)` : "";
          return `updated ingredients of ${subject}${counts}`;
        }
        const changes = fieldChanges(diff);
        return changes.length ? `updated ${subject} — ${changes.join(", ")}` : `updated ${subject}`;
      }
      case "stage":
        return `submitted changes to ${subject} for review`;
      case "submit":
        return `submitted ${subject} for publishing`;
      case "unpublish":
        return `unpublished ${subject}`;
      case "delete":
        return `removed ${subject}`;
      case "approve":
        return diff.kind === "PUBLISH"
          ? `approved ${subject} for publishing`
          : `approved changes to ${subject}`;
      case "reject": {
        const note = typeof diff.note === "string" && diff.note ? ` — "${diff.note}"` : "";
        return diff.kind === "PUBLISH"
          ? `rejected ${subject}${note}`
          : `rejected changes to ${subject}${note}`;
      }
      case "map_request":
        return typeof diff.name === "string"
          ? `linked "${diff.name}" to the ingredient catalog`
          : "linked an ingredient to the catalog";
      case "reject_request":
        return typeof diff.name === "string"
          ? `declined catalog request for "${diff.name}"`
          : "declined a catalog request";
      default:
        break;
    }
  }

  if (entry.entity === "restaurant") {
    if (entry.action === "update") {
      const fields = Object.keys(diff).filter((k) => isFromTo(diff[k]));
      return fields.length
        ? `updated restaurant profile — ${fields.join(", ")}`
        : "updated restaurant profile";
    }
    if (entry.action === "verify") return "confirmed the menu is current";
  }

  if (entry.entity === "invite") {
    if (entry.action === "create") {
      const email = typeof diff.email === "string" ? diff.email : "someone";
      const role = typeof diff.role === "string" ? diff.role.toLowerCase() : "staff";
      return `invited ${email} as ${role}`;
    }
    if (entry.action === "revoke") return "revoked an invite";
    if (entry.action === "accept") return "joined the team";
  }

  if (entry.entity === "staff" && entry.action === "remove") return "removed a staff member";

  return `${entry.action} ${entry.entity}`;
}

// Quarterly freshness (design §7): a menu with live dishes should be
// re-verified every ~90 days; an empty menu has nothing to verify.
export const VERIFY_NUDGE_DAYS = 90;

export function needsVerifyNudge(
  lastVerifiedAt: Date | null,
  publishedCount: number,
  now: Date
): boolean {
  if (publishedCount === 0) return false;
  if (!lastVerifiedAt) return true;
  const ageDays = (now.getTime() - lastVerifiedAt.getTime()) / (24 * 60 * 60 * 1000);
  return ageDays > VERIFY_NUDGE_DAYS;
}
