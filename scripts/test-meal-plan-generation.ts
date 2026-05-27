import { prisma } from "@/lib/db";
import { generateMealPlan } from "@/lib/meal-plan";
import { gradualDailyDeficit } from "@/lib/caloric-engine";

async function main() {
  // ── Find Bekzhan's patient via account lookup chain ──────────────────────────
  const account = await prisma.account.findFirst({
    where: {
      OR: [
        { firstName: "Bekzhan" },
        { email: { contains: "bex.abdi" } },
      ],
    },
    select: { id: true, firstName: true, lastName: true, email: true },
  });

  if (!account) {
    console.error("Account not found");
    process.exit(1);
  }
  console.log(`\nAccount: ${account.firstName} ${account.lastName} (${account.email})`);

  const patient = await prisma.patient.findUnique({
    where: { accountId: account.id },
    select: {
      id: true, weight: true, weightUnit: true,
      goalWeight: true, goalWeightUnit: true,
      height: true, heightUnit: true,
      sexAtBirth: true, birthday: true,
      physicalActivity: { select: { level: true } },
    },
  });

  if (!patient) {
    console.error("Patient not found");
    process.exit(1);
  }
  console.log(`Patient ID: ${patient.id}`);
  console.log(`Weight: ${patient.weight} ${patient.weightUnit}, Goal: ${patient.goalWeight} ${patient.goalWeightUnit}`);
  console.log(`Height: ${patient.height} ${patient.heightUnit}, Sex: ${patient.sexAtBirth}`);
  console.log(`Activity level: ${patient.physicalActivity?.level}`);

  // ── Generate fresh plan from today ───────────────────────────────────────────
  const today = new Date();
  const [y, m, d] = [today.getFullYear(), today.getMonth(), today.getDate()];
  const startDate = new Date(y, m, d);

  console.log(`\nGenerating meal plan from ${startDate.toDateString()}...`);
  await prisma.menu.deleteMany({ where: { patientId: patient.id } });
  await prisma.patient.update({ where: { id: patient.id }, data: { mealPlanStartDate: startDate } });

  const count = await generateMealPlan(patient.id, startDate);
  console.log(`Generated ${count} menu entries\n`);

  // ── Audit generated plan ─────────────────────────────────────────────────────
  const menus = await prisma.menu.findMany({
    where: { patientId: patient.id },
    include: {
      recipe: { select: { name: true, calories: true, family: true, subFamily: true, dishType: { select: { name: true } } } },
      mealType: { select: { name: true } },
    },
    orderBy: [{ date: "asc" }, { mealType: { name: "asc" } }],
  });

  // Group by date
  const byDate = new Map<string, typeof menus>();
  for (const menu of menus) {
    const key = menu.date.toISOString().slice(0, 10);
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key)!.push(menu);
  }

  const totalDays = byDate.size;
  console.log(`Plan spans ${totalDays} days\n`);
  console.log("─".repeat(90));
  console.log(`${"Day".padEnd(5)} ${"Date".padEnd(12)} ${"Expected".padEnd(10)} ${"Actual".padEnd(10)} ${"Diff".padEnd(8)} Meals`);
  console.log("─".repeat(90));

  // Estimate TDEE from the first day's expected deficit (we know it from day 1 ~2957 means TDEE ~3000)
  // We'll compute expected from gradualDailyDeficit and show actual from DB
  let dayNum = 0;
  let issues = 0;
  let tdeeEstimate = 0;

  for (const [dateStr, dayMenus] of byDate) {
    dayNum++;
    const actual = dayMenus.reduce((sum, m) => sum + (m.recipe.calories ?? 0), 0);
    const rawDeficit = gradualDailyDeficit(dayNum);

    // For display: compute expected using raw deficit (we don't know exact TDEE here, use 2992 from last session)
    const TDEE = 2992;
    const expected = Math.round(Math.max(TDEE - rawDeficit, 2816)); // 2816 = approx maintenance floor

    const diff = actual - expected;
    const mealCount = dayMenus.length;
    const flag = Math.abs(diff) > 300 ? " ⚠️" : diff > 0 ? " ✅" : "";

    console.log(
      `${String(dayNum).padEnd(5)} ${dateStr.padEnd(12)} ${String(expected).padEnd(10)} ${String(actual).padEnd(10)} ${String(diff).padEnd(8)}${mealCount} meals${flag}`
    );

    if (dayNum <= 3) tdeeEstimate = actual;
  }

  console.log("─".repeat(90));

  // ── Per-week summary ─────────────────────────────────────────────────────────
  console.log("\n── Per-week averages ────────────────────────────────────────────────────────");
  const dates = Array.from(byDate.keys());
  const weeks = Math.ceil(dates.length / 7);
  for (let w = 0; w < weeks; w++) {
    const weekDates = dates.slice(w * 7, (w + 1) * 7);
    if (weekDates.length === 0) break;
    const weekTotal = weekDates.reduce((sum, dt) => {
      const dayMenus = byDate.get(dt)!;
      return sum + dayMenus.reduce((s, m) => s + (m.recipe.calories ?? 0), 0);
    }, 0);
    const weekAvg = Math.round(weekTotal / weekDates.length);
    const weekNum = w + 1;
    const deficitStart = Math.round(gradualDailyDeficit(w * 7 + 1));
    const deficitEnd   = Math.round(gradualDailyDeficit(w * 7 + weekDates.length));
    console.log(`Week ${weekNum} (${weekDates[0]} – ${weekDates[weekDates.length - 1]}): avg ${weekAvg} kcal  |  expected deficit range: ${deficitStart}–${deficitEnd} kcal/day`);
  }

  // ── Day 1 detailed breakdown ─────────────────────────────────────────────────
  const firstDate = dates[0];
  if (firstDate) {
    console.log(`\n── Day 1 meal breakdown (${firstDate}) ────────────────────────────────────────`);
    const day1 = byDate.get(firstDate)!;
    const mealOrder = ["breakfast", "lunch", "dinner", "snack"];
    const sorted = [...day1].sort((a, b) =>
      mealOrder.indexOf(a.mealType?.name?.toLowerCase() ?? "") -
      mealOrder.indexOf(b.mealType?.name?.toLowerCase() ?? "")
    );
    for (const m of sorted) {
      console.log(
        `  [${(m.mealType?.name ?? "?").padEnd(10)}] ${String(m.recipe.calories ?? 0).padStart(4)} kcal  ` +
        `${(m.recipe.dishType?.name ?? "?").padEnd(20)} ${m.recipe.name?.slice(0, 40) ?? "?"}`
      );
    }
    const day1Total = sorted.reduce((s, m) => s + (m.recipe.calories ?? 0), 0);
    console.log(`  ${"TOTAL".padEnd(12)} ${day1Total} kcal  (expected ~${Math.round(2992 - gradualDailyDeficit(1))} kcal)`);
  }

  // ── Family clash check (days 1-7) ───────────────────────────────────────────
  console.log("\n── Family clash check (days 1-7) ──────────────────────────────────────────");
  let clashCount = 0;
  let dayCheck = 0;
  for (const [dateStr, dayMenus] of byDate) {
    dayCheck++;
    if (dayCheck > 7) break;
    const families = dayMenus
      .map((m) => m.recipe.family?.toLowerCase())
      .filter((f): f is string => !!f);
    const seen = new Set<string>();
    const clashes: string[] = [];
    for (const f of families) {
      if (seen.has(f)) clashes.push(f);
      seen.add(f);
    }
    if (clashes.length > 0) {
      console.log(`  Day ${dayCheck} (${dateStr}): ⚠️  family clash — ${clashes.join(", ")}`);
      clashCount++;
    } else {
      console.log(`  Day ${dayCheck} (${dateStr}): ✅ no family clashes`);
    }
  }
  if (clashCount === 0) console.log("  All good — no family clashes in first 7 days");

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); prisma.$disconnect(); process.exit(1); });
