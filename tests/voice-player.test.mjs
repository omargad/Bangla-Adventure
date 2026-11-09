import assert from "node:assert/strict";
import test from "node:test";

// A stand-in for the browser's speech synthesis, with timers the test moves by hand.
function fakeBrowser() {
  const timers = new Map();
  let clock = 0;
  let nextTimer = 1;
  const listeners = new Map();
  const speech = {
    voices: [],
    spoken: [],
    cancels: 0,
    getVoices: () => speech.voices,
    addEventListener: (type, listener, options) => {
      const list = listeners.get(type) ?? [];
      list.push({ listener, once: Boolean(options?.once) });
      listeners.set(type, list);
    },
    removeEventListener: (type, listener) => listeners.set(type, (listeners.get(type) ?? []).filter((entry) => entry.listener !== listener)),
    dispatch: (type) => {
      for (const entry of [...(listeners.get(type) ?? [])]) {
        if (entry.once) speech.removeEventListener(type, entry.listener);
        entry.listener();
      }
    },
    listenerCount: (type) => (listeners.get(type) ?? []).length,
    cancel: () => { speech.cancels += 1; },
    speak: (utterance) => { speech.spoken.push(utterance); },
  };
  class Utterance {
    constructor(text) { this.text = text; this.volume = 1; }
  }
  const window = {
    speechSynthesis: speech,
    SpeechSynthesisUtterance: Utterance,
    setTimeout: (callback, ms) => { const id = nextTimer++; timers.set(id, { at: clock + ms, callback }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
  };
  const advance = (ms) => {
    clock += ms;
    for (const [id, timer] of [...timers]) if (timer.at <= clock) { timers.delete(id); timer.callback(); }
  };
  return { window, speech, Utterance, advance, pendingTimers: () => timers.size };
}

const browser = fakeBrowser();
globalThis.window = browser.window;
globalThis.SpeechSynthesisUtterance = browser.Utterance;
const { loadDeviceVoices, runPlayback, unlockSpeech } = await import("../lib/voice-player.ts");
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("a device with no voices waits once, then answers at once until the browser reports new voices", async () => {
  const { speech, advance, pendingTimers } = browser;
  speech.voices = [];
  let first = null;
  void loadDeviceVoices(1500).then((voices) => { first = voices; });
  await flush();
  assert.equal(first, null, "the first Listen waits for the voices to load");
  assert.equal(pendingTimers(), 1);
  advance(1500);
  await flush();
  assert.deepEqual(first, []);

  // Later Listens on the same page do not wait 1.5 s again for an event that is not coming.
  let second = null;
  void loadDeviceVoices(1500).then((voices) => { second = voices; });
  await flush();
  assert.deepEqual(second, [], "answered without waiting");
  assert.equal(pendingTimers(), 0);

  // Once the browser reports a change, the next Listen waits again, and picks up voices that arrive.
  speech.dispatch("voiceschanged");
  let third = null;
  void loadDeviceVoices(1500).then((voices) => { third = voices; });
  await flush();
  assert.equal(third, null);
  advance(300);
  speech.voices = [{ lang: "bn-BD", name: "Bangla" }];
  speech.dispatch("voiceschanged");
  await flush();
  assert.deepEqual(third, speech.voices);
  assert.equal(pendingTimers(), 0);
  assert.equal(speech.listenerCount("voiceschanged"), 0, "no listener is left behind");
});

test("voices that arrive during the wait are used", async () => {
  const { speech, advance } = browser;
  speech.voices = [];
  speech.dispatch("voiceschanged");
  let answer = null;
  void loadDeviceVoices(1500).then((voices) => { answer = voices; });
  advance(200);
  speech.voices = [{ lang: "en-US", name: "English" }];
  speech.dispatch("voiceschanged");
  await flush();
  assert.deepEqual(answer, speech.voices);
});

test("unlocking speech speaks one silent, empty utterance at once", () => {
  const { speech } = browser;
  const before = speech.spoken.length;
  unlockSpeech();
  assert.equal(speech.spoken.length, before + 1);
  const silence = speech.spoken.at(-1);
  assert.equal(silence.text, "");
  assert.equal(silence.volume, 0);
});

test("a device voice that fails tells the caller its speech error; cancel and interrupt are not failures", () => {
  const { speech } = browser;
  const voice = { lang: "bn-BD", name: "Bangla" };
  for (const code of ["language-unavailable", "synthesis-failed"]) {
    const failures = [];
    runPlayback([{ source: "device", voice }], { text: "নদী", lang: "bn-BD" }, { current: null }, {
      isCurrent: () => true, onStart: () => {}, onEnd: () => {}, onFail: (error) => failures.push(error),
    });
    const utterance = speech.spoken.at(-1);
    utterance.onerror({ error: "interrupted" });
    utterance.onerror({ error: "canceled" });
    assert.deepEqual(failures, []);
    utterance.onerror({ error: code });
    assert.deepEqual(failures, [code]);
  }
  // With no steps at all there is no speech error to report.
  const failures = [];
  runPlayback([], { text: "x", lang: "en-AU" }, { current: null }, { isCurrent: () => true, onStart: () => {}, onEnd: () => {}, onFail: (error) => failures.push(error) });
  assert.deepEqual(failures, [undefined]);
});
