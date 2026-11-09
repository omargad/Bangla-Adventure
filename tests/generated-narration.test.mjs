import assert from "node:assert/strict";
import test, { after } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createGeneratedNarration, narrationCacheKey, NarrationError, newNarrationConfigured } from "../lib/generated-narration.ts";

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

test("a saved-only request plays saved audio and never calls the provider", async () => {
  const env = fixture("saved-only");
  let calls = 0;
  const generate = createGeneratedNarration({ env: () => env, now: () => now, transport: async () => { calls += 1; return stream(); } });
  await assert.rejects(generate("Draft activity", "en", "teacher", { savedOnly: true }), (error) => errorStatus(409)(error) && /approved, open activities/.test(error.message) && /কার্যক্রম/.test(error.messageBn) && error.code === "narration-saved-only");
  // The same refusal, with its code, whether or not a key is set.
  const keyless = createGeneratedNarration({ env: () => ({ ...env, ELEVENLABS_API_KEY: "" }), now: () => now, transport: async () => { calls += 1; return stream(); } });
  await assert.rejects(keyless("Draft activity", "en", "teacher", { savedOnly: true }), (error) => errorStatus(409)(error) && error.code === "narration-saved-only");
  assert.equal(calls, 0);
  assert.deepEqual(await generate("Draft activity", "en", "learner"), { audio, cached: false });
  assert.deepEqual(await generate("Draft activity", "en", "teacher", { savedOnly: true }), { audio, cached: true });
  assert.equal(calls, 1);
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
  const env = fixture("budget", { ELEVENLABS_DAILY_CHARACTER_LIMIT: "3", ELEVENLABS_ACCOUNT_DAILY_CHARACTER_LIMIT: "3" });
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

test("each account has its own daily share, a quarter of the site's unless configured", async () => {
  const env = fixture("per-account", { ELEVENLABS_DAILY_CHARACTER_LIMIT: "40" });
  let clock = now;
  let calls = 0;
  const dependencies = { env: () => env, now: () => clock, transport: async () => { calls += 1; return stream(); } };
  const generate = createGeneratedNarration(dependencies);
  // A quarter of 40 is 10 characters per account.
  await generate("12345", "en", "adult:teacher");
  await generate("67890", "en", "adult:teacher");
  const refusal = await generate("abc", "en", "adult:teacher").then(() => null, (error) => error);
  assert.ok(errorStatus(429)(refusal));
  assert.equal(refusal.message, "This account's narration allowance for today has been used. Saved audio is still available.");
  assert.match(refusal.messageBn, /[ঀ-৿]/);
  // Everyone else still has narration; the refused request reserved nothing.
  await generate("abc", "en", "student:maya");
  assert.equal(calls, 3);
  // Saved audio stays available to the account that used up its share.
  assert.deepEqual(await generate("12345", "en", "adult:teacher"), { audio, cached: true });
  // The shares are stored hashed and survive a restart.
  const budget = JSON.parse(await fs.readFile(path.join(cacheRoot(env), "daily-budget.json"), "utf8"));
  assert.equal(budget.characters, 13);
  assert.deepEqual(Object.values(budget.accounts).sort((a, b) => a - b), [3, 10]);
  assert.ok(!JSON.stringify(budget).includes("teacher") && !JSON.stringify(budget).includes("maya"));
  await assert.rejects(createGeneratedNarration(dependencies)("xyz", "en", "adult:teacher"), errorStatus(429));
  // A configured share replaces the quarter, and the next UTC day starts afresh.
  env.ELEVENLABS_ACCOUNT_DAILY_CHARACTER_LIMIT = "12";
  await createGeneratedNarration(dependencies)("xy", "en", "adult:teacher");
  clock += 86400_000;
  delete env.ELEVENLABS_ACCOUNT_DAILY_CHARACTER_LIMIT;
  await createGeneratedNarration(dependencies)("0123456789", "en", "adult:teacher");
  assert.equal(calls, 5);
});

test("the account share is a whole number, never more than the site's allowance", async () => {
  const { accountDailyLimit } = await import("../lib/generated-narration.ts");
  assert.equal(accountDailyLimit(20000, undefined), 5000);
  assert.equal(accountDailyLimit(20000, " "), 5000);
  assert.equal(accountDailyLimit(3, undefined), 0);
  assert.equal(accountDailyLimit(20000, "8000"), 8000);
  assert.equal(accountDailyLimit(20000, "90000"), 20000);
  for (const bad of ["-1", "1.5", "lots"]) assert.equal(accountDailyLimit(20000, bad), null, bad);
  let calls = 0;
  const invalid = fixture("invalid-share", { ELEVENLABS_ACCOUNT_DAILY_CHARACTER_LIMIT: "lots" });
  await assert.rejects(createGeneratedNarration({ env: () => invalid, transport: async () => { calls += 1; return stream(); } })("hello", "en", "actor"), errorStatus(503));
  assert.equal(calls, 0);
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
  for (const accounts of [[1], { "not-a-hash": 1 }, { ["a".repeat(64)]: -1 }]) {
    await fs.writeFile(path.join(cacheRoot(corrupt), "daily-budget.json"), JSON.stringify({ schema: 1, day: "2026-11-05", characters: 0, accounts }));
    await assert.rejects(createGeneratedNarration({ env: () => corrupt, transport })("hello", "en", "actor"), errorStatus(503), JSON.stringify(accounts));
  }
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

test("without a usable key, new narration is refused with the not-configured code in English and Bangla, while saved audio still plays", async () => {
  const env = fixture("not-configured");
  let calls = 0;
  const transport = async () => { calls += 1; return stream(); };
  // Saved first, while a key was set.
  await createGeneratedNarration({ env: () => env, now: () => now, transport })("Saved words", "en", "actor");
  assert.equal(calls, 1);
  for (const key of [undefined, "", "   ", "has space", "6fKdJFZHa5oCXNSVGieE"]) {
    const keyless = { ...env, ELEVENLABS_API_KEY: key };
    const generate = createGeneratedNarration({ env: () => keyless, now: () => now, transport });
    assert.deepEqual(await generate("Saved words", "en", "actor"), { audio, cached: true }, "saved audio needs no key");
    await assert.rejects(generate("Unsaved words", "en", "actor"), (error) => error instanceof NarrationError && error.status === 503
      && error.code === "narration-not-configured"
      && error.message === "New narration is not configured. Saved audio is still available."
      && error.messageBn === "নতুন কণ্ঠ তৈরি চালু করা হয়নি। সংরক্ষিত অডিও এখনো শোনা যাবে।", String(key));
    assert.equal(newNarrationConfigured(keyless), false, String(key));
  }
  assert.equal(calls, 1);
  assert.equal(newNarrationConfigured({ ELEVENLABS_API_KEY: fakeKey }), true);
  assert.equal(newNarrationConfigured({ ELEVENLABS_API_KEY: "SameAsVoice123", ELEVENLABS_VOICE_ID: "SameAsVoice123" }), false);
  // A key with a voice or model this site cannot use is not "configured" either: a Listen would be refused
  // ("Narration settings are unavailable."), so the page must not claim the ElevenLabs voice before playing.
  for (const settings of [{ ELEVENLABS_VOICE_ID: "bad voice!" }, { ELEVENLABS_VOICE_ID: "short" }, { ELEVENLABS_MODEL_ID: "eleven_v1" }]) {
    const misconfigured = { ...env, ELEVENLABS_API_KEY: fakeKey, ...settings };
    assert.equal(newNarrationConfigured(misconfigured), false, JSON.stringify(settings));
    await assert.rejects(createGeneratedNarration({ env: () => misconfigured, now: () => now, transport })("Unsaved words", "en", "actor"),
      (error) => error.status === 503 && error.message === "Narration settings are unavailable.", JSON.stringify(settings));
  }
  assert.equal(newNarrationConfigured({ ELEVENLABS_API_KEY: fakeKey, ELEVENLABS_VOICE_ID: "AbCdEf123456", ELEVENLABS_MODEL_ID: "eleven_v3" }), true);
  // Other refusals carry no code, so the player keeps showing them as errors.
  await assert.rejects(createGeneratedNarration({ env: () => fixture("bad-limit", { ELEVENLABS_DAILY_CHARACTER_LIMIT: "x" }), transport })("hello", "en", "actor"), (error) => error.status === 503 && error.code === undefined);
});
