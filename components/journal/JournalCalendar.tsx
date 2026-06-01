"use client";

import { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";

/* ─── Types ─────────────────────────────────────────────────────────────────── */

interface DayEntry {
  mood: string | null;
  weight: number | null;
  energyLevel: string | null;
  activityLevel: string | null;
  notes: string | null;
  dailyCalorieTarget: number | null;
  meals: { mealType: string; recipeName: string; rating: number }[];
}

interface CaloricSnapshot {
  dailyCalories: number;
  tdeeCBW: number;
  cbwKg: number;
  tbwKg: number;
  cbmi: number;
  cbmiClass: string;
  bodyFatPct: number;
}

interface CalendarData {
  planStartDate: string;
  planEndDate: string;
  caloricProfile: CaloricSnapshot | null;
  entries: Record<string, DayEntry>;
}

/* ─── Helpers ───────────────────────────────────────────────────────────────── */

const MOOD_MAP: Record<string, { emoji: string; label: string }> = {
  "1": { emoji: "😞", label: "Bad" },
  "2": { emoji: "😐", label: "Meh" },
  "3": { emoji: "🙂", label: "Good" },
  "4": { emoji: "😄", label: "Great" },
};

const ENERGY_MAP: Record<string, { label: string; bars: number }> = {
  "1": { label: "Very Low", bars: 1 },
  "2": { label: "Low", bars: 2 },
  "3": { label: "Moderate", bars: 3 },
  "4": { label: "High", bars: 4 },
};

const ACTIVITY_MAP: Record<string, { emoji: string; label: string }> = {
  none: { emoji: "🛋️", label: "Rest" },
  light: { emoji: "🚶", label: "Walk" },
  moderate: { emoji: "🏋️", label: "Gym" },
  intense: { emoji: "🏃", label: "Sport" },
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isToday(d: Date): boolean {
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function isFuture(d: Date): boolean {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  return target > now;
}

function monthLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/* ─── Component ─────────────────────────────────────────────────────────────── */

export default function JournalCalendar() {
  const [data, setData] = useState<CalendarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/journal/calendar");
        if (!res.ok) {
          const d = await res.json();
          setError(d.error || "Failed to load calendar");
          return;
        }
        const d = await res.json();
        setData(d);
      } catch {
        setError("Network error");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Build the calendar grid: array of weeks, each week is 7 day-slots
  const calendarWeeks = useMemo(() => {
    if (!data) return [];

    const start = parseLocalDate(data.planStartDate);
    const end = parseLocalDate(data.planEndDate);

    // Extend to full weeks (start at Sunday of the start week)
    const gridStart = new Date(start);
    gridStart.setDate(start.getDate() - start.getDay());

    const gridEnd = new Date(end);
    gridEnd.setDate(end.getDate() + (6 - end.getDay()));

    const weeks: { date: Date; key: string; inRange: boolean }[][] = [];
    let currentWeek: { date: Date; key: string; inRange: boolean }[] = [];
    const cursor = new Date(gridStart);

    while (cursor <= gridEnd) {
      const d = new Date(cursor);
      const key = fmtDate(d);
      const inRange = d >= start && d <= end;
      currentWeek.push({ date: d, key, inRange });

      if (currentWeek.length === 7) {
        weeks.push(currentWeek);
        currentWeek = [];
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    if (currentWeek.length > 0) weeks.push(currentWeek);

    return weeks;
  }, [data]);

  const selectedEntry = selectedDate && data ? data.entries[selectedDate] : null;
  const hasData = (entry: DayEntry) =>
    entry.mood || entry.weight || entry.energyLevel || entry.activityLevel || entry.notes || entry.meals.length > 0;

  /* ─── Loading / Error ──────────────────────────────────────────────────── */

  if (loading) {
    return (
      <div className="mx-auto pb-8" style={{ maxWidth: "1120px" }}>
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-48 bg-[#E2EAE2] rounded" />
          <div className="h-4 w-64 bg-[#F0F4F0] rounded" />
          <div className="flex gap-6 mt-6">
            <div className="flex-1 grid grid-cols-7 gap-1">
              {Array.from({ length: 35 }).map((_, i) => (
                <div key={i} className="aspect-square bg-[#F0F4F0] rounded-lg" />
              ))}
            </div>
            <div className="w-[340px] h-64 bg-[#F0F4F0] rounded-2xl flex-shrink-0 hidden lg:block" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto pb-8" style={{ maxWidth: "1120px" }}>
        <p className="text-sm" style={{ color: "#9EA8A0" }}>
          {error || "No meal plan data available."}
        </p>
      </div>
    );
  }

  /* ─── Month separators ─────────────────────────────────────────────────── */

  // Track which months need headers
  const monthHeaders = new Map<number, string>();
  let lastMonth = -1;
  calendarWeeks.forEach((week, weekIdx) => {
    for (const day of week) {
      if (day.inRange && day.date.getMonth() !== lastMonth) {
        lastMonth = day.date.getMonth();
        monthHeaders.set(weekIdx, monthLabel(day.date));
        break;
      }
    }
  });

  return (
    <div className="mx-auto pb-8" style={{ maxWidth: "1120px" }}>
      {/* Header */}
      <div className="mb-8">
        <p
          className="text-[9px] tracking-[0.28em] uppercase font-mono mb-2"
          style={{ color: "#7DB87D" }}
        >
          {parseLocalDate(data.planStartDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          {" — "}
          {parseLocalDate(data.planEndDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
        </p>
        <h1 className="text-3xl font-bold" style={{ color: "#0d1f10" }}>
          Journal
        </h1>
        <p className="text-xs mt-1.5" style={{ color: "#9EA8A0" }}>
          Tap a day to view your log
        </p>
      </div>

      {/* Two-column layout: calendar left, card right */}
      <div className="flex gap-6 items-start">
        {/* Left — Calendar */}
        <div className="flex-1 min-w-0">
          {/* Day name headers */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {DAY_NAMES.map((d) => (
              <div
                key={d}
                className="text-center text-[10px] font-bold uppercase tracking-wider py-1"
                style={{ color: "#ADBDAD" }}
              >
                {d}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="space-y-0.5">
            {calendarWeeks.map((week, weekIdx) => (
              <div key={weekIdx}>
                {/* Month header */}
                {monthHeaders.has(weekIdx) && (
                  <div className="pt-4 pb-2 first:pt-0">
                    <span
                      className="text-xs font-bold tracking-wide"
                      style={{ color: "#0d1f10" }}
                    >
                      {monthHeaders.get(weekIdx)}
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-7 gap-1">
                  {week.map((day) => {
                    const entry = data.entries[day.key];
                    const hasDayData = entry && hasData(entry);
                    const selected = selectedDate === day.key;
                    const today = isToday(day.date);
                    const future = isFuture(day.date);
                    const clickable = day.inRange && !future;

                    return (
                      <button
                        key={day.key}
                        type="button"
                        disabled={!clickable}
                        onClick={() => clickable && setSelectedDate(selected ? null : day.key)}
                        className="relative aspect-square rounded-lg transition-all duration-200"
                        style={{
                          background: selected
                            ? "#4ade80"
                            : day.inRange
                              ? "#ffffff"
                              : "transparent",
                          border: today && !selected
                            ? "1.5px solid #4ade80"
                            : day.inRange
                              ? "1px solid #F0F4F0"
                              : "1px solid transparent",
                          opacity: !day.inRange ? 0.25 : future ? 0.4 : 1,
                          cursor: clickable ? "pointer" : "default",
                          boxShadow: selected
                            ? "0 2px 8px rgba(74,222,128,0.25)"
                            : "none",
                        }}
                      >
                        {/* Date number */}
                        <span
                          className="absolute top-1 right-1.5 text-[10px] font-medium leading-none"
                          style={{
                            color: selected ? "#ffffff" : "#0d1f10",
                          }}
                        >
                          {day.date.getDate()}
                        </span>

                        {/* Activity dot */}
                        {hasDayData && !selected && (
                          <span
                            className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full"
                            style={{ background: "#4ade80" }}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right — Day detail card (sticky) */}
        <div className="w-[340px] flex-shrink-0 sticky top-4 hidden lg:block">
          <AnimatePresence mode="wait">
            {selectedDate ? (
              <motion.div
                key={selectedDate}
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              >
                <DayDetailCard
                  date={selectedDate}
                  entry={selectedEntry!}
                  caloricProfile={data.caloricProfile}
                />
              </motion.div>
            ) : (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="rounded-2xl px-5 py-10 text-center"
                style={{
                  background: "#ffffff",
                  border: "1px solid #F0F4F0",
                  boxShadow: "0 1px 3px rgba(13,31,16,0.07), 0 0 0 1px rgba(13,31,16,0.04)",
                }}
              >
                <p className="text-xs" style={{ color: "#ADBDAD" }}>
                  Select a day to view details
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Mobile: card below calendar */}
      <div className="lg:hidden">
        <AnimatePresence mode="wait">
          {selectedDate && (
            <motion.div
              key={selectedDate}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="mt-6"
            >
              <DayDetailCard
                date={selectedDate}
                entry={selectedEntry!}
                caloricProfile={data.caloricProfile}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Day Detail Card
   ═══════════════════════════════════════════════════════════════════════════════ */

function DayDetailCard({
  date,
  entry,
  caloricProfile,
}: {
  date: string;
  entry: DayEntry;
  caloricProfile: CaloricSnapshot | null;
}) {
  const d = parseLocalDate(date);
  const dateLabel = d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const hasAny =
    entry.mood || entry.weight || entry.energyLevel || entry.activityLevel || entry.notes || entry.meals.length > 0;

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: "#ffffff",
        border: "1px solid #F0F4F0",
        boxShadow: "0 1px 3px rgba(13,31,16,0.07), 0 0 0 1px rgba(13,31,16,0.04)",
      }}
    >
      {/* Card header */}
      <div
        className="flex items-center justify-between px-5 py-3.5"
        style={{ borderBottom: "1px solid #F0F4F0" }}
      >
        <div className="flex items-center gap-2.5">
          <div className="w-1 h-4 rounded-full" style={{ background: "#4ade80" }} />
          <span className="text-sm font-bold" style={{ color: "#0d1f10" }}>
            {dateLabel}
          </span>
        </div>
        {hasAny && (
          <span
            className="text-[9px] font-bold tracking-[0.18em] uppercase px-2.5 py-1 rounded-full"
            style={{ background: "rgba(74,222,128,0.1)", color: "#4ade80" }}
          >
            Logged
          </span>
        )}
      </div>

      {!hasAny ? (
        /* Empty state */
        <div className="px-5 py-10 text-center">
          <p className="text-sm" style={{ color: "#9EA8A0" }}>
            No entry for this day
          </p>
          <Link
            href="/journal"
            className="inline-block mt-3 text-xs font-bold transition-colors"
            style={{ color: "#4ade80" }}
          >
            Log an entry →
          </Link>
        </div>
      ) : (
        <div className="divide-y" style={{ borderColor: "#F0F4F0" }}>
          {/* 1 — Caloric Profile */}
          {entry.dailyCalorieTarget && (
            <CaloricSection
              dailyTarget={entry.dailyCalorieTarget}
              weight={entry.weight}
              profile={caloricProfile}
            />
          )}

          {/* 2 — Completed Meals */}
          <MealsSection meals={entry.meals} />

          {/* 3 — Daily Journal */}
          <JournalSection
            mood={entry.mood}
            energyLevel={entry.energyLevel}
            activityLevel={entry.activityLevel}
            weight={entry.weight}
            notes={entry.notes}
          />
        </div>
      )}
    </div>
  );
}

/* ─── Caloric Section ────────────────────────────────────────────────────────── */

function CaloricSection({
  dailyTarget,
  weight,
  profile,
}: {
  dailyTarget: number;
  weight: number | null;
  profile: CaloricSnapshot | null;
}) {
  const maxCal = profile?.tdeeCBW ?? dailyTarget;
  const ratio = maxCal > 0 ? Math.min(1, dailyTarget / maxCal) : 1;
  const circumference = 2 * Math.PI * 28;
  const dashOffset = circumference * (1 - ratio);

  return (
    <div className="px-5 py-4">
      <p
        className="text-[9px] font-bold tracking-[0.2em] uppercase mb-3"
        style={{ color: "#ADBDAD" }}
      >
        Caloric Profile
      </p>
      <div className="flex items-center gap-5">
        {/* Mini calorie ring */}
        <div className="relative w-16 h-16 flex-shrink-0">
          <svg viewBox="0 0 64 64" className="w-full h-full -rotate-90">
            <circle cx="32" cy="32" r="28" fill="none" stroke="#F0F0F2" strokeWidth="4" />
            <circle
              cx="32"
              cy="32"
              r="28"
              fill="none"
              stroke="#7DB87D"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-sm font-bold" style={{ color: "#25293C" }}>
              {Math.round(dailyTarget)}
            </span>
            <span className="text-[7px] uppercase tracking-wider" style={{ color: "#9EA8A0" }}>
              kcal
            </span>
          </div>
        </div>

        {/* Metrics */}
        <div className="flex gap-5 text-xs">
          {weight != null && (
            <div>
              <p className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: "#ADBDAD" }}>
                Weight
              </p>
              <p className="font-bold" style={{ color: "#25293C" }}>
                {weight.toFixed(1)} <span style={{ color: "#9EA8A0" }}>kg</span>
              </p>
            </div>
          )}
          {profile?.tbwKg && (
            <div>
              <p className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: "#ADBDAD" }}>
                Target
              </p>
              <p className="font-bold" style={{ color: "#7DB87D" }}>
                {profile.tbwKg.toFixed(1)} <span style={{ color: "#9EA8A0" }}>kg</span>
              </p>
            </div>
          )}
          {profile?.cbmi && (
            <div>
              <p className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: "#ADBDAD" }}>
                BMI
              </p>
              <p className="font-bold" style={{ color: "#25293C" }}>
                {profile.cbmi.toFixed(1)}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Meals Section ──────────────────────────────────────────────────────────── */

function MealsSection({ meals }: { meals: DayEntry["meals"] }) {
  if (meals.length === 0) {
    return (
      <div className="px-5 py-4">
        <p
          className="text-[9px] font-bold tracking-[0.2em] uppercase mb-2"
          style={{ color: "#ADBDAD" }}
        >
          Completed Meals
        </p>
        <p className="text-xs" style={{ color: "#C8D4C8" }}>
          No rated meals this day
        </p>
      </div>
    );
  }

  return (
    <div className="px-5 py-4">
      <p
        className="text-[9px] font-bold tracking-[0.2em] uppercase mb-3"
        style={{ color: "#ADBDAD" }}
      >
        Completed Meals
      </p>
      <div className="space-y-2">
        {meals.map((meal, i) => (
          <div
            key={i}
            className="flex items-center gap-3 px-3 py-2 rounded-lg"
            style={{ background: "#FAFAFA" }}
          >
            {/* Like / Dislike icon */}
            <span
              className="text-sm flex-shrink-0"
              style={{ color: meal.rating > 0 ? "#4ade80" : "#EA5455" }}
            >
              {meal.rating > 0 ? "👍" : "👎"}
            </span>
            <div className="min-w-0 flex-1">
              <p
                className="text-[9px] font-bold uppercase tracking-wide"
                style={{ color: "#ADBDAD" }}
              >
                {meal.mealType}
              </p>
              <p
                className="text-xs font-medium truncate"
                style={{ color: "#25293C" }}
              >
                {meal.recipeName}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Journal Section ────────────────────────────────────────────────────────── */

function JournalSection({
  mood,
  energyLevel,
  activityLevel,
  weight,
  notes,
}: {
  mood: string | null;
  energyLevel: string | null;
  activityLevel: string | null;
  weight: number | null;
  notes: string | null;
}) {
  const hasSomething = mood || energyLevel || activityLevel || weight || notes;
  if (!hasSomething) return null;

  return (
    <div className="px-5 py-4">
      <p
        className="text-[9px] font-bold tracking-[0.2em] uppercase mb-3"
        style={{ color: "#ADBDAD" }}
      >
        Daily Journal
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Mood */}
        {mood && MOOD_MAP[mood] && (
          <MetricChip label="Mood" value={MOOD_MAP[mood].emoji} sub={MOOD_MAP[mood].label} />
        )}

        {/* Energy */}
        {energyLevel && ENERGY_MAP[energyLevel] && (
          <div
            className="rounded-xl px-3 py-2.5"
            style={{ background: "#FAFAFA" }}
          >
            <p className="text-[9px] uppercase tracking-wider mb-1" style={{ color: "#ADBDAD" }}>
              Energy
            </p>
            <div className="flex items-end gap-0.5 mb-0.5">
              {[1, 2, 3, 4].map((bar) => (
                <div
                  key={bar}
                  className="w-1.5 rounded-sm"
                  style={{
                    height: `${bar * 4 + 4}px`,
                    background:
                      bar <= ENERGY_MAP[energyLevel].bars ? "#7DB87D" : "#E2EAE2",
                  }}
                />
              ))}
            </div>
            <p className="text-[10px] font-medium" style={{ color: "#25293C" }}>
              {ENERGY_MAP[energyLevel].label}
            </p>
          </div>
        )}

        {/* Activity */}
        {activityLevel && ACTIVITY_MAP[activityLevel] && (
          <MetricChip
            label="Activity"
            value={ACTIVITY_MAP[activityLevel].emoji}
            sub={ACTIVITY_MAP[activityLevel].label}
          />
        )}

        {/* Weight */}
        {weight != null && (
          <div
            className="rounded-xl px-3 py-2.5"
            style={{ background: "#FAFAFA" }}
          >
            <p className="text-[9px] uppercase tracking-wider mb-1" style={{ color: "#ADBDAD" }}>
              Weight
            </p>
            <p className="text-sm font-bold" style={{ color: "#25293C" }}>
              {weight.toFixed(1)}
              <span className="text-[10px] font-normal ml-0.5" style={{ color: "#9EA8A0" }}>
                kg
              </span>
            </p>
          </div>
        )}
      </div>

      {/* Notes */}
      {notes && (
        <div className="mt-3 px-3 py-2.5 rounded-xl" style={{ background: "#FAFAFA" }}>
          <p className="text-[9px] uppercase tracking-wider mb-1" style={{ color: "#ADBDAD" }}>
            Notes
          </p>
          <p className="text-xs leading-relaxed" style={{ color: "#25293C" }}>
            {notes}
          </p>
        </div>
      )}
    </div>
  );
}

/* ─── Metric Chip ────────────────────────────────────────────────────────────── */

function MetricChip({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl px-3 py-2.5" style={{ background: "#FAFAFA" }}>
      <p className="text-[9px] uppercase tracking-wider mb-1" style={{ color: "#ADBDAD" }}>
        {label}
      </p>
      <p className="text-lg leading-none">{value}</p>
      <p className="text-[10px] font-medium mt-0.5" style={{ color: "#25293C" }}>
        {sub}
      </p>
    </div>
  );
}
