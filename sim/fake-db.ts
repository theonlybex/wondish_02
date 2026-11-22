// In-memory stand-in for the Prisma client, fed by the read-only snapshot.
//
// The services under test run UNCHANGED: they import the `prisma` singleton
// from @/lib/db, which resolves `globalThis.prisma` first. This object answers
// exactly the queries those services make. Every where-clause key is
// interpreted from the arguments (never hardcoded), and an operator it does
// not understand THROWS — a silently ignored filter would make a service look
// safer or less safe than it is. `select`/`include` are ignored: rows are
// returned whole (a superset of what was asked), which cannot hide a ban.
// Writes are refused except the catalog's idempotent createMany.

export type Snapshot = {
  takenAt: string;
  rules: {
    allergies: { name: string; bannedIngredients: { name: string }[] }[];
    avoids: { name: string; bannedIngredients: { name: string }[] }[];
    conditions: { name: string; bannedIngredients: { name: string }[] }[];
    preferences: { name: string; bannedIngredients: { name: string }[] }[];
    motivations: { name: string; bannedIngredients: { name: string }[] }[];
    triggerRules: { code: string; category: string; baselineDays: number; trialDays: number; reintroductionDays: number; washoutDays: number; condition: { name: string } }[];
  };
  mealTypes: { id: string; name: string }[];
  physicalActivities: { id: string; name: string; level: number }[];
  ingredients: SnapIngredient[];
  recipes: SnapRecipe[];
  realCombos: { rules: string[]; users: number }[];
  stats: { patients: number; customConditionHolders: number };
};
export type SnapIngredient = { id: string; name: string; allergenGroups: string[]; groceryCategory: string | null };
export type SnapRecipe = Record<string, any> & {
  id: string;
  name: string;
  isPublic: boolean;
  mealTypeId: string | null;
  ingredients: { ingredientId: string; quantity: number | null; unit: string | null }[];
};

export type SimState = {
  patient: Record<string, any> | null;
  pantryIds: string[];
  // The current caller holds the SUPER role (requireAdmin / resolveAiTier).
  isAdmin?: boolean;
};

class UnsupportedQuery extends Error {}

export function createFakePrisma(snap: Snapshot, state: SimState) {
  const ingById = new Map(snap.ingredients.map((i) => [i.id, i]));
  const ingByNameLower = new Map(snap.ingredients.map((i) => [i.name.toLowerCase(), i]));
  // Recipes in the shape every caller selects: links carry the ingredient row.
  const recipes = snap.recipes.map((r) => ({
    ...r,
    ingredients: r.ingredients.map((ri) => ({ ...ri, ingredient: ingById.get(ri.ingredientId)! })).filter((ri) => ri.ingredient),
  }));

  const fail = (model: string, what: unknown): never => {
    throw new UnsupportedQuery(`fake-db: unsupported ${model} query ${JSON.stringify(what)}`);
  };

  // Generic scalar condition: equality, {in}, {notIn}, {not: null}, {gte/lte}, {equals, mode}.
  const scalarOk = (value: any, cond: any, model: string, key: string): boolean => {
    if (cond === null || typeof cond !== "object" || cond instanceof Date) return value === cond;
    const insensitive = cond.mode === "insensitive";
    const norm = (v: any) => (insensitive && typeof v === "string" ? v.toLowerCase() : v);
    for (const [op, arg] of Object.entries(cond)) {
      if (op === "mode") continue;
      if (op === "in") { if (!(arg as any[]).map(norm).includes(norm(value))) return false; }
      else if (op === "notIn") { if ((arg as any[]).map(norm).includes(norm(value))) return false; }
      else if (op === "not") { if (arg === null ? value === null || value === undefined : norm(value) === norm(arg)) return false; }
      else if (op === "equals") { if (norm(value) !== norm(arg)) return false; }
      else if (op === "gte") { if (!(value >= (arg as any))) return false; }
      else if (op === "lte") { if (!(value <= (arg as any))) return false; }
      else if (op === "gt") { if (!(value > (arg as any))) return false; }
      else if (op === "lt") { if (!(value < (arg as any))) return false; }
      else fail(model, { [key]: cond });
    }
    return true;
  };

  const recipeWhere = (r: (typeof recipes)[number], where: any): boolean => {
    for (const [key, cond] of Object.entries(where ?? {})) {
      if (key === "ingredients") {
        const c = cond as any;
        if (c?.some && Object.keys(c.some).length === 0 && Object.keys(c).length === 1) {
          if (r.ingredients.length === 0) return false;
        } else fail("recipe", { ingredients: cond });
      } else if (key === "NOT") {
        const nameFilter = (cond as any)?.ingredients?.some?.ingredient?.name;
        if (!nameFilter) fail("recipe", { NOT: cond });
        if (r.ingredients.some((ri) => scalarOk(ri.ingredient.name, nameFilter, "recipe", "NOT.name"))) return false;
      } else if (key === "AND") {
        if (!(cond as any[]).every((w) => recipeWhere(r, w))) return false;
      } else if (key === "OR") {
        if (!(cond as any[]).some((w) => recipeWhere(r, w))) return false;
      } else if (["isPublic", "id", "mealTypeId", "description", "calories", "name"].includes(key)) {
        if (!scalarOk((r as any)[key], cond, "recipe", key)) return false;
      } else fail("recipe", { [key]: cond });
    }
    return true;
  };

  const ingredientWhere = (i: SnapIngredient, where: any): boolean => {
    for (const [key, cond] of Object.entries(where ?? {})) {
      if (key === "id" || key === "name") {
        if (!scalarOk((i as any)[key], cond, "ingredient", key)) return false;
      } else fail("ingredient", { [key]: cond });
    }
    return true;
  };

  const thePatient = () => state.patient;
  const patientMatches = (where: any): boolean => {
    const p = thePatient();
    if (!p) return false;
    if (where?.account?.clerkId) return where.account.clerkId === p.account.clerkId;
    if (where?.id) return where.id === p.id;
    if (where?.accountId) return where.accountId === p.accountId;
    return fail("patient", where);
  };

  const orderTake = <T,>(rows: T[], args: any): T[] => {
    // `take` caps candidate pools (taste dishes takes 80). Honoured, so the
    // service behaves as in production.
    return typeof args?.take === "number" ? rows.slice(0, args.take) : rows;
  };

  const refuseWrite = (model: string) => async () => {
    throw new UnsupportedQuery(`fake-db: write to ${model} refused (simulation is read-only)`);
  };

  const self: any = {
    patient: {
      findFirst: async (args: any) => (patientMatches(args?.where) ? thePatient() : null),
      findUnique: async (args: any) => (patientMatches(args?.where) ? thePatient() : null),
      update: refuseWrite("patient"),
    },
    account: {
      findUnique: async (args: any) => {
        const p = thePatient();
        if (!p) return null;
        if (args?.where?.clerkId === p.account.clerkId || args?.where?.id === p.accountId)
          return { ...p.account, id: p.accountId, subscriptions: [], roles: state.isAdmin ? [{ role: { name: "SUPER" } }] : [] };
        return null;
      },
    },
    recipe: {
      findMany: async (args: any) => orderTake(recipes.filter((r) => recipeWhere(r, args?.where)), args),
      findFirst: async (args: any) => recipes.find((r) => recipeWhere(r, args?.where)) ?? null,
      findUnique: async (args: any) => recipes.find((r) => r.id === args?.where?.id) ?? null,
      create: refuseWrite("recipe"),
    },
    ingredient: {
      findMany: async (args: any) => snap.ingredients.filter((i) => ingredientWhere(i, args?.where)),
      findFirst: async (args: any) => snap.ingredients.find((i) => ingredientWhere(i, args?.where)) ?? null,
      // resolveCatalogIngredientIds creates missing catalog names; the
      // snapshot holds them all, so this is a no-op (and reported if not).
      createMany: async (args: any) => {
        const missing = (args?.data ?? []).map((d: any) => d.name);
        if (missing.length) throw new UnsupportedQuery(`fake-db: catalog names missing from snapshot: ${missing.join(", ")}`);
        return { count: 0 };
      },
      create: refuseWrite("ingredient"),
    },
    mealType: { findMany: async () => snap.mealTypes },
    patientPantryItem: {
      findMany: async () => state.pantryIds.map((id) => ({ ingredientId: id, ingredient: ingById.get(id) })),
    },
    // The diner's own rows, honouring the liked filter the caller asks for.
    patientIngredientPreference: {
      findMany: async (args: any) =>
        (thePatient()?.ingredientPreferences ?? [])
          .filter((p: any) => args?.where?.liked === undefined || p.liked === args.where.liked)
          .map((p: any) => ({ ...p, ingredientId: ingByNameLower.get(p.ingredient.name.toLowerCase())?.id })),
    },
    patientDishPreference: {
      findMany: async () => (thePatient()?.dishPreferences ?? []).map((d: any) => ({ recipeId: d.recipeId, liked: false })),
    },
    menu: { findMany: async () => [] },
    ingredientUnitConversion: { findMany: async () => [] },
    // Feedback reports (2026-10-07): the one place the simulation WRITES — to
    // this in-memory store only, never the snapshot. Callback transactions
    // run against the same store (no rollback is needed by the callers).
    feedbackReport: faulty("feedbackReport", feedbackModel("report")),
    feedbackIssue: faulty("feedbackIssue", feedbackModel("issue")),
    $transaction: async (arg: unknown) => {
      if (typeof arg === "function") return (arg as (tx: unknown) => unknown)(self);
      throw new UnsupportedQuery("fake-db: array $transaction refused (simulation is read-only)");
    },
  };
  return self;

  function feedbackModel(kind: "report" | "issue") {
    const rows = kind === "report" ? feedback.reports : feedback.issues;
    // Prisma semantics, not a superset: scalars by default, a relation only
    // when `include`d or `select`ed, nested select/include/orderBy honoured.
    // Returning everything let a route that dropped its include — or leaked a
    // field past its select — pass the simulation (final review, 2026-10-07).
    const relationOf = (r: any, key: string) => {
      if (kind === "report" && key === "issue") return { kind: "issue" as const, value: r.issueId ? feedback.issues.find((i) => i.id === r.issueId) ?? null : null };
      if (kind === "issue" && key === "reports") return { kind: "report" as const, value: feedback.reports.filter((x) => x.issueId === r.id) };
      throw new UnsupportedQuery(`fake-db: feedback ${kind} has no relation "${key}"`);
    };
    const isRelation = (key: string) => (kind === "report" && key === "issue") || (kind === "issue" && key === "reports");
    const projectRelated = (rel: { kind: "issue" | "report"; value: any }, spec: any) => {
      const sub = feedbackModel(rel.kind);
      if (rel.value === null) return null;
      const arg = spec === true ? {} : spec;
      return Array.isArray(rel.value) ? sub.project(order(rel.value, arg.orderBy), arg) : sub.project(rel.value, arg);
    };
    const project = (r: any, args: any = {}): any => {
      if (Array.isArray(r)) return r.map((x) => project(x, args));
      const out: any = {};
      if (args.select) {
        for (const [k, v] of Object.entries(args.select)) {
          if (!v) continue;
          out[k] = isRelation(k) ? projectRelated(relationOf(r, k), v) : r[k];
        }
        return out;
      }
      for (const [k, v] of Object.entries(r)) if (!isRelation(k)) out[k] = v;
      for (const [k, v] of Object.entries(args.include ?? {})) if (v) out[k] = projectRelated(relationOf(r, k), v);
      return out;
    };
    const withRelations = (r: any, args: any = {}) => project(r, args);
    const where = (r: any, w: any): boolean =>
      Object.entries(w ?? {}).every(([k, cond]) => scalarOk(r[k] ?? null, cond, `feedback${kind}`, k));
    const order = (list: any[], orderBy: any) => {
      if (!orderBy) return list;
      const [[k, dir]] = Object.entries(orderBy) as [string, string][];
      return [...list].sort((a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0) * (dir === "desc" ? -1 : 1));
    };
    const applyData = (r: any, data: any) => {
      for (const [k, v] of Object.entries(data)) {
        if (v && typeof v === "object" && "increment" in (v as any)) r[k] = (r[k] ?? 0) + (v as any).increment;
        else r[k] = v;
      }
      r.updatedAt = new Date(Date.now() + feedback.tick++);
    };
    return {
      create: async (args: any) => {
        const { data } = args;
        const now = new Date(Date.now() + feedback.tick++);
        const row = kind === "report"
          ? { id: `rep${++feedback.seq}`, issueId: null, area: null, screenshotKey: null, triage: "PENDING", triageNote: null, triageTries: 0, createdAt: now, ...data }
          : { id: `iss${++feedback.seq}`, status: "NEW", createdAt: now, updatedAt: now, ...data };
        rows.push(row);
        return withRelations(row, args);
      },
      update: async (args: any) => {
        const { where: w, data } = args;
        const row = rows.find((r) => r.id === w.id);
        if (!row) throw new UnsupportedQuery(`fake-db: feedback ${kind} ${w.id} not found`);
        applyData(row, data);
        return withRelations(row, args);
      },
      findUnique: async (args: any) => {
        const row = rows.find((r) => r.id === args.where.id);
        return row ? withRelations(row, args) : null;
      },
      findMany: async (args: any = {}) => {
        const list = order(rows.filter((r) => where(r, args.where)), args.orderBy);
        return (typeof args.take === "number" ? list.slice(0, args.take) : list).map((r) => withRelations(r, args));
      },
      count: async (args: any = {}) => rows.filter((r) => where(r, args.where)).length,
      // Compare-and-swap claims and cleanup (deferred minors, 2026-10-07).
      updateMany: async (args: any) => {
        const hit = rows.filter((r) => where(r, args.where));
        for (const r of hit) applyData(r, args.data);
        return { count: hit.length };
      },
      delete: async (args: any) => {
        const i = rows.findIndex((r) => r.id === args.where.id);
        if (i < 0) throw new UnsupportedQuery(`fake-db: feedback ${kind} ${args.where.id} not found`);
        return rows.splice(i, 1)[0];
      },
      deleteMany: async (args: any = {}) => {
        const keep = rows.filter((r) => !where(r, args.where));
        const count = rows.length - keep.length;
        rows.splice(0, rows.length, ...keep);
        return { count };
      },
      project,
    };
  }
}

// In-memory feedback tables, shared by every fake client in the process.
// `failNext` makes the next call to e.g. "feedbackIssue.findMany" throw once.
export const feedback = { reports: [] as any[], issues: [] as any[], seq: 0, tick: 0, failNext: null as string | null };
function faulty<T extends Record<string, any>>(model: string, impl: T): T {
  const out: any = {};
  for (const [op, fn] of Object.entries(impl)) {
    out[op] = typeof fn !== "function" || op === "project" ? fn : async (...a: any[]) => {
      if (feedback.failNext === `${model}.${op}`) {
        feedback.failNext = null;
        throw new Error(`injected failure: ${model}.${op}`);
      }
      return fn(...a);
    };
  }
  return out;
}
export function resetFeedbackStore() {
  feedback.reports.length = 0;
  feedback.issues.length = 0;
  feedback.failNext = null;
}

// ═════════════════════════════════════════════════════════════════════════════
// Writable in-memory store for the Clara-first simulation (sim/clara-first.sim.ts).
//
// Unlike createFakePrisma above, this one WRITES — to memory only, never to a
// database — because the journeys it backs are writes (onboarding, logging,
// cooking, tracked levels, goals, weigh-ins, pills). It aims at Prisma/Postgres
// semantics, not a superset:
//   - scalars by default; a relation only when `include`d or `select`ed, with
//     nested where / orderBy / take / select honoured;
//   - every declared field is type-checked on write (an unknown field or a
//     wrong type throws, as Prisma's validation does); `undefined` = leave alone;
//   - unique constraints (id, @unique, @@unique, composite ids) throw
//     PrismaClientKnownRequestError P2002; NULLs are distinct, as in Postgres;
//     foreign keys throw P2003; a missing row on update/delete/…OrThrow is P2025;
//   - createMany is all-or-nothing, with skipDuplicates;
//   - operations are LAZY like PrismaPromise, so `$transaction([...])` runs
//     them in order and rolls ALL of them back when one fails; an interactive
//     `$transaction(fn)` rolls back when fn throws;
//   - `$queryRaw` answers only the two `SELECT … FOR UPDATE` row locks the
//     routes use (anything else throws). There is no concurrency here, so a
//     lock is only an existence check.
// Recipes and ingredients are the read-only snapshot, served by createFakePrisma.
// ═════════════════════════════════════════════════════════════════════════════
import { Prisma } from "@prisma/client";

type FieldType = "S" | "I" | "F" | "B" | "D" | "J" | "S[]";
type FieldDef = { t: FieldType; null?: true; def?: () => unknown; updatedAt?: true };
type RelDef =
  | { kind: "one"; model: string; local: string; foreign: string }
  | { kind: "many"; model: string; local: string; foreign: string }
  | { kind: "embedded"; field: string };
type ModelDef = {
  fields: Record<string, FieldDef>;
  relations: Record<string, RelDef>;
  unique: string[][]; // each a set of fields; ["id"] is implied when an id field exists
  compound?: Record<string, string[]>; // where-key name → fields (e.g. patientId_levelKey)
  fks?: { field: string; model: string }[];
  readOnly?: true;
  idPrefix?: string;
};

const now = () => new Date();
const S = (o: Partial<FieldDef> = {}): FieldDef => ({ t: "S", ...o });
const SN = (): FieldDef => ({ t: "S", null: true });
const F = (o: Partial<FieldDef> = {}): FieldDef => ({ t: "F", ...o });
const FN = (): FieldDef => ({ t: "F", null: true });
const IN = (): FieldDef => ({ t: "I", null: true });
const B = (d: boolean): FieldDef => ({ t: "B", def: () => d });
const DN = (): FieldDef => ({ t: "D", null: true });
const DNOW = (): FieldDef => ({ t: "D", def: now });
const UPD = (): FieldDef => ({ t: "D", def: now, updatedAt: true });
const JN = (): FieldDef => ({ t: "J", null: true });
const ID = (): FieldDef => ({ t: "S" });
const many = (model: string, foreign: string): RelDef => ({ kind: "many", model, local: "id", foreign });
const one = (model: string, local: string): RelDef => ({ kind: "one", model, local, foreign: "id" });
const empty = (model: string, foreign = "patientId"): RelDef => many(model, foreign);

const REF = (extra: Record<string, FieldDef> = {}): ModelDef => ({
  fields: { id: ID(), name: S(), ...extra },
  relations: { bannedIngredients: { kind: "embedded", field: "bannedIngredients" } },
  unique: [["id"]],
  readOnly: true,
});

export const CLARA_SCHEMA: Record<string, ModelDef> = {
  account: {
    idPrefix: "acc",
    fields: {
      id: ID(), clerkId: SN(), email: S(), firstName: S(), lastName: S(), password: S({ def: () => "" }), phone: SN(), photoUrl: SN(),
      isEnabled: B(true), agreedTerms: B(false), emailVerified: B(false), onboardingComplete: B(false), createdAt: DNOW(), updatedAt: UPD(),
      companyId: SN(), countryId: SN(),
    },
    relations: { subscriptions: many("subscription", "accountId"), patient: { kind: "one", model: "patient", local: "id", foreign: "accountId" }, roles: empty("accountRole", "accountId") },
    unique: [["id"], ["clerkId"], ["email"]],
  },
  subscription: {
    idPrefix: "sub",
    fields: { id: ID(), accountId: S(), plan: S(), status: S(), source: S(), currentPeriodEnd: DN(), createdAt: DNOW(), updatedAt: UPD() },
    relations: {},
    unique: [["id"]],
    fks: [{ field: "accountId", model: "account" }],
  },
  accountRole: { fields: { id: ID(), accountId: S() }, relations: {}, unique: [["id"]], readOnly: true },
  patient: {
    idPrefix: "pat",
    fields: {
      id: ID(), accountId: S(), birthday: DN(), sexAtBirth: SN(), genderId: SN(), weight: FN(), weightUnit: { t: "S", null: true, def: () => "lbs" },
      displayWeightUnit: SN(), height: FN(), heightUnit: { t: "S", null: true, def: () => "ftin" }, heightFt: IN(), heightIn: FN(), bmi: FN(),
      physicalActivityId: SN(), mealTypeId: SN(), goalWeight: FN(), goalWeightUnit: { t: "S", null: true, def: () => "lbs" }, weeklyGoal: FN(),
      mealPlanStartDate: DN(), activePlanVersion: { t: "I", def: () => 0 }, mealPlanStatus: S({ def: () => "IDLE" }), mealPlanStale: B(false),
      mealPlanGenStartedAt: DN(), mealPlanError: SN(), mealPlanWeight: FN(), recentDishes: JN(), missingStaples: { t: "S[]", def: () => [] },
      usualEating: JN(), startingPicture: JN(), weightGoal: SN(), noCondition: B(false), profileCompleted: B(false), tasteCompleted: B(false),
      createdAt: DNOW(), updatedAt: UPD(),
    },
    relations: {
      account: one("account", "accountId"),
      physicalActivity: one("physicalActivity", "physicalActivityId"),
      gender: one("gender", "genderId"),
      mealType: one("mealType", "mealTypeId"),
      healthConditions: many("patientHealthCondition", "patientId"),
      foodAllergies: many("patientFoodAllergy", "patientId"),
      foodToAvoid: many("patientFoodToAvoid", "patientId"),
      foodPreferences: many("patientFoodPreference", "patientId"),
      motivations: many("patientMotivation", "patientId"),
      supplements: many("supplement", "patientId"),
      trackedLevels: many("trackedLevel", "patientId"),
      journalEntries: many("journalEntry", "patientId"),
      mealLogs: many("mealLog", "patientId"),
      claraConversations: many("claraConversation", "patientId"),
      triggerTrials: empty("triggerTrial"),
      ingredientPreferences: empty("patientIngredientPreference"),
      dishPreferences: empty("patientDishPreference"),
      customConditions: { kind: "many", model: "healthCondition", local: "id", foreign: "ownerPatientId" },
      customIngredients: empty("patientCustomIngredient"),
    },
    unique: [["id"], ["accountId"]],
    fks: [{ field: "accountId", model: "account" }, { field: "physicalActivityId", model: "physicalActivity" }],
  },
  healthCondition: REF({ ownerPatientId: SN(), guidance: SN() }),
  foodAllergy: REF(),
  foodToAvoid: REF(),
  foodPreference: REF({ ownerPatientId: SN(), guidance: SN() }),
  motivation: REF(),
  physicalActivity: { fields: { id: ID(), name: S(), level: { t: "I" } }, relations: {}, unique: [["id"]], readOnly: true },
  gender: { fields: { id: ID(), name: S() }, relations: {}, unique: [["id"]], readOnly: true },
  mealType: { fields: { id: ID(), name: S() }, relations: {}, unique: [["id"]], readOnly: true },
  patientHealthCondition: {
    fields: { patientId: S(), conditionId: S() },
    relations: { patient: one("patient", "patientId"), condition: one("healthCondition", "conditionId") },
    unique: [["patientId", "conditionId"]], compound: { patientId_conditionId: ["patientId", "conditionId"] },
    fks: [{ field: "patientId", model: "patient" }, { field: "conditionId", model: "healthCondition" }],
  },
  patientFoodAllergy: {
    fields: { patientId: S(), foodId: S() },
    relations: { patient: one("patient", "patientId"), food: one("foodAllergy", "foodId") },
    unique: [["patientId", "foodId"]], compound: { patientId_foodId: ["patientId", "foodId"] },
    fks: [{ field: "patientId", model: "patient" }, { field: "foodId", model: "foodAllergy" }],
  },
  patientFoodToAvoid: {
    fields: { patientId: S(), foodId: S() },
    relations: { patient: one("patient", "patientId"), food: one("foodToAvoid", "foodId") },
    unique: [["patientId", "foodId"]], compound: { patientId_foodId: ["patientId", "foodId"] },
    fks: [{ field: "patientId", model: "patient" }, { field: "foodId", model: "foodToAvoid" }],
  },
  patientFoodPreference: {
    fields: { patientId: S(), foodId: S() },
    relations: { patient: one("patient", "patientId"), food: one("foodPreference", "foodId") },
    unique: [["patientId", "foodId"]], compound: { patientId_foodId: ["patientId", "foodId"] },
    fks: [{ field: "patientId", model: "patient" }, { field: "foodId", model: "foodPreference" }],
  },
  patientMotivation: {
    fields: { patientId: S(), motivationId: S() },
    relations: { patient: one("patient", "patientId"), motivation: one("motivation", "motivationId") },
    unique: [["patientId", "motivationId"]], compound: { patientId_motivationId: ["patientId", "motivationId"] },
    fks: [{ field: "patientId", model: "patient" }, { field: "motivationId", model: "motivation" }],
  },
  supplement: {
    idPrefix: "sup",
    fields: { id: ID(), patientId: S(), name: S(), dosage: SN(), timeSlot: S(), deletedAt: DN(), createdAt: DNOW(), contents: JN(), estimated: B(false) },
    relations: { patient: one("patient", "patientId"), intakes: empty("supplementIntake", "supplementId") },
    unique: [["id"]],
    fks: [{ field: "patientId", model: "patient" }],
  },
  supplementIntake: { fields: { id: ID(), supplementId: S(), date: { t: "D" } }, relations: {}, unique: [["id"]], readOnly: true },
  trackedLevel: {
    idPrefix: "trk",
    fields: { id: ID(), patientId: S(), levelKey: S(), tracked: B(true), goal: FN(), direction: SN(), target: FN(), updatedAt: UPD() },
    relations: { patient: one("patient", "patientId") },
    unique: [["id"], ["patientId", "levelKey"]], compound: { patientId_levelKey: ["patientId", "levelKey"] },
    fks: [{ field: "patientId", model: "patient" }],
  },
  journalEntry: {
    idPrefix: "jrn",
    fields: { id: ID(), patientId: S(), date: { t: "D" }, mood: SN(), weight: FN(), energyLevel: SN(), activityLevel: SN(), notes: SN(), createdAt: DNOW() },
    relations: { patient: one("patient", "patientId"), meals: empty("journalMeal", "journalEntryId"), symptoms: empty("journalSymptom", "journalEntryId") },
    unique: [["id"]],
    fks: [{ field: "patientId", model: "patient" }],
  },
  journalMeal: { fields: { id: ID(), journalEntryId: S() }, relations: {}, unique: [["id"]], readOnly: true },
  journalSymptom: { fields: { id: ID(), journalEntryId: S() }, relations: {}, unique: [["id"]], readOnly: true },
  conditionTrackingItem: { fields: { id: ID() }, relations: {}, unique: [["id"]], readOnly: true },
  triggerTrial: { fields: { id: ID(), patientId: S() }, relations: {}, unique: [["id"]], readOnly: true },
  // The at-home and favourite marks (Ingredients tab). Writable so a simulation
  // can mark foods; the dish skill's kept-foods path reads them by patient.
  patientIngredientPreference: {
    idPrefix: "ipf",
    fields: { id: ID(), patientId: S(), ingredientId: S(), liked: B(true), createdAt: DNOW() },
    relations: { patient: one("patient", "patientId"), ingredient: one("ingredient", "ingredientId") },
    unique: [["id"], ["patientId", "ingredientId"]], compound: { patientId_ingredientId: ["patientId", "ingredientId"] },
    fks: [{ field: "patientId", model: "patient" }, { field: "ingredientId", model: "ingredient" }],
  },
  patientPantryItem: {
    idPrefix: "pan",
    fields: { id: ID(), patientId: S(), ingredientId: S(), createdAt: DNOW() },
    relations: { patient: one("patient", "patientId"), ingredient: one("ingredient", "ingredientId") },
    unique: [["id"], ["patientId", "ingredientId"]], compound: { patientId_ingredientId: ["patientId", "ingredientId"] },
    fks: [{ field: "patientId", model: "patient" }, { field: "ingredientId", model: "ingredient" }],
  },
  patientDishPreference: { fields: { id: ID(), patientId: S() }, relations: {}, unique: [["id"]], readOnly: true },
  patientCustomIngredient: { fields: { id: ID(), patientId: S() }, relations: {}, unique: [["id"]], readOnly: true },
  restaurantDish: { fields: { id: ID() }, relations: {}, unique: [["id"]], readOnly: true },
  mealLog: {
    idPrefix: "mlg",
    fields: {
      id: ID(), patientId: S(), localDate: S(), mealType: S(), source: S({ def: () => "MANUAL" }), name: S(), servings: F({ def: () => 1 }),
      calories: FN(), protein: FN(), carbs: FN(), fat: FN(), fiber: FN(), incomplete: B(false), sodium: FN(), estimated: B(false), nutrients: JN(),
      recipeId: SN(), restaurantDishId: SN(), customIngredientId: SN(), journalMealId: SN(), pictureResultId: SN(), fridgeRecipeId: SN(),
      planExchangeId: SN(), note: SN(), clientRequestId: SN(), deletedAt: DN(), loggedAt: DNOW(), createdAt: DNOW(), updatedAt: UPD(),
    },
    relations: { patient: one("patient", "patientId") },
    unique: [["id"], ["patientId", "clientRequestId"]], compound: { patientId_clientRequestId: ["patientId", "clientRequestId"] },
    fks: [{ field: "patientId", model: "patient" }, { field: "recipeId", model: "recipe" }],
  },
  claraConversation: {
    idPrefix: "cnv",
    fields: { id: ID(), patientId: S(), title: S(), surface: S({ def: () => "unknown" }), dishName: SN(), cookedAt: DN(), recipe: JN(), createdAt: DNOW(), updatedAt: UPD() },
    relations: { patient: one("patient", "patientId"), messages: many("claraMessage", "conversationId") },
    unique: [["id"]],
    fks: [{ field: "patientId", model: "patient" }],
  },
  claraMessage: {
    idPrefix: "msg",
    fields: { id: ID(), conversationId: S(), role: S(), content: S(), choices: JN(), toolTrace: JN(), surface: S({ def: () => "unknown" }), createdAt: DNOW() },
    relations: { conversation: one("claraConversation", "conversationId") },
    unique: [["id"]],
    fks: [{ field: "conversationId", model: "claraConversation" }],
  },
};

const known = (code: string, message: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: "sim", meta });
class FakeValidationError extends Error {}

/** The writable store. `refs` are the rule rows with synthetic ids (by name). */
export function createClaraStore(snap: Snapshot) {
  const base = createFakePrisma(snap, { patient: null, pantryIds: [] });
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const refRows = (prefix: string, rows: { name: string; bannedIngredients: { name: string }[] }[], extra: Record<string, unknown> = {}) =>
    rows.map((r) => ({ id: `${prefix}_${slug(r.name)}`, name: r.name, ...extra, bannedIngredients: r.bannedIngredients.map((b) => ({ name: b.name })) }));
  const tables: Record<string, any[]> = {};
  for (const m of Object.keys(CLARA_SCHEMA)) tables[m] = [];
  tables.healthCondition = refRows("hc", snap.rules.conditions, { ownerPatientId: null, guidance: null });
  tables.foodAllergy = refRows("fa", snap.rules.allergies);
  tables.foodToAvoid = refRows("ft", snap.rules.avoids);
  tables.foodPreference = refRows("fp", snap.rules.preferences, { ownerPatientId: null, guidance: null });
  tables.motivation = refRows("mo", snap.rules.motivations);
  tables.physicalActivity = snap.physicalActivities.map((a) => ({ ...a }));
  tables.mealType = snap.mealTypes.map((m) => ({ ...m }));
  const recipeIds = new Set(snap.recipes.map((r) => r.id));

  let seq = 0;
  let lastMs = 0;
  const stamp = () => {
    // Monotonic: the simulated clock is frozen between steps, and rows written
    // in one step still need a stable order (loggedAt).
    lastMs = Math.max(Date.now(), lastMs + 1);
    return new Date(lastMs);
  };
  const stats = { reads: 0, writes: 0, transactions: 0, rollbacks: 0 };

  const def = (model: string) => {
    const d = CLARA_SCHEMA[model];
    if (!d) throw new FakeValidationError(`fake-db: unknown model ${model}`);
    return d;
  };
  const isRel = (model: string, key: string) => key in def(model).relations;

  // ── where ────────────────────────────────────────────────────────────────
  const eq = (a: any, b: any) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b);
  // Dates by instant, strings (e.g. localDate "YYYY-MM-DD") lexically, numbers numerically.
  const cmp = (a: any, b: any) => {
    const x = a instanceof Date ? a.getTime() : a;
    const y = b instanceof Date ? b.getTime() : b;
    return x < y ? -1 : x > y ? 1 : 0;
  };
  const scalar = (model: string, key: string, value: any, cond: any): boolean => {
    if (value === undefined) value = null;
    if (cond === null || typeof cond !== "object" || cond instanceof Date) return eq(value, cond);
    const insensitive = cond.mode === "insensitive";
    const norm = (v: any) => (insensitive && typeof v === "string" ? v.toLowerCase() : v);
    for (const [op, arg] of Object.entries(cond)) {
      if (op === "mode") continue;
      if (op === "equals") { if (!eq(norm(value), norm(arg))) return false; }
      else if (op === "in") { if (!(arg as any[]).some((x) => eq(norm(x), norm(value)))) return false; }
      else if (op === "notIn") { if ((arg as any[]).some((x) => eq(norm(x), norm(value)))) return false; }
      else if (op === "not") {
        if (arg === null) { if (value === null) return false; }
        else if (typeof arg === "object" && !(arg instanceof Date)) { if (scalar(model, key, value, arg)) return false; }
        else if (eq(norm(value), norm(arg))) return false;
      }
      // Postgres: a comparison with NULL is never true.
      else if (op === "gte") { if (value === null || cmp(value, arg) < 0) return false; }
      else if (op === "lte") { if (value === null || cmp(value, arg) > 0) return false; }
      else if (op === "gt") { if (value === null || cmp(value, arg) <= 0) return false; }
      else if (op === "lt") { if (value === null || cmp(value, arg) >= 0) return false; }
      else throw new FakeValidationError(`fake-db: unsupported operator ${model}.${key}.${op}`);
    }
    return true;
  };
  const matches = (model: string, row: any, where: any): boolean => {
    const d = def(model);
    for (const [key, cond] of Object.entries(where ?? {})) {
      if (cond === undefined) continue; // Prisma ignores undefined filters
      if (key === "AND") { if (!(Array.isArray(cond) ? cond : [cond]).every((w) => matches(model, row, w))) return false; continue; }
      if (key === "OR") { if (!(cond as any[]).some((w) => matches(model, row, w))) return false; continue; }
      if (key === "NOT") { if ((Array.isArray(cond) ? cond : [cond]).some((w) => matches(model, row, w))) return false; continue; }
      if (d.compound?.[key]) { if (!d.compound[key].every((f) => eq(row[f] ?? null, (cond as any)[f]))) return false; continue; }
      const rel = d.relations[key];
      if (rel) {
        if (rel.kind === "embedded") throw new FakeValidationError(`fake-db: filter on embedded ${model}.${key}`);
        if (rel.kind === "one") {
          const target = related(model, row, key) as any;
          if (cond === null) { if (target !== null) return false; continue; }
          const c = cond as any;
          if ("is" in c || "isNot" in c) {
            if ("is" in c && !(c.is === null ? target === null : target && matches(rel.model, target, c.is))) return false;
            if ("isNot" in c && (c.isNot === null ? target === null : target && matches(rel.model, target, c.isNot))) return false;
            continue;
          }
          if (!target || !matches(rel.model, target, c)) return false;
          continue;
        }
        const list = related(model, row, key) as any[];
        const c = cond as any;
        for (const op of Object.keys(c)) {
          if (op === "some") { if (!list.some((r) => matches(rel.model, r, c.some))) return false; }
          else if (op === "every") { if (!list.every((r) => matches(rel.model, r, c.every))) return false; }
          else if (op === "none") { if (list.some((r) => matches(rel.model, r, c.none))) return false; }
          else throw new FakeValidationError(`fake-db: unsupported list filter ${model}.${key}.${op}`);
        }
        continue;
      }
      if (!(key in d.fields)) throw new FakeValidationError(`fake-db: unknown field in where ${model}.${key}`);
      if (!scalar(model, key, row[key], cond)) return false;
    }
    return true;
  };

  // ── relations and projection ─────────────────────────────────────────────
  const rowsOf = (model: string): any[] => {
    if (model === "recipe") return snap.recipes as any[];
    if (model === "ingredient") return snap.ingredients as any[];
    return tables[model];
  };
  function related(model: string, row: any, key: string): any {
    const rel = def(model).relations[key];
    if (rel.kind === "embedded") return row[rel.field] ?? [];
    if (rel.kind === "one") {
      const v = row[rel.local];
      if (v == null) return null;
      return rowsOf(rel.model).find((r) => r[rel.foreign] === v) ?? null;
    }
    return rowsOf(rel.model).filter((r) => r[rel.foreign] === row[rel.local]);
  }
  const order = (model: string, list: any[], orderBy: any): any[] => {
    if (!orderBy) return list;
    const keys = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap((o) => Object.entries(o));
    const val = (r: any, k: string, dir: any): [any, string] => {
      if (typeof dir === "object") {
        const [[sub, d2]] = Object.entries(dir);
        const t = related(model, r, k);
        return [t ? t[sub] : null, d2 as string];
      }
      return [r[k], dir as string];
    };
    return [...list].sort((a, b) => {
      for (const [k, dir] of keys) {
        const [x, d] = val(a, k, dir);
        const [y] = val(b, k, dir);
        // Postgres: NULLS LAST for asc, FIRST for desc.
        if (x == null && y == null) continue;
        if (x == null) return d === "desc" ? -1 : 1;
        if (y == null) return d === "desc" ? 1 : -1;
        const c = x instanceof Date ? x.getTime() - y.getTime() : x < y ? -1 : x > y ? 1 : 0;
        if (c !== 0) return d === "desc" ? -c : c;
      }
      return 0;
    });
  };
  const clone = (v: any): any => (v === null || typeof v !== "object" || v instanceof Date ? v : structuredClone(v));
  const project = (model: string, row: any, args: any = {}): any => {
    if (row == null) return null;
    const d = def(model);
    const out: any = {};
    if (args.select) {
      for (const [k, spec] of Object.entries(args.select)) {
        if (!spec) continue;
        if (k === "_count") throw new FakeValidationError(`fake-db: _count unsupported (${model})`);
        if (d.relations[k]) out[k] = relationValue(model, row, k, spec);
        else if (k in d.fields) out[k] = clone(row[k] ?? null);
        else throw new FakeValidationError(`fake-db: unknown field in select ${model}.${k}`);
      }
      return out;
    }
    for (const k of Object.keys(d.fields)) out[k] = clone(row[k] ?? null);
    for (const [k, spec] of Object.entries(args.include ?? {})) {
      if (!spec) continue;
      if (!d.relations[k]) throw new FakeValidationError(`fake-db: unknown relation in include ${model}.${k}`);
      out[k] = relationValue(model, row, k, spec);
    }
    return out;
  };
  const relationValue = (model: string, row: any, key: string, spec: any): any => {
    const rel = def(model).relations[key];
    const sub = spec === true ? {} : spec;
    if (rel.kind === "embedded") {
      const list = related(model, row, key) as any[];
      if (sub.select) return list.map((r) => Object.fromEntries(Object.entries(sub.select).filter(([, v]) => v).map(([k]) => [k, r[k] ?? null])));
      return list.map((r) => ({ ...r }));
    }
    if (rel.kind === "one") {
      if (rel.model === "recipe" || rel.model === "ingredient") return related(model, row, key);
      return project(rel.model, related(model, row, key), sub);
    }
    let list = related(model, row, key) as any[];
    if (sub.where) list = list.filter((r) => matches(rel.model, r, sub.where));
    list = order(rel.model, list, sub.orderBy);
    if (typeof sub.skip === "number") list = list.slice(sub.skip);
    if (typeof sub.take === "number") list = list.slice(0, sub.take);
    return list.map((r) => project(rel.model, r, sub));
  };

  // ── writes ───────────────────────────────────────────────────────────────
  const typeOk = (t: FieldType, v: any): boolean => {
    switch (t) {
      case "S": return typeof v === "string";
      case "I": return typeof v === "number" && Number.isInteger(v);
      case "F": return typeof v === "number" && Number.isFinite(v);
      case "B": return typeof v === "boolean";
      case "D": return v instanceof Date && !Number.isNaN(v.getTime());
      case "S[]": return Array.isArray(v) && v.every((x) => typeof x === "string");
      case "J": return true;
    }
  };
  const writeValue = (model: string, key: string, raw: any, current: any): any => {
    const f = def(model).fields[key];
    if (!f) throw new FakeValidationError(`fake-db: unknown argument ${model}.${key}`);
    let v = raw;
    if (v === Prisma.DbNull || v === Prisma.JsonNull) v = null;
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v) && f.t !== "J") {
      const ops = Object.keys(v);
      if (ops.length === 1 && ops[0] === "set") v = v.set;
      else if (ops.length === 1 && (ops[0] === "increment" || ops[0] === "decrement")) {
        const n = v[ops[0]];
        v = (current ?? 0) + (ops[0] === "increment" ? n : -n);
      } else throw new FakeValidationError(`fake-db: unsupported write op ${model}.${key} ${JSON.stringify(v)}`);
    }
    if (v === null) {
      if (!f.null) throw new FakeValidationError(`fake-db: ${model}.${key} is required, got null`);
      return null;
    }
    if (!typeOk(f.t, v)) throw new FakeValidationError(`fake-db: ${model}.${key} expects ${f.t}, got ${JSON.stringify(v)}`);
    return f.t === "J" ? JSON.parse(JSON.stringify(v)) : v instanceof Date ? new Date(v) : Array.isArray(v) ? [...v] : v;
  };
  const checkUnique = (model: string, row: any) => {
    const d = def(model);
    for (const fields of d.unique) {
      if (fields.some((f) => row[f] == null)) continue; // NULLs are distinct
      const clash = tables[model].find((r) => r !== row && fields.every((f) => eq(r[f], row[f])));
      if (clash) throw known("P2002", `Unique constraint failed on the fields: (${fields.join(",")}) [${model}]`, { target: fields });
    }
  };
  const checkFks = (model: string, row: any) => {
    for (const fk of def(model).fks ?? []) {
      const v = row[fk.field];
      if (v == null) continue;
      const ok = fk.model === "recipe" ? recipeIds.has(v) : fk.model === "ingredient" ? snap.ingredients.some((i) => i.id === v) : tables[fk.model].some((r) => r.id === v);
      if (!ok) throw known("P2003", `Foreign key constraint failed on the field: ${model}.${fk.field}`, { field_name: fk.field });
    }
  };
  const findUniqueRow = (model: string, where: any) => {
    const hits = tables[model].filter((r) => matches(model, r, where));
    return hits[0] ?? null;
  };
  const buildRow = (model: string, data: any): { row: any; nested: [string, any][] } => {
    const d = def(model);
    if (d.readOnly) throw new FakeValidationError(`fake-db: ${model} is read-only in the simulation`);
    const row: any = {};
    const nested: [string, any][] = [];
    for (const [k, v] of Object.entries(data ?? {})) {
      if (v === undefined) continue;
      if (d.relations[k]) { nested.push([k, v]); continue; }
      row[k] = writeValue(model, k, v, undefined);
    }
    for (const [k, f] of Object.entries(d.fields)) {
      if (k in row) continue;
      if (k === "id" && d.idPrefix) { row.id = `${d.idPrefix}${(++seq).toString(36).padStart(6, "0")}`; continue; }
      if (f.def) { const v = f.def(); row[k] = v instanceof Date ? stamp() : v; continue; }
      if (f.null) { row[k] = null; continue; }
      throw new FakeValidationError(`fake-db: argument ${model}.${k} is missing`);
    }
    return { row, nested };
  };
  const insert = (model: string, data: any): any => {
    const { row, nested } = buildRow(model, data);
    checkFks(model, row);
    checkUnique(model, row);
    tables[model].push(row);
    for (const [k, v] of nested) {
      const rel = def(model).relations[k];
      if (rel.kind !== "many") throw new FakeValidationError(`fake-db: nested write on ${model}.${k}`);
      const keys = Object.keys(v);
      if (keys.length !== 1 || keys[0] !== "create") throw new FakeValidationError(`fake-db: nested ${keys.join(",")} on ${model}.${k}`);
      for (const child of Array.isArray(v.create) ? v.create : [v.create]) insert(rel.model, { ...child, [rel.foreign]: row[rel.local] });
    }
    stats.writes++;
    return row;
  };
  const applyUpdate = (model: string, row: any, data: any) => {
    const d = def(model);
    if (d.readOnly) throw new FakeValidationError(`fake-db: ${model} is read-only in the simulation`);
    const next = { ...row };
    for (const [k, v] of Object.entries(data ?? {})) {
      if (v === undefined) continue;
      if (d.relations[k]) throw new FakeValidationError(`fake-db: nested write in update ${model}.${k}`);
      next[k] = writeValue(model, k, v, row[k]);
    }
    for (const [k, f] of Object.entries(d.fields)) if (f.updatedAt && !(data && k in data)) next[k] = stamp();
    checkFks(model, next);
    const i = tables[model].indexOf(row);
    tables[model][i] = next;
    try { checkUnique(model, next); } catch (e) { tables[model][i] = row; throw e; }
    stats.writes++;
    return next;
  };

  // ── lazy operations (PrismaPromise) ──────────────────────────────────────
  const RUN = Symbol("run");
  const lazy = <T,>(fn: () => T) => {
    let p: Promise<T> | null = null;
    const run = () => (p ??= new Promise<T>((res, rej) => { try { res(fn()); } catch (e) { rej(e); } }));
    return { [RUN]: run, then: (a: any, b: any) => run().then(a, b), catch: (b: any) => run().catch(b), finally: (f: any) => run().finally(f), [Symbol.toStringTag]: "PrismaPromise" } as any;
  };

  const modelClient = (model: string) => {
    const findMany = (args: any = {}) => {
      stats.reads++;
      let list = tables[model].filter((r) => matches(model, r, args.where));
      list = order(model, list, args.orderBy);
      if (args.distinct) {
        const seen = new Set<string>();
        list = list.filter((r) => { const k = JSON.stringify((args.distinct as string[]).map((f) => r[f])); if (seen.has(k)) return false; seen.add(k); return true; });
      }
      if (typeof args.skip === "number") list = list.slice(args.skip);
      if (typeof args.take === "number") list = list.slice(0, args.take);
      return list.map((r) => project(model, r, args));
    };
    const first = (args: any = {}) => findMany({ ...args, take: 1 })[0] ?? null;
    const orThrow = (v: any) => { if (v == null) throw known("P2025", `No ${model} found`); return v; };
    return {
      findMany: (args?: any) => lazy(() => findMany(args)),
      findFirst: (args?: any) => lazy(() => first(args)),
      findUnique: (args?: any) => lazy(() => first(args)),
      findFirstOrThrow: (args?: any) => lazy(() => orThrow(first(args))),
      findUniqueOrThrow: (args?: any) => lazy(() => orThrow(first(args))),
      count: (args: any = {}) => lazy(() => tables[model].filter((r) => matches(model, r, args.where)).length),
      create: (args: any) => lazy(() => project(model, insert(model, args.data), args)),
      createMany: (args: any) => lazy(() => {
        const rows = (Array.isArray(args.data) ? args.data : [args.data]);
        // One INSERT: all or nothing.
        const before = tables[model].length;
        let count = 0;
        try {
          for (const data of rows) {
            try { insert(model, data); count++; }
            catch (e) {
              if (args.skipDuplicates && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
              throw e;
            }
          }
        } catch (e) { tables[model].length = before; throw e; }
        return { count };
      }),
      update: (args: any) => lazy(() => {
        const row = findUniqueRow(model, args.where);
        if (!row) throw known("P2025", `Record to update not found (${model})`);
        return project(model, applyUpdate(model, row, args.data), args);
      }),
      updateMany: (args: any = {}) => lazy(() => {
        const hit = tables[model].filter((r) => matches(model, r, args.where));
        for (const r of hit) applyUpdate(model, r, args.data);
        return { count: hit.length };
      }),
      upsert: (args: any) => lazy(() => {
        const row = findUniqueRow(model, args.where);
        if (row) return project(model, applyUpdate(model, row, args.update), args);
        // Prisma fills the where's unique fields only if create carries them; a
        // create that disagrees with its where is the caller's bug, as in Prisma.
        return project(model, insert(model, args.create), args);
      }),
      delete: (args: any) => lazy(() => {
        const row = findUniqueRow(model, args.where);
        if (!row) throw known("P2025", `Record to delete does not exist (${model})`);
        tables[model].splice(tables[model].indexOf(row), 1);
        stats.writes++;
        return project(model, row, args);
      }),
      deleteMany: (args: any = {}) => lazy(() => {
        if (def(model).readOnly && tables[model].length === 0) return { count: 0 };
        const keep = tables[model].filter((r) => !matches(model, r, args.where));
        const count = tables[model].length - keep.length;
        tables[model].splice(0, tables[model].length, ...keep);
        if (count) stats.writes++;
        return { count };
      }),
    };
  };

  const snapshotTables = () => Object.fromEntries(Object.entries(tables).map(([k, rows]) => [k, rows.map((r) => ({ ...r }))]));
  const restore = (saved: Record<string, any[]>) => { for (const k of Object.keys(tables)) tables[k] = saved[k]; };

  const client: any = {
    recipe: base.recipe,
    ingredient: base.ingredient,
    menu: { findMany: async () => [] },
    ingredientUnitConversion: { findMany: async () => [] },
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => lazy(() => {
      const sql = strings.join("?").replace(/\s+/g, " ").trim();
      if (/^SELECT "id" FROM "Patient" WHERE "id" = \? FOR UPDATE$/.test(sql)) {
        return tables.patient.filter((p) => p.id === values[0]).map((p) => ({ id: p.id }));
      }
      if (/^SELECT id FROM "ClaraConversation" WHERE id = \? AND "patientId" = \? FOR UPDATE$/.test(sql)) {
        return tables.claraConversation.filter((c) => c.id === values[0] && c.patientId === values[1]).map((c) => ({ id: c.id }));
      }
      throw new FakeValidationError(`fake-db: unsupported $queryRaw: ${sql}`);
    }),
    $transaction: async (arg: any) => {
      stats.transactions++;
      const saved = snapshotTables();
      try {
        if (typeof arg === "function") return await arg(client);
        const out: unknown[] = [];
        for (const op of arg as any[]) {
          if (!op || typeof op[RUN] !== "function") throw new FakeValidationError("fake-db: $transaction array item is not a fake PrismaPromise");
          out.push(await op[RUN]());
        }
        return out;
      } catch (e) {
        stats.rollbacks++;
        restore(saved);
        throw e;
      }
    },
  };
  for (const m of Object.keys(CLARA_SCHEMA)) client[m] = modelClient(m);
  // Ingredient rows keep the snapshot's read-only fake (with its createMany guard).
  client.ingredient = base.ingredient;

  return {
    client,
    tables,
    stats,
    /** Rule rows by kind and name, with their synthetic ids. */
    ref: (kind: "healthCondition" | "foodAllergy" | "foodToAvoid" | "foodPreference" | "motivation", name: string) => {
      const row = tables[kind].find((r) => r.name === name);
      if (!row) throw new Error(`fake-db: no ${kind} named ${name}`);
      return row as { id: string; name: string };
    },
    /** Seeds an account as Clerk sign-up + /api/me would have created it. */
    seedAccount: (clerkId: string, email: string) => {
      const acc = insert("account", { clerkId, email, firstName: "Sim", lastName: "Person" });
      insert("subscription", { accountId: acc.id, plan: "FREE", status: "ACTIVE", source: "STRIPE" });
      return acc;
    },
  };
}
