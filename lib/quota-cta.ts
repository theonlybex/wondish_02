// Where a quota refusal's link goes. Usually the upgrade; but a member who is
// on the free allowance only because their Plus payment failed already chose
// Plus — sending them to /pricing would try to sell it twice. They need the
// card update (lib/ai-budget.ts quotaExceededBody sets `lapsed`).
export type QuotaCta = { href: string; label: string } | null;

export function quotaCta(data: unknown): QuotaCta {
  const d = data as { code?: unknown; upgrade?: unknown; lapsed?: unknown } | null;
  if (d?.code !== "quota" || d.upgrade !== true) return null;
  return d.lapsed === "past_due"
    ? { href: "/membership", label: "Update your card →" }
    : { href: "/pricing", label: "Upgrade for more →" };
}
