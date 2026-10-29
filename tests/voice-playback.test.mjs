import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";

const playback = await import("../lib/voice-playback.ts");
const { lessons } = await import("../app/curriculum.ts");
const { bundledClip, lessonClip, playbackPlan, deviceVoiceFor, voiceLabel, noVoiceNote, voiceStatusText, isNeuralClip } = playback;

const english = [{ lang: "en-US", name: "English (US)" }, { lang: "en-GB", name: "English (UK)" }];
const banglaIndia = { lang: "bn-IN", name: "Bangla (India)" };
const banglaBangladesh = { lang: "bn-BD", name: "Bangla (Bangladesh)" };
const espeakFiles = { "lesson-hello-me-word-1": { provider: "espeak", voice: "bn+f3" }, "hello-bn": { provider: "espeak", voice: "bn+f3" } };
const neuralFiles = { "lesson-hello-me-word-1": { provider: "azure", voice: "bn-BD-NabanitaNeural" }, "hello-bn": { provider: "azure", voice: "bn-BD-NabanitaNeural" } };
const sources = (steps) => steps.map((step) => step.source);

test("an approved human recording plays first, then the device's Bangla voice, then the bundled eSpeak clip", () => {
  const steps = playbackPlan({
    lang: "bn-BD", voices: [...english, banglaBangladesh], clip: lessonClip("hello-me", "word-1"),
    recordings: { "hello-me/word-1": "rec-1" }, files: espeakFiles,
  });
  assert.deepEqual(sources(steps), ["human", "device", "computer"]);
  assert.equal(steps[0].url, "/api/audio/hello-me/word-1?v=rec-1", "word recordings go through /api/audio, versioned by the recording");
  assert.equal(steps[1].voice, banglaBangladesh);
  assert.equal(steps[2].url, "/audio/lesson-hello-me-word-1.ogg", "behind a known recording, the bundled clip comes straight from public/audio");
  const plain = playbackPlan({ lang: "bn-BD", voices: [], clip: lessonClip("hello-me", "word-1"), files: espeakFiles });
  assert.deepEqual(plain, [{ source: "computer", url: "/api/audio/hello-me/word-1" }], "without one, it goes through /api/audio, which serves a newly approved recording");
});

test("a neural provider's clip plays before the device voice; an eSpeak clip only after it", () => {
  const clip = lessonClip("hello-me", "word-1");
  assert.deepEqual(sources(playbackPlan({ lang: "bn-BD", voices: [banglaBangladesh], clip, files: neuralFiles })), ["provider", "device"]);
  assert.deepEqual(sources(playbackPlan({ lang: "bn-BD", voices: [banglaBangladesh], clip, files: espeakFiles })), ["device", "computer"]);
  assert.deepEqual(
    sources(playbackPlan({ lang: "bn-BD", voices: [banglaBangladesh], clip, recordings: { "hello-me/word-1": "rec-1" }, files: neuralFiles })),
    ["human", "provider", "device"],
  );
  // A clip the manifest does not list was made before it existed, with eSpeak.
  assert.deepEqual(sources(playbackPlan({ lang: "bn-BD", voices: [], clip: bundledClip("unlisted"), files: {} })), ["computer"]);
});

test("Bangla is never read by an English voice: the bundled clip plays, or nothing does", () => {
  const steps = playbackPlan({ lang: "bn-BD", voices: english, clip: bundledClip("hello-bn"), files: espeakFiles });
  assert.deepEqual(steps, [{ source: "computer", url: "/audio/hello-bn.ogg" }]);
  // Hub pages have no bundled clip: with no Bangla voice there is nothing to play.
  assert.deepEqual(playbackPlan({ lang: "bn-BD", voices: english }), []);
  assert.deepEqual(playbackPlan({ lang: "bn-BD", voices: [] }), []);
  assert.deepEqual(sources(playbackPlan({ lang: "bn-BD", voices: [...english, banglaIndia] })), ["device"]);
});

test("a recording for another lesson part does not apply", () => {
  const steps = playbackPlan({ lang: "bn-BD", voices: [], clip: lessonClip("hello-me", "word-2"), recordings: { "hello-me/word-1": "rec-1", "my-day/word-2": "rec-2" }, files: espeakFiles });
  assert.deepEqual(steps, [{ source: "computer", url: "/api/audio/hello-me/word-2" }]);
});

test("the device voice is a bn-BD voice when there is one, then bn-IN, then any Bangla voice", () => {
  assert.equal(deviceVoiceFor([banglaIndia, banglaBangladesh], "bn-BD"), banglaBangladesh);
  assert.equal(deviceVoiceFor([...english, banglaIndia], "bn-BD"), banglaIndia);
  const underscored = { lang: "bn_BD", name: "Android Bangla" };
  assert.equal(deviceVoiceFor([banglaIndia, underscored], "bn-BD"), underscored);
  const plain = { lang: "bn", name: "Bangla" };
  assert.equal(deviceVoiceFor([...english, plain], "bn-BD"), plain);
  assert.equal(deviceVoiceFor(english, "bn-BD"), null);
  assert.equal(deviceVoiceFor([{ lang: "en-US" }, { lang: "en-AU" }], "en-AU").lang, "en-AU");
  assert.equal(deviceVoiceFor([banglaBangladesh], "en-AU"), null);
});

test("English narration uses an English device voice before its bundled clip", () => {
  const clip = bundledClip("story-1-en");
  assert.deepEqual(sources(playbackPlan({ lang: "en-AU", voices: english, clip, files: {} })), ["device", "computer"]);
  assert.deepEqual(sources(playbackPlan({ lang: "en-AU", voices: [banglaBangladesh], clip, files: {} })), ["computer"]);
});

test("labels say what is playing, in English and Bangla, and never claim a bundled voice model", () => {
  assert.equal(voiceLabel("human", "en"), "Recorded voice");
  assert.equal(voiceLabel("device", "en"), "Device voice");
  assert.equal(voiceLabel("computer", "en"), "Computer voice: may mispronounce names");
  for (const source of ["human", "provider", "device", "computer"]) {
    assert.ok(voiceLabel(source, "en") && voiceLabel(source, "bn") && voiceLabel(source, "en") !== voiceLabel(source, "bn"), source);
    assert.match(voiceLabel(source, "bn"), /[ঀ-৿]/);
  }
  assert.equal(noVoiceNote("bn-BD", "en"), "No Bangla voice on this device");
  assert.match(noVoiceNote("bn-BD", "bn"), /বাংলা কণ্ঠ নেই/);
  assert.equal(voiceStatusText({ state: "playing", source: "device", lang: "bn-BD" }, "en"), "Device voice");
  assert.equal(voiceStatusText({ state: "none", lang: "bn-BD" }, "en"), "No Bangla voice on this device");
  assert.match(voiceStatusText({ state: "failed", lang: "bn-BD" }, "bn"), /আবার চেষ্টা/);
  assert.equal(voiceStatusText(null, "en"), "");
  const lessonSource = readFileSync(new URL("../app/components/LessonExperience.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(lessonSource, /Bundled Bangla voice model/);
  assert.doesNotMatch(lessonSource, /line\.speaker\}।/, "dialogue playback does not read the speakers' names");
});

test("the voice manifest lists every bundled clip with the engine and voice that made it", () => {
  const manifest = JSON.parse(readFileSync(new URL("../public/audio/voice-manifest.json", import.meta.url), "utf8"));
  const clips = readdirSync(new URL("../public/audio/", import.meta.url)).filter((file) => file.endsWith(".ogg")).map((file) => file.slice(0, -4)).sort();
  assert.deepEqual(Object.keys(manifest.files).sort(), clips);
  for (const lesson of lessons) {
    for (const slot of ["dialogue", "reading", "word-1", "word-6", "pattern-1", "pattern-2"]) assert.ok(manifest.files[`lesson-${lesson.id}-${slot}`], `${lesson.id} ${slot}`);
  }
  for (const [file, entry] of Object.entries(manifest.files)) {
    assert.ok(["espeak", "azure"].includes(entry.provider), `${file}: unknown provider ${entry.provider}`);
    assert.ok(entry.voice, `${file}: no voice recorded`);
    assert.equal(isNeuralClip(file), entry.provider === "azure", file);
  }
});
