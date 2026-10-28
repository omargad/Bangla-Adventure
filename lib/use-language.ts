"use client";

import { useEffect, useState } from "react";

export type Language = "en" | "bn";

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
