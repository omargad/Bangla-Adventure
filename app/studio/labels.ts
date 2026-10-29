import type { Bilingual } from "@/app/topics-content";
import type { Language } from "@/lib/topic-model";
import type { LessonStatus } from "@/lib/lesson-model";

/** A lesson's shared approval state as the Studio API returns it. */
export type LessonApproval = { lessonId: string; status: LessonStatus; baseline: boolean; changedByName: string | null; changedAt: string | null; note: string };

const pair = (en: string, bn: string): Bilingual => ({ en, bn });
const pick = (labels: Record<string, Bilingual>, value: string, language: Language) => labels[value]?.[language] ?? value;

export function lessonStatusLabel(approval: Pick<LessonApproval, "status" | "baseline">, language: Language): string {
  if (approval.status === "withdrawn") return language === "bn" ? "সরিয়ে নেওয়া · শিক্ষার্থীরা দেখে না" : "Withdrawn · hidden from students";
  if (approval.status === "waiting") return language === "bn" ? "অনুমোদনের অপেক্ষায় · শিক্ষার্থীরা দেখে না" : "Waiting for approval · hidden from students";
  if (approval.baseline) return language === "bn" ? "অনুমোদিত · আগে থেকে থাকা" : "Approved · baseline";
  return language === "bn" ? "অনুমোদিত" : "Approved";
}

/** The chip colour classes shared with the topics area. */
export function lessonStatusClass(status: LessonStatus): string {
  return status === "approved" ? "topic-status topic-status-approved" : status === "withdrawn" ? "topic-status topic-status-rejected" : "topic-status topic-status-pending";
}

const slots: Record<string, Bilingual> = {
  dialogue: pair("Complete dialogue", "পুরো কথোপকথন"),
  reading: pair("Guided reading", "পড়ার অংশ"),
  ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [`word-${n}`, pair(`Vocabulary word ${n}`, `শব্দ ${n.toLocaleString("bn-BD")}`)])),
  "pattern-1": pair("Sentence pattern 1", "বাক্যের ধাঁচ ১"),
  "pattern-2": pair("Sentence pattern 2", "বাক্যের ধাঁচ ২"),
};
export const audioSlots = Object.keys(slots);
export const slotLabel = (slot: string, language: Language) => pick(slots, slot, language);

const recordingStatuses: Record<string, Bilingual> = {
  pending: pair("Waiting for review", "পর্যালোচনার অপেক্ষায়"),
  approved: pair("Approved · in use", "অনুমোদিত · চালু"),
  "changes-requested": pair("Changes requested", "পরিবর্তন চাওয়া হয়েছে"),
  retired: pair("Retired", "বাদ দেওয়া"),
};
export const recordingStatusLabel = (status: string, language: Language) => pick(recordingStatuses, status, language);

export const videoStatuses: Record<string, Bilingual> = {
  pending: pair("Not decided yet", "এখনো ঠিক হয়নি"),
  approved: pair("Approved", "অনুমোদিত"),
  replace: pair("Replace this video", "ভিডিওটি বদলাতে হবে"),
  unavailable: pair("Unavailable on YouTube", "YouTube-এ পাওয়া যায় না"),
};
export const captionStatuses: Record<string, Bilingual> = {
  unchecked: pair("Not checked", "দেখা হয়নি"),
  available: pair("Available", "আছে"),
  partial: pair("Partial or automatic only", "আংশিক বা শুধু স্বয়ংক্রিয়"),
  missing: pair("Missing", "নেই"),
};
export const suitabilityStatuses: Record<string, Bilingual> = {
  unchecked: pair("Not checked", "দেখা হয়নি"),
  suitable: pair("Suitable", "উপযুক্ত"),
  "supervision-required": pair("Needs a grown-up watching", "বড়দের সঙ্গে দেখতে হবে"),
  unsuitable: pair("Unsuitable for children", "শিশুদের জন্য উপযুক্ত নয়"),
};
export const optionLabel = (labels: Record<string, Bilingual>, value: string, language: Language) => pick(labels, value, language);

/** The optional specialist checks that used to be required gates. */
export const specialistGates: Array<{ id: string; label: Bilingual; description: Bilingual }> = [
  { id: "language", label: pair("Bangla language", "বাংলা ভাষা"), description: pair("Grammar, register, transliteration and age-appropriate support", "ব্যাকরণ, ভাষার ধরন, উচ্চারণ-লিপি ও বয়স অনুযায়ী সহায়তা") },
  { id: "culture", label: pair("Cultural representation", "সংস্কৃতির উপস্থাপন"), description: pair("Accuracy, variety and community perspective", "সঠিকতা, বৈচিত্র্য ও সমাজের দৃষ্টিভঙ্গি") },
  { id: "child-development", label: pair("Learning design", "শেখার নকশা"), description: pair("Workload, interaction, safeguarding and age fit", "কাজের চাপ, অংশগ্রহণ, সুরক্ষা ও বয়স উপযোগিতা") },
  { id: "accessibility", label: pair("Accessibility", "সবার জন্য ব্যবহারযোগ্যতা"), description: pair("Keyboard, screen reader, captions and contrast", "কিবোর্ড, স্ক্রিন রিডার, ক্যাপশন ও রঙের পার্থক্য") },
  { id: "video", label: pair("External media", "বাইরের মিডিয়া"), description: pair("Availability, captions and channel suitability", "পাওয়া যায় কি না, ক্যাপশন ও চ্যানেলের উপযোগিতা") },
  { id: "legal-privacy", label: pair("Legal & privacy", "আইন ও গোপনীয়তা"), description: pair("Data, notices, consent and retention", "তথ্য, বিজ্ঞপ্তি, সম্মতি ও সংরক্ষণ") },
];
export const specialistStatuses: Record<string, Bilingual> = {
  "not-started": pair("Not started", "শুরু হয়নি"),
  "in-review": pair("In review", "পর্যালোচনা চলছে"),
  "changes-requested": pair("Changes requested", "পরিবর্তন চাওয়া হয়েছে"),
  approved: pair("Approved", "অনুমোদিত"),
};
export const gateLabel = (id: string, language: Language) => specialistGates.find((gate) => gate.id === id)?.label[language] ?? id;
