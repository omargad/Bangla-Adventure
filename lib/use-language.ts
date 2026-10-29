"use client";

import { useEffect, useState } from "react";

export type Language = "en" | "bn";

const STORAGE_KEY = "bangla-adventures-language";
const locale = (language: Language) => (language === "bn" ? "bn-BD" : "en-AU");

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

/** A whole number in the page language's digits (Bangla digits in Bangla mode). */
export function localNumber(value: number, language: Language): string {
  return value.toLocaleString(locale(language));
}

/**
 * A stored time in the reader's local time and the page language. SQLite's CURRENT_TIMESTAMP is UTC
 * without a zone ("2026-10-28 06:41:12"), so it is read as UTC; ISO times carry their own zone.
 */
export function localDateTime(value: string, language: Language): string {
  const date = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(" ", "T")}Z` : value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale(language), { dateStyle: "medium", timeStyle: "short" });
}

/** A calendar date ('YYYY-MM-DD', such as a class session) in the page language, without shifting the day. */
export function localDate(value: string, language: Language): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toLocaleDateString(locale(language), { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * A server message in the page language: its Bangla copy (`errorBn`/`messageBn`) in Bangla mode, or
 * the caller's Bangla fallback when the server sent none, so Bangla pages never show English text.
 */
export function localMessage(data: { error?: unknown; errorBn?: unknown; message?: unknown; messageBn?: unknown } | null | undefined, language: Language, fallback: [string, string]): string {
  if (language === "bn") return typeof data?.errorBn === "string" && data.errorBn ? data.errorBn : typeof data?.messageBn === "string" && data.messageBn ? data.messageBn : fallback[1];
  return typeof data?.error === "string" && data.error ? data.error : typeof data?.message === "string" && data.message ? data.message : fallback[0];
}
