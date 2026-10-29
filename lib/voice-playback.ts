// Which sound plays when a learner presses a listen button, everywhere Bangla is
// spoken: an approved human recording, then a clip from a neural text-to-speech
// provider, then the device's own Bangla voice, then the bundled eSpeak clip.
// When none of these exists nothing plays and the page says so; Bangla is never
// read out by a voice for another language.
import voiceManifest from "../public/audio/voice-manifest.json";

export type Language = "en" | "bn";
/** Where a sound comes from: a person, a neural provider's clip, the device, or the bundled eSpeak clip. */
export type VoiceSource = "human" | "provider" | "device" | "computer";
/** The bundled clip behind a listen button, and the lesson part it belongs to when a teacher can record it. */
export type Clip = { file: string; lessonId?: string; slot?: string };
/** Approved human recordings learners hear, keyed `${lessonId}/${slot}`, valued by the recording id. */
export type RecordingMap = Record<string, string>;
/** The parts of SpeechSynthesisVoice the choice needs, so it can be tested without a browser. */
export type VoiceLike = { lang: string; name?: string };
export type PlaybackStep<V extends VoiceLike = VoiceLike> =
  | { source: "human" | "provider" | "computer"; url: string }
  | { source: "device"; voice: V };
/** What the page shows about the sound: what is playing, or that nothing can. */
export type VoiceStatus =
  | { state: "playing"; source: VoiceSource; lang: string }
  | { state: "none"; lang: string }
  | { state: "failed"; lang: string };

type ManifestEntry = { provider: string; voice: string };
const manifestFiles: Record<string, ManifestEntry | undefined> = (voiceManifest as { files: Record<string, ManifestEntry> }).files;

/** Text-to-speech providers whose clips sound better than a device voice. eSpeak is not one. */
export const NEURAL_PROVIDERS: ReadonlySet<string> = new Set(["azure"]);
export const LESSON_AUDIO_SLOT = /^(dialogue|reading|word-[1-6]|pattern-[1-2])$/;

export const lessonClip = (lessonId: string, slot: string): Clip => ({ file: `lesson-${lessonId}-${slot}`, lessonId, slot });
export const bundledClip = (file: string): Clip => ({ file });

/** The engine and voice that made a bundled clip, from public/audio/voice-manifest.json. */
export function bundledVoice(file: string, files: Record<string, ManifestEntry | undefined> = manifestFiles): ManifestEntry | null {
  return files[file] ?? null;
}

export function isNeuralClip(file: string, files: Record<string, ManifestEntry | undefined> = manifestFiles): boolean {
  const entry = bundledVoice(file, files);
  return Boolean(entry && NEURAL_PROVIDERS.has(entry.provider));
}

const normalizeLang = (lang: string) => lang.trim().toLowerCase().replace(/_/g, "-");
const langRoot = (lang: string) => normalizeLang(lang).split("-")[0];

/**
 * The device voice that may read text in `lang`, or null. Only a voice for the
 * same language counts; for Bangla a bn-BD voice is preferred, then bn-IN, then
 * any other Bangla voice. For other languages the exact locale comes first.
 */
export function deviceVoiceFor<V extends VoiceLike>(voices: readonly V[], lang: string): V | null {
  const wanted = normalizeLang(lang);
  const root = langRoot(lang);
  const preference = root === "bn" ? [wanted, "bn-bd", "bn-in"] : [wanted];
  const candidates = voices.filter((voice) => typeof voice.lang === "string" && langRoot(voice.lang) === root);
  for (const locale of preference) {
    const match = candidates.find((voice) => normalizeLang(voice.lang) === locale);
    if (match) return match;
  }
  return candidates[0] ?? null;
}

const lessonAudioUrl = (clip: Clip) => `/api/audio/${encodeURIComponent(clip.lessonId!)}/${encodeURIComponent(clip.slot!)}`;

/**
 * Where the bundled clip is fetched from. Lesson parts go through /api/audio,
 * which serves a recording a teacher approved after this page loaded; once the
 * page knows of a recording, the bundled clip is its fallback and comes
 * straight from public/audio.
 */
function bundledUrl(clip: Clip, recordingId?: string): string {
  return clip.lessonId && clip.slot && !recordingId ? lessonAudioUrl(clip) : `/audio/${clip.file}.ogg`;
}

/**
 * The sounds to try, best first. Each later step is the fallback when the one
 * before cannot play (a missing file, no network, a voice error). An empty plan
 * means nothing can be played on this device.
 */
export function playbackPlan<V extends VoiceLike>({ lang, voices, clip, recordings, files = manifestFiles }: {
  lang: string;
  voices: readonly V[];
  clip?: Clip;
  recordings?: RecordingMap;
  files?: Record<string, ManifestEntry | undefined>;
}): PlaybackStep<V>[] {
  const steps: PlaybackStep<V>[] = [];
  const recordingId = clip?.lessonId && clip.slot ? recordings?.[`${clip.lessonId}/${clip.slot}`] : undefined;
  // Asked for by id: if a teacher has since stopped using it, /api/audio answers 404 and the next voice plays.
  if (clip && recordingId) steps.push({ source: "human", url: `${lessonAudioUrl(clip)}?v=${encodeURIComponent(recordingId)}` });
  const bundled = clip ? bundledVoice(clip.file, files) : null;
  const neural = Boolean(clip && bundled && NEURAL_PROVIDERS.has(bundled.provider));
  if (clip && neural) steps.push({ source: "provider", url: bundledUrl(clip, recordingId) });
  const voice = deviceVoiceFor(voices, lang);
  if (voice) steps.push({ source: "device", voice });
  // A clip missing from the manifest was made before it existed, which means with eSpeak.
  if (clip && !neural) steps.push({ source: "computer", url: bundledUrl(clip, recordingId) });
  return steps;
}

const sourceLabels: Record<VoiceSource, Record<Language, string>> = {
  human: { en: "Recorded voice", bn: "রেকর্ড করা কণ্ঠ" },
  provider: { en: "Neural computer voice: may mispronounce some words", bn: "উন্নত কম্পিউটার কণ্ঠ: কিছু শব্দ ভুল উচ্চারণ হতে পারে" },
  device: { en: "Device voice", bn: "এই ডিভাইসের কণ্ঠ" },
  computer: { en: "Computer voice: may mispronounce names", bn: "কম্পিউটারের কণ্ঠ: নাম ভুল উচ্চারণ হতে পারে" },
};

/** A short label for what is playing, in the page language. */
export function voiceLabel(source: VoiceSource, language: Language): string {
  return sourceLabels[source][language];
}

/** What the page says when nothing can read the text aloud. */
export function noVoiceNote(lang: string, language: Language): string {
  if (langRoot(lang) === "bn") return language === "bn" ? "এই ডিভাইসে কোনো বাংলা কণ্ঠ নেই" : "No Bangla voice on this device";
  return language === "bn" ? "এই ডিভাইসে কোনো ইংরেজি কণ্ঠ নেই" : "No English voice on this device";
}

/** The text for a voice status, or "" when there is nothing to say. */
export function voiceStatusText(status: VoiceStatus | null | undefined, language: Language): string {
  if (!status) return "";
  if (status.state === "playing") return voiceLabel(status.source, language);
  if (status.state === "none") return noVoiceNote(status.lang, language);
  return language === "bn" ? "শব্দ বাজানো গেল না। আবার চেষ্টা করো।" : "The sound could not play. Please try again.";
}
