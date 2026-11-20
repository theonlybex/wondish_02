// Share links for the diet card. A link is a random token that points at one
// person and how much they chose to show. It is kept in Redis (the same store
// as the rate limits) with a 90-day life, so no database table is needed, and
// turning a link off is deleting two keys. Without Redis (local dev, tests)
// an in-memory map stands in.
import crypto from "crypto";
import { redis } from "@/lib/redis";

export const DIET_SHARE_DAYS = 90;
export const DIET_SHARE_TTL_SEC = DIET_SHARE_DAYS * 86_400;
export const DIET_SHARE_TOKEN = /^[A-Za-z0-9_-]{20,64}$/;

export interface DietShare {
  token: string;
  patientId: string;
  /** Show health condition names and their cooking guidance. */
  showConditions: boolean;
  /** ISO time the link stops working. */
  expiresAt: string;
}

/** The small key-value surface the share links need. */
export interface DietShareKV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec: number): Promise<void>;
  del(key: string): Promise<void>;
}

const tokenKey = (token: string) => `diet-share:t:${token}`;
const personKey = (patientId: string) => `diet-share:p:${patientId}`;

export function memoryKV(now: () => number = Date.now): DietShareKV {
  const rows = new Map<string, { value: string; until: number }>();
  return {
    async get(key) {
      const row = rows.get(key);
      if (!row) return null;
      if (row.until <= now()) {
        rows.delete(key);
        return null;
      }
      return row.value;
    },
    async set(key, value, ttlSec) {
      rows.set(key, { value, until: now() + ttlSec * 1000 });
    },
    async del(key) {
      rows.delete(key);
    },
  };
}

const fallback = memoryKV();

function defaultKV(): DietShareKV {
  if (!redis) return fallback;
  const r = redis;
  return {
    // The client parses JSON on read, so objects come back as objects: store and read strings only.
    get: async (key) => {
      const v = await r.get<unknown>(key);
      return v == null ? null : typeof v === "string" ? v : JSON.stringify(v);
    },
    set: async (key, value, ttlSec) => {
      await r.set(key, value, { ex: ttlSec });
    },
    del: async (key) => {
      await r.del(key);
    },
  };
}

function parse(token: string, raw: string | null): DietShare | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (typeof v.patientId !== "string" || typeof v.expiresAt !== "string") return null;
    if (Date.parse(v.expiresAt) <= Date.now()) return null;
    return { token, patientId: v.patientId, showConditions: v.showConditions === true, expiresAt: v.expiresAt };
  } catch {
    return null;
  }
}

export function makeDietShareStore(kv: DietShareKV = defaultKV(), now: () => number = Date.now) {
  const write = async (share: DietShare) => {
    const ttl = Math.max(1, Math.ceil((Date.parse(share.expiresAt) - now()) / 1000));
    await kv.set(tokenKey(share.token), JSON.stringify({ patientId: share.patientId, showConditions: share.showConditions, expiresAt: share.expiresAt }), ttl);
    await kv.set(personKey(share.patientId), share.token, ttl);
  };

  const store = {
    /** The share a token points at; null when it is unknown, turned off or expired. */
    async byToken(token: string): Promise<DietShare | null> {
      if (!DIET_SHARE_TOKEN.test(token)) return null;
      return parse(token, await kv.get(tokenKey(token)));
    },

    /** The person's own live link, if they have one. */
    async current(patientId: string): Promise<DietShare | null> {
      const token = await kv.get(personKey(patientId));
      if (!token) return null;
      const share = await store.byToken(token);
      return share && share.patientId === patientId ? share : null;
    },

    /**
     * Turns sharing on. One link per person: an existing link is kept (the
     * chef's bookmark keeps working) and only what it shows is updated.
     */
    async enable(patientId: string, showConditions: boolean): Promise<DietShare> {
      const existing = await store.current(patientId);
      const share: DietShare = existing
        ? { ...existing, showConditions }
        : {
            token: crypto.randomBytes(18).toString("base64url"),
            patientId,
            showConditions,
            expiresAt: new Date(now() + DIET_SHARE_TTL_SEC * 1000).toISOString(),
          };
      await write(share);
      return share;
    },

    /** Turns the link off. The old address stops working at once. */
    async revoke(patientId: string): Promise<void> {
      const token = await kv.get(personKey(patientId));
      if (token) await kv.del(tokenKey(token));
      await kv.del(personKey(patientId));
    },
  };
  return store;
}

export const dietShareStore = makeDietShareStore();
