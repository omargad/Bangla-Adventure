"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { splitNarration } from "@/lib/narration-model";
import {
  DEVICE_START_TIMEOUT_MS, deviceFailureNote, deviceFallback, deviceRate, isNotConfiguredReply, NARRATION_STATUS_TTL_MS,
  NARRATION_STATUS_URL, replyAction, speechParts, unavailableNote, voiceLine, type PlayedVoice,
} from "@/lib/narration-fallback";
import { deviceVoices, loadDeviceVoices, runPlayback, unlockSpeech } from "@/lib/voice-player";
import styles from "./ContentNarration.module.css";

type Language = "en" | "bn";
type NarrationSource = { kind: "topic" | "activity"; id: string; slot: string; language: Language };
/** Who is listening: Bangla addresses learners informally (তুমি) and grown-ups politely (আপনি). */
type Audience = "learner" | "adult";
type Props = { source: NarrationSource; text: string; language: Language; label?: string; disabled?: boolean; audience?: Audience };
type Message = { en: string; bn: string };

// Separate buttons share playback ownership without retaining any recording.
const playbackEvents = new EventTarget();
const START_PLAYBACK = "start-content-narration";
const messages: Record<Audience, { unavailable: Message; playbackFailed: Message }> = {
  learner: {
    unavailable: { en: "Could not prepare the voice. Check your connection and try again.", bn: "কণ্ঠ প্রস্তুত করা যায়নি। সংযোগ দেখে আবার চেষ্টা করো।" },
    playbackFailed: { en: "Could not play this recording. Try again to listen.", bn: "রেকর্ডিংটি চালানো যায়নি। শুনতে আবার চেষ্টা করো।" },
  },
  adult: {
    unavailable: { en: "Could not prepare the voice. Check your connection and try again.", bn: "কণ্ঠ প্রস্তুত করা যায়নি। সংযোগ দেখে আবার চেষ্টা করুন।" },
    playbackFailed: { en: "Could not play this recording. Try again to listen.", bn: "রেকর্ডিংটি চালানো যায়নি। শুনতে আবার চেষ্টা করুন।" },
  },
};

/**
 * Whether the server can make new narration, asked once a minute for the whole
 * page (every control shares the answer); null while unknown or unanswered.
 */
let configuredAnswer: { at: number; value: Promise<boolean | null> } | null = null;
/** After an unanswered question the next one skips the browser's copy, so a kept refusal is never reused. */
let askAfresh = false;
function narrationConfigured(): Promise<boolean | null> {
  if (configuredAnswer && Date.now() - configuredAnswer.at < NARRATION_STATUS_TTL_MS) return configuredAnswer.value;
  const value = fetch(NARRATION_STATUS_URL, { credentials: "same-origin", ...(askAfresh ? { cache: "reload" as const } : {}) })
    .then((response) => (response.ok ? response.json() as Promise<{ configured?: unknown }> : null))
    .then((body) => (typeof body?.configured === "boolean" ? body.configured : null))
    .catch(() => null);
  const answer = { at: Date.now(), value };
  configuredAnswer = answer;
  // An unanswered question is asked again by the next control rather than remembered.
  void value.then((known) => {
    askAfresh = known === null;
    if (known === null && configuredAnswer === answer) configuredAnswer = null;
  });
  return value;
}
/** A "not configured" reply to a Listen is the newest answer. */
function rememberNotConfigured() {
  configuredAnswer = { at: Date.now(), value: Promise.resolve(false) };
}

class NarrationError extends Error {
  constructor(readonly messageText: Message) { super(messageText.en); }
}
/** The device's own voice failed (`error` is its speech error code) or never started (no code). */
class DeviceSpeechFailure extends Error {
  constructor(readonly error: string | undefined) { super(error ?? "device speech did not start"); }
}

/** A changed source, text or permission unmounts and stops the old recording. */
export default function ContentNarration(props: Props) {
  const { source, text, disabled } = props;
  const identity = JSON.stringify([source.kind, source.id, source.slot, source.language, text, Boolean(disabled)]);
  return <NarrationControl key={identity} {...props} />;
}

function NarrationControl({ source, text, language, label, disabled = false, audience = "learner" }: Props) {
  const s = (en: string, bn: string) => language === "bn" ? bn : en;
  const adult = audience === "adult";
  const { unavailable, playbackFailed } = messages[audience];
  const [phase, setPhase] = useState<"idle" | "preparing" | "playing">("idle");
  const [error, setError] = useState<Message | null>(null);
  /** The calm note when neither saved audio nor a device voice can read the text: a status, not an error. */
  const [note, setNote] = useState<Message | null>(null);
  const [played, setPlayed] = useState<PlayedVoice>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const owner = useRef(Symbol("content-narration"));
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const objectUrl = useRef<string | null>(null);
  /** True while this control has the device voice speaking, so Stop cancels only its own speech. */
  const speaking = useRef(false);
  const deviceAudio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let live = true;
    // Asking once makes the browser start loading its voices before the first Listen, as the lessons do.
    deviceVoices();
    void narrationConfigured().then((known) => { if (live) setConfigured(known); });
    return () => { live = false; };
  }, []);

  const releaseAudio = useCallback(() => {
    if (audio.current) {
      audio.current.pause();
      audio.current.removeAttribute("src");
      audio.current.load();
      audio.current = null;
    }
    if (objectUrl.current) {
      URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = null;
    }
  }, []);

  const stop = useCallback((update = true) => {
    generation.current += 1;
    request.current?.abort();
    request.current = null;
    releaseAudio();
    if (speaking.current) {
      speaking.current = false;
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    }
    if (update) setPhase("idle");
  }, [releaseAudio]);

  useEffect(() => {
    const anotherStarted = (event: Event) => {
      if ((event as CustomEvent<symbol>).detail !== owner.current && request.current) stop();
    };
    playbackEvents.addEventListener(START_PLAYBACK, anotherStarted);
    return () => {
      playbackEvents.removeEventListener(START_PLAYBACK, anotherStarted);
      stop(false);
    };
  }, [stop]);

  /** A note or an error says nothing played this time, so no voice line may claim one did. */
  const showNote = (message: Message) => { setPlayed("nothing"); setNote(message); };

  async function listen() {
    if (request.current) { stop(); return; }
    if (disabled || !text.trim()) return;
    stop(false);
    // Inside the tap, before anything is awaited, so a device voice may start later on iPhone and iPad.
    unlockSpeech();
    const controller = new AbortController();
    request.current = controller;
    const token = generation.current;
    const current = () => token === generation.current && !controller.signal.aborted;
    playbackEvents.dispatchEvent(new CustomEvent(START_PLAYBACK, { detail: owner.current }));
    setError(null);
    setNote(null);
    // A new Listen is no longer the one that played nothing.
    setPlayed((last) => (last === "nothing" ? null : last));
    setPhase("preparing");
    try {
      const chunks = splitNarration(text);
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      for (let part = 0; part < chunks.length; part += 1) {
        if (!current()) return;
        setPhase("preparing");
        // Every click and part rechecks current server permission/publication.
        const response = await fetch("/api/narration", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...source, hash, part }),
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({})) as { error?: unknown; errorBn?: unknown };
          if (replyAction(response.status, payload) === "device") {
            // No saved audio for this part and the server will make none (no key, or a preview awaiting
            // approval): the device reads the rest, or the note says it cannot.
            if (isNotConfiguredReply(response.status, payload)) {
              rememberNotConfigured();
              setConfigured(false);
            }
            await speakOnDevice(chunks.slice(part).join(""), controller.signal, current);
            return;
          }
          throw new NarrationError({
            en: typeof payload.error === "string" ? payload.error : unavailable.en,
            bn: typeof payload.errorBn === "string" ? payload.errorBn : unavailable.bn,
          });
        }
        const recording = await response.blob();
        if (!current()) return;
        if (!recording.size || !/^audio\/ogg(?:;|$)/i.test(response.headers.get("Content-Type") ?? "")) {
          throw new NarrationError(unavailable);
        }
        objectUrl.current = URL.createObjectURL(recording);
        const player = new Audio(objectUrl.current);
        audio.current = player;
        await new Promise<void>((resolve, reject) => {
          let finished = false;
          const clean = () => {
            finished = true;
            player.removeEventListener("ended", done);
            player.removeEventListener("error", failed);
            controller.signal.removeEventListener("abort", done);
          };
          const done = () => { clean(); resolve(); };
          const failed = () => { clean(); reject(new NarrationError(playbackFailed)); };
          player.addEventListener("ended", done, { once: true });
          player.addEventListener("error", failed, { once: true });
          controller.signal.addEventListener("abort", done, { once: true });
          void player.play().then(() => {
            if (!finished && current()) { setPhase("playing"); setPlayed("server"); }
          }).catch(failed);
        });
        if (!current()) return;
        releaseAudio();
      }
    } catch (failure) {
      if (current()) {
        if (failure instanceof DeviceSpeechFailure) {
          showNote(deviceFailureNote(failure.error, audience));
        } else {
          setPlayed("nothing");
          setError(failure instanceof NarrationError ? failure.messageText : unavailable);
        }
      }
    } finally {
      if (current()) {
        request.current = null;
        if (speaking.current) {
          speaking.current = false;
          if ("speechSynthesis" in window) window.speechSynthesis.cancel();
        }
        releaseAudio();
        setPhase("idle");
      }
    }
  }

  /**
   * Reads `remaining` with a device voice for its language, part by part, until done or stopped.
   * A part that fails, or that has not started within DEVICE_START_TIMEOUT_MS (a browser that
   * silently dropped the speech), ends the reading with a DeviceSpeechFailure.
   */
  async function speakOnDevice(remaining: string, signal: AbortSignal, current: () => boolean) {
    const voices = await loadDeviceVoices();
    if (!current()) return;
    const choice = deviceFallback(voices, source.language);
    if (choice.kind === "unavailable") {
      showNote(unavailableNote(audience));
      return;
    }
    for (const piece of speechParts(remaining)) {
      if (!current()) return;
      speaking.current = true;
      await new Promise<void>((resolve, reject) => {
        let started = false;
        let over = false;
        const finish = (failure?: DeviceSpeechFailure) => {
          if (over) return;
          over = true;
          window.clearTimeout(watchdog);
          signal.removeEventListener("abort", stopped);
          if (failure) reject(failure); else resolve();
        };
        const stopped = () => finish();
        signal.addEventListener("abort", stopped, { once: true });
        const watchdog = window.setTimeout(() => { if (!started) finish(new DeviceSpeechFailure(undefined)); }, DEVICE_START_TIMEOUT_MS);
        runPlayback([{ source: "device", voice: choice.voice }], { text: piece, lang: choice.lang, rate: deviceRate(source.language) }, deviceAudio, {
          isCurrent: () => current() && !over,
          onStart: () => { started = true; setPhase("playing"); setPlayed("device"); },
          onEnd: () => finish(),
          onFail: (speechError) => finish(new DeviceSpeechFailure(speechError)),
        });
      });
    }
    speaking.current = false;
  }

  const idleLabel = label ?? s("Listen", adult ? "শুনুন" : "শুনি");
  const active = phase !== "idle";
  const providerLine = voiceLine(played, configured, language);
  const buttonText = active ? s("Stop", adult ? "থামান" : "থামাও") : error ? s("Try again", adult ? "আবার চেষ্টা করুন" : "আবার চেষ্টা") : idleLabel;
  return <div className={styles.control} data-narration-kind={source.kind} data-narration-slot={source.slot}>
    <div className={styles.actions}>
      <button type="button" className="outline-button" disabled={disabled || !text.trim()} onClick={() => void listen()} aria-label={!active && error ? `${buttonText}: ${idleLabel}` : undefined}>
        <span aria-hidden="true">{active ? "■" : "♪"}</span> {buttonText}
      </button>
      <span role="status" aria-live="polite" className={styles.status}>
        {phase === "preparing" ? s("Preparing voice…", "কণ্ঠ প্রস্তুত হচ্ছে…") : phase === "playing" ? s("Playing", "চলছে") : note?.[language] ?? ""}
      </span>
    </div>
    {providerLine && <small className={styles.provider}>{providerLine}</small>}
    {error && <p role="alert" className={styles.error}>{error[language]}</p>}
  </div>;
}
