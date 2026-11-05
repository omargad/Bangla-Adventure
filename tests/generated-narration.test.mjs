import assert from "node:assert/strict";
import test, { after } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createGeneratedNarration, narrationCacheKey, NarrationError } from "../lib/generated-narration.ts";

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "bangla-narration-"));
after(() => fs.rm(temporary, { recursive: true, force: true }));
const fakeKey = "offline-narration-key";
const now = Date.parse("2026-11-05T10:00:00.000Z");
const audio = Buffer.alloc(50);
audio.write("OggS");
audio[26] = 1;
audio[27] = 19;
audio.write("OpusHead", 28);
const stream = (bytes = audio) => new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
const fixture = (name, extra = {}) => ({ MEDIA_ROOT: path.join(temporary, name), ELEVENLABS_API_KEY: fakeKey, ...extra });
const cacheRoot = (env) => path.join(env.MEDIA_ROOT, "generated-narration", "v1");
const errorStatus = (status) => (error) => error instanceof NarrationError && error.status === status;

test("narration is generated once, persisted, and available after the key is removed or the daily allowance reaches zero", async () => {
  const env = fixture("cache");
  let calls = 0;
  const generate = createGeneratedNarration({ env: () => env, now: () => now, transport: async (request) => {
    calls += 1;
    assert.equal(request.language, "bn");
    assert.equal(request.voiceId, "6fKdJFZHa5oCXNSVGieE");
    assert.equal(request.modelId, "eleven_v4");
    assert.equal(request.key, fakeKey);
    return stream();
  } });
  const first = await generate("বাংলা গল্প", "bn", "student-1");
  assert.deepEqual(first, { audio, cached: false });
  assert.deepEqual(await generate("বাংলা গল্প", "bn", "student-2"), { audio, cached: true });
  delete env.ELEVENLABS_API_KEY;
  env.ELEVENLABS_DAILY_CHARACTER_LIMIT = "0";
  const restarted = createGeneratedNarration({ env: () => env, transport: async () => { throw new Error("must not call"); } });
  assert.deepEqual(await restarted("বাংলা গল্প", "bn", "student-3"), { audio, cached: true });
  assert.equal(calls, 1);
  const saved = await fs.readFile(path.join(cacheRoot(env), `${narrationCacheKey("বাংলা গল্প", "bn")}.ogg`));
  assert.deepEqual(saved, audio);
  assert.equal((await fs.stat(path.join(cacheRoot(env), "daily-budget.json"))).mode & 0o777, 0o600);
});

test("changed text, language, voice and model cannot reuse a stale cache entry", async () => {
  const env = fixture("variants");
  let calls = 0;
  const generate = createGeneratedNarration({ env: () => env, now: () => now, transport: async () => { calls += 1; return stream(); } });
  await generate("Hello", "en", "actor");
  await generate("Hello!", "en", "actor");
  await generate("Hello", "bn", "actor");
  env.ELEVENLABS_VOICE_ID = "OtherValidVoice123456";
  await generate("Hello", "en", "actor");
  env.ELEVENLABS_MODEL_ID = "eleven_v3";
  await generate("Hello", "en", "actor");
  assert.equal(calls, 5);
  assert.equal((await fs.readdir(cacheRoot(env))).filter((file) => file.endsWith(".ogg")).length, 5);
});

test("identical concurrent requests coalesce into one upstream request and one budget reservation", async () => {
  const env = fixture("coalesce");
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  const generate = createGeneratedNarration({ env: () => env, now: () => now, transport: async () => {
    calls += 1; started(); await gate; return stream();
  } });
  const requests = Array.from({ length: 10 }, (_, index) => generate("শব্দ", "bn", `actor-${index}`));
  await ready;
  assert.equal(calls, 1);
  release();
  const results = await Promise.all(requests);
  assert.ok(results.every((result) => result.audio.equals(audio)));
  const budget = JSON.parse(await fs.readFile(path.join(cacheRoot(env), "daily-budget.json"), "utf8"));
  assert.equal(budget.characters, [..."শব্দ"].length);
  assert.equal(JSON.stringify(budget).includes("actor-"), false);
});

test("upstream concurrency is capped at two and busy requests spend no characters", async () => {
  const env = fixture("concurrency");
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let bothStarted;
  const ready = new Promise((resolve) => { bothStarted = resolve; });
  const generate = createGeneratedNarration({ env: () => env, now: () => now, transport: async () => {
    calls += 1; if (calls === 2) bothStarted(); await gate; return stream();
  } });
  const first = generate("one", "en", "actor");
  const second = generate("two", "en", "actor");
  await ready;
  await assert.rejects(generate("three", "en", "actor"), errorStatus(503));
  assert.equal(calls, 2);
  release();
  await Promise.all([first, second]);
  const budget = JSON.parse(await fs.readFile(path.join(cacheRoot(env), "daily-budget.json"), "utf8"));
  assert.equal(budget.characters, 6);
});

test("daily budget reservations serialize, survive restart and reset only on a later UTC day", async () => {
  const env = fixture("budget", { ELEVENLABS_DAILY_CHARACTER_LIMIT: "3" });
  let clock = now;
  let calls = 0;
  const dependencies = { env: () => env, now: () => clock, transport: async () => { calls += 1; return stream(); } };
  const generate = createGeneratedNarration(dependencies);
  const outcomes = await Promise.allSettled([generate("ab", "en", "actor"), generate("cd", "en", "actor")]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal(outcomes.find((outcome) => outcome.status === "rejected").reason.status, 429);
  await assert.rejects(createGeneratedNarration(dependencies)("ef", "en", "actor"), errorStatus(429));
  assert.equal(calls, 1);
  clock += 86400_000;
  await createGeneratedNarration(dependencies)("ef", "en", "actor");
  assert.equal(calls, 2);
});

test("missing keys, invalid settings and corrupt budget files fail closed without provider requests", async () => {
  let calls = 0;
  const transport = async () => { calls += 1; return stream(); };
  const missing = fixture("missing", { ELEVENLABS_API_KEY: undefined });
  await assert.rejects(createGeneratedNarration({ env: () => missing, transport })("hello", "en", "actor"), errorStatus(503));
  const invalid = fixture("invalid", { ELEVENLABS_DAILY_CHARACTER_LIMIT: "not-a-number" });
  await assert.rejects(createGeneratedNarration({ env: () => invalid, transport })("hello", "en", "actor"), errorStatus(503));
  const corrupt = fixture("corrupt");
  await fs.mkdir(cacheRoot(corrupt), { recursive: true });
  await fs.writeFile(path.join(cacheRoot(corrupt), "daily-budget.json"), "broken");
  await assert.rejects(createGeneratedNarration({ env: () => corrupt, transport })("hello", "en", "actor"), errorStatus(503));
  await fs.writeFile(path.join(cacheRoot(corrupt), "daily-budget.json"), JSON.stringify({ schema: 1, day: "2025-99-99", characters: 0 }));
  await assert.rejects(createGeneratedNarration({ env: () => corrupt, transport })("hello", "en", "actor"), errorStatus(503));
  assert.equal(calls, 0);
});

test("provider failures expose no key, text, response or cause and cool down without repeated charges", async () => {
  const env = fixture("failure");
  const text = "private canonical narration text";
  let clock = now;
  let calls = 0;
  const generate = createGeneratedNarration({ env: () => env, now: () => clock, transport: async () => {
    calls += 1;
    throw new Error(`provider echoed ${fakeKey} and ${text}`);
  } });
  const safe = (error) => {
    assert.equal(error.status, 503);
    assert.equal(error.message.includes(fakeKey), false);
    assert.equal(error.message.includes(text), false);
    assert.equal(error.cause, undefined);
    return true;
  };
  await assert.rejects(generate(text, "en", "actor"), safe);
  await assert.rejects(generate(text, "en", "actor"), safe);
  assert.equal(calls, 1);
  let budget = JSON.parse(await fs.readFile(path.join(cacheRoot(env), "daily-budget.json"), "utf8"));
  assert.equal(budget.characters, [...text].length);
  clock += 61_000;
  await assert.rejects(generate(text, "en", "actor"), safe);
  budget = JSON.parse(await fs.readFile(path.join(cacheRoot(env), "daily-budget.json"), "utf8"));
  assert.equal(calls, 2);
  assert.equal(budget.characters, 2 * [...text].length);
});

test("non-Opus and oversized provider responses are rejected and never cached", async () => {
  for (const [name, bytes] of [["invalid-audio", Buffer.from("OggS not opus")], ["oversized", Buffer.alloc(8 * 1024 * 1024 + 1)]]) {
    const env = fixture(name);
    const generate = createGeneratedNarration({ env: () => env, now: () => now, transport: async () => stream(bytes) });
    await assert.rejects(generate("hello", "en", "actor"), errorStatus(503));
    assert.deepEqual((await fs.readdir(cacheRoot(env))).filter((file) => file.endsWith(".ogg")), []);
  }
});

test("corrupt cached audio fails closed, and invalid chunks never call the provider", async () => {
  const env = fixture("invalid-cache");
  let calls = 0;
  const generate = createGeneratedNarration({ env: () => env, transport: async () => { calls += 1; return stream(); } });
  await fs.mkdir(cacheRoot(env), { recursive: true });
  await fs.writeFile(path.join(cacheRoot(env), `${narrationCacheKey("hello", "en")}.ogg`), "not audio");
  await assert.rejects(generate("hello", "en", "actor"), errorStatus(503));
  for (const args of [["", "en", "actor"], ["a".repeat(1501), "en", "actor"], ["a", "fr", "actor"], ["a", "en", ""]]) {
    await assert.rejects(generate(...args), errorStatus(400));
  }
  assert.equal(calls, 0);
});
