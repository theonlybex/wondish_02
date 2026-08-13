// Phase 2 — the non-dismissible safety disclaimer required on every verdict
// surface (docs/restaurants/coherence.md #4). Wondish makes allergy-relevant
// claims about food it did not cook, from an ingredient list it did not write,
// so the verdict is a decision aid and must never read as a guarantee.
// Deliberately not collapsible and not a toast: it stays on screen with the
// verdicts it qualifies.
export default function SafetyNote() {
  return (
    <aside
      role="note"
      className="rounded-2xl border border-warning/30 bg-warning/[0.07] px-4 py-3 sm:px-5 sm:py-3.5"
    >
      <p className="text-sm leading-relaxed text-[#1E1A1A]">
        <span className="font-semibold">Always confirm with the restaurant.</span>{" "}
        <span className="text-[#5C5757]">
          Wondish checks each dish against the ingredients the restaurant gave us — it&rsquo;s a
          guide, not a guarantee. Recipes change and kitchens share equipment. If you have a severe
          allergy, tell your server before ordering.
        </span>
      </p>
    </aside>
  );
}
