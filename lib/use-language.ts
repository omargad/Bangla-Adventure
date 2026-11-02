"use client";

import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from "react";
import { chosenLanguage, languageCookie, LANGUAGE_STORAGE_KEY } from "./language-choice";
import type { Language } from "./local-format";

// Numbers, dates and times in the page language live in lib/local-format.ts (shared with server-side models).
export { localDate, localDateTime, localNumber, type Language } from "./local-format";

const CHANGE_EVENT = "bangla-language";
let documentLanguageUsers = 0;

/** The choice saved in this browser, or null when there is none or storage is blocked. */
function savedLanguage(): Language | null {
  try { return chosenLanguage(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)); } catch { return null; }
}

/** Keeps the choice in the cookie the root layout reads, so the next page the server renders is in it. */
function rememberLanguage(language: Language) {
  document.cookie = languageCookie(language, window.location.protocol === "https:");
}

// The language the server rendered the page in (from the cookie), then the reader's current choice.
const PageLanguage = createContext<Language>("en");

/**
 * Given the language the root layout read from the cookie, so every useLanguage starts in it: the server's HTML
 * is already in the chosen language and hydrates without a switch. It follows later changes, so page parts that
 * appear after a client-side navigation start in the current choice too.
 */
export function LanguageProvider({ initialLanguage, children }: { initialLanguage: Language; children: ReactNode }) {
  const [language, setLanguage] = useState(initialLanguage);
  // The language this page's HTML came in, which its cookie held; it does not change while the page is open.
  const [served] = useState(initialLanguage);
  useEffect(() => {
    // A choice made before the cookie existed (or one whose cookie has lapsed) is only in localStorage; copying it to the
    // cookie makes the next page right, and this page is switched by its useLanguage parts. A cookie that already holds it is
    // left alone: the server renews it on each page load for a year, and rewriting it here would cut that to Safari's 7 days.
    const saved = savedLanguage();
    if (saved) {
      if (saved !== served) rememberLanguage(saved);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLanguage(saved);
    }
    // The server gives <html> the chosen language; a page that does not follow it (the 404 page, say) is English.
    if (documentLanguageUsers === 0) document.documentElement.lang = "en";
    const changed = (event: Event) => setLanguage((event as CustomEvent<Language>).detail);
    window.addEventListener(CHANGE_EVENT, changed);
    return () => window.removeEventListener(CHANGE_EVENT, changed);
  }, [served]);
  return createElement(PageLanguage, { value: language }, children);
}

/**
 * Client hook for the shared English/Bangla preference used across the learner
 * and grown-up surfaces. It starts in the language the server rendered (LanguageProvider, from the cookie),
 * so the first paint is already in the chosen language. The choice is persisted to localStorage, which wins
 * when the two differ, and to the cookie, so it carries between pages.
 * While a page uses it, <html lang> follows the choice; pass `documentLang: false` from parts
 * that appear on every page (such as the offline banner) so pages with their own language keep "en".
 * A page can pass `title: [its metadata title, a Bangla version]` so the tab title follows the language too.
 */
export function useLanguage({ documentLang = true, title }: { documentLang?: boolean; title?: [en: string, bn: string] } = {}): [Language, () => void] {
  const [language, setLanguage] = useState<Language>(useContext(PageLanguage));

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLanguage((current) => savedLanguage() ?? current);
    const changed = (event: Event) => setLanguage((event as CustomEvent<Language>).detail);
    window.addEventListener(CHANGE_EVENT, changed);
    return () => window.removeEventListener(CHANGE_EVENT, changed);
  }, []);

  useEffect(() => {
    if (documentLang) document.documentElement.lang = language;
  }, [documentLang, language]);

  useEffect(() => {
    if (!documentLang) return;
    documentLanguageUsers += 1;
    return () => {
      documentLanguageUsers -= 1;
      // Back to English once no page part sets it (as LanguageProvider does on load), so a page that does not follow the choice is not left in Bangla.
      if (documentLanguageUsers === 0) document.documentElement.lang = "en";
    };
  }, [documentLang]);

  useLanguageTitle(language, title);

  function toggle() {
    const next = language === "en" ? "bn" : "en";
    setLanguage(next);
    try { window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next); } catch { /* the cookie still keeps it */ }
    rememberLanguage(next);
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: next }));
  }

  return [language, toggle];
}

/**
 * Shows the tab title in Bangla while the page is in Bangla. `title` is the page's metadata title and its
 * Bangla version; parts that get the language from their page (not useLanguage) call this directly.
 */
export function useLanguageTitle(language: Language, title?: [en: string, bn: string]) {
  const [englishTitle, banglaTitle] = title ?? [];
  useEffect(() => {
    if (language !== "bn" || !englishTitle || !banglaTitle) return;
    // Next can write the metadata title after this runs (it streams in), so swap it whenever it appears.
    const swap = () => { if (document.title === englishTitle) document.title = banglaTitle; };
    swap();
    const observer = new MutationObserver(swap);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      // After a navigation the next page's title is already in place, so only undo this page's title.
      if (document.title === banglaTitle) document.title = englishTitle;
    };
  }, [englishTitle, banglaTitle, language]);
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
