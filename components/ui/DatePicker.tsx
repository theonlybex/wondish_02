"use client";

import { useState, useRef, useEffect } from "react";
import { DayPicker } from "react-day-picker";
import { format } from "date-fns";
import "react-day-picker/dist/style.css";

interface DatePickerProps {
  value?: Date;
  onChange: (date: Date) => void;
  label?: string;
  placeholder?: string;
  disabled?: (date: Date) => boolean;
}

export default function DatePicker({
  value,
  onChange,
  label,
  placeholder = "Pick a date",
  disabled,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div className="flex flex-col gap-1.5 relative" ref={ref}>
      {label && (
        <label className="text-sm font-medium text-[#25293C]">{label}</label>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full px-3.5 py-2.5 rounded-xl border border-[#E8E7EA] bg-white text-sm text-left focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
      >
        {value ? (
          <span className="text-[#25293C]">{format(value, "PPP")}</span>
        ) : (
          <span className="text-[#A8A4B5]">{placeholder}</span>
        )}
      </button>
      {open && (
        <div className="absolute top-full left-0 z-50 mt-1 bg-white border border-[#E8E7EA] rounded-2xl shadow-xl p-2">
          <DayPicker
            mode="single"
            selected={value}
            onSelect={(d) => {
              if (d) {
                onChange(d);
                setOpen(false);
              }
            }}
            disabled={disabled}
          />
        </div>
      )}
    </div>
  );
}
