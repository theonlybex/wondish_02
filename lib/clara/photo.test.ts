import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_PHOTO_BASE64_CHARS,
  PHOTO_ONLY_TEXT,
  parsePhoto,
  photoReplayText,
  photoStoredText,
  splitPhotoMarker,
} from "./photo";
import { parseClaraChatBody, startClaraAppTurn, type ChatServiceDeps } from "./chat-service";
import { makeConversationStore, titleFrom, type ConversationDeps, type HistoryRow } from "./conversations";
import type { MemoryDeps } from "./skills/memory";
import type { ModelClient, ModelRoundEvent, ModelRoundRequest, Skill } from "./types";

const DATA = "/9j/4AAQSkZJRgABAQAAAQABAAD="; // a JPEG header, base64
const PHOTO = { id: "photo-1234abcd", mediaType: "image/jpeg", data: DATA };

// ─── parsePhoto ─────────────────────────────────────────────────────────────

test("parsePhoto: absent or null → no photo, ok", () => {
  assert.deepEqual(parsePhoto(undefined), { ok: true });
  assert.deepEqual(parsePhoto(null), { ok: true });
});

test("parsePhoto: a JPEG, PNG or WebP with a good id is accepted", () => {
  for (const mediaType of ["image/jpeg", "image/png", "image/webp"]) {
    const r = parsePhoto({ ...PHOTO, mediaType });
    assert.ok(r.ok && r.photo?.mediaType === mediaType, mediaType);
  }
});

test("parsePhoto: bad id, type, data or size → an error, never a silent drop", () => {
  const bad: unknown[] = [
    "x",
    { ...PHOTO, id: "short" },
    { ...PHOTO, id: "has spaces in it" },
    { ...PHOTO, mediaType: "image/gif" },
    { ...PHOTO, mediaType: "image/heic" },
    { ...PHOTO, data: "" },
    { ...PHOTO, data: "not base64!" },
    { ...PHOTO, data: "data:image/jpeg;base64," + DATA },
    { ...PHOTO, data: "A".repeat(MAX_PHOTO_BASE64_CHARS + 4) },
  ];
  for (const b of bad) assert.equal(parsePhoto(b).ok, false, JSON.stringify(b).slice(0, 80));
});

// ─── marker ─────────────────────────────────────────────────────────────────

test("marker: stored text round-trips, with and without words", () => {
  assert.equal(photoStoredText("photo-1234abcd", "my lunch"), "[photo:photo-1234abcd] my lunch");
  assert.equal(photoStoredText("photo-1234abcd", ""), "[photo:photo-1234abcd]");
  assert.deepEqual(splitPhotoMarker("[photo:photo-1234abcd] my lunch"), { photoId: "photo-1234abcd", text: "my lunch" });
  assert.deepEqual(splitPhotoMarker("[photo:photo-1234abcd]"), { photoId: "photo-1234abcd", text: "" });
  assert.equal(splitPhotoMarker("my lunch [photo:photo-1234abcd]"), null);
  assert.equal(splitPhotoMarker("hello"), null);
});

test("replay: a photo row reads as text the model understands; other rows are unchanged", () => {
  assert.equal(photoReplayText("[photo:photo-1234abcd] my lunch"), "[I sent a photo of my food] my lunch");
  assert.equal(photoReplayText("[photo:photo-1234abcd]"), "[I sent a photo of my food]");
  assert.equal(photoReplayText("what should I eat?"), "what should I eat?");
});

test("titleFrom: a photo chat is titled by its words, or 'Photo of my food'", () => {
  assert.equal(titleFrom("[photo:photo-1234abcd] Chicken salad for lunch"), "Chicken salad for lunch");
  assert.equal(titleFrom("[photo:photo-1234abcd]"), "Photo of my food");
});

// ─── body parser ────────────────────────────────────────────────────────────

test("parseClaraChatBody: a photo with no words is accepted; no photo and no words is still 400", () => {
  const r = parseClaraChatBody({ message: "", photo: PHOTO });
  assert.ok(r.ok && r.photo?.id === PHOTO.id && r.message === "");
  assert.equal(parseClaraChatBody({ message: "" }).ok, false);
  assert.equal(parseClaraChatBody({ message: "hi", photo: { ...PHOTO, mediaType: "image/gif" } }).ok, false);
  const plain = parseClaraChatBody({ message: "hi" });
  assert.ok(plain.ok && plain.photo === undefined);
});

// ─── service ────────────────────────────────────────────────────────────────

function setup(history: HistoryRow[] = []) {
  const saved: HistoryRow[] = [];
  const requests: ModelRoundRequest[] = [];
  const created: { title: string; firstMessage: string }[] = [];
  const deps: ConversationDeps = {
    createConversation: async ({ title, firstMessage }) => {
      created.push({ title, firstMessage });
      return { id: "c1" };
    },
    isOwned: async () => true,
    recentMessages: async () => [...history].reverse(),
    insertMessage: async ({ role, content, choices, toolTrace }) => {
      saved.push({ id: `m${saved.length}`, role, content, choices, toolTrace: toolTrace ?? null, createdAt: new Date() });
      return { id: `m${saved.length}` };
    },
    listPage: async () => [],
    getOwned: async () => null,
    deleteOwned: async () => false,
  };
  const memory: MemoryDeps = {
    list: async () => [],
    create: async (_p, text) => ({ id: "n", text, createdAt: new Date() }),
    remove: async () => false,
    clear: async () => 0,
  };
  const client: ModelClient = {
    async openRound(req) {
      requests.push(structuredClone(req));
      return (async function* () {
        yield { type: "text", text: "A chicken salad, about 350 g." } as ModelRoundEvent;
        yield { type: "end", content: [{ type: "text", text: "A chicken salad, about 350 g." }], stopReason: null } as ModelRoundEvent;
      })();
    },
  };
  const dishSkill: Skill = {
    name: "dish",
    promptFragment: "",
    tools: [
      {
        def: { name: "dish_suggest", description: "d", input_schema: { type: "object", properties: {} } },
        handler: async () => ({ ok: true, data: {} }),
      },
    ],
  };
  const svc: ChatServiceDeps = {
    store: makeConversationStore(deps),
    memory,
    client,
    skills: [dishSkill],
    todaysPlan: async () => "",
    onIntent: () => {},
    onConversion: () => {},
  };
  return { svc, saved, requests, created };
}
const patient = {
  id: "p1", mealType: null, foodAllergies: [], foodToAvoid: [], foodPreferences: [], healthConditions: [], motivations: [],
};
async function turn(svc: ChatServiceDeps, message: string, conversationId?: string) {
  const parsed = parseClaraChatBody({ message, photo: PHOTO, ...(conversationId ? { conversationId } : {}) });
  assert.ok(parsed.ok);
  const res = await startClaraAppTurn(svc, {
    patient, account: { id: "a1", firstName: "Sam" }, isPremium: false,
    message: parsed.message, photo: parsed.photo, conversationId: parsed.conversationId,
    options: { clientDate: "2026-11-14", tzOffsetMinutes: 0, surface: "ios" }, parts: true,
  });
  assert.ok(res.ok);
  for await (const _ of res.events) void _;
}

test("service: the photo reaches the model as an image block before the words", async () => {
  const { svc, requests } = setup();
  await turn(svc, "my lunch");
  const last = requests[0].messages.at(-1)!;
  assert.equal(last.role, "user");
  assert.ok(Array.isArray(last.content));
  const blocks = last.content as { type: string }[];
  assert.deepEqual(blocks.map((b) => b.type), ["image", "text"]);
  assert.deepEqual((blocks[0] as unknown as { source: unknown }).source, { type: "base64", media_type: "image/jpeg", data: DATA });
  assert.equal((blocks[1] as unknown as { text: string }).text, "my lunch");
});

test("service: a photo with no words reads as the photo-only line", async () => {
  const { svc, requests } = setup();
  await turn(svc, "");
  const blocks = requests[0].messages.at(-1)!.content as { type: string; text?: string }[];
  assert.equal(blocks[1].text, PHOTO_ONLY_TEXT);
});

test("service: the saved row is the marker plus words, never the photo; the title is the words", async () => {
  const { svc, created } = setup();
  await turn(svc, "my lunch");
  assert.equal(created[0].firstMessage, "[photo:photo-1234abcd] my lunch");
  assert.equal(created[0].title, "my lunch");
  assert.ok(!created[0].firstMessage.includes(DATA));
});

test("service: the photo turn tells Clara how to read it and to ask before logging", async () => {
  const { svc, requests } = setup();
  await turn(svc, "");
  assert.ok(requests[0].system.includes("Sam sent a photo"));
  assert.ok(requests[0].system.includes("Don't log"));
});

test("service: a photo turn is never forced into a dish card, even with cooking words", async () => {
  const { svc, requests } = setup();
  await turn(svc, "help me cook this");
  assert.equal(requests[0].toolChoice, undefined);
});

test("service: a retry of a saved photo row is not saved twice and still carries the photo", async () => {
  const history: HistoryRow[] = [
    { id: "h0", role: "user", content: "hello", choices: null, toolTrace: null, createdAt: new Date() },
    { id: "h1", role: "assistant", content: "Hi Sam.", choices: null, toolTrace: null, createdAt: new Date() },
    { id: "h2", role: "user", content: "[photo:photo-1234abcd] my lunch", choices: null, toolTrace: null, createdAt: new Date() },
  ];
  const { svc, saved, requests } = setup(history);
  await turn(svc, "my lunch", "c1");
  assert.equal(saved.filter((r) => r.role === "user").length, 0, "the earlier row is reused");
  const msgs = requests[0].messages;
  assert.equal(msgs.filter((m) => m.role === "user").length, 2);
  assert.ok(Array.isArray(msgs.at(-1)!.content));
});

test("service: a later turn replays the photo row as text", async () => {
  const history: HistoryRow[] = [
    { id: "h0", role: "user", content: "[photo:photo-1234abcd] my lunch", choices: null, toolTrace: null, createdAt: new Date() },
    { id: "h1", role: "assistant", content: "A chicken salad.", choices: null, toolTrace: null, createdAt: new Date() },
  ];
  const { svc, requests } = setup(history);
  const res = await startClaraAppTurn(svc, {
    patient, account: { id: "a1", firstName: "Sam" }, isPremium: false, message: "thanks", conversationId: "c1",
    options: { clientDate: "2026-11-14", tzOffsetMinutes: 0, surface: "ios" },
  });
  assert.ok(res.ok);
  for await (const _ of res.events) void _;
  assert.equal(requests[0].messages[0].content, "[I sent a photo of my food] my lunch");
  assert.ok(!requests[0].system.includes("sent a photo with this message"));
});
