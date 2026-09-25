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
  // min-h-11 (44px) on phones only. QA measured "New week" at 84x28 and
  // /overview's four "+ Add" buttons at 37x19 — under the 44px minimum a finger
  // can reliably hit. The desktop sizes are unchanged: a mouse does not need it,
  // and growing every small button everywhere would redesign five screens.
  sm: "px-3 py-1.5 text-xs rounded-lg min-h-11 sm:min-h-0",
  md: "px-4 py-2 text-sm rounded-xl min-h-11 sm:min-h-0",
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
      ...props
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={twMerge(
          "inline-flex items-center justify-center gap-2 font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed",
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      >
        {loading && (
          <svg
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
