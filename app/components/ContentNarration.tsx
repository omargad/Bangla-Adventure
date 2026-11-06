"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { splitNarration } from "@/lib/narration-model";
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

class NarrationError extends Error {
  constructor(readonly messageText: Message) { super(messageText.en); }
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
  const owner = useRef(Symbol("content-narration"));
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const objectUrl = useRef<string | null>(null);

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

  async function listen() {
    if (request.current) { stop(); return; }
    if (disabled || !text.trim()) return;
    stop(false);
    const controller = new AbortController();
    request.current = controller;
    const token = generation.current;
    const current = () => token === generation.current && !controller.signal.aborted;
    playbackEvents.dispatchEvent(new CustomEvent(START_PLAYBACK, { detail: owner.current }));
    setError(null);
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
            if (!finished && current()) setPhase("playing");
          }).catch(failed);
        });
        if (!current()) return;
        releaseAudio();
      }
    } catch (failure) {
      if (current()) setError(failure instanceof NarrationError ? failure.messageText : unavailable);
    } finally {
      if (current()) {
        request.current = null;
        releaseAudio();
        setPhase("idle");
      }
    }
  }

  const idleLabel = label ?? s("Listen", adult ? "শুনুন" : "শুনি");
  const active = phase !== "idle";
  const buttonText = active ? s("Stop", adult ? "থামান" : "থামাও") : error ? s("Try again", adult ? "আবার চেষ্টা করুন" : "আবার চেষ্টা") : idleLabel;
  return <div className={styles.control} data-narration-kind={source.kind} data-narration-slot={source.slot}>
    <div className={styles.actions}>
      <button type="button" className="outline-button" disabled={disabled || !text.trim()} onClick={() => void listen()} aria-label={!active && error ? `${buttonText}: ${idleLabel}` : undefined}>
        <span aria-hidden="true">{active ? "■" : "♪"}</span> {buttonText}
      </button>
      <span role="status" aria-live="polite" className={styles.status}>
        {phase === "preparing" ? s("Preparing voice…", "কণ্ঠ প্রস্তুত হচ্ছে…") : phase === "playing" ? s("Playing", "চলছে") : ""}
      </span>
    </div>
    <small className={styles.provider}>{s("Neural computer voice (ElevenLabs, elevenlabs.io)", "নিউরাল কম্পিউটার কণ্ঠ (ElevenLabs, elevenlabs.io)")}</small>
    {error && <p role="alert" className={styles.error}>{error[language]}</p>}
  </div>;
}
