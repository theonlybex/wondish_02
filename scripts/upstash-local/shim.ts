// Local Upstash-compatible REST shim: the pieces behind `npm run redis:local`.
//
// @upstash/redis speaks HTTP+JSON, not RESP, so a bare redis-server is not
// enough to run lib/rate-limit.ts against Redis locally. This module bridges
// the two: an HTTP server that accepts Upstash's request shapes and forwards
// each command over one RESP socket to a real redis-server (which it can also
// spawn from ~/.wondish/redis/bin, see install-redis.sh). No npm dependencies:
// the RESP client is ~60 lines in protocol.ts + the class below.
//
// Split from server.ts (the CLI) so scripts/upstash-local/shim.test.ts can
// start everything on random ports and drive it with the real client.

import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import {
  RespError,
  RespParser,
  type RespValue,
  describeCommand,
  encodeCommand,
  isAuthorized,
  parseCommandBody,
  parseCommandsBody,
  toUpstashReply,
} from "./protocol";

export const DEFAULT_SHIM_PORT = 8079;
export const DEFAULT_TOKEN = "local-dev-token";
export const DEFAULT_REDIS_PORT = 6379;
export const LOCALHOST = "127.0.0.1";

type Pending = { resolve: (v: RespValue) => void; reject: (e: Error) => void };

/** One pipelined RESP connection. Redis answers in order, so a FIFO of resolvers is enough. */
export class RedisConnection {
  private socket: net.Socket | null = null;
  private parser = new RespParser();
  private pending: Pending[] = [];
  private connecting: Promise<void> | null = null;

  constructor(
    readonly host: string,
    readonly port: number
  ) {}

  private failAll(err: Error): void {
    const waiting = this.pending;
    this.pending = [];
    for (const p of waiting) p.reject(err);
  }

  private connect(): Promise<void> {
    if (this.socket && !this.socket.destroyed) return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.connecting = new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      socket.setNoDelay(true);
      socket.once("connect", () => {
        this.socket = socket;
        this.connecting = null;
        resolve();
      });
      socket.on("data", (chunk: Buffer) => {
        try {
          for (const value of this.parser.push(chunk)) this.pending.shift()?.resolve(value);
        } catch (err) {
          socket.destroy(err instanceof Error ? err : new Error(String(err)));
        }
      });
      socket.on("error", (err) => {
        this.connecting = null;
        reject(err);
        this.failAll(err);
      });
      socket.on("close", () => {
        this.socket = null;
        this.parser = new RespParser();
        this.failAll(new Error(`redis connection to ${this.host}:${this.port} closed`));
      });
    });
    return this.connecting;
  }

  /** Send several commands in one write; resolves with one reply per command (errors are RespError values). */
  async sendMany(cmds: ReadonlyArray<ReadonlyArray<string>>): Promise<RespValue[]> {
    await this.connect();
    const replies = cmds.map(
      () => new Promise<RespValue>((resolve, reject) => this.pending.push({ resolve, reject }))
    );
    this.socket!.write(Buffer.concat(cmds.map(encodeCommand)));
    return Promise.all(replies);
  }

  async send(cmd: ReadonlyArray<string>): Promise<RespValue> {
    return (await this.sendMany([cmd]))[0];
  }

  close(): void {
    this.socket?.destroy();
    this.socket = null;
  }
}

function readBody(req: http.IncomingMessage, maxBytes = 8 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export interface ShimLogger {
  log: (line: string) => void;
  error: (line: string) => void;
}

const silentLogger: ShimLogger = { log: () => {}, error: () => {} };

/**
 * The HTTP server. Replies follow the Upstash REST API closely enough for
 * @upstash/redis 1.38 and @upstash/ratelimit 2.0: command errors are HTTP 400
 * with `{error}` (the client turns either shape into an UpstashError, which is
 * what @upstash/ratelimit's NOSCRIPT → EVAL fallback keys on).
 */
export function createShimServer(redis: RedisConnection, token: string, logger: ShimLogger = silentLogger): http.Server {
  return http.createServer(async (req, res) => {
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json", "upstash-sync-token": "0" });
      res.end(JSON.stringify(body));
    };
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (!isAuthorized(req.headers.authorization, url.searchParams.get("_token"), token)) {
        return reply(401, { error: "Unauthorized" });
      }
      if (req.method !== "POST") return reply(405, { error: "only POST is supported by this shim" });
      const base64 = req.headers["upstash-encoding"] === "base64";
      let body: unknown;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return reply(400, { error: "invalid JSON body" });
      }

      switch (url.pathname) {
        case "/": {
          const cmd = parseCommandBody(body);
          if (!cmd) return reply(400, { error: "expected a JSON array command" });
          logger.log(describeCommand(cmd));
          const envelope = toUpstashReply(await redis.send(cmd), base64);
          return reply("error" in envelope ? 400 : 200, envelope);
        }
        case "/pipeline": {
          const cmds = parseCommandsBody(body);
          if (!cmds) return reply(400, { error: "expected a JSON array of commands" });
          logger.log(`PIPELINE ${cmds.map(describeCommand).join(" | ")}`);
          const replies = await redis.sendMany(cmds);
          return reply(200, replies.map((v) => toUpstashReply(v, base64)));
        }
        case "/multi-exec": {
          const cmds = parseCommandsBody(body);
          if (!cmds) return reply(400, { error: "expected a JSON array of commands" });
          logger.log(`MULTI-EXEC ${cmds.map(describeCommand).join(" | ")}`);
          const replies = await redis.sendMany([["MULTI"], ...cmds, ["EXEC"]]);
          const exec = replies[replies.length - 1];
          if (exec instanceof RespError) return reply(400, { error: exec.message });
          if (!Array.isArray(exec)) return reply(400, { error: "EXECABORT Transaction discarded" });
          return reply(200, exec.map((v) => toUpstashReply(v, base64)));
        }
        default:
          // Path-style commands (POST /get/key) are not used by the client.
          return reply(404, { error: `unsupported path ${url.pathname}` });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`request failed: ${message}`);
      if (!res.headersSent) reply(500, { error: `shim: ${message}` });
      else res.end();
    }
  });
}

export function defaultRedisHome(): string {
  return process.env.WONDISH_REDIS_HOME ?? path.join(os.homedir(), ".wondish", "redis");
}

/** REDIS_SERVER_BIN, then the install-redis.sh location, then PATH. */
export function findRedisServerBinary(): string | null {
  const candidates = [process.env.REDIS_SERVER_BIN, path.join(defaultRedisHome(), "bin", "redis-server")];
  for (const c of candidates) if (c && existsSync(c)) return c;
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const p = path.join(dir, "redis-server");
    if (dir && existsSync(p)) return p;
  }
  return null;
}

/** True when something on host:port answers PING with PONG. */
export function pingRedis(host: string, port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const parser = new RespParser();
    const socket = net.createConnection({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => socket.write(encodeCommand(["PING"])));
    socket.on("data", (chunk: Buffer) => {
      try {
        const [reply] = parser.push(chunk);
        if (reply !== undefined) done(reply === "PONG");
      } catch {
        done(false);
      }
    });
    socket.on("error", () => done(false));
  });
}

export interface EnsuredRedis {
  /** null when an already-running server on that port was reused. */
  child: ChildProcess | null;
  bin: string | null;
}

/**
 * Reuse a redis-server already listening on the port, else spawn one from the
 * local build. RDB snapshots go to `dataDir` so counters survive restarts of
 * the shim — the point of the exercise is quota state that does not vanish.
 */
export async function ensureRedisServer(opts: {
  host: string;
  port: number;
  dataDir: string;
  stdio?: "inherit" | "ignore";
}): Promise<EnsuredRedis> {
  if (await pingRedis(opts.host, opts.port)) return { child: null, bin: null };
  const bin = findRedisServerBinary();
  if (!bin) {
    throw new Error(
      "redis-server not found. Build one with `npm run redis:install` (bash scripts/upstash-local/install-redis.sh), or point REDIS_SERVER_BIN at an existing binary."
    );
  }
  mkdirSync(opts.dataDir, { recursive: true });
  const child = spawn(
    bin,
    [
      "--port", String(opts.port),
      "--bind", opts.host,
      "--dir", opts.dataDir,
      "--save", "60", "1",
      "--appendonly", "no",
      "--daemonize", "no",
      "--loglevel", "warning",
    ],
    { stdio: ["ignore", opts.stdio ?? "inherit", opts.stdio ?? "inherit"] }
  );
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`redis-server exited with code ${child.exitCode} during startup`);
    if (await pingRedis(opts.host, opts.port)) return { child, bin };
    await sleep(100);
  }
  child.kill("SIGTERM");
  throw new Error(`redis-server did not answer PING on ${opts.host}:${opts.port} within 5s`);
}

/** Random free TCP port on `host` (tests). */
export function freePort(host = LOCALHOST): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, host, () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}
