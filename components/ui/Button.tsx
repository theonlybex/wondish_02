import { ButtonHTMLAttributes, forwardRef } from "react";
import { twMerge } from "tailwind-merge";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}

const variants = {
  primary: "bg-primary hover:bg-primary-dark text-white shadow-sm shadow-primary/30",
  secondary: "bg-[#F3F2FF] hover:bg-[#EAE8FF] text-primary",
  ghost: "bg-transparent hover:bg-white/[0.06] text-white/70 hover:text-white",
  danger: "bg-error/10 hover:bg-error/20 text-error",
};

const sizes = {
  // min-h-11 (44px) wherever the pointer is a FINGER. QA measured "New week" at
  // 84x28 and /overview's four "+ Add" buttons at 37x19 — under the minimum a
  // finger can reliably hit. A mouse does not need it, and growing every small
  // button everywhere would redesign five screens.
  //
  // This was `sm:min-h-0`, which asks about WIDTH. A phone in landscape is
  // 844px wide holding the same finger, so the floor switched off exactly when
  // the screen got shorter and the buttons got no easier to hit: QA measured
  // "Generate a new week" back at 780x28 there. `(pointer: coarse)` asks the
  // question that actually matters.
  sm: "px-3 py-1.5 text-xs rounded-lg [@media(pointer:coarse)]:min-h-11",
  md: "px-4 py-2 text-sm rounded-xl [@media(pointer:coarse)]:min-h-11",
  lg: "px-6 py-3 text-sm rounded-xl",
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      loading,
      disabled,
      children,
      className,
      onClick,
      ...props
    },
    ref
  ) => {
    // LOADING is not DISABLED. A natively disabled button leaves the tab order,
    // and a generation holds it there for about a minute (QA cycle 17 measured
    // 58s and 64s): a keyboard user could neither reach the button nor hear
    // what it was doing. While loading it stays focusable, says it is busy,
    // and swallows activation — including the synthetic click a form's
    // Enter-to-submit sends, so a second submit cannot slip through.
    const busy = Boolean(loading) && !disabled;
    return (
      <button
        {...props}
        ref={ref}
        disabled={disabled}
        aria-disabled={busy || (props["aria-disabled"] as boolean | undefined) || undefined}
        aria-busy={busy || undefined}
        onClick={(e) => {
          if (busy) {
            e.preventDefault();
            return;
          }
          onClick?.(e);
        }}
        className={twMerge(
          "inline-flex items-center justify-center gap-2 font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed aria-busy:opacity-70 aria-busy:cursor-progress",
          variants[variant],
          sizes[size],
          className
        )}
      >
        {loading && (
          <svg
            aria-hidden="true"
            className="animate-spin h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v8H4z"
            />
          </svg>
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
export default Button;
