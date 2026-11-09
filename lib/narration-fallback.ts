// What a Listen control for topic and activity text does when the server
// cannot make new narration (no ElevenLabs key): saved audio still comes from
// the server first; for text with no saved audio the device's own voice for the
// text's language reads it, and when the device has none the control says so
// calmly. Bangla is never read by a voice for another language (see
// deviceVoiceFor). Pure functions, so the choices are tested without a browser.
import { deviceVoiceFor, type VoiceLike } from "./voice-playback";

export type NarrationLanguage = "en" | "bn";
/** Who is listening: Bangla addresses learners informally (তুমি) and grown-ups politely (আপনি). */
export type NarrationAudience = "learner" | "adult";
type Message = { en: string; bn: string };

/** The `code` /api/narration sends when new narration is not configured on the server. */
export const NARRATION_NOT_CONFIGURED_CODE = "narration-not-configured";
/**
 * The `code` /api/narration sends to staff previewing an activity that is not yet approved (or not
 * open) when no audio was saved for it: the server makes none for such text, with or without a key.
 */
export const NARRATION_SAVED_ONLY_CODE = "narration-saved-only";
/** Where the Listen controls ask whether new narration is configured. */
export const NARRATION_STATUS_URL = "/api/narration";
/** How long a page reuses that answer, matching the server's Cache-Control. */
export const NARRATION_STATUS_TTL_MS = 60_000;

/** True only for the server's "new narration is not configured" reply; every other refusal is a real error. */
export function isNotConfiguredReply(status: number, payload: unknown): boolean {
  return status === 503 && Boolean(payload) && typeof payload === "object"
    && (payload as { code?: unknown }).code === NARRATION_NOT_CONFIGURED_CODE;
}

/**
 * True only for the server's "only saved audio plays for this preview" reply (a staff preview of an
 * activity awaiting approval with nothing saved). The text is already on that reader's screen, so
 * the device may read it; the server still makes no audio for it.
 */
export function isSavedOnlyReply(status: number, payload: unknown): boolean {
  return status === 409 && Boolean(payload) && typeof payload === "object"
    && (payload as { code?: unknown }).code === NARRATION_SAVED_ONLY_CODE;
}

/**
 * What a Listen control does with the server's reply to one part: play the
 * audio it sent (saved, or newly made with a key), hand the text to the device
 * voice (no saved audio, and the server will not make any: no key, or a staff
 * preview of an activity not yet approved), or show the server's message as an
 * error (network, permission, withdrawn content, busy, allowance used...).
 */
export function replyAction(status: number, payload: unknown): "play" | "device" | "error" {
  if (status >= 200 && status < 300) return "play";
  return isNotConfiguredReply(status, payload) || isSavedOnlyReply(status, payload) ? "device" : "error";
}

/** The locale the device voice is asked for: the one the lesson pages use for each language. */
export const deviceLocale = (language: NarrationLanguage) => (language === "bn" ? "bn-BD" : "en-AU");
/** The speaking rate lessons use for each language. */
export const deviceRate = (language: NarrationLanguage) => (language === "bn" ? 0.78 : 0.88);

/**
 * What to do with text the server has no audio for and cannot make: read it
 * with a device voice for its language, or (when there is none) show the calm
 * note. An English voice never reads Bangla, nor a Bangla voice English.
 */
export function deviceFallback<V extends VoiceLike>(voices: readonly V[], language: NarrationLanguage):
  | { kind: "device"; voice: V; lang: string }
  | { kind: "unavailable" } {
  const lang = deviceLocale(language);
  const voice = deviceVoiceFor(voices, lang);
  return voice ? { kind: "device", voice, lang } : { kind: "unavailable" };
}

const SPEECH_PART_CHARACTERS = 220;

/**
 * Text split for a device voice: whole sentences, about 220 characters at most,
 * so a long passage is not cut short by browsers that stop long utterances.
 * A sentence longer than that is split at spaces (or, with none, by length).
 * No words are lost or reordered; blank parts are dropped.
 */
export function speechParts(text: string): string[] {
  const sentences = (text.match(/[^.!?।\n]*(?:[.!?।]+|\n+|$)\s*/gu) ?? []).filter(Boolean);
  const pieces: string[] = [];
  for (const sentence of sentences) {
    let rest = sentence;
    while (Array.from(rest).length > SPEECH_PART_CHARACTERS) {
      const characters = Array.from(rest);
      let cut = characters.lastIndexOf(" ", SPEECH_PART_CHARACTERS);
      if (cut <= 0) cut = SPEECH_PART_CHARACTERS;
      pieces.push(characters.slice(0, cut).join(""));
      rest = characters.slice(cut).join("");
    }
    pieces.push(rest);
  }
  const parts: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (current && Array.from(current + piece).length > SPEECH_PART_CHARACTERS) {
      parts.push(current);
      current = "";
    }
    current += piece;
  }
  if (current) parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** Where the sound a control last played came from. */
export type PlayedVoice = "server" | "device" | null;

const voiceLines: Record<"server" | "device", Message> = {
  server: { en: "Neural computer voice (ElevenLabs, elevenlabs.io)", bn: "নিউরাল কম্পিউটার কণ্ঠ (ElevenLabs, elevenlabs.io)" },
  device: { en: "This device's voice", bn: "এই ডিভাইসের কণ্ঠ" },
};

/**
 * The line under a Listen control saying whose voice it is, or null for none.
 * After something played it names that voice: ElevenLabs only for audio the
 * server sent, the device's voice when the device read it. Before anything has
 * played it names ElevenLabs only when the server says new narration is
 * configured (as it was before this fallback existed); otherwise, or while that
 * is not known, it says nothing rather than something untrue.
 */
export function voiceLine(played: PlayedVoice, configured: boolean | null, language: NarrationLanguage): string | null {
  const source = played ?? (configured === true ? "server" : null);
  return source ? voiceLines[source][language] : null;
}

const unavailableNotes: Record<NarrationAudience, Message> = {
  learner: {
    en: "Audio isn't available for this text on this device yet. Read it on the screen instead.",
    bn: "এই লেখার অডিও এই ডিভাইসে এখনো নেই। লেখাটি স্ক্রিনে পড়ে নাও।",
  },
  adult: {
    en: "Audio isn't available for this text on this device yet. Read it on the screen instead.",
    bn: "এই লেখার অডিও এই ডিভাইসে এখনো নেই। লেখাটি স্ক্রিনে পড়ে নিন।",
  },
};

/** The calm note (a status, not an error) when neither the server nor the device can read the text. */
export function unavailableNote(audience: NarrationAudience, language: NarrationLanguage): string {
  return unavailableNotes[audience][language];
}

const deviceFailedNotes: Record<NarrationAudience, Message> = {
  learner: {
    en: "This device could not read the text aloud. Read it on the screen instead.",
    bn: "এই ডিভাইস লেখাটি পড়ে শোনাতে পারেনি। লেখাটি স্ক্রিনে পড়ে নাও।",
  },
  adult: {
    en: "This device could not read the text aloud. Read it on the screen instead.",
    bn: "এই ডিভাইস লেখাটি পড়ে শোনাতে পারেনি। লেখাটি স্ক্রিনে পড়ে নিন।",
  },
};

/**
 * Speech errors meaning the device has no way to read this text (its voice or language is not
 * installed, or it has no speech engine): the same calm note as having no voice at all.
 */
const DEVICE_UNAVAILABLE_ERRORS = new Set(["language-unavailable", "voice-unavailable", "synthesis-unavailable"]);

/**
 * The calm note (a status, not an alert with Try again: nothing recorded was playing, and asking the
 * same speech engine again rarely helps) when the device's own voice failed or never started.
 * `error` is the speech error's code, or undefined when speech never started.
 */
export function deviceFailureNote(error: string | undefined, audience: NarrationAudience, language: NarrationLanguage): string {
  return error && DEVICE_UNAVAILABLE_ERRORS.has(error) ? unavailableNote(audience, language) : deviceFailedNotes[audience][language];
}

/** How long the device voice may take to start before the control gives up and says so. */
export const DEVICE_START_TIMEOUT_MS = 4000;
