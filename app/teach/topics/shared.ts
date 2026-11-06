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

/** What a save answered (see SavedTopic in lib/curriculum-catalog.ts). */
export type SaveResult = { topicId: string; version: number; status: "approved" | "pending"; publishedDirectly: "admin" | "setting" | null; superseded: number[]; restored: boolean };

/** What the author is told after saving: published now (and what that replaced), or waiting for an administrator. */
export function savedMessage(saved: Pick<SaveResult, "version" | "status" | "publishedDirectly" | "superseded" | "restored">): Bilingual {
  const label = { en: versionLabel(saved.version, "en").toLowerCase(), bn: versionLabel(saved.version, "bn") };
  if (saved.status !== "approved") return {
    en: `Submitted as ${label.en} for administrator review. Students will not see this version until an administrator approves it.`,
    bn: `${label.bn} হিসেবে প্রশাসকের পর্যালোচনার জন্য জমা দেওয়া হয়েছে। প্রশাসক অনুমোদন না দেওয়া পর্যন্ত শিক্ষার্থীরা এই সংস্করণটি দেখবে না।`,
  };
  const parts: Bilingual[] = [saved.publishedDirectly === "setting"
    ? { en: `Published as ${label.en}. Students see it now: teachers' topics do not need an administrator's approval at the moment.`, bn: `${label.bn} হিসেবে প্রকাশিত হয়েছে। শিক্ষার্থীরা এখনই এটি দেখবে: এখন শিক্ষকদের বিষয়ে প্রশাসকের অনুমোদন লাগে না।` }
    : { en: `Published as ${label.en}. Students see it now: an administrator's own topics do not wait for approval.`, bn: `${label.bn} হিসেবে প্রকাশিত হয়েছে। শিক্ষার্থীরা এখনই এটি দেখবে: প্রশাসকের নিজের বিষয় অনুমোদনের অপেক্ষায় থাকে না।` }];
  if (saved.superseded.length) {
    const list = { en: saved.superseded.map((version) => versionLabel(version, "en")).join(", "), bn: saved.superseded.map((version) => versionLabel(version, "bn")).join(", ") };
    parts.push(saved.superseded.length === 1
      ? { en: `${list.en}, which was waiting for approval, is included in it and is marked as replaced.`, bn: `অনুমোদনের অপেক্ষায় থাকা ${list.bn} এতে অন্তর্ভুক্ত, তাই সেটি প্রতিস্থাপিত হিসেবে চিহ্নিত হয়েছে।` }
      : { en: `${list.en}, which were waiting for approval, are included in it and are marked as replaced.`, bn: `অনুমোদনের অপেক্ষায় থাকা ${list.bn} এতে অন্তর্ভুক্ত, তাই সেগুলো প্রতিস্থাপিত হিসেবে চিহ্নিত হয়েছে।` });
  }
  if (saved.restored) parts.push({ en: "The topic was withdrawn and is shown to students again.", bn: "বিষয়টি সরিয়ে নেওয়া ছিল, এখন আবার শিক্ষার্থীদের দেখানো হচ্ছে।" });
  return { en: parts.map((part) => part.en).join(" "), bn: parts.map((part) => part.bn).join(" ") };
}

/** How a version that was published as it was saved reads in its history, or null for a reviewed one. */
export function publishedDirectlyLabel(version: Pick<VersionSummary, "publishedDirectly">, language: Language): string | null {
  const s = (en: string, bn: string) => (language === "bn" ? bn : en);
  if (version.publishedDirectly === "admin") return s("Published at once (an administrator's own edit)", "সরাসরি প্রকাশিত (প্রশাসকের নিজের সম্পাদনা)");
  if (version.publishedDirectly === "setting") return s("Published at once (teachers' topics did not need approval)", "সরাসরি প্রকাশিত (তখন শিক্ষকদের বিষয়ে অনুমোদন লাগত না)");
  return null;
}

export function versionLabel(version: number, language: Language): string {
  if (version === 0) return language === "bn" ? "অ্যাপের সঙ্গে আসা মূল সংস্করণ" : "Original shipped version";
  return language === "bn" ? `সংস্করণ ${formatNumber(version, language)}` : `Version ${version}`;
}
