import { SelectHTMLAttributes, forwardRef } from "react";
import { twMerge } from "tailwind-merge";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: { value: string; label: string }[];
  placeholder?: string;
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, placeholder, className, id, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={id} className="text-sm font-medium text-[#25293C]">
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={id}
          className={twMerge(
            "w-full px-3.5 py-2.5 rounded-xl border bg-white text-[#25293C] text-sm outline-none transition-all appearance-none",
            error
              ? "border-error focus:ring-2 focus:ring-error/20"
              : "border-[#E8E7EA] focus:border-primary focus:ring-2 focus:ring-primary/20",
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
        {error && <p className="text-error text-xs">{error}</p>}
      </div>
    );
  }
);

Select.displayName = "Select";
export default Select;
