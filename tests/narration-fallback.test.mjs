import assert from "node:assert/strict";
import test from "node:test";

const {
  replyAction, isNotConfiguredReply, isSavedOnlyReply, deviceFallback, deviceLocale, speechParts, voiceLine, unavailableNote,
  deviceFailureNote, DEVICE_START_TIMEOUT_MS, NARRATION_NOT_CONFIGURED_CODE, NARRATION_SAVED_ONLY_CODE, NARRATION_STATUS_TTL_MS,
} = await import("../lib/narration-fallback.ts");
const generated = await import("../lib/generated-narration.ts");
const { NARRATION_STATUS_MAX_AGE_SECONDS } = await import("../lib/narration-handler.ts");
const { splitNarration } = await import("../lib/narration-model.ts");

const english = { lang: "en-US", name: "English (US)" };
const britishEnglish = { lang: "en_GB", name: "English (UK)" };
const banglaIndia = { lang: "bn-IN", name: "Bangla (India)" };
const banglaBangladesh = { lang: "bn-BD", name: "Bangla (Bangladesh)" };
const hindi = { lang: "hi-IN", name: "Hindi" };
const notConfigured = { error: "New narration is not configured. Saved audio is still available.", errorBn: "নতুন কণ্ঠ তৈরি চালু করা হয়নি। সংরক্ষিত অডিও এখনো শোনা যাবে।", code: "narration-not-configured" };

test("audio the server sends plays, whether saved or newly made with a key", () => {
  assert.equal(replyAction(200, null), "play");
  assert.equal(replyAction(204, {}), "play");
});

test("only the server's not-configured reply hands the text to the device voice", () => {
  assert.equal(NARRATION_NOT_CONFIGURED_CODE, "narration-not-configured");
  assert.equal(replyAction(503, notConfigured), "device");
  assert.equal(isNotConfiguredReply(503, notConfigured), true);
  // The same code on another status, a different 503, or no payload is a real error.
  assert.equal(replyAction(500, notConfigured), "error");
  assert.equal(replyAction(503, { error: notConfigured.error }), "error", "the message alone is not machine-readable");
  assert.equal(replyAction(503, { error: "Narration is busy. Please try again shortly." }), "error");
  assert.equal(replyAction(503, {}), "error");
  assert.equal(replyAction(503, null), "error");
  assert.equal(replyAction(503, "narration-not-configured"), "error");
  for (const [status, error] of [[401, "Sign in to listen to this content."], [403, "Choose your own password before you continue."], [404, "This content is no longer available."], [409, "This content has changed. Refresh it before listening."], [429, "Today's narration allowance has been used. Saved audio is still available."]]) {
    assert.equal(replyAction(status, { error }), "error", `${status} stays an error`);
  }
});

test("a staff preview awaiting approval with nothing saved is read by the device voice, not shown as an error", () => {
  const savedOnly = { error: "New narration is made only for approved, open activities. Saved audio still plays.", errorBn: "নতুন কণ্ঠ শুধু অনুমোদিত ও খোলা কার্যক্রমের জন্য তৈরি হয়। সংরক্ষিত অডিও এখনো শোনা যাবে।", code: "narration-saved-only" };
  // The page and the server agree on both codes.
  assert.equal(NARRATION_SAVED_ONLY_CODE, generated.NARRATION_SAVED_ONLY);
  assert.equal(NARRATION_NOT_CONFIGURED_CODE, generated.NARRATION_NOT_CONFIGURED);
  assert.equal(replyAction(409, savedOnly), "device");
  assert.equal(isSavedOnlyReply(409, savedOnly), true);
  // It is not a "not configured" answer: the server may still have a key for approved text.
  assert.equal(isNotConfiguredReply(409, savedOnly), false);
  // Only that code on a 409: "content has changed" and the same code on another status stay errors.
  assert.equal(replyAction(409, { error: "This content has changed. Refresh it before listening." }), "error");
  assert.equal(replyAction(503, savedOnly), "error");
  assert.equal(replyAction(409, { ...savedOnly, code: undefined }), "error");
});

test("a device voice that fails or never starts gives a calm note that never mentions a recording", () => {
  for (const audience of ["learner", "adult"]) {
    for (const language of ["en", "bn"]) {
      // A voice or language the device cannot use: the same note as having no voice at all.
      for (const code of ["language-unavailable", "voice-unavailable", "synthesis-unavailable"]) {
        assert.equal(deviceFailureNote(code, audience, language), unavailableNote(audience, language), code);
      }
      // Anything else, or speech that never started: the device could not read it aloud.
      for (const code of ["synthesis-failed", "network", "not-allowed", "audio-busy", undefined]) {
        const note = deviceFailureNote(code, audience, language);
        assert.notEqual(note, unavailableNote(audience, language));
        assert.doesNotMatch(note, /recording|রেকর্ডিং|try again|আবার চেষ্টা/i, String(code));
      }
    }
  }
  assert.equal(deviceFailureNote("synthesis-failed", "learner", "en"), "This device could not read the text aloud. Read it on the screen instead.");
  assert.match(deviceFailureNote(undefined, "learner", "bn"), /পড়ে নাও।$/);
  assert.match(deviceFailureNote(undefined, "adult", "bn"), /পড়ে নিন।$/);
  assert.ok(DEVICE_START_TIMEOUT_MS >= 2000 && DEVICE_START_TIMEOUT_MS <= 5000);
});

test("English text with no saved audio and no key is read by an English device voice", () => {
  const choice = deviceFallback([hindi, english, banglaBangladesh], "en");
  assert.equal(choice.kind, "device");
  assert.equal(choice.voice, english);
  assert.equal(choice.lang, deviceLocale("en"));
  assert.equal(deviceFallback([britishEnglish], "en").voice, britishEnglish, "any English locale may read English");
});

test("Bangla text is read only by a Bangla device voice, preferring Bangladesh", () => {
  assert.equal(deviceFallback([english, banglaIndia, banglaBangladesh], "bn").voice, banglaBangladesh);
  assert.equal(deviceFallback([english, banglaIndia], "bn").voice, banglaIndia);
  assert.equal(deviceFallback([english, banglaBangladesh], "bn").lang, "bn-BD");
  // An English (or any other) voice never reads Bangla, and a Bangla voice never reads English.
  assert.deepEqual(deviceFallback([english, britishEnglish, hindi], "bn"), { kind: "unavailable" });
  assert.deepEqual(deviceFallback([banglaBangladesh], "en"), { kind: "unavailable" });
});

test("with no device voices at all the calm note is shown instead of an error", () => {
  assert.deepEqual(deviceFallback([], "bn"), { kind: "unavailable" });
  assert.deepEqual(deviceFallback([], "en"), { kind: "unavailable" });
  assert.equal(unavailableNote("learner", "en"), "Audio isn't available for this text on this device yet. Read it on the screen instead.");
  assert.equal(unavailableNote("adult", "en"), unavailableNote("learner", "en"));
  // Learners are addressed informally in Bangla (নাও), grown-ups politely (নিন).
  assert.match(unavailableNote("learner", "bn"), /এই ডিভাইসে এখনো নেই।.*নাও।$/);
  assert.match(unavailableNote("adult", "bn"), /এই ডিভাইসে এখনো নেই।.*নিন।$/);
  for (const audience of ["learner", "adult"]) {
    for (const language of ["en", "bn"]) assert.doesNotMatch(unavailableNote(audience, language), /error|try again|আবার চেষ্টা|ত্রুটি/i);
  }
});

test("the voice line names ElevenLabs only for server audio, the device for device speech, and nothing untrue before playing", () => {
  const eleven = "Neural computer voice (ElevenLabs, elevenlabs.io)";
  const device = "This device's voice";
  // After playing: whatever actually played, whatever the server is configured to do.
  for (const configured of [true, false, null]) {
    assert.equal(voiceLine("server", configured, "en"), eleven);
    assert.equal(voiceLine("device", configured, "en"), device);
  }
  // Before playing: as before with a key; with no key, or not yet known, no line at all.
  assert.equal(voiceLine(null, true, "en"), eleven);
  assert.equal(voiceLine(null, false, "en"), null);
  assert.equal(voiceLine(null, null, "en"), null);
  assert.equal(voiceLine("server", false, "bn"), "নিউরাল কম্পিউটার কণ্ঠ (ElevenLabs, elevenlabs.io)");
  assert.equal(voiceLine("device", true, "bn"), "এই ডিভাইসের কণ্ঠ");
});

test("the page reuses the configured answer for as long as the server lets it be cached", () => {
  assert.equal(NARRATION_STATUS_TTL_MS, NARRATION_STATUS_MAX_AGE_SECONDS * 1000);
});

test("device speech is split into whole sentences without losing or reordering words", () => {
  const short = "নদীর কথা. আমাদের নদীর কথা পড়ো।";
  assert.deepEqual(speechParts(short), [short], "a short text is spoken whole");
  assert.deepEqual(speechParts("   "), []);
  const sentence = (index) => `Sentence number ${index} tells a little more about the rivers of Bangladesh and the boats on them.`;
  const long = Array.from({ length: 30 }, (_, index) => sentence(index)).join(" ");
  const parts = speechParts(long);
  assert.ok(parts.length > 1);
  for (const part of parts) {
    assert.ok(Array.from(part).length <= 220, part);
    assert.match(part, /\.$/, "parts end at a sentence");
  }
  assert.equal(parts.join(" "), long);
  const bangla = Array.from({ length: 12 }, () => "পদ্মা বাংলাদেশের একটি বড় নদী, এর পাশে অনেক গ্রাম আছে।").join(" ");
  const banglaParts = speechParts(bangla);
  assert.ok(banglaParts.length > 1);
  assert.equal(banglaParts.join(" "), bangla);
  // One sentence longer than a part is split at spaces; one with no spaces, by length.
  const runOn = Array.from({ length: 80 }, (_, index) => `word${index}`).join(" ");
  const runOnParts = speechParts(runOn);
  assert.ok(runOnParts.length > 1 && runOnParts.every((part) => Array.from(part).length <= 220));
  assert.equal(runOnParts.join(" "), runOn);
  const unbroken = "ক".repeat(500);
  assert.equal(speechParts(unbroken).join(""), unbroken);
  // What the server could not read, from any part on, is the same text the device reads.
  const passage = Array.from({ length: 40 }, (_, index) => sentence(index)).join(" ");
  assert.equal(splitNarration(passage).slice(0).join(""), passage);
  assert.equal(speechParts(splitNarration(passage).slice(1).join("")).join(" "), splitNarration(passage).slice(1).join("").trim());
});
