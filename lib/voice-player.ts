// Plays a playback plan in the browser: each step in turn until one starts. A
// recording that cannot load, or a device voice that errors, hands over to the
// next step; when every step fails the caller is told.
import type { PlaybackStep, VoiceSource } from "./voice-playback";

export type PlaybackOptions = { text: string; lang: string; rate?: number; pitch?: number; volume?: number };
export type PlaybackHandlers = {
  /** False once a newer sound (or stop) has replaced this one; its events are then ignored. */
  isCurrent: () => boolean;
  onStart: (source: VoiceSource) => void;
  onEnd: () => void;
  onFail: () => void;
};

/** The device voices available now, or none when the browser has no speech synthesis. */
export function deviceVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
  try {
    return window.speechSynthesis.getVoices();
  } catch {
    return [];
  }
}

/** Stops whatever this player started: a recording or the device voice. */
export function stopPlayback(audioRef: { current: HTMLAudioElement | null }) {
  audioRef.current?.pause();
  audioRef.current = null;
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}

export function runPlayback(
  steps: PlaybackStep<SpeechSynthesisVoice>[],
  options: PlaybackOptions,
  audioRef: { current: HTMLAudioElement | null },
  handlers: PlaybackHandlers,
) {
  const attempt = (index: number) => {
    if (!handlers.isCurrent()) return;
    const step = steps[index];
    if (!step) {
      handlers.onFail();
      return;
    }
    let settled = false;
    const next = () => {
      if (settled || !handlers.isCurrent()) return;
      settled = true;
      attempt(index + 1);
    };

    if (step.source === "device") {
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(options.text);
        utterance.lang = options.lang;
        utterance.voice = step.voice;
        utterance.rate = options.rate ?? 0.8;
        utterance.pitch = options.pitch ?? 1;
        utterance.volume = options.volume ?? 1;
        utterance.onstart = () => { if (handlers.isCurrent()) handlers.onStart("device"); };
        utterance.onend = () => { if (handlers.isCurrent() && !settled) handlers.onEnd(); };
        utterance.onerror = (event) => {
          if (event.error === "canceled" || event.error === "interrupted") return;
          next();
        };
        window.speechSynthesis.speak(utterance);
      } catch {
        next();
      }
      return;
    }

    const audio = new Audio(step.url);
    audio.preload = "auto";
    audio.volume = options.volume ?? 0.92;
    audioRef.current = audio;
    audio.onplay = () => { if (handlers.isCurrent()) handlers.onStart(step.source); };
    audio.onended = () => {
      if (!handlers.isCurrent()) return;
      audioRef.current = null;
      handlers.onEnd();
    };
    const failed = () => {
      if (audioRef.current === audio) audioRef.current = null;
      next();
    };
    audio.onerror = failed;
    audio.play().catch(failed);
  };
  attempt(0);
}
