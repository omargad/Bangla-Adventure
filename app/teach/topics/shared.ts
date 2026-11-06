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
 * Who wrote a version. Text that came with Bangla Adventures says so; administrator edits carried
 * over from before topic approval existed, and versions whose author's account was deleted, have no author.
 */
export function authorLabel(version: Pick<VersionSummary, "authorName" | "baseline" | "shipped">, language: Language): string {
  if (version.authorName) return version.authorName;
  const s = (en: string, bn: string) => (language === "bn" ? bn : en);
  if (version.shipped) return s("came with Bangla Adventures", "Bangla Adventures-এর সঙ্গে এসেছে");
  return version.baseline ? s("an administrator, before topic approval existed", "একজন প্রশাসক, বিষয় অনুমোদন চালুর আগে") : s("a former staff member", "একজন সাবেক কর্মী");
}

/** "written by …", or that the version came with Bangla Adventures. */
export function writtenLabel(version: Pick<VersionSummary, "authorName" | "baseline" | "shipped">, language: Language): string {
  if (!version.authorName && version.shipped) return authorLabel(version, language);
  return language === "bn" ? `লিখেছেন ${authorLabel(version, language)}` : `written by ${authorLabel(version, language)}`;
}

/**
 * What the reviewer is told after deciding on a version, from whether students can read an
 * approved version of the topic (none yet, a withdrawn one, or one they keep seeing).
 */
export function versionDecisionMessage(decision: "approve" | "reject", version: number, topic: { approvedVersion: number | null; withdrawn: boolean }): Bilingual {
  if (decision === "approve") return { en: `Approved. Students now see ${versionLabel(version, "en").toLowerCase()} of this topic.`, bn: `অনুমোদিত। শিক্ষার্থীরা এখন এই বিষয়ের ${versionLabel(version, "bn")} দেখবে।` };
  const sent = { en: "Sent back to the author with your note.", bn: "আপনার নোটসহ লেখকের কাছে ফেরত পাঠানো হয়েছে।" };
  if (topic.approvedVersion === null) return { en: `${sent.en} Students cannot see this topic until a version of it is approved.`, bn: `${sent.bn} কোনো সংস্করণ অনুমোদিত না হওয়া পর্যন্ত শিক্ষার্থীরা এই বিষয়টি দেখতে পাবে না।` };
  if (topic.withdrawn) return { en: `${sent.en} The topic stays withdrawn, so students still cannot see it.`, bn: `${sent.bn} বিষয়টি সরিয়ে নেওয়াই থাকছে, তাই শিক্ষার্থীরা এখনো এটি দেখতে পাবে না।` };
  return { en: `${sent.en} Students keep seeing the approved version.`, bn: `${sent.bn} শিক্ষার্থীরা অনুমোদিত সংস্করণই দেখবে।` };
}

export function versionLabel(version: number, language: Language): string {
  if (version === 0) return language === "bn" ? "অ্যাপের সঙ্গে আসা মূল সংস্করণ" : "Original shipped version";
  return language === "bn" ? `সংস্করণ ${formatNumber(version, language)}` : `Version ${version}`;
}
