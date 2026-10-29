// Numbers, dates and times in the page language. Plain functions with no React
// or browser imports, so client components (through lib/use-language.ts) and
// shared models such as lib/topic-model.ts use one implementation.

export type Language = "en" | "bn";

const locale = (language: Language) => (language === "bn" ? "bn-BD" : "en-AU");

/**
 * A stored time as a Date, or null when it is not a time. SQLite's CURRENT_TIMESTAMP is UTC without a
 * zone ("2026-10-28 06:41:12"), so it is read as UTC; ISO times carry their own zone.
 */
export function storedTime(value: string): Date | null {
  const date = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(" ", "T")}Z` : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** A whole number in the page language's digits (Bangla digits in Bangla mode). */
export function localNumber(value: number, language: Language): string {
  return value.toLocaleString(locale(language));
}

/** A stored time in the reader's local time and the page language; anything that is not a time is shown as it is. */
export function localDateTime(value: string, language: Language): string {
  const date = storedTime(value);
  return date ? date.toLocaleString(locale(language), { dateStyle: "medium", timeStyle: "short" }) : value;
}

/** A calendar date ('YYYY-MM-DD', such as a class session) in the page language, without shifting the day. */
export function localDate(value: string, language: Language): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toLocaleDateString(locale(language), { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
