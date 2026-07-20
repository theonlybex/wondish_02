"use client";

// Universal one-tap "add to today's log" component. Given a prepared payload
// (RECIPE from DishCard today; PICTURE / FRIDGE result cards later), it:
//   1. derives localDate from the browser clock (formatLocalDate — never UTC),
//   2. attaches a fresh clientRequestId (idempotent server upsert),
//   3. POSTs /api/meal-log, fires a Toast,
//   4. broadcasts the SERVER echo (dayTotals/dayTarget/remaining) so the
//      ring/log cards update without recomputing macros client-side.

import { useEffect, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import { ToastContainer, useToast } from "@/components/ui/Toast";
import ServingsStepper from "./ServingsStepper";
import {
  emitMealLogUpdated,
  formatLocalDate,
  newClientRequestId,
  type MealType,
  type WriteResponse,
} from "./shared";

export interface AddToLogPayload {
  mealType: MealType;
  source: "RECIPE" | "MANUAL" | "PICTURE" | "FRIDGE" | "CUSTOM";
  name?: string;
  recipeId?: string;
  customIngredientId?: string;
  journalMealId?: string;
  pictureResultId?: string;
  fridgeRecipeId?: string;
  note?: string;
  perServing?: {
    calories?: number;
    protein?: number;
    carbs?: number;
    fat?: number;
    fiber?: number;
  };
}

interface AddToLogButtonProps {
  payload: AddToLogPayload;
  label?: string;
  withServingsStepper?: boolean;
  defaultServings?: number;
  size?: "sm" | "md";
  className?: string;
  onLogged?: (res: WriteResponse) => void;
}

export default function AddToLogButton({
  payload,
  label = "Add to log",
  withServingsStepper = false,
  defaultServings = 1,
  size = "sm",
  className,
  onLogged,
}: AddToLogButtonProps) {
  const [servings, setServings] = useState(defaultServings);
  const [loading, setLoading] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  const resetTimer = useRef<number | null>(null);
  const { toasts, addToast, dismiss } = useToast();

  useEffect(() => {
    return () => {
      if (resetTimer.current) window.clearTimeout(resetTimer.current);
    };
  }, []);

  async function add() {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/meal-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          servings,
          localDate: formatLocalDate(new Date()),
          clientRequestId: newClientRequestId(),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.log) {
        addToast(data?.error || "Could not log this meal. Please try again.", "error");
        return;
      }
      const echo = data as WriteResponse;
      addToast(`Logged ${echo.log.name}`, "success");
      emitMealLogUpdated({
        localDate: echo.log.localDate,
        dayTotals: echo.dayTotals,
        dayTarget: echo.dayTarget,
        remaining: echo.remaining,
      });
      onLogged?.(echo);
      setJustAdded(true);
      if (resetTimer.current) window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => setJustAdded(false), 2200);
    } catch {
      addToast("Network error. Please try again.", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      {withServingsStepper && (
        <ServingsStepper value={servings} onChange={setServings} disabled={loading} size={size} />
      )}
      <Button size={size} loading={loading} onClick={add} className="flex-1">
        {justAdded ? "Added ✓" : label}
      </Button>
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
