import { InputHTMLAttributes, forwardRef } from "react";
import { twMerge } from "tailwind-merge";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

// The label was never actually attached to the field. This component has
// rendered `htmlFor={id}` since it was written, and no caller passes `id`, so
// every input in the app — the whole profile form, onboarding, the admin
// screens — shipped with a floating label, no id and no name: a QA pass found
// all 10 controls on /profile reachable only by position, which defeats a
// screen reader and autofill alike (2026-09-24). Deriving the id from the
// label keeps it a pure component (no useId, so server rendering is unchanged)
// and fixes every caller at once.
const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className, id, name, ...props }, ref) => {
    const fieldId = id ?? (label ? `field-${slugify(label)}` : undefined);
    const errorId = error && fieldId ? `${fieldId}-error` : undefined;
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={fieldId} className="text-sm font-medium text-[#1E1A1A]">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={fieldId}
          name={name ?? fieldId}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          aria-label={!label && typeof props.placeholder === "string" ? props.placeholder : undefined}
          className={twMerge(
            // Same 44px floor as the sibling Select: these two render the same
            // padding and sit in the same forms, so they have to be the same
            // height or the form looks assembled from parts.
            "w-full min-h-[44px] px-3.5 py-2.5 rounded-xl border bg-white text-[#1E1A1A] text-sm placeholder:text-[#A8A4B5] outline-none transition-all",
            error
              ? "border-error focus:ring-2 focus:ring-error/20"
              : "border-[#EAE4CA] focus:border-primary focus:ring-2 focus:ring-primary/20",
            className
          )}
          {...props}
        />
        {error && <p id={errorId} className="text-error text-xs">{error}</p>}
      </div>
    );
  }
);

Input.displayName = "Input";
export default Input;
