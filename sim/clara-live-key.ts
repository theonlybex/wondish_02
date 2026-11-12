// Imported BEFORE sim/setup.ts by sim/clara-live.sim.ts: setup deletes
// ANTHROPIC_API_KEY (the other simulations must never call a model), so the
// opt-in live sample keeps it here first. It also drops every database URL so
// nothing in the live sample can reach a real database.
(globalThis as any).__simLiveKey = process.env.ANTHROPIC_API_KEY;
delete process.env.DATABASE_URL;
delete process.env.DATABASE_URL_UNPOOLED;
