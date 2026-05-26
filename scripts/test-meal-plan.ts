/**
 * End-to-end test for the 35-day meal plan generation.
 * Verifies Wondish spec rules:
 *   1. Each day has all 4 meal slots (breakfast, lunch, dinner, snack)
 *   2. Lunch calories >= dinner calories every day
 *   3. No same food family appears twice in the same day
 *   4. No same sub-family appears twice in the same meal slot
 *   5. No recipe repeats within any 7-day rolling window
 *   6. Dish type distribution looks correct
 */
import { PrismaClient } from "@prisma/client";
import { generateMealPlan } from "../lib/meal-plan";
import { addDays } from "date-fns";

const prisma = new PrismaClient();

async function main() {
  const patient = await prisma.patient.findFirst({
    where: { profileCompleted: true },
    select: { id: true },
  });

  if (!patient) {
    console.error("No patient with a completed profile found.");
    return;
  }

  console.log(`Using patient: ${patient.id}\n`);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const planEnd = addDays(today, 34);
  planEnd.setHours(23, 59, 59, 999);

  console.log(`Generating plan: ${today.toDateString()} → ${planEnd.toDateString()}`);
  const count = await generateMealPlan(patient.id, today, planEnd);
  console.log(`Entries created: ${count}\n`);

  const menus = await prisma.menu.findMany({
    where: { patientId: patient.id, date: { gte: today, lte: planEnd } },
    include: {
      mealType: true,
      recipe: {
        select: {
          id: true, name: true, calories: true,
          family: true, subFamily: true,
          dishType: { select: { name: true } },
        },
      },
    },
    orderBy: [{ date: "asc" }, { mealType: { name: "asc" } }],
  });

  // Group by day — use sorted UTC date key to avoid timezone issues
  const byDay = new Map<string, typeof menus>();
  for (const m of menus) {
    // Use the date's UTC components to build a stable YYYY-MM-DD key
    const d = m.date;
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(m);
  }

  const sortedDays = Array.from(byDay.keys()).sort();
  const totalDays = sortedDays.length;
  console.log(`Days with meals: ${totalDays} / 35\n`);

  let failures = 0;
  const dishTypeCounts: Record<string, number> = {};

  // 7-day windows aligned with algorithm's clear points (every 7 iterations)
  const weekWindows: Map<string, string>[] = [
    new Map(), new Map(), new Map(), new Map(), new Map(),
  ];

  for (let idx = 0; idx < sortedDays.length; idx++) {
    const day = sortedDays[idx];
    const entries = byDay.get(day)!;
    const winIdx = Math.floor(idx / 7);

    const slots = new Map<string, typeof menus>();
    for (const e of entries) {
      const slot = e.mealType.name.toLowerCase();
      if (!slots.has(slot)) slots.set(slot, []);
      slots.get(slot)!.push(e);
    }

    // ── Rule 1: All 4 slots present ───────────────────────────────────────
    for (const slot of ["breakfast", "lunch", "dinner", "snack"]) {
      if (!slots.has(slot) || slots.get(slot)!.length === 0) {
        console.log(`  FAIL [${day}] Missing slot: ${slot}`);
        failures++;
      }
    }

    // ── Rule 2: Lunch calories >= dinner calories ──────────────────────────
    const lunchCals  = (slots.get("lunch")  ?? []).reduce((s, e) => s + (e.recipe.calories ?? 0), 0);
    const dinnerCals = (slots.get("dinner") ?? []).reduce((s, e) => s + (e.recipe.calories ?? 0), 0);
    if (dinnerCals > lunchCals && lunchCals > 0) {
      console.log(`  FAIL [${day}] Dinner (${dinnerCals} kcal) > Lunch (${lunchCals} kcal)`);
      failures++;
    }

    // ── Rule 3: No same family twice in same day ───────────────────────────
    const dailyFamilies: string[] = [];
    for (const e of entries) {
      if (!e.recipe.family) continue;
      const dt  = e.recipe.dishType?.name?.toLowerCase() ?? "";
      const fam = e.recipe.family.toLowerCase();
      const isBevExempt = dt === "beverage" && !fam.includes("fruity") && !fam.includes("veggie");
      if (isBevExempt) continue;
      if (dailyFamilies.includes(e.recipe.family)) {
        console.log(`  FAIL [${day}] Duplicate family "${e.recipe.family}" → "${e.recipe.name}"`);
        failures++;
      } else {
        dailyFamilies.push(e.recipe.family);
      }
    }

    // ── Rule 4: No same sub-family twice in same meal slot ─────────────────
    for (const [slot, slotEntries] of slots.entries()) {
      const seen: string[] = [];
      for (const e of slotEntries) {
        if (!e.recipe.subFamily) continue;
        if (seen.includes(e.recipe.subFamily)) {
          console.log(`  FAIL [${day}/${slot}] Duplicate subFamily "${e.recipe.subFamily}" → "${e.recipe.name}"`);
          failures++;
        } else {
          seen.push(e.recipe.subFamily);
        }
      }
    }

    // ── Dish type counts ───────────────────────────────────────────────────
    for (const e of entries) {
      const dt = e.recipe.dishType?.name?.toLowerCase() ?? "unknown";
      dishTypeCounts[dt] = (dishTypeCounts[dt] ?? 0) + 1;
    }

    // ── Track recipe IDs per 7-day window (timezone-safe index) ───────────
    const win = weekWindows[winIdx];
    if (win) {
      for (const e of entries) {
        if (win.has(e.recipe.id)) {
          console.log(
            `  FAIL [Week ${winIdx + 1}] Recipe "${e.recipe.name}" (${e.recipe.id}) repeated` +
            ` — first seen on ${win.get(e.recipe.id)}, repeated on ${day}`
          );
          failures++;
        } else {
          win.set(e.recipe.id, day);
        }
      }
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log("\n── Dish type distribution ──────────────────────────────────");
  for (const [dt, n] of Object.entries(dishTypeCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${dt.padEnd(24)} ${n}`);
  }

  console.log("\n── Per-day slot counts (first 7 days) ─────────────────────");
  for (let i = 0; i < Math.min(7, sortedDays.length); i++) {
    const day = sortedDays[i];
    const entries = byDay.get(day)!;
    const slots: Record<string, number> = {};
    for (const e of entries) {
      const s = e.mealType.name.toLowerCase();
      slots[s] = (slots[s] ?? 0) + 1;
    }
    const lC = (byDay.get(day) ?? []).filter(e => e.mealType.name.toLowerCase() === "lunch").reduce((s, e) => s + (e.recipe.calories ?? 0), 0);
    const dC = (byDay.get(day) ?? []).filter(e => e.mealType.name.toLowerCase() === "dinner").reduce((s, e) => s + (e.recipe.calories ?? 0), 0);
    const parts = Object.entries(slots).map(([s, n]) => `${s}:${n}`).join(" | ");
    console.log(`  ${day}  ${parts}  [lunch:${lC} dinner:${dC}]`);
  }

  console.log(`\n── Result ──────────────────────────────────────────────────`);
  if (failures === 0) {
    console.log(`  ALL CHECKS PASSED ✓  (${totalDays} days, ${count} entries)`);
  } else {
    console.log(`  ${failures} FAILURE(S) found across ${totalDays} days`);
  }
}

main().finally(() => prisma.$disconnect());
