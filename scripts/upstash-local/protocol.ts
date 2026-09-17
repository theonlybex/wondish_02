// Wire formats for the local Upstash shim (scripts/upstash-local/server.ts):
// RESP2 towards redis-server, Upstash's JSON envelope towards @upstash/redis.
// Pure — no sockets — so scripts/upstash-local/protocol.test.ts can cover it.
//
// What @upstash/redis sends (node_modules/@upstash/redis/nodejs.js, HttpClient):
//   POST /            body ["evalsha", sha, 3, k1, k2, k3, ...argv]  → {result} | {error}
//   POST /pipeline    body [[...cmd], [...cmd]]                       → [{result}|{error}, ...]
//   POST /multi-exec  body [[...cmd], [...cmd]]                       → [{result}|{error}, ...]
// Scalars in a command may be JSON numbers/booleans (defaultSerializer passes
// them through); Redis wants strings. With `Upstash-Encoding: base64` every
// string in the result is base64 — except the bare status "OK", which the
// client special-cases and Upstash sends raw.

const CRLF = "\r\n";

/** A Redis error reply (`-ERR ...`). A value, not a thrown Error, so it can sit inside arrays. */
export class RespError {
  constructor(public readonly message: string) {}
}

export type RespValue = string | Buffer | number | null | RespError | RespValue[];

/** Encode one command as a RESP array of bulk strings. Non-strings are stringified. */
export function encodeCommand(args: ReadonlyArray<string | number | boolean>): Buffer {
  const parts: Buffer[] = [Buffer.from(`*${args.length}${CRLF}`)];
  for (const arg of args) {
    const bytes = Buffer.from(typeof arg === "string" ? arg : String(arg), "utf8");
    parts.push(Buffer.from(`$${bytes.length}${CRLF}`), bytes, Buffer.from(CRLF));
  }
  return Buffer.concat(parts);
}

type Parsed = { value: RespValue; end: number };

function readLine(buf: Buffer, offset: number): { line: string; end: number } | null {
  const idx = buf.indexOf(CRLF, offset, "latin1");
  if (idx === -1) return null;
  return { line: buf.toString("utf8", offset, idx), end: idx + 2 };
}

// Returns null when the buffer does not yet hold a complete value at `offset`.
function parseAt(buf: Buffer, offset: number): Parsed | null {
  if (offset >= buf.length) return null;
  const type = buf[offset];
  const head = readLine(buf, offset + 1);
  if (!head) return null;
  switch (type) {
    case 0x2b: // + simple string
      return { value: head.line, end: head.end };
    case 0x2d: // - error
      return { value: new RespError(head.line), end: head.end };
    case 0x3a: // : integer
      return { value: Number(head.line), end: head.end };
    case 0x24: {
      // $ bulk string
      const len = Number(head.line);
      if (len === -1) return { value: null, end: head.end };
      const end = head.end + len + 2;
      if (buf.length < end) return null;
      // Copy: the parser's buffer is re-sliced after every push.
      return { value: Buffer.from(buf.subarray(head.end, head.end + len)), end };
    }
    case 0x2a: {
      // * array
      const n = Number(head.line);
      if (n === -1) return { value: null, end: head.end };
      const items: RespValue[] = [];
      let pos = head.end;
      for (let i = 0; i < n; i++) {
        const item = parseAt(buf, pos);
        if (!item) return null;
        items.push(item.value);
        pos = item.end;
      }
      return { value: items, end: pos };
    }
    default:
      throw new Error(`RESP: unexpected type byte 0x${type.toString(16)} at offset ${offset}`);
  }
}

/** Incremental RESP2 parser: feed chunks in any split, get back every completed reply. */
export class RespParser {
  private buf: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): RespValue[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const out: RespValue[] = [];
    let offset = 0;
    for (;;) {
      const parsed = parseAt(this.buf, offset);
      if (!parsed) break;
      out.push(parsed.value);
      offset = parsed.end;
    }
    this.buf = offset === 0 ? this.buf : Buffer.from(this.buf.subarray(offset));
    return out;
  }
}

export type UpstashReply = { result: unknown } | { error: string };

/** Command as sent by the client: a non-empty array of scalars. Returns the stringified form or null. */
export function parseCommandBody(body: unknown): string[] | null {
  if (!Array.isArray(body) || body.length === 0) return null;
  const out: string[] = [];
  for (const arg of body) {
    if (typeof arg === "string") out.push(arg);
    else if (typeof arg === "number" || typeof arg === "boolean") out.push(String(arg));
    else if (arg === null) out.push("null");
    else if (typeof arg === "object") out.push(JSON.stringify(arg));
    else return null;
  }
  return out;
}

/** Pipeline / multi-exec body: an array of commands. */
export function parseCommandsBody(body: unknown): string[][] | null {
  if (!Array.isArray(body) || body.length === 0) return null;
  const cmds: string[][] = [];
  for (const item of body) {
    const cmd = parseCommandBody(item);
    if (!cmd) return null;
    cmds.push(cmd);
  }
  return cmds;
}

function toJson(v: RespValue, base64: boolean): unknown {
  if (v === null || typeof v === "number") return v;
  if (v instanceof RespError) return v.message;
  if (Array.isArray(v)) return v.map((item) => toJson(item, base64));
  if (Buffer.isBuffer(v)) return base64 ? v.toString("base64") : v.toString("utf8");
  // Simple string. "OK" travels raw (see header); anything else is encoded like a bulk string.
  if (!base64 || v === "OK") return v;
  return Buffer.from(v, "utf8").toString("base64");
}

/** One Redis reply → Upstash's `{result}` / `{error}` envelope. */
export function toUpstashReply(v: RespValue, base64: boolean): UpstashReply {
  if (v instanceof RespError) return { error: v.message };
  return { result: toJson(v, base64) };
}

/** Bearer-token check for the Authorization header; also accepts Upstash's `_token` query form. */
export function isAuthorized(authorization: string | undefined, queryToken: string | null, expected: string): boolean {
  const presented = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : queryToken ?? "";
  return presented.length > 0 && presented === expected;
}

/** Keys touched by a command, for the one-line request log. */
export function describeCommand(cmd: ReadonlyArray<string>): string {
  const name = (cmd[0] ?? "").toUpperCase();
  if (name === "EVAL" || name === "EVALSHA") {
    const numKeys = Number(cmd[2] ?? 0);
    return [name, ...cmd.slice(3, 3 + numKeys)].join(" ");
  }
  return [name, ...cmd.slice(1, 2)].join(" ");
}
