import { test } from "node:test";
import assert from "node:assert/strict";
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

// Every Redis reply type once, back to back, as redis-server would send them.
const STREAM =
  "+OK\r\n" + // simple string
  "-ERR boom\r\n" + // error
  ":42\r\n" + // integer
  "$5\r\nhello\r\n" + // bulk string
  "$-1\r\n" + // null bulk
  "*2\r\n:1\r\n$2\r\nab\r\n" + // array
  "*-1\r\n" + // null array
  "*0\r\n" + // empty array
  "*3\r\n:1\r\n-NOSCRIPT No matching script\r\n*1\r\n+PONG\r\n"; // nested, with an error inside

function plain(v: RespValue): unknown {
  if (Buffer.isBuffer(v)) return `<${v.toString("utf8")}>`;
  if (v instanceof RespError) return { err: v.message };
  if (Array.isArray(v)) return v.map(plain);
  return v;
}

const EXPECTED = ["OK", { err: "ERR boom" }, 42, "<hello>", null, [1, "<ab>"], null, [], [1, { err: "NOSCRIPT No matching script" }, ["PONG"]]];

test("encodeCommand: RESP array of bulk strings; numbers and booleans become strings", () => {
  assert.equal(encodeCommand(["SET", "k", 1]).toString(), "*3\r\n$3\r\nSET\r\n$1\r\nk\r\n$1\r\n1\r\n");
  assert.equal(encodeCommand(["x", true]).toString(), "*2\r\n$1\r\nx\r\n$4\r\ntrue\r\n");
  // byte length, not character length
  assert.equal(encodeCommand(["é"]).toString("latin1"), "*1\r\n$2\r\n" + Buffer.from("é").toString("latin1") + "\r\n");
});

test("parser: one chunk holding every reply type", () => {
  const values = new RespParser().push(Buffer.from(STREAM));
  assert.deepEqual(values.map(plain), EXPECTED);
});

test("parser: the same stream fed one byte at a time yields the same replies", () => {
  const parser = new RespParser();
  const bytes = Buffer.from(STREAM);
  const values: RespValue[] = [];
  for (let i = 0; i < bytes.length; i++) values.push(...parser.push(bytes.subarray(i, i + 1)));
  assert.deepEqual(values.map(plain), EXPECTED);
});

test("parser: a partial reply waits for the rest, and leftover bytes carry over", () => {
  const parser = new RespParser();
  assert.deepEqual(parser.push(Buffer.from("$5\r\nhel")), []);
  assert.deepEqual(parser.push(Buffer.from("lo\r\n:7\r\n+O")).map(plain), ["<hello>", 7]);
  assert.deepEqual(parser.push(Buffer.from("K\r\n")).map(plain), ["OK"]);
});

test("parser: an unknown type byte throws rather than silently desyncing", () => {
  assert.throws(() => new RespParser().push(Buffer.from("!oops\r\n")), /unexpected type byte/);
});

test("toUpstashReply: base64 encodes strings but leaves the bare OK status raw", () => {
  assert.deepEqual(toUpstashReply("OK", true), { result: "OK" });
  assert.deepEqual(toUpstashReply("PONG", true), { result: Buffer.from("PONG").toString("base64") });
  assert.deepEqual(toUpstashReply(Buffer.from("hello"), true), { result: "aGVsbG8=" });
  assert.deepEqual(toUpstashReply(Buffer.from("hello"), false), { result: "hello" });
  assert.deepEqual(toUpstashReply(42, true), { result: 42 });
  assert.deepEqual(toUpstashReply(null, true), { result: null });
  assert.deepEqual(toUpstashReply([1, Buffer.from("ab"), [null, "OK"]], true), { result: [1, "YWI=", [null, "OK"]] });
});

test("toUpstashReply: an error reply becomes {error} with the message intact (NOSCRIPT must survive)", () => {
  assert.deepEqual(toUpstashReply(new RespError("NOSCRIPT No matching script. Please use EVAL."), true), {
    error: "NOSCRIPT No matching script. Please use EVAL.",
  });
});

test("parseCommandBody: scalars only, stringified; anything else is rejected", () => {
  assert.deepEqual(parseCommandBody(["set", "k", 86400, true, null]), ["set", "k", "86400", "true", "null"]);
  assert.deepEqual(parseCommandBody(["set", "k", { a: 1 }]), ["set", "k", '{"a":1}']);
  assert.equal(parseCommandBody([]), null);
  assert.equal(parseCommandBody("PING"), null);
  assert.equal(parseCommandBody({ cmd: "PING" }), null);
  assert.deepEqual(parseCommandsBody([["PING"], ["GET", "k"]]), [["PING"], ["GET", "k"]]);
  assert.equal(parseCommandsBody([["PING"], "GET"]), null);
  assert.equal(parseCommandsBody([]), null);
});

test("isAuthorized: bearer header or _token query, exact match, never empty", () => {
  assert.equal(isAuthorized("Bearer secret", null, "secret"), true);
  assert.equal(isAuthorized("Bearer wrong", null, "secret"), false);
  assert.equal(isAuthorized(undefined, "secret", "secret"), true);
  assert.equal(isAuthorized(undefined, null, "secret"), false);
  assert.equal(isAuthorized("Bearer ", "", ""), false);
});

test("describeCommand: shows the keys of an EVALSHA, not the script hash", () => {
  assert.equal(describeCommand(["evalsha", "abc123", "2", "rl:ai-chat:u1:5", "rl:ai-chat:u1:4", "", "5", "1700"]), "EVALSHA rl:ai-chat:u1:5 rl:ai-chat:u1:4");
  assert.equal(describeCommand(["get", "k", "extra"]), "GET k");
  assert.equal(describeCommand(["ping"]), "PING");
});
