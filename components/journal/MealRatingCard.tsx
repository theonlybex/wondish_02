"use client";

interface MealRatingCardProps {
  mealType: string;
  recipeName?: string;
  recipeId?: string;
  rating: number;
  skipped: boolean;
  preparation: string;
  onRatingChange: (r: number) => void;
  onSkipToggle: () => void;
  onPreparationChange: (p: string) => void;
}

const PREP_OPTIONS = [
  { value: "cooked", label: "Cooked at home" },
  { value: "ready-to-eat", label: "Ready-to-eat" },
  { value: "restaurant", label: "Restaurant" },
  { value: "skipped", label: "Skipped" },
];

export default function MealRatingCard({
  mealType,
  recipeName,
  rating,
  skipped,
  preparation,
  onRatingChange,
  onSkipToggle,
  onPreparationChange,
}: MealRatingCardProps) {
  return (
    <div
      className={`bg-white border rounded-2xl p-5 transition-opacity ${
        skipped ? "opacity-60 border-[#E8E7EA]" : "border-[#E8E7EA]"
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-xs font-semibold text-[#8A8D93] uppercase tracking-wide">
            {mealType}
          </p>
          {recipeName && (
            <p className="font-medium text-navy mt-0.5">{recipeName}</p>
          )}
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={skipped}
            onChange={onSkipToggle}
            className="accent-error w-4 h-4"
          />
          <span className="text-xs text-[#8A8D93]">Skip</span>
        </label>
      </div>

      {!skipped && (
        <>
          {/* Star rating */}
          <div className="flex gap-1 mb-3">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                onClick={() => onRatingChange(star)}
                className={`text-xl transition-colors ${
                  star <= rating ? "text-warning" : "text-[#E8E7EA]"
                }`}
              >
                ★
              </button>
            ))}
          </div>

          {/* Preparation */}
          <select
            value={preparation}
            onChange={(e) => onPreparationChange(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-[#E8E7EA] text-sm text-[#25293C] bg-white outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            <option value="">Select preparation…</option>
            {PREP_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </>
      )}
    </div>
  );
}
