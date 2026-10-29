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
