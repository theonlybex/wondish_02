"use client";

interface Option {
  id: string;
  name: string;
}

interface MultiSelectChipsProps {
  label: string;
  options: Option[];
  selected: string[];
  onChange: (ids: string[]) => void;
}

export default function MultiSelectChips({
  label,
  options,
  selected,
  onChange,
}: MultiSelectChipsProps) {
  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  return (
    <div>
      <p className="text-sm font-medium text-[#25293C] mb-2">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const active = selected.includes(opt.id);
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => toggle(opt.id)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                active
                  ? "bg-primary text-white shadow-sm shadow-primary/30"
                  : "bg-[#F3F2FF] text-[#8A8D93] hover:bg-primary/10 hover:text-primary"
              }`}
            >
              {opt.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
