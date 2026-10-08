// Link from a report's Sentry event id to the event (admin feedback page).
// Both parts are validated: the org becomes a hostname, the id a query value.
export function sentryEventUrl(org: string | null | undefined, eventId: string | null | undefined): string | null {
  if (!org || !/^[a-z0-9-]+$/i.test(org)) return null;
  if (!eventId || !/^[a-f0-9-]{6,64}$/i.test(eventId)) return null;
  return `https://${org}.sentry.io/issues/?query=${eventId}`;
}
