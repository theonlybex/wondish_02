import { InputHTMLAttributes, forwardRef } from "react";
import { twMerge } from "tailwind-merge";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className, id, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={id} className="text-sm font-medium text-[#25293C]">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={id}
          className={twMerge(
            "w-full px-3.5 py-2.5 rounded-xl border bg-white text-[#25293C] text-sm placeholder:text-[#A8A4B5] outline-none transition-all",
            error
              ? "border-error focus:ring-2 focus:ring-error/20"
              : "border-[#E8E7EA] focus:border-primary focus:ring-2 focus:ring-primary/20",
            className
          )}
          {...props}
        />
        {error && <p className="text-error text-xs">{error}</p>}
      </div>
    );
  }
);

Input.displayName = "Input";
export default Input;
