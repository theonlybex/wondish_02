"use client";

import { useState } from "react";
import { format, startOfWeek, endOfWeek } from "date-fns";
import DatePicker from "@/components/ui/DatePicker";
import Button from "@/components/ui/Button";
import { GroceryItem } from "@/types";

interface GroceryListViewProps {
  initialItems: GroceryItem[];
  initialFrom: Date;
  initialTo: Date;
}

export default function GroceryListView({
  initialItems,
  initialFrom,
  initialTo,
}: GroceryListViewProps) {
  const [items, setItems] = useState(initialItems);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const load = async (f: Date, t: Date) => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/grocery-list?from=${format(f, "yyyy-MM-dd")}&to=${format(t, "yyyy-MM-dd")}`
      );
      const data = await res.json();
      setItems(data.items ?? []);
      setChecked(new Set());
    } finally {
      setLoading(false);
    }
  };

  const toggleChecked = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handlePrint = () => window.print();

  return (
    <div>
      {/* Date range */}
      <div className="flex flex-wrap items-end gap-3 mb-6">
        <DatePicker
          label="From"
          value={from}
          onChange={(d) => setFrom(d)}
        />
        <DatePicker
          label="To"
          value={to}
          onChange={(d) => setTo(d)}
        />
        <Button onClick={() => load(from, to)} loading={loading}>
          Refresh
        </Button>
        <Button variant="secondary" onClick={handlePrint}>
          Print
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-[#8A8D93]">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-[#8A8D93]">
          No ingredients found for this date range.
        </div>
      ) : (
        <div className="bg-white border border-[#E8E7EA] rounded-2xl divide-y divide-[#E8E7EA]">
          {items.map((item) => (
            <label
              key={item.ingredientId}
              className="flex items-center gap-3 px-5 py-3.5 cursor-pointer hover:bg-[#FAFAFA] transition-colors"
            >
              <input
                type="checkbox"
                checked={checked.has(item.ingredientId)}
                onChange={() => toggleChecked(item.ingredientId)}
                className="w-4 h-4 rounded accent-primary"
              />
              <span
                className={`flex-1 text-sm font-medium ${
                  checked.has(item.ingredientId)
                    ? "line-through text-[#B0ADB8]"
                    : "text-navy"
                }`}
              >
                {item.name}
              </span>
              <span className="text-[#8A8D93] text-xs">
                {item.totalQuantity > 0
                  ? `${item.totalQuantity}${item.unit ? ` ${item.unit}` : ""}`
                  : ""}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
