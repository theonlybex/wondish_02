import path from "node:path";
for (const f of [".env.local", ".env"]) { try { (process as any).loadEnvFile(path.resolve(process.cwd(), f)); } catch {} }
(async () => {
  const { redis, redisCredentials } = await import("./lib/redis");
  const url = redisCredentials()?.url ?? "";
  const host = new URL(url).hostname;
  if (!/^(127\.|localhost$|::1$)/.test(host)) { console.error("REFUSED: not loopback ->", host); process.exit(1); }
  const ID = "user_3JloWzTdZZh1HAe4GaPO2WvtQjp";
  const want = process.argv.slice(2);
  const keys = await redis!.keys(`rl:*:${ID}:*`);
  for (const k of keys) {
    const bucket = k.split(":")[1];
    if (!want.some(w => bucket.startsWith(w))) continue;
    await redis!.del(k);
    console.log("deleted", k);
  }
  console.log("remaining:", (await redis!.keys(`rl:*:${ID}:*`)).join(", "));
})();
