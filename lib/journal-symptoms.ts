// Condition symptoms in the daily journal (workbook 05). Pure helpers plus
// one small Prisma-shaped loader so the journal route stays thin.

export type Severity = "NOT_PRESENT" | "MILD" | "MODERATE" | "SEVERE";
export const SEVERITIES: readonly Severity[] = ["NOT_PRESENT", "MILD", "MODERATE", "SEVERE"];
export const SEVERITY_LABEL: Record<Severity, string> = { NOT_PRESENT: "Not present", MILD: "Mild", MODERATE: "Moderate", SEVERE: "Severe" };

export interface TrackingItemView {
  id: string;
  label: string;
  conditionName: string;
  inTrial: boolean;
}

// The subset of PrismaClient the loader needs — keeps this file testable
// with a hand-built object.
export interface SymptomDb {
  conditionTrackingItem: {
    findMany(args: {
      where: { category: "SYMPTOM"; active: true; condition: { patients: { some: { patientId: string } } } };
      select: { id: true; label: true; condition: { select: { name: true } } };
      orderBy: [{ condition: { name: "asc" } }, { label: "asc" }];
    }): Promise<{ id: string; label: string; condition: { name: string } }[]>;
  };
  triggerTrial: {
    findFirst(args: {
      where: { patientId: string; status: "ACTIVE" };
      select: { rule: { select: { monitored: { select: { trackingItemId: true } } } } };
    }): Promise<{ rule: { monitored: { trackingItemId: string }[] } } | null>;
  };
}

/** Symptom items to ask today: the patient's conditions' items, trial-linked first. */
export async function trackingItemsForPatient(db: SymptomDb, patientId: string): Promise<TrackingItemView[]> {
  const [items, trial] = await Promise.all([
    db.conditionTrackingItem.findMany({
      where: { category: "SYMPTOM", active: true, condition: { patients: { some: { patientId } } } },
      select: { id: true, label: true, condition: { select: { name: true } } },
      orderBy: [{ condition: { name: "asc" } }, { label: "asc" }],
    }),
    db.triggerTrial.findFirst({ where: { patientId, status: "ACTIVE" }, select: { rule: { select: { monitored: { select: { trackingItemId: true } } } } } }),
  ]);
  const monitored = new Set(trial?.rule.monitored.map((m) => m.trackingItemId) ?? []);
  return items
    .map((i) => ({ id: i.id, label: i.label, conditionName: i.condition.name, inTrial: monitored.has(i.id) }))
    .sort((a, b) => Number(b.inTrial) - Number(a.inTrial));
}

export type SymptomInput = { trackingItemId: string; severity: Severity | null };

/** Validates the `symptoms` array of a journal POST against the items the patient may log. */
export function validateSymptoms(raw: unknown, allowedIds: ReadonlySet<string>): { ok: true; rows: SymptomInput[] } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, rows: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "symptoms must be an array" };
  const rows: SymptomInput[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (!r || typeof r !== "object") return { ok: false, error: "symptoms entries must be objects" };
    const { trackingItemId, severity } = r as Record<string, unknown>;
    if (typeof trackingItemId !== "string" || !allowedIds.has(trackingItemId)) return { ok: false, error: "unknown symptom item" };
    if (severity !== null && !SEVERITIES.includes(severity as Severity)) return { ok: false, error: "severity must be NOT_PRESENT, MILD, MODERATE, SEVERE or null" };
    if (seen.has(trackingItemId)) continue;
    seen.add(trackingItemId);
    rows.push({ trackingItemId, severity: (severity as Severity | null) ?? null });
  }
  return { ok: true, rows };
}
