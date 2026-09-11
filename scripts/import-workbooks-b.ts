import type { PrismaClient } from "@prisma/client";

// Phase B (library recipes) lands in the next task; keep the CLI wiring stable.
export async function phaseB(_prisma: PrismaClient, _apply: boolean): Promise<void> {
  throw new Error("phase B not implemented yet");
}
