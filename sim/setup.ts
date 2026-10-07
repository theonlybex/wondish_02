// Shared isolation for every simulation file: mocks and env BEFORE any
// service module loads, the read-only snapshot, and the fake Prisma on
// globalThis. Import this first; load services with dynamic import().
import { mock } from "node:test";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createFakePrisma, type Snapshot, type SimState } from "./fake-db";

const req = createRequire(__filename);
export const state: SimState = { patient: null, pantryIds: [] };
mock.module(pathToFileURL(req.resolve("server-only")).href, { namedExports: {} });
mock.module(pathToFileURL(req.resolve("@clerk/nextjs/server")).href, {
  namedExports: { auth: async () => ({ userId: state.patient?.account.clerkId ?? null }) },
});
delete process.env.ANTHROPIC_API_KEY; // planner's Clara top-up returns [] without a key
delete process.env.UPSTASH_REDIS_REST_URL; // in-memory rate limiter
delete process.env.UPSTASH_REDIS_REST_TOKEN;
delete process.env.RATE_LIMIT_ENFORCE_BACKEND;

export const snap: Snapshot = JSON.parse(readFileSync(join(__dirname, ".snapshot", "snapshot.json"), "utf8"));
(globalThis as any).prisma = createFakePrisma(snap, state);

export const ingById = new Map(snap.ingredients.map((i) => [i.id, i]));
export const ingByName = new Map(snap.ingredients.map((i) => [i.name.trim().toLowerCase(), i]));
export const recipeById = new Map(snap.recipes.map((r) => [r.id, r]));
export const recipeItems = (id: string) =>
  (recipeById.get(id)?.ingredients ?? []).map((ri) => ingById.get(ri.ingredientId)).filter(Boolean).map((i) => ({ name: i!.name, allergenGroups: i!.allergenGroups }));
