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
    feedbackReport: feedbackModel("report"),
    feedbackIssue: feedbackModel("issue"),
    $transaction: async (arg: unknown) => {
      if (typeof arg === "function") return (arg as (tx: unknown) => unknown)(self);
      throw new UnsupportedQuery("fake-db: array $transaction refused (simulation is read-only)");
    },
  };
  return self;

  function feedbackModel(kind: "report" | "issue") {
    const rows = kind === "report" ? feedback.reports : feedback.issues;
    const withRelations = (r: any) =>
      kind === "report"
        ? { ...r, issue: r.issueId ? feedback.issues.find((i) => i.id === r.issueId) ?? null : null }
        : { ...r, reports: feedback.reports.filter((x) => x.issueId === r.id).sort((a, b) => b.createdAt - a.createdAt) };
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
      create: async ({ data }: any) => {
        const now = new Date(Date.now() + feedback.tick++);
        const row = kind === "report"
          ? { id: `rep${++feedback.seq}`, issueId: null, area: null, screenshotKey: null, triage: "PENDING", triageNote: null, triageTries: 0, createdAt: now, ...data }
          : { id: `iss${++feedback.seq}`, status: "NEW", createdAt: now, updatedAt: now, ...data };
        rows.push(row);
        return withRelations(row);
      },
      update: async ({ where: w, data }: any) => {
        const row = rows.find((r) => r.id === w.id);
        if (!row) throw new UnsupportedQuery(`fake-db: feedback ${kind} ${w.id} not found`);
        applyData(row, data);
        return withRelations(row);
      },
      findUnique: async ({ where: w }: any) => {
        const row = rows.find((r) => r.id === w.id);
        return row ? withRelations(row) : null;
      },
      findMany: async (args: any = {}) => {
        const list = order(rows.filter((r) => where(r, args.where)), args.orderBy);
        return (typeof args.take === "number" ? list.slice(0, args.take) : list).map(withRelations);
      },
      count: async (args: any = {}) => rows.filter((r) => where(r, args.where)).length,
    };
  }
}

// In-memory feedback tables, shared by every fake client in the process.
export const feedback = { reports: [] as any[], issues: [] as any[], seq: 0, tick: 0 };
export function resetFeedbackStore() {
  feedback.reports.length = 0;
  feedback.issues.length = 0;
}
