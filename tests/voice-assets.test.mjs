import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The audio generation script: its Azure request is checked against a mocked
// fetch only. Nothing here calls a text-to-speech provider.
const require = createRequire(import.meta.url);
const voice = require("../scripts/generate-voice-assets.cjs");
const { lessonExtensions } = await import("../app/learning-content.ts");
const { lessons } = await import("../app/curriculum.ts");

const dir = mkdtempSync(path.join(tmpdir(), "bangla-voice-assets-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const azureEnv = { AZURE_SPEECH_KEY: "test-key-123", AZURE_SPEECH_REGION: "southeastasia" };
const ogg = (label) => Buffer.concat([Buffer.from("OggS"), Buffer.from(label)]);
const response = (status, body = Buffer.alloc(0), headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers(headers),
  arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
});

test("the Azure request is the documented text-to-speech REST call with SSML, the key and Ogg/Opus output", () => {
  const { url, init } = voice.azureSpeechRequest({ text: "মায়া <ও> রাফি & \"বন্ধু\"", voice: "bn-BD-NabanitaNeural", region: "southeastasia", key: "secret", rate: "-10%" });
  assert.equal(url, "https://southeastasia.tts.speech.microsoft.com/cognitiveservices/v1");
  assert.equal(init.method, "POST");
  assert.equal(init.headers["Ocp-Apim-Subscription-Key"], "secret");
  assert.equal(init.headers["Content-Type"], "application/ssml+xml");
  assert.equal(init.headers["X-Microsoft-OutputFormat"], "ogg-24khz-16bit-mono-opus");
  assert.ok(init.headers["User-Agent"]);
  assert.equal(
    init.body,
    '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="bn-BD"><voice name="bn-BD-NabanitaNeural"><prosody rate="-10%">মায়া &lt;ও&gt; রাফি &amp; &quot;বন্ধু&quot;</prosody></voice></speak>',
  );
  assert.throws(() => voice.azureSpeechRequest({ text: "x", voice: "bn-BD-NabanitaNeural", region: "evil.example.com/", key: "k" }), /region/);
  assert.throws(() => voice.azureSpeechRequest({ text: "x", voice: "bn-BD-Nabanita\"/><x", region: "eastus", key: "k" }), /voice/);
  assert.throws(() => voice.azureSpeechRequest({ text: "  ", voice: "bn-BD-NabanitaNeural", region: "eastus", key: "k" }), /Nothing/);
});

test("options: eSpeak by default; Azure needs a key and region from the environment and takes a voice", () => {
  assert.deepEqual(voice.parseOptions([], {}).provider, "espeak");
  assert.equal(voice.parseOptions(["--force"], {}).force, true);
  assert.throws(() => voice.parseOptions(["--provider", "polly"], azureEnv), /Unknown provider/);
  assert.throws(() => voice.parseOptions(["--provider", "azure"], {}), /AZURE_SPEECH_KEY/);
  assert.throws(() => voice.parseOptions(["--provider", "azure"], { AZURE_SPEECH_KEY: "k" }), /AZURE_SPEECH_REGION/);
  const azure = voice.parseOptions(["--provider", "azure", "--force"], azureEnv);
  assert.deepEqual([azure.provider, azure.force, azure.region, azure.key, azure.voices.bn, azure.voices.en], ["azure", true, "southeastasia", "test-key-123", "bn-BD-NabanitaNeural", "en-AU-NatashaNeural"]);
  assert.equal(voice.parseOptions(["--provider=azure", "--voice=bn-BD-PradeepNeural"], azureEnv).voices.bn, "bn-BD-PradeepNeural");
  assert.equal(voice.parseOptions(["--provider", "azure"], { ...azureEnv, AZURE_SPEECH_VOICE: "bn-IN-TanishaaNeural" }).voices.bn, "bn-IN-TanishaaNeural");
  assert.throws(() => voice.parseOptions(["--provider", "azure", "--voice", "en-US-JennyNeural"], azureEnv), /bn-BD or bn-IN/);
  assert.throws(() => voice.parseOptions(["--provider", "azure", "--voice"], azureEnv), /needs a value/);
  assert.deepEqual(voice.parseOptions(["--only", "lesson-my-family,hello-bn"], {}).only, ["lesson-my-family", "hello-bn"]);
});

test("Azure clips: throttling is retried with the wait Azure asks for; a refused key stops without retrying or printing it", async () => {
  const options = voice.parseOptions(["--provider", "azure"], azureEnv);
  const asset = { file: "hello-bn", text: "হ্যালো, বন্ধু!", language: "bn" };
  const calls = [];
  const waits = [];
  const answers = [response(429, Buffer.alloc(0), { "Retry-After": "2" }), response(503), response(200, ogg("hello"))];
  const fetch = async (url, init) => { calls.push({ url, init }); return answers.shift(); };
  const bytes = await voice.synthesizeAzure(asset, options, { fetch, sleep: async (ms) => { waits.push(ms); } });
  assert.deepEqual(bytes, ogg("hello"));
  assert.equal(calls.length, 3);
  assert.deepEqual(waits, [2000, 4000]);
  assert.match(calls[0].init.body, /bn-BD-NabanitaNeural/);
  assert.match(calls[0].init.body, /হ্যালো, বন্ধু!/);

  let refused = 0;
  await assert.rejects(
    voice.synthesizeAzure(asset, options, { fetch: async () => { refused += 1; return response(401); }, sleep: async () => undefined }),
    (error) => /refused/.test(error.message) && !error.message.includes(azureEnv.AZURE_SPEECH_KEY),
  );
  assert.equal(refused, 1);
  await assert.rejects(voice.synthesizeAzure(asset, options, { fetch: async () => response(400), sleep: async () => undefined }), /failed for hello-bn \(400\)/);
  await assert.rejects(voice.synthesizeAzure(asset, options, { fetch: async () => response(200, Buffer.from("<html>")), sleep: async () => undefined }), /did not return Ogg/);
  let throttled = 0;
  await assert.rejects(voice.synthesizeAzure(asset, options, { fetch: async () => { throttled += 1; return response(429); }, sleep: async () => undefined, attempts: 3 }), /\(429\)/);
  assert.equal(throttled, 3);
});

test("generating with Azure writes Ogg files under the same names and records the provider and voice in the manifest", async () => {
  const out = path.join(dir, "azure");
  const assets = [
    { file: "hello-bn", text: "হ্যালো, বন্ধু!", language: "bn" },
    { file: "story-1-en", text: "Maya stood beside a wide river.", language: "en" },
    { file: "lesson-hello-me-word-1", text: "হ্যালো", language: "bn" },
  ];
  // An earlier eSpeak run made hello-bn already.
  const first = await voice.generate(voice.parseOptions(["--out", out], {}), { assets: assets.slice(0, 1), synthesize: async () => ogg("espeak"), log: () => undefined });
  assert.equal(first.generated, 1);
  assert.deepEqual(JSON.parse(readFileSync(path.join(out, voice.MANIFEST_FILE), "utf8")).files, { "hello-bn": { provider: "espeak", voice: "bn+f3" } });

  const requests = [];
  const fetch = async (url, init) => { requests.push(init.body); return response(200, ogg(`azure-${requests.length}`)); };
  // Without --force existing clips are kept, so only the two new ones are made.
  const kept = await voice.generate(voice.parseOptions(["--provider", "azure", "--out", out], azureEnv), { assets, fetch, log: () => undefined });
  assert.deepEqual([kept.generated, kept.kept], [2, 1]);
  assert.deepEqual(readFileSync(path.join(out, "hello-bn.ogg")), ogg("espeak"));
  assert.match(requests[0], /en-AU-NatashaNeural/);
  assert.match(requests[1], /bn-BD-NabanitaNeural/);

  const forced = await voice.generate(voice.parseOptions(["--provider", "azure", "--force", "--voice", "bn-BD-PradeepNeural", "--out", out], azureEnv), { assets, fetch, log: () => undefined });
  assert.equal(forced.generated, 3);
  for (const asset of assets) assert.equal(readFileSync(path.join(out, `${asset.file}.ogg`)).subarray(0, 4).toString(), "OggS", asset.file);
  assert.deepEqual(JSON.parse(readFileSync(path.join(out, voice.MANIFEST_FILE), "utf8")).files, {
    "hello-bn": { provider: "azure", voice: "bn-BD-PradeepNeural" },
    "lesson-hello-me-word-1": { provider: "azure", voice: "bn-BD-PradeepNeural" },
    "story-1-en": { provider: "azure", voice: "en-AU-NatashaNeural" },
  });
  assert.ok(!existsSync(path.join(out, "hello-bn.tmp.wav")));

  // --only regenerates just the matching clips.
  const only = await voice.generate(voice.parseOptions(["--provider", "azure", "--force", "--only", "lesson-", "--out", out], azureEnv), { assets, fetch, log: () => undefined });
  assert.equal(only.generated, 1);
  await assert.rejects(voice.generate(voice.parseOptions(["--only", "nothing-matches", "--out", out], {}), { assets, log: () => undefined }), /No clip matches/);
});

test("clips that existed before the manifest are recorded as eSpeak; a broken manifest is rebuilt", async () => {
  const out = path.join(dir, "legacy");
  await voice.generate(voice.parseOptions(["--out", out], {}), { assets: [{ file: "hello-bn", text: "x", language: "bn" }], synthesize: async () => ogg("old"), log: () => undefined });
  writeFileSync(path.join(out, voice.MANIFEST_FILE), "not json");
  const run = await voice.generate(voice.parseOptions(["--out", out], {}), { assets: [{ file: "hello-bn", text: "x", language: "bn" }], log: () => undefined });
  assert.deepEqual([run.generated, run.kept], [0, 1]);
  assert.deepEqual(run.manifest.files, { "hello-bn": { provider: "espeak", voice: "bn+f3" } });
});

test("every lesson part has a clip, and dialogue clips never read the speakers' names", async () => {
  const assets = await voice.allAssets();
  const names = assets.map((asset) => asset.file);
  assert.equal(new Set(names).size, names.length, "clip names are unique");
  for (const lesson of lessons) {
    for (const slot of ["dialogue", "reading", "word-1", "word-2", "word-3", "word-4", "word-5", "word-6", "pattern-1", "pattern-2"]) {
      assert.ok(names.includes(`lesson-${lesson.id}-${slot}`), `${lesson.id} ${slot}`);
    }
    const dialogue = assets.find((asset) => asset.file === `lesson-${lesson.id}-dialogue`);
    const lines = lessonExtensions[lesson.id].dialogue;
    assert.equal(dialogue.text, lines.map((line) => line.bn).join(" "), lesson.id);
  }
});

// ElevenLabs, the provider the client chose. Every request goes to a mocked fetch.
const { isNeuralClip } = await import("../lib/voice-playback.ts");
const elevenEnv = { ELEVENLABS_API_KEY: "xi-test-key-456", ELEVENLABS_VOICE_ID_BN: "BanglaVoice000000001", ELEVENLABS_VOICE_ID_EN: "EnglishVoice00000002" };
/** The start of an Ogg Opus stream: an Ogg page whose one packet is the Opus identification header. */
const oggOpus = (label) => {
  const page = Buffer.alloc(28);
  page.write("OggS", 0, "latin1");
  page[26] = 1;
  page[27] = 19;
  return Buffer.concat([page, Buffer.from("OpusHead"), Buffer.from(label)]);
};
const answer = (status, json, headers = {}) => ({ ...response(status, Buffer.from(JSON.stringify(json)), headers), text: async () => JSON.stringify(json) });
const noFetch = async () => { throw new Error("no request may be sent"); };

test("the ElevenLabs request is the documented Create speech call: voice in the path, Ogg Opus output, key header and JSON body", () => {
  const text = "মায়া একটি চওড়া নদীর পাশে দাঁড়াল। তীরে একটি ছোট নৌকা দুলছিল।";
  const { url, init } = voice.elevenLabsRequest({ text, language: "bn", voiceId: "BanglaVoice000000001", model: "eleven_v4", key: "secret" });
  assert.equal(url, "https://api.elevenlabs.io/v1/text-to-speech/BanglaVoice000000001?output_format=opus_48000_64");
  assert.equal(init.method, "POST");
  assert.equal(init.headers["xi-api-key"], "secret");
  assert.equal(init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(init.body), { text, model_id: "eleven_v4", language_code: "bn", voice_settings: { stability: 0.7, similarity_boost: 0.75 } });
  const v3 = voice.elevenLabsRequest({ text: "Maya stood beside a wide river.", language: "en", voiceId: "EnglishVoice00000002", model: "eleven_v3", key: "secret" });
  assert.deepEqual(JSON.parse(v3.init.body), { text: "Maya stood beside a wide river.", model_id: "eleven_v3", language_code: "en", voice_settings: { stability: 0.5, similarity_boost: 0.75 } });
  // Multilingual v2 does not take language_code, and does not list Bengali.
  const v2 = JSON.parse(voice.elevenLabsRequest({ text: "Come aboard.", language: "en", voiceId: "EnglishVoice00000002", model: "eleven_multilingual_v2", key: "k" }).init.body);
  assert.equal("language_code" in v2, false);
  assert.throws(() => voice.elevenLabsRequest({ text: "নদী", language: "bn", voiceId: "BanglaVoice000000001", model: "eleven_multilingual_v2", key: "k" }), /cannot speak Bangla/);
  assert.throws(() => voice.elevenLabsRequest({ text: "নদী", language: "bn", voiceId: "../../v1/user", model: "eleven_v4", key: "k" }), /voice id/);
  assert.throws(() => voice.elevenLabsRequest({ text: "নদী", language: "bn", voiceId: "BanglaVoice000000001", model: "eleven_flash_v2_5", key: "k" }), /model/);
  assert.throws(() => voice.elevenLabsRequest({ text: "  ", language: "bn", voiceId: "BanglaVoice000000001", model: "eleven_v4", key: "k" }), /Nothing/);
  assert.throws(() => voice.elevenLabsRequest({ text: "ন".repeat(5001), language: "bn", voiceId: "BanglaVoice000000001", model: "eleven_v3", key: "k" }), /5000 characters/);
  assert.ok(voice.elevenLabsRequest({ text: "ন".repeat(5001), language: "bn", voiceId: "BanglaVoice000000001", model: "eleven_v4", key: "k" }));
});

test("ElevenLabs options: the key comes from the environment, the model and voice ids are checked, and nothing secret is echoed", () => {
  assert.throws(() => voice.parseOptions(["--provider", "elevenlabs"], {}), /Set ELEVENLABS_API_KEY/);
  assert.throws(() => voice.parseOptions(["--provider", "elevenlabs"], { ELEVENLABS_API_KEY: "k" }), /ELEVENLABS_VOICE_ID_BN or pass --voice/);
  const options = voice.parseOptions(["--provider", "elevenlabs", "--force"], elevenEnv);
  assert.deepEqual(
    [options.provider, options.force, options.model, options.key, options.voices.bn, options.voices.en, options.concurrency],
    ["elevenlabs", true, "eleven_v4", "xi-test-key-456", "BanglaVoice000000001", "EnglishVoice00000002", 2],
  );
  assert.equal(voice.parseOptions(["--provider=elevenlabs", "--model=eleven_v3"], elevenEnv).model, "eleven_v3");
  assert.equal(voice.parseOptions(["--provider", "elevenlabs", "--model", "eleven_multilingual_v2"], elevenEnv).model, "eleven_multilingual_v2");
  assert.throws(() => voice.parseOptions(["--provider", "elevenlabs", "--model", "eleven_flash_v2_5"], elevenEnv), /--model must be eleven_v4/);
  assert.throws(() => voice.parseOptions(["--provider", "elevenlabs", "--model", "__proto__"], elevenEnv), /--model must be/);
  // --voice wins over the environment; English falls back to the Bangla voice.
  const flagged = voice.parseOptions(["--provider", "elevenlabs", "--voice", "OtherBanglaVoice0003"], { ELEVENLABS_API_KEY: "k" });
  assert.deepEqual(flagged.voices, { bn: "OtherBanglaVoice0003", en: "OtherBanglaVoice0003" });
  assert.equal(voice.parseOptions(["--provider", "elevenlabs", "--voice-en", "OtherEnglishVoice004"], elevenEnv).voices.en, "OtherEnglishVoice004");
  for (const bad of ["short", "has space in it 12345", "../../v1/voices/abc", "x".repeat(41)]) {
    assert.throws(() => voice.parseOptions(["--provider", "elevenlabs", "--voice", bad], elevenEnv), (error) => /not an ElevenLabs voice id/.test(error.message) && !error.message.includes(bad), bad);
  }
  // An API key pasted as the voice id would end up in the URL and the logs.
  const pasted = { ...elevenEnv, ELEVENLABS_API_KEY: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6", ELEVENLABS_VOICE_ID_BN: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6" };
  assert.throws(() => voice.parseOptions(["--provider", "elevenlabs"], pasted), (error) => /holds the API key/.test(error.message) && !error.message.includes(pasted.ELEVENLABS_API_KEY));
  // A dry run sends nothing, so it needs neither the key nor a voice.
  const dry = voice.parseOptions(["--provider", "elevenlabs", "--dry-run"], {});
  assert.deepEqual([dry.dryRun, dry.key, dry.voices.bn], [true, "", ""]);
  // Samples: five named clips, always made again, in their own folder unless --out says otherwise.
  const samples = voice.parseOptions(["--provider", "elevenlabs", "--samples"], elevenEnv);
  assert.deepEqual(samples.only, voice.SAMPLE_CLIPS);
  assert.equal(samples.force, true);
  assert.equal(path.basename(samples.outputDirectory), "voice-samples");
  assert.equal(voice.parseOptions(["--provider", "elevenlabs", "--samples", "--out", dir], elevenEnv).outputDirectory, dir);
  assert.throws(() => voice.parseOptions(["--provider", "elevenlabs", "--samples", "--only", "hello-bn"], elevenEnv), /either --samples or --only/);
  assert.equal(voice.parseOptions(["--provider", "elevenlabs", "--resume"], elevenEnv).resume, true);
});

test("ElevenLabs clips: 429 waits as long as Retry-After asks, 5xx and network failures back off, refusals stop at once without the key", async () => {
  const options = voice.parseOptions(["--provider", "elevenlabs"], elevenEnv);
  const asset = { file: "story-1-bn", text: "মায়া একটি চওড়া নদীর পাশে দাঁড়াল।", language: "bn" };
  const calls = [];
  const waits = [];
  const answers = [response(429, Buffer.alloc(0), { "Retry-After": "3" }), response(503), response(200, oggOpus("maya"), { "Content-Type": "audio/ogg" })];
  const fetch = async (url, init) => { calls.push({ url, init }); return answers.shift(); };
  const bytes = await voice.synthesizeElevenLabs(asset, options, { fetch, sleep: async (ms) => { waits.push(ms); } });
  assert.deepEqual(bytes, oggOpus("maya"));
  assert.equal(calls.length, 3);
  assert.deepEqual(waits, [3000, 4000]);
  for (const call of calls) {
    assert.equal(call.url, "https://api.elevenlabs.io/v1/text-to-speech/BanglaVoice000000001?output_format=opus_48000_64");
    assert.equal(call.init.headers["xi-api-key"], "xi-test-key-456");
    assert.ok(call.init.signal, "each request has a time limit");
  }
  assert.equal(JSON.parse(calls[0].init.body).text, asset.text);

  // Retry-After may also be a date; long waits are capped at five minutes.
  assert.equal(voice.retryWait("Wed, 21 Oct 2026 07:28:10 GMT", 1, Date.parse("Wed, 21 Oct 2026 07:28:00 GMT")), 10000);
  assert.equal(voice.retryWait("100000", 1), 300000);
  assert.equal(voice.retryWait(null, 3), 8000);

  let refused = 0;
  const invalidKey = { detail: { status: "invalid_api_key", message: "Invalid API key: xi-test-key-456" } };
  await assert.rejects(
    voice.synthesizeElevenLabs(asset, options, { fetch: async () => { refused += 1; return answer(401, invalidKey); }, sleep: async () => undefined }),
    (error) => /refused the request \(401\): invalid_api_key/.test(error.message) && !error.message.includes(elevenEnv.ELEVENLABS_API_KEY),
  );
  assert.equal(refused, 1, "a refused key is not retried");
  let invalid = 0;
  await assert.rejects(
    voice.synthesizeElevenLabs(asset, options, { fetch: async () => { invalid += 1; return answer(422, { detail: [{ loc: ["body", "voice_settings"], msg: "stability out of range", type: "value_error" }] }); }, sleep: async () => undefined }),
    /failed for story-1-bn \(422\): stability out of range/,
  );
  assert.equal(invalid, 1, "a request ElevenLabs rejects is not retried");
  await assert.rejects(voice.synthesizeElevenLabs(asset, options, { fetch: async () => answer(404, { detail: { status: "voice_not_found", message: "A voice with that id was not found." } }), sleep: async () => undefined }), /\(404\): voice_not_found/);

  const networkWaits = [];
  let attempts = 0;
  const flaky = async () => { attempts += 1; if (attempts < 3) throw new TypeError("fetch failed"); return response(200, oggOpus("ok")); };
  assert.deepEqual(await voice.synthesizeElevenLabs(asset, options, { fetch: flaky, sleep: async (ms) => { networkWaits.push(ms); } }), oggOpus("ok"));
  assert.deepEqual(networkWaits, [2000, 4000]);
  let dropped = 0;
  const dropping = async () => {
    dropped += 1;
    return dropped === 1 ? { ...response(200), arrayBuffer: async () => { throw new TypeError("terminated"); } } : response(200, oggOpus("whole"));
  };
  assert.deepEqual(await voice.synthesizeElevenLabs(asset, options, { fetch: dropping, sleep: async () => undefined }), oggOpus("whole"), "audio cut off part-way is asked for again");
  assert.equal(dropped, 2);
  let throttled = 0;
  await assert.rejects(voice.synthesizeElevenLabs(asset, options, { fetch: async () => { throttled += 1; return response(429); }, sleep: async () => undefined, attempts: 3 }), /\(429\)/);
  assert.equal(throttled, 3);
});

test("every ElevenLabs answer must be an Ogg Opus stream, since the app plays bundled clips only as .ogg", async () => {
  assert.equal(voice.isOggOpus(oggOpus("x")), true);
  assert.equal(voice.isOggOpus(Buffer.from("ID3\u0004\u0000mp3 bytes", "latin1")), false);
  const vorbis = oggOpus("x");
  vorbis.write("\u0001vorbis\u0000", 28, "latin1");
  assert.equal(voice.isOggOpus(vorbis), false, "Ogg must carry Opus");
  assert.equal(voice.isOggOpus(Buffer.from("OggS")), false);

  const options = voice.parseOptions(["--provider", "elevenlabs"], elevenEnv);
  const asset = { file: "hello-bn", text: "হ্যালো, বন্ধু!", language: "bn" };
  await assert.rejects(
    voice.synthesizeElevenLabs(asset, options, { fetch: async () => response(200, Buffer.from("ID3 mp3"), { "Content-Type": "audio/mpeg" }), sleep: async () => undefined }),
    /did not return Ogg Opus audio for hello-bn \(audio\/mpeg\), so nothing was written/,
  );
  // In a run, the clip fails and nothing is written for it.
  const out = path.join(dir, "eleven-not-ogg");
  await assert.rejects(
    voice.generate(voice.parseOptions(["--provider", "elevenlabs", "--out", out], elevenEnv), { assets: [asset], fetch: async () => response(200, Buffer.from("<html>busy</html>"), { "Content-Type": "text/html" }), sleep: async () => undefined, log: () => undefined }),
    /did not return Ogg Opus/,
  );
  assert.equal(existsSync(path.join(out, "hello-bn.ogg")), false);
  assert.deepEqual(JSON.parse(readFileSync(path.join(out, voice.MANIFEST_FILE), "utf8")).files, {});
});

test("generating with ElevenLabs writes .ogg files under the same names and records provider, model and voice for learner playback", async () => {
  const out = path.join(dir, "elevenlabs");
  const assets = [
    { file: "hello-bn", text: "হ্যালো, বন্ধু!", language: "bn" },
    { file: "story-1-en", text: "Maya stood beside a wide river.", language: "en" },
    { file: "story-1-bn", text: "মায়া একটি চওড়া নদীর পাশে দাঁড়াল।", language: "bn" },
  ];
  await voice.generate(voice.parseOptions(["--out", out], {}), { assets: assets.slice(0, 1), synthesize: async () => ogg("espeak"), log: () => undefined });
  const requests = [];
  const fetch = async (url, init) => { requests.push({ url, body: JSON.parse(init.body) }); return response(200, oggOpus(`eleven-${requests.length}`)); };
  const lines = [];
  const run = await voice.generate(voice.parseOptions(["--provider", "elevenlabs", "--force", "--out", out], elevenEnv), { assets, fetch, log: (line) => lines.push(line) });
  assert.deepEqual([run.generated, run.kept], [3, 0]);
  for (const asset of assets) assert.ok(voice.isOggOpus(readFileSync(path.join(out, `${asset.file}.ogg`))), asset.file);
  const files = JSON.parse(readFileSync(path.join(out, voice.MANIFEST_FILE), "utf8")).files;
  assert.deepEqual(files, {
    "hello-bn": { provider: "elevenlabs", voice: "BanglaVoice000000001", model: "eleven_v4" },
    "story-1-bn": { provider: "elevenlabs", voice: "BanglaVoice000000001", model: "eleven_v4" },
    "story-1-en": { provider: "elevenlabs", voice: "EnglishVoice00000002", model: "eleven_v4" },
  });
  // Learner playback treats them as neural provider clips.
  for (const asset of assets) assert.equal(isNeuralClip(asset.file, files), true, asset.file);
  const english = requests.find((request) => request.body.text.startsWith("Maya"));
  assert.match(english.url, /\/EnglishVoice00000002\?/);
  assert.equal(english.body.language_code, "en");
  assert.equal(requests.find((request) => request.body.text.startsWith("মায়া")).body.language_code, "bn");
  assert.ok(lines.every((line) => !line.includes(elevenEnv.ELEVENLABS_API_KEY)), "the key is never printed");
  assert.ok(lines.some((line) => /made 3 clips \(\d+ characters\) with elevenlabs/.test(line)));

  // --only takes a list; without --force the clips that exist are kept.
  const listed = await voice.generate(voice.parseOptions(["--provider", "elevenlabs", "--force", "--only", "story-1-bn, hello-bn", "--out", out], elevenEnv), { assets, fetch, log: () => undefined });
  assert.equal(listed.generated, 2);
  const kept = await voice.generate(voice.parseOptions(["--provider", "elevenlabs", "--out", out], elevenEnv), { assets, fetch: noFetch, log: () => undefined });
  assert.deepEqual([kept.generated, kept.kept], [0, 3]);
});

test("ElevenLabs clips are made two at a time", async () => {
  const assets = Array.from({ length: 6 }, (_, index) => ({ file: `word-${index}`, text: `শব্দ ${index}`, language: "bn" }));
  let active = 0;
  let peak = 0;
  const fetch = async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return response(200, oggOpus("x"));
  };
  const run = await voice.generate(voice.parseOptions(["--provider", "elevenlabs", "--out", path.join(dir, "eleven-concurrency")], elevenEnv), { assets, fetch, log: () => undefined });
  assert.equal(run.generated, 6);
  assert.equal(peak, 2);
});

test("a stopped ElevenLabs run keeps what it made, and --resume makes only the rest", async () => {
  const out = path.join(dir, "eleven-resume");
  const assets = Array.from({ length: 5 }, (_, index) => ({ file: `clip-${index}`, text: `বাক্য ${index}`, language: "bn" }));
  await voice.generate(voice.parseOptions(["--out", out], {}), { assets: assets.slice(0, 1), synthesize: async () => ogg("espeak"), log: () => undefined });
  const quota = { detail: { status: "quota_exceeded", message: "This request exceeds your quota." } };
  const first = async (url, init) => (JSON.parse(init.body).text === "বাক্য 2" ? answer(401, quota) : response(200, oggOpus("first")));
  const options = voice.parseOptions(["--provider", "elevenlabs", "--force", "--out", out], elevenEnv);
  await assert.rejects(voice.generate(options, { assets, fetch: first, log: () => undefined }), /quota_exceeded.*--resume to make only the rest/);
  const made = Object.entries(JSON.parse(readFileSync(path.join(out, voice.MANIFEST_FILE), "utf8")).files)
    .filter(([, entry]) => entry.provider === "elevenlabs").map(([file]) => file);
  assert.ok(made.length >= 1 && !made.includes("clip-2"), made.join());

  const sent = [];
  const second = async (url, init) => { sent.push(JSON.parse(init.body).text); return response(200, oggOpus("second")); };
  const resumed = await voice.generate(voice.parseOptions(["--provider", "elevenlabs", "--force", "--resume", "--out", out], elevenEnv), { assets, fetch: second, log: () => undefined });
  assert.equal(resumed.generated, 5 - made.length);
  assert.equal(resumed.kept, made.length);
  for (const file of made) assert.ok(!sent.includes(`বাক্য ${file.slice(-1)}`), `${file} is not paid for twice`);
  assert.ok(Object.values(resumed.manifest.files).every((entry) => entry.provider === "elevenlabs"), "the eSpeak clip was replaced too");
  // Another voice is a different clip, so --resume makes it again.
  const otherVoice = await voice.generate(voice.parseOptions(["--provider", "elevenlabs", "--resume", "--voice", "OtherBanglaVoice0003", "--out", out], elevenEnv), { assets, fetch: second, log: () => undefined });
  assert.equal(otherVoice.generated, 5);
});

test("a dry run counts the clips and characters it would send and calls nothing", async () => {
  const out = path.join(dir, "eleven-dry");
  const assets = [
    { file: "word-river-bn", text: "নদী", language: "bn" },
    { file: "story-1-en", text: "Hello", language: "en" },
    { file: "word-boat-bn", text: "নৌকা", language: "bn" },
  ];
  const lines = [];
  const run = await voice.generate(voice.parseOptions(["--provider", "elevenlabs", "--dry-run", "--force", "--out", out], {}), { assets, fetch: noFetch, log: (line) => lines.push(line) });
  assert.deepEqual(run.planned, { clips: 3, characters: 12, bn: { clips: 2, characters: 7 }, en: { clips: 1, characters: 5 } });
  assert.equal(run.generated, 0);
  assert.equal(existsSync(out), false, "nothing is written");
  assert.match(lines.join("\n"), /would make 3 clips with elevenlabs, 12 characters in all/);
  assert.match(lines.join("\n"), /2 clips in Bangla, 7 characters \(elevenlabs, eleven_v4, voice not set\)/);
  // Without --force, clips that exist are not counted.
  await voice.generate(voice.parseOptions(["--out", out], {}), { assets: assets.slice(0, 1), synthesize: async () => ogg("espeak"), log: () => undefined });
  const partial = await voice.generate(voice.parseOptions(["--provider", "elevenlabs", "--dry-run", "--out", out], elevenEnv), { assets, fetch: noFetch, log: () => undefined });
  assert.deepEqual([partial.planned.clips, partial.planned.characters, partial.kept], [2, 9, 1]);
});

test("eleven_multilingual_v2 is refused for Bangla clips before anything is sent, and allowed for English ones", async () => {
  const out = path.join(dir, "eleven-v2");
  const assets = [{ file: "story-1-en", text: "Maya stood beside a wide river.", language: "en" }, { file: "story-1-bn", text: "মায়া", language: "bn" }];
  const options = voice.parseOptions(["--provider", "elevenlabs", "--model", "eleven_multilingual_v2", "--force", "--out", out], elevenEnv);
  await assert.rejects(voice.generate(options, { assets, fetch: noFetch, log: () => undefined }), /eleven_multilingual_v2 does not speak Bangla.*eleven_v4/);
  await assert.rejects(voice.generate({ ...options, dryRun: true }, { assets, fetch: noFetch, log: () => undefined }), /does not speak Bangla/);
  const bodies = [];
  const english = await voice.generate(voice.parseOptions(["--provider", "elevenlabs", "--model", "eleven_multilingual_v2", "--only", "story-1-en", "--out", out], elevenEnv), {
    assets, fetch: async (url, init) => { bodies.push(JSON.parse(init.body)); return response(200, oggOpus("en")); }, log: () => undefined,
  });
  assert.equal(english.generated, 1);
  assert.deepEqual(bodies, [{ text: "Maya stood beside a wide river.", model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.7, similarity_boost: 0.75 } }]);
  assert.deepEqual(english.manifest.files["story-1-en"], { provider: "elevenlabs", voice: "EnglishVoice00000002", model: "eleven_multilingual_v2" });
});

test("the sample clips exist, one each, and include Maya's name and an English line", async () => {
  const assets = await voice.allAssets();
  assert.ok(voice.SAMPLE_CLIPS.length >= 3 && voice.SAMPLE_CLIPS.length <= 5);
  for (const name of voice.SAMPLE_CLIPS) assert.equal(assets.filter((asset) => asset.file.startsWith(name)).length, 1, name);
  assert.match(assets.find((asset) => asset.file === "story-1-bn").text, /মায়া/);
  assert.ok(voice.SAMPLE_CLIPS.includes("story-1-bn"));
  assert.ok(voice.SAMPLE_CLIPS.some((name) => assets.find((asset) => asset.file === name).language === "en"));
});
