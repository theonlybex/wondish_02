// Pure-ish event dispatch: every event is reduced to "which account, which
// subscription id", and the actual row write is syncStripeSubscription,
// which re-retrieves the subscription through the pinned SDK. Nothing here
// reads current_period_end / status / invoice.subscription off the payload
// — those fields move between Stripe API versions and the payload follows
// the dashboard's version, not ours.
export interface WebhookDeps {
  sync: (accountId: string, subscriptionId: string) => Promise<{ count: number }>;
  retrieveInvoiceSubscription: (invoiceId: string) => Promise<{ subscriptionId: string | null; accountId: string | null }>;
}

export type EventLike = { type: string; data: { object: Record<string, unknown> } };

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

export async function handleStripeEvent(event: EventLike, deps: WebhookDeps): Promise<"synced" | "skipped" | "ignored"> {
  const obj = event.data.object;
  const meta = (obj.metadata ?? {}) as Record<string, unknown>;

  switch (event.type) {
    case "checkout.session.completed": {
      const accountId = str(meta.accountId);
      const subscriptionId = str(obj.subscription);
      if (!accountId || !subscriptionId) return "skipped";
      await deps.sync(accountId, subscriptionId);
      return "synced";
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const accountId = str(meta.accountId);
      const subscriptionId = str(obj.id);
      if (!accountId || !subscriptionId) return "skipped";
      await deps.sync(accountId, subscriptionId);
      return "synced";
    }
    case "invoice.payment_succeeded":
    case "invoice.payment_failed":
    case "invoice.paid": {
      const invoiceId = str(obj.id);
      if (!invoiceId) return "skipped";
      const { subscriptionId, accountId } = await deps.retrieveInvoiceSubscription(invoiceId);
      if (!subscriptionId || !accountId) return "skipped";
      await deps.sync(accountId, subscriptionId);
      return "synced";
    }
    default:
      return "ignored";
  }
}
