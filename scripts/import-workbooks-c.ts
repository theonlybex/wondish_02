// Phase C: workbook 05 (tracking items) + 04 (trigger rules, journal links)
// + the authored trigger-category terms. Dry-run unless `apply`; idempotent.
import fs from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { findWorkbook, readTrackingItems, readTriggerRules, readTriggerLinks, readConditionSummary } from "../lib/workbooks/read";
import { CONDITION_FACTOR_MAP } from "../lib/workbooks/condition-map";
import { TRIGGER_CATEGORY_TERMS } from "../lib/trials/category-terms";

export async function phaseC(prisma: PrismaClient, apply: boolean): Promise<void> {
  const f05 = findWorkbook("Wondish_05");
  const f04 = findWorkbook("Wondish_04");
  const summary = readConditionSummary(f05);
  const items = readTrackingItems(f05);
  const rules = readTriggerRules(f04);
  const links = readTriggerLinks(f04);

  // 1. profileFactorId on our conditions.
  const conditions = await prisma.healthCondition.findMany({ select: { id: true, name: true, profileFactorId: true } });
  const idByName = new Map(conditions.map((c) => [c.name, c]));
  const conditionIdsByFactor = new Map<number, string[]>();
  const factorUpdates: { id: string; name: string; factor: number }[] = [];
  for (const [factorStr, names] of Object.entries(CONDITION_FACTOR_MAP)) {
    const factor = Number(factorStr);
    for (const name of names) {
      const c = idByName.get(name);
      if (!c) { console.log(`  [map] our condition "${name}" not in DB`); continue; }
      conditionIdsByFactor.set(factor, [...(conditionIdsByFactor.get(factor) ?? []), c.id]);
      if (c.profileFactorId !== factor) factorUpdates.push({ id: c.id, name, factor });
    }
  }
  const unmappedWorkbook = summary.filter((s) => !CONDITION_FACTOR_MAP[s.profileFactorId]).map((s) => `${s.profileFactorId} ${s.name}`);
  const unmappedOurs = conditions.filter((c) => !Object.values(CONDITION_FACTOR_MAP).flat().includes(c.name)).map((c) => c.name);

  // 2. tracking items (only for mapped factors; an item is copied to each of the factor's conditions).
  const existingItems = new Map((await prisma.conditionTrackingItem.findMany({ select: { id: true, code: true, conditionId: true } })).map((i) => [i.code, i]));
  const itemPlan: { code: string; conditionId: string; data: typeof items[number] }[] = [];
  let itemsSkipped = 0;
  for (const it of items) {
    const conditionIds = conditionIdsByFactor.get(it.profileFactorId);
    if (!conditionIds) { itemsSkipped++; continue; }
    conditionIds.forEach((conditionId, i) => {
      // Factor 4 → two conditions: suffix the code for the second copy.
      const code = i === 0 ? it.code : `${it.code}#${i}`;
      itemPlan.push({ code, conditionId, data: it });
    });
  }
  const itemsToWrite = itemPlan.filter((p) => { const e = existingItems.get(p.code); return !e || e.conditionId !== p.conditionId; });

  // 3. trigger rules.
  const existingRules = new Map((await prisma.triggerRule.findMany({ select: { id: true, code: true } })).map((r) => [r.code, r.id]));
  const rulePlan = rules.flatMap((r) => (conditionIdsByFactor.get(r.profileFactorId) ?? []).map((conditionId, i) => ({ code: i === 0 ? r.code : `${r.code}#${i}`, conditionId, data: r })));
  const rulesSkipped = rules.filter((r) => !conditionIdsByFactor.has(r.profileFactorId)).length;
  const rulesToWrite = rulePlan.filter((p) => !existingRules.has(p.code));

  // 5. terms: the constant is the source of truth.
  const wantedTerms = Object.entries(TRIGGER_CATEGORY_TERMS).flatMap(([category, v]) => v.terms.map((term) => ({ category, term, group: v.groups?.[0] ?? null })));
  const existingTerms = await prisma.triggerCategoryTerm.findMany();
  const termKey = (t: { category: string; term: string }) => `${t.category}|${t.term.toLowerCase()}`;
  const have = new Map(existingTerms.map((t) => [termKey(t), t]));
  const termsToAdd = wantedTerms.filter((t) => !have.has(termKey(t)));
  const wantedKeys = new Set(wantedTerms.map(termKey));
  const termsToDelete = existingTerms.filter((t) => !wantedKeys.has(termKey(t)));

  console.log(`[C] ${apply ? "APPLY" : "DRY RUN"}: factorUpdates=${factorUpdates.length} items=+${itemsToWrite.length} (skipped ${itemsSkipped} unmapped) rules=+${rulesToWrite.length} (skipped ${rulesSkipped} unmapped) terms=+${termsToAdd.length}/-${termsToDelete.length}`);
  if (unmappedWorkbook.length) console.log("  workbook factors without our condition:", unmappedWorkbook.join("; "));
  if (unmappedOurs.length) console.log("  our conditions without a factor:", unmappedOurs.join("; "));
  if (!apply) return;

  fs.writeFileSync(`workbooks-rollback-C-${Date.now()}.json`, JSON.stringify({ conditions, existingItems: [...existingItems.values()], existingRules: [...existingRules.entries()], existingTerms }));

  for (const u of factorUpdates) await prisma.healthCondition.update({ where: { id: u.id }, data: { profileFactorId: u.factor } });
  for (const p of itemsToWrite) {
    await prisma.conditionTrackingItem.upsert({
      where: { code: p.code },
      update: { conditionId: p.conditionId, category: p.data.category, itemCode: p.data.itemCode, label: p.data.label, inputSource: p.data.inputSource, active: p.data.active },
      create: { code: p.code, conditionId: p.conditionId, category: p.data.category, itemCode: p.data.itemCode, label: p.data.label, inputSource: p.data.inputSource, active: p.data.active },
    });
  }
  for (const p of rulesToWrite) {
    const d = p.data;
    await prisma.triggerRule.upsert({
      where: { code: p.code },
      update: {},
      create: { code: p.code, conditionId: p.conditionId, category: d.category, action: d.action, baselineDays: d.baselineDays, trialDays: d.trialDays, reintroductionDays: d.reintroductionDays, washoutDays: d.washoutDays, doseDependent: d.doseDependent, examples: d.examples, symptomsToMonitor: d.symptomsToMonitor, safetyNote: d.safetyNote, sourceUrl: d.sourceUrl },
    });
  }
  // 4. links (after rules/items exist): for each copy suffix, link matching copies.
  const ruleIdByCode = new Map((await prisma.triggerRule.findMany({ select: { id: true, code: true } })).map((r) => [r.code, r.id]));
  const itemIdByCode = new Map((await prisma.conditionTrackingItem.findMany({ select: { id: true, code: true } })).map((i) => [i.code, i.id]));
  const linkRows: { ruleId: string; trackingItemId: string }[] = [];
  for (const l of links) for (const suffix of ["", "#1"]) {
    const ruleId = ruleIdByCode.get(l.ruleCode + suffix); const trackingItemId = itemIdByCode.get(l.trackingCode + suffix);
    if (ruleId && trackingItemId) linkRows.push({ ruleId, trackingItemId });
  }
  const linked = await prisma.triggerRuleTrackingItem.createMany({ data: linkRows, skipDuplicates: true });
  if (termsToDelete.length) await prisma.triggerCategoryTerm.deleteMany({ where: { id: { in: termsToDelete.map((t) => t.id) } } });
  if (termsToAdd.length) await prisma.triggerCategoryTerm.createMany({ data: termsToAdd, skipDuplicates: true });
  console.log(`[C] applied: links +${linked.count}`);
}
