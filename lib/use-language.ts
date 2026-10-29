"use client";

import { useEffect, useState } from "react";
import type { Language } from "./local-format";

// Numbers, dates and times in the page language live in lib/local-format.ts (shared with server-side models).
export { localDate, localDateTime, localNumber, type Language } from "./local-format";

const STORAGE_KEY = "bangla-adventures-language";

/**
 * Client hook for the shared English/Bangla preference used across the learner
 * and grown-up surfaces. The preference is read after mount to avoid an SSR
 * hydration mismatch and persisted to localStorage so it carries between pages.
 */
export function useLanguage(): [Language, () => void] {
  const [language, setLanguage] = useState<Language>("en");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLanguage((current) => {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      return saved === "bn" || saved === "en" ? saved : current;
    });
    const changed = (event: Event) => setLanguage((event as CustomEvent<Language>).detail);
    window.addEventListener("bangla-language", changed);
    return () => window.removeEventListener("bangla-language", changed);
  }, []);

  function toggle() {
    const next = language === "en" ? "bn" : "en";
    setLanguage(next);
    window.localStorage.setItem(STORAGE_KEY, next);
    window.dispatchEvent(new CustomEvent("bangla-language", { detail: next }));
  }

  return [language, toggle];
}

/**
 * A server message in the page language: its Bangla copy (`errorBn`/`messageBn`) in Bangla mode, or
 * the caller's Bangla fallback when the server sent none, so Bangla pages never show English text.
 */
export function localMessage(data: { error?: unknown; errorBn?: unknown; message?: unknown; messageBn?: unknown } | null | undefined, language: Language, fallback: [string, string]): string {
  if (language === "bn") return typeof data?.errorBn === "string" && data.errorBn ? data.errorBn : typeof data?.messageBn === "string" && data.messageBn ? data.messageBn : fallback[1];
  return typeof data?.error === "string" && data.error ? data.error : typeof data?.message === "string" && data.message ? data.message : fallback[0];
}

/** One message in both languages, so a page shows it in whichever language is chosen, even after a switch. */
export type Message = [en: string, bn: string];

/** A server message in both languages; the fallback fills in a language the server did not send. */
export function serverMessage(data: { error?: unknown; errorBn?: unknown } | null | undefined, fallback: Message): Message {
  return [localMessage(data, "en", fallback), localMessage(data, "bn", fallback)];
}

/** A failed request carrying its message in both languages. */
export class MessageError extends Error {
  constructor(readonly text: Message) { super(text[0]); }
}
