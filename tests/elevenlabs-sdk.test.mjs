import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseSdkOptions, run, safeErrorMessage, sdkRequest, synthesizeWithSdk } from "../scripts/generate-elevenlabs-audio.mjs";

const env = { ELEVENLABS_API_KEY: "offline-test-key" };
const voiceId = "JBFqnCBsd6RMkjVDRZzb";
const options = parseSdkOptions(["--voice", voiceId], env);
const asset = { file: "story-1-bn", text: "মায়া ও রাফি।", language: "bn" };
const page = Buffer.alloc(28);
page.write("OggS");
page[26] = 1;
page[27] = 19;
const ogg = Buffer.concat([page, Buffer.from("OpusHead"), Buffer.alloc(11)]);
const audioStream = (bytes = ogg) => new ReadableStream({
  start(controller) {
    controller.enqueue(bytes.subarray(0, 10));
    controller.enqueue(bytes.subarray(10));
    controller.close();
  },
});
const mockClient = (convert) => ({ textToSpeech: { convert } });
const quiet = () => {};

test("SDK uses documented camelCase fields and assembles a web stream as Ogg Opus", async () => {
  let calls = 0;
  const client = mockClient(async (voice, request) => {
    calls += 1;
    assert.equal(voice, voiceId);
    assert.deepEqual(request, {
      text: asset.text,
      modelId: "eleven_v4",
      languageCode: "bn",
      voiceSettings: { stability: 0.7, similarityBoost: 0.75 },
      outputFormat: "opus_48000_64",
    });
    assert.equal(JSON.stringify(request).includes(env.ELEVENLABS_API_KEY), false);
    return audioStream();
  });
  assert.deepEqual(await synthesizeWithSdk(asset, options, client), ogg);
  assert.equal(calls, 1);
  const english = sdkRequest({ ...asset, language: "en" }, { ...options, model: "eleven_multilingual_v2" });
  assert.equal(Object.hasOwn(english, "languageCode"), false);
});

test("SDK rejection and stream failures discard request, body and secrets", async () => {
  const secret = "do-not-output-this-request-or-key";
  for (const statusCode of [401, 429, secret, undefined]) {
    const unsafe = Object.assign(new Error(secret), { statusCode, body: secret, request: { headers: secret } });
    await assert.rejects(synthesizeWithSdk(asset, options, mockClient(async () => { throw unsafe; })), (error) => {
      const expected = Number.isInteger(statusCode)
        ? `ElevenLabs audio generation failed (HTTP ${statusCode}).`
        : "ElevenLabs audio generation failed.";
      assert.equal(safeErrorMessage(error), expected);
      assert.equal(error.cause, undefined);
      assert.equal(JSON.stringify(error).includes(secret), false);
      assert.equal(error.stack.includes(secret), false);
      return true;
    });
  }
  const broken = new ReadableStream({ start(controller) { controller.error(new Error(secret)); } });
  await assert.rejects(synthesizeWithSdk(asset, options, mockClient(async () => broken)), /ElevenLabs audio generation failed\.$/);
  assert.equal(safeErrorMessage(new Error(secret)).includes(secret), false);
});

test("non-Opus and empty SDK responses are rejected before the generator can write them", async () => {
  for (const bytes of [Buffer.from("ID3 audio"), Buffer.from("OggS invalid"), Buffer.alloc(0)]) {
    await assert.rejects(synthesizeWithSdk(asset, options, mockClient(async () => audioStream(bytes))), /expected Ogg Opus/);
  }
});

test("SDK entrypoint preserves sample, output, Bangla-only and resume manifest behavior", async (t) => {
  const out = await mkdtemp(join(tmpdir(), "bangla-sdk-"));
  t.after(() => rm(out, { recursive: true, force: true }));
  const assets = [asset, { file: "story-1-en", text: "Maya and Rafi.", language: "en" }, { file: "hello-bn", text: "হ্যালো।", language: "bn" }];
  let calls = 0;
  const client = mockClient(async () => { calls += 1; return audioStream(); });
  const args = ["--voice", voiceId, "--out", out, "--samples", "--bangla-only"];
  const first = await run(args, env, { client, assets, log: quiet });
  assert.equal(first.generated, 1);
  assert.deepEqual((await readdir(out)).sort(), ["story-1-bn.ogg", "voice-manifest.json"]);
  assert.deepEqual(await readFile(join(out, "story-1-bn.ogg")), ogg);
  const manifest = JSON.parse(await readFile(join(out, "voice-manifest.json"), "utf8"));
  assert.deepEqual(manifest.files[asset.file], { provider: "elevenlabs", voice: voiceId, model: "eleven_v4" });
  assert.equal(JSON.stringify(manifest).includes(env.ELEVENLABS_API_KEY), false);
  const resumed = await run([...args, "--resume"], env, { client, assets, log: quiet });
  assert.equal(resumed.generated, 0);
  assert.equal(resumed.kept, 1);
  assert.equal(calls, 1);
});

test("dry run needs no credentials or SDK client and options never repeat unsafe input", async (t) => {
  const out = await mkdtemp(join(tmpdir(), "bangla-sdk-dry-"));
  t.after(() => rm(out, { recursive: true, force: true }));
  const result = await run(["--dry-run", "--force", "--bangla-only", "--out", out], {}, {
    assets: [asset, { ...asset, file: "story-1-en", language: "en" }], log: quiet,
  });
  assert.equal(result.planned.clips, 1);
  assert.equal(result.planned.en.clips, 0);
  assert.deepEqual(await readdir(out), []);
  assert.throws(() => parseSdkOptions(["--provider", "unsafe-secret-value"], env), (error) => {
    assert.equal(safeErrorMessage(error), "Invalid ElevenLabs options. Check --voice, --model and ELEVENLABS_API_KEY.");
    return true;
  });
});
