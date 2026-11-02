import type { Language } from "./local-format";

/**
 * Where the reader's English/Bangla choice is kept. The browser keeps it in localStorage and, so the server
 * can render every page in it from the first paint, in a cookie the root layout reads (see lib/use-language.ts).
 * Plain values with no React or browser imports, so the server layout and the client hook share them.
 */
export const LANGUAGE_STORAGE_KEY = "bangla-adventures-language";
export const LANGUAGE_COOKIE = "ba_language";
/** A year, in seconds. Safari keeps a cookie the page itself writes for 7 days at most, so the server renews it (proxy.ts). */
export const LANGUAGE_COOKIE_MAX_AGE = 31536000;

/** A stored choice, or null when there is none (or it is not one of the two languages). */
export function chosenLanguage(value: unknown): Language | null {
  return value === "bn" || value === "en" ? value : null;
}

/** The cookie that keeps a choice for a year, for document.cookie. It holds nothing private, so scripts may read it. */
export function languageCookie(language: Language, secure: boolean): string {
  return `${LANGUAGE_COOKIE}=${language}; Path=/; Max-Age=${LANGUAGE_COOKIE_MAX_AGE}; SameSite=Lax${secure ? "; Secure" : ""}`;
}
