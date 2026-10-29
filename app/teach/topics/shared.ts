import type { Bilingual } from "@/app/topics-content";
import type { VersionSummary } from "@/lib/curriculum-catalog";
import { formatNumber, type Language } from "@/lib/topic-model";

const unreachable: Bilingual = { en: "The request could not be completed. Please try again.", bn: "অনুরোধটি সম্পন্ন হয়নি। আবার চেষ্টা করুন।" };

class ApiError extends Error {
  constructor(public en: string, public bn: string) { super(en); }
}

/** Calls a topics API; a refusal is thrown with its message in both languages. */
export async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, ...(init?.body ? { headers: { "Content-Type": "application/json" } } : {}) });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new ApiError(data?.error ?? unreachable.en, data?.errorBn ?? data?.error ?? unreachable.bn);
  return data as T;
}

/** Any caught failure as a message in both languages. */
export function failure(caught: unknown): Bilingual {
  return caught instanceof ApiError ? { en: caught.en, bn: caught.bn } : unreachable;
}

export function statusLabel(version: Pick<VersionSummary, "status" | "baseline">, language: Language): string {
  const s = (en: string, bn: string) => (language === "bn" ? bn : en);
  if (version.status === "pending") return s("Waiting for approval", "অনুমোদনের অপেক্ষায়");
  if (version.status === "rejected") return s("Sent back", "ফেরত পাঠানো হয়েছে");
  if (version.status === "superseded") return s("Replaced by a newer version", "নতুন সংস্করণে প্রতিস্থাপিত");
  return version.baseline ? s("Approved · baseline", "অনুমোদিত · আগে থেকে থাকা") : s("Approved", "অনুমোদিত");
}

/**
 * Who wrote a version. Administrator edits carried over from before topic approval
 * existed have no author when that account no longer exists.
 */
export function authorLabel(version: Pick<VersionSummary, "authorName" | "baseline">, language: Language): string {
  if (version.authorName) return version.authorName;
  const s = (en: string, bn: string) => (language === "bn" ? bn : en);
  return version.baseline ? s("an administrator, before topic approval existed", "একজন প্রশাসক, বিষয় অনুমোদন চালুর আগে") : s("a former staff member", "একজন সাবেক কর্মী");
}

export function versionLabel(version: number, language: Language): string {
  if (version === 0) return language === "bn" ? "অ্যাপের সঙ্গে আসা মূল সংস্করণ" : "Original shipped version";
  return language === "bn" ? `সংস্করণ ${formatNumber(version, language)}` : `Version ${version}`;
}
