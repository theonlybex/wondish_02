// Phase 2 — one dish on a consumer restaurant menu, carrying its diet verdict.
//
// Presentation rules (pinned in lib/restaurant-menu-view.ts, unit-tested):
//   - A failing dish is muted AND badged AND given the reason in words. Colour
//     alone is not a signal — it fails WCAG, and it tells an allergic diner
//     nothing about WHY the dish is out.
//   - "unknown" (signed out, or no diet profile) says exactly that. It never
//     borrows the language of a pass.
import Badge from "@/components/ui/Badge";
import {
  dishVerdictState,
  describeViolation,
  summarizeViolations,
} from "@/lib/restaurant-menu-view";
import type { DishDTO } from "@/lib/restaurants";

export default function MenuDishCard({ dish }: { dish: DishDTO }) {
  const state = dishVerdictState(dish.verdict);
  const violations = dish.verdict?.violations ?? [];
  const reason = summarizeViolations(violations);
  const doesntFit = state === "doesntFit";

  return (
    <article
      className={`rounded-2xl border bg-white p-4 sm:p-5 transition-colors ${
        doesntFit ? "border-[#EDEAE0]" : "border-[#EAE4CA]"
      } ${dish.isRecommended && !doesntFit ? "ring-2 ring-primary/25" : ""}`}
    >
      <div className={doesntFit ? "opacity-60" : ""}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-bold text-[#1E1A1A] leading-snug">{dish.name}</h3>
            {dish.description && (
              <p className="text-sm mt-1 leading-relaxed" style={{ color: "#848181" }}>
                {dish.description}
              </p>
            )}
          </div>
          {dish.price && (
            <span className="text-sm font-semibold text-[#1E1A1A] whitespace-nowrap tabular-nums">
              {dish.price}
            </span>
          )}
        </div>

        {dish.ingredients.length > 0 && (
          <p className="text-xs mt-2.5 leading-relaxed" style={{ color: "#ABA6A6" }}>
            <span className="font-semibold uppercase tracking-wider text-[10px]">Ingredients</span>{" "}
            {dish.ingredients.join(", ")}
          </p>
        )}

        {dish.calories != null && (
          <p className="text-xs mt-2 tabular-nums" style={{ color: "#848181" }}>
            {dish.calories} kcal
            {dish.protein != null && ` · ${dish.protein}g protein`}
            {dish.carbs != null && ` · ${dish.carbs}g carbs`}
            {dish.fat != null && ` · ${dish.fat}g fat`}
          </p>
        )}
      </div>

      {/* Verdict sits OUTSIDE the muted wrapper: the reason a dish is refused
          must stay at full contrast even when the dish itself is dimmed. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {dish.isRecommended && !doesntFit && <Badge variant="primary">Wondish pick</Badge>}

        {state === "fits" && <Badge variant="success">Fits your plan</Badge>}

        {doesntFit && <Badge variant="error">{reason ?? "Doesn’t fit your plan"}</Badge>}

        {state === "unknown" && <Badge variant="neutral">Sign in to check</Badge>}
      </div>

      {/* More than one reason: list them all without hiding any behind JS. */}
      {doesntFit && violations.length > 1 && (
        <details className="mt-2">
          <summary className="text-xs font-semibold text-primary cursor-pointer py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded">
            Why this doesn&rsquo;t fit ({violations.length})
          </summary>
          <ul className="mt-1.5 space-y-1">
            {violations.map((v, i) => (
              <li key={`${v.ingredient}-${v.term}-${i}`} className="text-xs text-[#5C5757]">
                {describeViolation(v)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}
