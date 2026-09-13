import { PrismaClient } from "@prisma/client";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";

neonConfig.webSocketConstructor = WebSocket;

function createPrismaClient() {
  // max: the Neon serverless Pool default is 10 WebSocket connections per
  // instance with nothing ever calling pool.end(). Five is plenty for one
  // request at a time on Fluid Compute and keeps a busy evening from
  // holding hundreds of sockets open across warm instances.
  const pool = new Pool({ connectionString: process.env.DATABASE_URL!, max: 5 });
  const adapter = new PrismaNeon(pool);
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

// Pinned in EVERY environment. The old `NODE_ENV !== "production"` guard
// meant a production process that evaluated this module twice (route
// bundle + RSC bundle) got two independent pools.
globalForPrisma.prisma = prisma;
