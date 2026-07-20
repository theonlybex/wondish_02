"use client";

// Today's intake log card (overview bento grid / journey). Fetches
// GET /api/meal-log?date=<today> and renders the four mealType sections of
// MealLogRows plus the day summary (dayTotals vs dayTarget, signed remaining).
// Every mutation applies the SERVER echo (log + dayTotals/dayTarget/remaining)
// — macros are never recomputed client-side — then broadcasts the echo so
// sibling cards (CaloricProfileCard ring) update in one round-trip.

import { useCallback, useEffect, useRef, useState } from "react";
import Badge from "@/components/ui/Badge";
import { ToastContainer, useToast } from "@/components/ui/Toast";
import MealLogRow from "./MealLogRow";
import MealLogModal from "./MealLogModal";
import {
  MEAL_LOG_UPDATED_EVENT,
  MEAL_TYPE_LABELS,
  MEAL_TYPE_ORDER,
  emitMealLogUpdated,
  formatLocalDate,
  groupLogsByMealType,
  newClientRequestId,
  type DayEnvelopeDTO,
  type DayLogResponse,
  type MealLogDTO,
  type MealLogUpdatedDetail,
  type MealType,
  type WriteResponse,
} from "./shared";

function defaultMealTypeForNow(): MealType {
  const h = new Date().getHours();
  if (h < 10) return "breakfast";
  if (h < 15) return "lunch";
  if (h < 21) return "dinner";
  return "snack";
}

export default function DailyLogCard() {
  // Client-local calendar day — the aggregation key for every read and write.
  const [date] = useState(() => formatLocalDate(new Date()));
  const emitterId = useRef<string | null>(null);
  if (emitterId.current === null) emitterId.current = newClientRequestId();

  const [data, setData] = useState<DayLogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<MealLogDTO | null>(null);
  const [modalMealType, setModalMealType] = useState<MealType>("breakfast");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [undoLog, setUndoLog] = useState<MealLogDTO | null>(null);
  const undoTimer = useRef<number | null>(null);
  const { toasts, addToast, dismiss } = useToast();

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const res = await fetch(`/api/meal-log?date=${date}`);
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          setError(json?.error || "Could not load today's log");
          return;
        }
        setData(json as DayLogResponse);
        setError("");
      } catch {
        setError("Network error");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [date]
  );

  useEffect(() => {
    load();
  }, [load]);

  // Refresh silently when another surface (e.g. AddToLogButton on a dish card)
  // logs a meal for this day. Our own writes are skipped via emitterId — they
  // already applied the server echo locally.
  useEffect(() => {
    const onUpdated = (e: Event) => {
      const detail = (e as CustomEvent<MealLogUpdatedDetail>).detail;
      if (!detail || detail.emitterId === emitterId.current || detail.localDate !== date) return;
      load(true);
    };
    window.addEventListener(MEAL_LOG_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(MEAL_LOG_UPDATED_EVENT, onUpdated);
  }, [date, load]);

  useEffect(() => {
    return () => {
      if (undoTimer.current) window.clearTimeout(undoTimer.current);
    };
  }, []);

  const emitEnvelope = (env: DayEnvelopeDTO) =>
    emitMealLogUpdated({ ...env, localDate: date, emitterId: emitterId.current ?? undefined });

  // Insert/replace one row + adopt the server's day envelope. No client math.
  const applyWrite = (res: WriteResponse) => {
    setData((prev) => {
      const logs = (prev?.logs ?? []).filter((l) => l.id !== res.log.id);
      if (res.log.localDate === date && !res.log.deletedAt) logs.push(res.log);
      logs.sort((a, b) => (a.loggedAt < b.loggedAt ? -1 : 1));
      return {
        date,
        logs,
        byMealType: groupLogsByMealType(logs),
        dayTotals: res.dayTotals,
        dayTarget: res.dayTarget,
        remaining: res.remaining,
      };
    });
    emitEnvelope({ dayTotals: res.dayTotals, dayTarget: res.dayTarget, remaining: res.remaining });
  };

  const openCreate = (mealType?: MealType) => {
    setEditing(null);
    setModalMealType(mealType ?? defaultMealTypeForNow());
    setModalOpen(true);
  };

  const openEdit = (log: MealLogDTO) => {
    setEditing(log);
    setModalOpen(true);
  };

  // Soft delete → server tombstone + Undo affordance (PATCH { deletedAt: null }).
  const handleDelete = async (log: MealLogDTO) => {
    setBusyId(log.id);
    try {
      const res = await fetch(`/api/meal-log/${log.id}`, { method: "DELETE" });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        addToast(json?.error || "Could not delete this meal.", "error");
        return;
      }
      setData((prev) => {
        if (!prev) return prev;
        const logs = prev.logs.filter((l) => l.id !== log.id);
        return {
          ...prev,
          logs,
          byMealType: groupLogsByMealType(logs),
          dayTotals: json.dayTotals,
          dayTarget: json.dayTarget,
          remaining: json.remaining,
        };
      });
      emitEnvelope({ dayTotals: json.dayTotals, dayTarget: json.dayTarget, remaining: json.remaining });
      if (undoTimer.current) window.clearTimeout(undoTimer.current);
      setUndoLog(log);
      undoTimer.current = window.setTimeout(() => setUndoLog(null), 6000);
    } catch {
      addToast("Network error. Please try again.", "error");
    } finally {
      setBusyId(null);
    }
  };

  const handleUndo = async () => {
    const target = undoLog;
    if (!target) return;
    setUndoLog(null);
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    try {
      const res = await fetch(`/api/meal-log/${target.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deletedAt: null }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.log) {
        addToast(json?.error || "Could not restore this meal.", "error");
        return;
      }
      applyWrite(json as WriteResponse);
      addToast(`Restored ${target.name}`, "success");
    } catch {
      addToast("Network error. Please try again.", "error");
    }
  };

  const overBudget = (data?.remaining?.calories ?? 0) < 0;
  const barPct =
    data?.dayTarget && data.dayTarget.calories > 0
      ? Math.min(100, (data.dayTotals.calories / data.dayTarget.calories) * 100)
      : 0;

  return (
    <div className="bg-white h-full flex flex-col">
      {/* Header — dashboard card idiom */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#F5F1DD] flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-1 h-4 rounded-full" style={{ background: "#812549" }} />
          <h3 className="text-[#1E1A1A] text-sm font-bold">Today&apos;s Log</h3>
        </div>
        <button
          type="button"
          onClick={() => openCreate()}
          className="text-[9px] tracking-[0.2em] uppercase font-bold transition-colors cursor-pointer hover:opacity-70"
          style={{ color: "#812549" }}
        >
          + Add Meal
        </button>
      </div>

      <div className="px-5 py-4 flex-1 overflow-auto">
        {loading && (
          <div className="animate-pulse flex flex-col gap-3" aria-hidden="true">
            <div className="h-8 w-32 bg-gray-200 rounded" />
            <div className="h-1.5 bg-gray-100 rounded-full" />
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-10 bg-gray-100 rounded-xl" />
            ))}
          </div>
        )}

        {!loading && error && (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-[#848181]">{error}</p>
            <button
              type="button"
              onClick={() => load()}
              className="text-xs font-bold text-primary hover:text-primary-dark transition-colors cursor-pointer"
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !error && data && (
          <>
            {/* Day summary — server envelope only */}
            <div className="mb-3">
              <div className="flex items-baseline justify-between gap-2">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-bold text-[#1E1A1A] tabular-nums">
                    {Math.round(data.dayTotals.calories)}
                  </span>
                  <span className="text-xs text-[#848181] tabular-nums">
                    / {data.dayTarget ? `${data.dayTarget.calories} kcal` : "— kcal"}
                  </span>
                </div>
                {data.remaining &&
                  (overBudget ? (
                    <span className="text-xs font-bold text-error tabular-nums">
                      {Math.round(Math.abs(data.remaining.calories))} over
                    </span>
                  ) : (
                    <span className="text-xs font-semibold text-[#848181] tabular-nums">
                      {Math.round(data.remaining.calories)} left
                    </span>
                  ))}
              </div>

              <div className="h-1.5 rounded-full bg-[#F5F1DD] mt-2 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${barPct}%`, background: overBudget ? "#EA5455" : "#812549" }}
                />
              </div>

              <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                {(
                  [
                    ["P", data.dayTotals.protein, data.dayTarget?.protein],
                    ["C", data.dayTotals.carbs, data.dayTarget?.carbs],
                    ["F", data.dayTotals.fat, data.dayTarget?.fat],
                  ] as const
                ).map(([label, total, target]) => (
                  <span
                    key={label}
                    className="text-[11px] font-medium text-[#848181] bg-[#F8F7FA] px-2 py-0.5 rounded-full tabular-nums"
                  >
                    <strong className="text-[#1E1A1A]">{label}</strong> {Math.round(total)}
                    {target != null ? `/${Math.round(target)}` : ""}g
                  </span>
                ))}
                {data.dayTarget?.basis === "plan-ramp" && <Badge variant="primary">plan ramp</Badge>}
                {data.dayTotals.incomplete && <Badge variant="warning">Incomplete nutrition</Badge>}
                {!data.dayTarget && <Badge variant="neutral">Complete your profile for targets</Badge>}
              </div>
            </div>

            {/* Undo strip after a soft delete */}
            {undoLog && (
              <div className="flex items-center gap-2 rounded-xl border border-[#EAE4CA] bg-[#F9F7ED] px-3 py-2 mb-3">
                <span className="flex-1 text-xs text-[#4F4A4A] truncate">
                  Removed &ldquo;{undoLog.name}&rdquo;
                </span>
                <button
                  type="button"
                  onClick={handleUndo}
                  className="text-xs font-bold text-primary hover:text-primary-dark transition-colors cursor-pointer"
                >
                  Undo
                </button>
              </div>
            )}

            {/* Four mealType sections */}
            {MEAL_TYPE_ORDER.map((mt) => {
              const rows = data.byMealType[mt] ?? [];
              return (
                <div key={mt} className="mb-1.5">
                  <div className="flex items-center justify-between mt-2">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-[#848181]">
                      {MEAL_TYPE_LABELS[mt]}
                    </p>
                    <button
                      type="button"
                      onClick={() => openCreate(mt)}
                      aria-label={`Add a ${MEAL_TYPE_LABELS[mt].toLowerCase()} entry`}
                      className="text-[10px] font-bold text-[#B75E78] hover:text-primary transition-colors cursor-pointer px-1 py-0.5"
                    >
                      + Add
                    </button>
                  </div>
                  {rows.length > 0 ? (
                    rows.map((log) => (
                      <MealLogRow
                        key={log.id}
                        log={log}
                        onEdit={openEdit}
                        onDelete={handleDelete}
                        disabled={busyId === log.id}
                      />
                    ))
                  ) : (
                    <p className="text-[11px] text-[#CCC6C6] py-1.5">Nothing logged</p>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>

      <MealLogModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        localDate={date}
        initial={editing}
        defaultMealType={modalMealType}
        onSaved={(res, mode) => {
          applyWrite(res);
          addToast(mode === "created" ? `Logged ${res.log.name}` : "Meal updated", "success");
        }}
      />
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
