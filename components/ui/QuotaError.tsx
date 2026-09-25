/**
 * The one way a spent allowance is shown.
 *
 * Wondish has no paywall: signing in gets you the whole app, and what a free
 * user meets is a per-feature allowance enforced server-side by guardAiSpend
 * (lib/ai-budget.ts). That makes this component the entire upgrade path — the
 * app never blocks a screen, so the only moment it can mention Plus is the
 * moment somebody runs out of something.
 *
 * It was copied per surface, and the copy was incomplete: /meal-plan, the swap
 * modal and /dish-checker each rendered the refusal with an upgrade link, and
 * /pantry's cook-my-day (free: 1 a day) rendered the message alone. A free user
 * hitting their one cook-my-day was told "no" with no way to say yes. One
 * component now, so a new metered feature cannot ship without the offer.
 *
 * `upgrade` comes from the API body, not from the UI's guess: lib/ai-budget.ts
 * sets it only when the premium tier actually has a higher limit, so a beta
 * tester at the premium ceiling is never shown an upsell that would buy them
 * nothing.
 *
 * role="alert" because the refusal arrives after an action the user took and
 * they may not be looking at this corner of the screen (WCAG aria-live-errors).
 */
export default function QuotaError({
  message,
  upgrade,
  className = "",
  tone = "error",
}: {
  message: string;
  /** From the response body. Never inferred — see lib/ai-budget.ts. */
  upgrade: boolean;
  className?: string;
  /**
   * Two surfaces, because /pantry's cook-my-day card is dark: the error red
   * that reads correctly on white does not meet contrast on it. The AFFORDANCE
   * is shared either way — only the palette differs — so a feature cannot end
   * up without the offer just because its card is a different colour.
   */
  tone?: "error" | "onDark";
}) {
  if (!message) return null;
  const onDark = tone === "onDark";
  return (
    <p
      role="alert"
      className={
        onDark
          ? `bg-white/10 border border-white/20 text-white rounded-xl px-4 py-2.5 text-xs ${className}`
          : `text-xs text-error ${className}`
      }
    >
      {message}
      {upgrade && (
        <>
          {" "}
          <a
            href="/pricing"
            className={`underline font-semibold whitespace-nowrap${onDark ? " text-white" : ""}`}
          >
            Upgrade for more →
          </a>
        </>
      )}
    </p>
  );
}
