"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { lessonRecordingsUrl, playbackPlan, playingStatus, withLessonRecordings, type Clip, type RecordingMap, type VoiceStatus } from "./voice-playback";
import { deviceVoices, runPlayback, stopPlayback } from "./voice-player";

type SpeakOptions = { key?: string; lang?: string; clip?: Clip; rate?: number };

/**
 * Listen buttons for a page: plays the best sound available (see
 * lib/voice-playback.ts), remembers which button is speaking and what is
 * playing, and says so when this device cannot read Bangla aloud.
 */
export function useVoicePlayer(recordings?: RecordingMap) {
  const [speakingKey, setSpeakingKey] = useState<string | null>(null);
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [supported, setSupported] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const tokenRef = useRef(0);
  const clearTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!("speechSynthesis" in window)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSupported(false);
      return;
    }
    // Asking once makes the browser load its voices before the first tap.
    const warm = () => void deviceVoices();
    warm();
    window.speechSynthesis.addEventListener("voiceschanged", warm);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", warm);
  }, []);

  /** Shows a status; with `fadeAfter` it disappears after that many milliseconds. */
  const show = useCallback((next: VoiceStatus | null, fadeAfter?: number) => {
    if (clearTimerRef.current !== null) window.clearTimeout(clearTimerRef.current);
    clearTimerRef.current = null;
    setStatus(next);
    if (next && fadeAfter) clearTimerRef.current = window.setTimeout(() => setStatus(null), fadeAfter);
  }, []);

  const stop = useCallback(() => {
    tokenRef.current += 1;
    stopPlayback(audioRef);
    setSpeakingKey(null);
    setStatus((current) => (current?.state === "playing" ? null : current));
  }, []);

  useEffect(() => () => {
    tokenRef.current += 1;
    stopPlayback(audioRef);
    if (clearTimerRef.current !== null) window.clearTimeout(clearTimerRef.current);
  }, []);

  const speak = useCallback((text: string, { key = text, lang = "bn-BD", clip, rate }: SpeakOptions = {}) => {
    const token = tokenRef.current + 1;
    tokenRef.current = token;
    stopPlayback(audioRef);
    setSpeakingKey(null);
    const steps = playbackPlan({ lang, voices: deviceVoices(), clip, recordings });
    if (steps.length === 0) {
      show({ state: "none", lang }, 6000);
      return;
    }
    let lastSource = steps[0].source;
    runPlayback(steps, { text, lang, rate }, audioRef, {
      isCurrent: () => tokenRef.current === token,
      onStart: (source) => { lastSource = source; setSpeakingKey(key); show(playingStatus(source, lang, clip)); },
      // The label stays a moment after a short clip, so it can be read.
      onEnd: () => { setSpeakingKey(null); show(playingStatus(lastSource, lang, clip), 3000); },
      onFail: () => { setSpeakingKey(null); show({ state: "failed", lang }, 6000); },
    });
  }, [recordings, show]);

  return { speak, stop, speakingKey, status, supported };
}

/**
 * The approved human recordings a learner page knows, starting from the list
 * the server rendered. `refresh(lessonId)` asks again (when a lesson opens), so
 * a recording a teacher approved after the page loaded plays as a recording,
 * and one a teacher stopped using is skipped, without a reload. Until the
 * answer arrives, or if it fails, the page keeps what it knew.
 */
export function useLessonRecordings(initial: RecordingMap) {
  const [recordings, setRecordings] = useState(initial);
  const refresh = useCallback((lessonId: string) => {
    void fetch(lessonRecordingsUrl(lessonId), { cache: "no-store" })
      .then((response) => (response.ok ? response.json() as Promise<{ recordings?: RecordingMap }> : null))
      .then((body) => {
        if (body?.recordings && typeof body.recordings === "object") setRecordings((current) => withLessonRecordings(current, lessonId, body.recordings!));
      })
      .catch(() => undefined);
  }, []);
  return { recordings, refresh };
}
