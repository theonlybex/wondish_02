import { SelectHTMLAttributes, forwardRef } from "react";
import { twMerge } from "tailwind-merge";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: { value: string; label: string }[];
  placeholder?: string;
}

// Same defect as components/ui/Input.tsx had, in the sibling: `htmlFor={id}`
// with no caller passing `id`, so every select shipped with a floating label
// and no name. A QA pass found three on /profile — "Sex at Birth", "Physical
// Activity", and the height-unit toggle with no label at all (2026-09-24).
// Derived from the label to stay a pure component; see Input.tsx.
const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, placeholder, className, id, name, ...props }, ref) => {
    const fieldId = id ?? (label ? `field-${slugify(label)}` : undefined);
    const errorId = error && fieldId ? `${fieldId}-error` : undefined;
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={fieldId} className="text-sm font-medium text-[#1E1A1A]">
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={fieldId}
          name={name ?? fieldId}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          aria-label={!label && placeholder ? placeholder : undefined}
          className={twMerge(
            // min-h-[44px]: py-2.5 on 14px text renders 42px, and a QA hit-test
            // measured all three /profile selects at exactly that. Two pixels
            // under the floor is still under the floor, and a select is one of
            // the hardest controls to hit — it opens a picker, so a miss costs
            // the user a scroll position as well as a tap.
            "w-full min-h-[44px] px-3.5 py-2.5 rounded-xl border bg-white text-[#1E1A1A] text-sm outline-none transition-all appearance-none",
            error
              ? "border-error focus:ring-2 focus:ring-error/20"
              : "border-[#EAE4CA] focus:border-primary focus:ring-2 focus:ring-primary/20",
            className
          )}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {error && <p id={errorId} className="text-error text-xs">{error}</p>}
      </div>
    );
  }
);

Select.displayName = "Select";
export default Select;
