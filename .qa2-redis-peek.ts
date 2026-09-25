import path from "node:path";
for (const f of [".env.local", ".env"]) { try { (process as any).loadEnvFile(path.resolve(process.cwd(), f)); } catch {} }
import { Redis } from "@upstash/redis";
const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL!;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN!;
const r = new Redis({ url, token });
(async () => {
  const keys = await r.keys("rl:*3JloWzTdZZh1HAe4GaPO2WvtQjp*");
  if (!keys.length) console.log("no counters for this user yet");
  for (const k of keys.sort()) console.log(k, "=", JSON.stringify(await r.get(k)));
  const g = await r.keys("rl:ai-global-day*");
  for (const k of g) console.log(k, "=", JSON.stringify(await r.get(k)));
})();
