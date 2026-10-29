// Rules for teacher-written topics: validation, review decisions, change
// summaries, quiz marking and category grouping. Pure functions shared by the
// API, the staff editor and the tests; database access lives in
// lib/curriculum-catalog.ts.
import { topicThemes, type Bilingual, type Topic, type TopicQuizQuestion, type TopicTheme } from "../app/topics-content";

export type TopicContent = Omit<Topic, "id">;
export type TopicDraft = Omit<TopicContent, "sources">;
export type TopicVersionStatus = "pending" | "approved" | "rejected" | "superseded";
export type Language = "en" | "bn";

/** A refusal with a message in both languages and the HTTP status to answer with. */
export class TopicError extends Error {
  constructor(message: string, public messageBn: string, public status = 400) { super(message); }
}

export const TOPIC_LIMITS = {
  title: 160, tagline: 500, heading: 160, body: 8000, minSections: 1, maxSections: 12, maxFacts: 6, fact: 300,
  maxQuestions: 10, question: 300, minOptions: 2, maxOptions: 6, option: 160, sourceNote: 1000, note: 1000, maxMinutes: 60,
} as const;
export const TOPIC_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,79}$/;

const bnDigits = (value: number) => value.toLocaleString("bn-BD");
type Label = [en: string, bn: string];

function requiredText(value: unknown, [en, bn]: Label, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new TopicError(`${en} is required and must be at most ${max} characters.`, `${bn} লিখতে হবে, সর্বোচ্চ ${bnDigits(max)} অক্ষর।`);
  }
  return value.trim();
}

function bilingual(value: unknown, [en, bn]: Label, max: number): Bilingual {
  const pair = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    en: requiredText(pair.en, [`${en} (English)`, `${bn} (ইংরেজি)`], max),
    bn: requiredText(pair.bn, [`${en} (Bangla)`, `${bn} (বাংলা)`], max),
  };
}

function list(value: unknown, min: number, max: number, error: Label): unknown[] {
  if (value === undefined || value === null) value = [];
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new TopicError(error[0], error[1]);
  return value;
}

const isBlank = (value: unknown) => value === undefined || value === null || (typeof value === "string" && !value.trim());

/**
 * Checks a topic written or edited by a teacher or administrator. Every reader-facing
 * text needs both English and Bangla. NCTB book sources are not part of the draft:
 * the server keeps them from the version being edited.
 */
export function validateTopicDraft(raw: unknown): TopicDraft {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new TopicError("Provide the topic fields.", "বিষয়ের তথ্যগুলো দিন।");
  const input = raw as Record<string, unknown>;
  const theme = topicThemes.find((item) => item.id === input.theme)?.id;
  if (!theme) throw new TopicError("Choose a category.", "একটি বিভাগ বেছে নিন।");
  const emoji = typeof input.emoji === "string" ? input.emoji.trim() : "";
  if (!emoji || emoji.length > 16) throw new TopicError("Add one emoji or symbol for the topic card.", "বিষয়ের কার্ডের জন্য একটি ইমোজি বা চিহ্ন দিন।");
  const title = bilingual(input.title, ["Title", "শিরোনাম"], TOPIC_LIMITS.title);
  const tagline = bilingual(input.tagline, ["Short introduction", "ছোট পরিচিতি"], TOPIC_LIMITS.tagline);
  const minutes = Number(input.minutes);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > TOPIC_LIMITS.maxMinutes) throw new TopicError("Reading time must be 1–60 minutes.", "পড়ার সময় ১–৬০ মিনিটের মধ্যে দিন।");
  const sections = list(input.sections, TOPIC_LIMITS.minSections, TOPIC_LIMITS.maxSections, ["Add 1–12 reading sections.", "১–১২টি পড়ার অংশ দিন।"]).map((section, index) => {
    const item = section && typeof section === "object" ? (section as Record<string, unknown>) : {};
    const n = index + 1;
    return {
      heading: bilingual(item.heading, [`Section ${n} heading`, `অংশ ${bnDigits(n)}-এর শিরোনাম`], TOPIC_LIMITS.heading),
      body: bilingual(item.body, [`Section ${n} text`, `অংশ ${bnDigits(n)}-এর লেখা`], TOPIC_LIMITS.body),
    };
  });
  const funFacts = list(input.funFacts, 0, TOPIC_LIMITS.maxFacts, ["Add at most 6 “Did you know?” facts.", "সর্বোচ্চ ৬টি “জানো কি?” তথ্য দিন।"])
    .map((fact, index) => bilingual(fact, [`Fact ${index + 1}`, `তথ্য ${bnDigits(index + 1)}`], TOPIC_LIMITS.fact));
  const quiz = list(input.quiz, 0, TOPIC_LIMITS.maxQuestions, ["A quiz can have at most 10 questions.", "কুইজে সর্বোচ্চ ১০টি প্রশ্ন থাকতে পারে।"]).map((entry, index): TopicQuizQuestion => {
    const item = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    const n = index + 1;
    const question = bilingual(item.question, [`Quiz question ${n}`, `কুইজের প্রশ্ন ${bnDigits(n)}`], TOPIC_LIMITS.question);
    const options = list(item.options, TOPIC_LIMITS.minOptions, TOPIC_LIMITS.maxOptions, [`Quiz question ${n} needs 2–6 answer options.`, `কুইজের প্রশ্ন ${bnDigits(n)}-এ ২–৬টি উত্তর দিন।`])
      .map((option, optionIndex) => bilingual(option, [`Question ${n} option ${optionIndex + 1}`, `প্রশ্ন ${bnDigits(n)}-এর উত্তর ${bnDigits(optionIndex + 1)}`], TOPIC_LIMITS.option));
    for (const lang of ["en", "bn"] as const) {
      if (new Set(options.map((option) => option[lang].toLowerCase())).size !== options.length) {
        throw new TopicError(`Quiz question ${n} needs different answer options.`, `কুইজের প্রশ্ন ${bnDigits(n)}-এর উত্তরগুলো আলাদা হতে হবে।`);
      }
    }
    const answer = Number(item.answer);
    if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) throw new TopicError(`Choose the correct answer for quiz question ${n}.`, `কুইজের প্রশ্ন ${bnDigits(n)}-এর সঠিক উত্তর বেছে নিন।`);
    return { question, options, answer };
  });
  const note = input.sourceNote && typeof input.sourceNote === "object" ? (input.sourceNote as Record<string, unknown>) : {};
  const sourceNote = isBlank(note.en) && isBlank(note.bn) ? undefined : bilingual(note, ["Source note", "উৎসের নোট"], TOPIC_LIMITS.sourceNote);
  return { theme, emoji, title, tagline, minutes, sections, funFacts, quiz, ...(sourceNote ? { sourceNote } : {}) };
}

/** A readable, unique-enough id for a new topic: its English title plus a random suffix. */
export function newTopicId(englishTitle: string, suffix: string): string {
  const slug = englishTitle.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/, "");
  return `${slug || "topic"}-${suffix}`;
}

/**
 * Whether a pending version may be approved or sent back. Only pending versions are
 * reviewed, and an older pending version cannot replace a newer approved one.
 */
export function checkReview(target: { version: number; status: TopicVersionStatus } | undefined, approvedVersion: number | null, decision: "approve" | "reject"): void {
  if (!target) throw new TopicError("That version of the topic was not found.", "বিষয়ের ওই সংস্করণটি পাওয়া যায়নি।", 404);
  if (target.status !== "pending") throw new TopicError("This version has already been reviewed. Reload to see its status.", "এই সংস্করণটি আগেই পর্যালোচনা হয়েছে। অবস্থা দেখতে আবার খুলুন।", 409);
  if (decision === "approve" && approvedVersion !== null && target.version < approvedVersion) {
    throw new TopicError("A newer version is already approved. Review the latest version instead.", "এর চেয়ে নতুন সংস্করণ আগেই অনুমোদিত। সর্বশেষ সংস্করণটি পর্যালোচনা করুন।", 409);
  }
}

/**
 * Status changes when a version is approved: it becomes the one students see, the
 * previously approved version is superseded, and older pending versions (which the
 * approved one already builds on) leave the review queue.
 */
export function statusesAfterApproval(versions: Array<{ version: number; status: TopicVersionStatus }>, approved: number): Array<{ version: number; status: TopicVersionStatus }> {
  return versions.flatMap(({ version, status }): Array<{ version: number; status: TopicVersionStatus }> => {
    if (version === approved) return [{ version, status: "approved" }];
    if (status === "approved" || (status === "pending" && version < approved)) return [{ version, status: "superseded" }];
    return [];
  });
}

/**
 * Whether an editor may start again from the approved version instead of the newest
 * one: only when every version after the approved one was sent back, so nobody has
 * to carry a rejected change into their own edit.
 */
export function canRestartFromApproved(versions: Array<{ version: number; status: TopicVersionStatus }>, approvedVersion: number | null): boolean {
  if (approvedVersion === null) return false;
  const later = versions.filter((item) => item.version > approvedVersion);
  return later.length > 0 && later.every((item) => item.status === "rejected");
}

/** Marks a topic quiz; null unless every question has an answer that is one of its options. */
export function gradeTopicQuiz(quiz: TopicQuizQuestion[], answers: unknown): { score: number; total: number } | null {
  if (!quiz.length || !Array.isArray(answers) || answers.length !== quiz.length) return null;
  if (!answers.every((answer, index) => Number.isInteger(answer) && answer >= 0 && answer < quiz[index].options.length)) return null;
  return { score: quiz.reduce((sum, question, index) => sum + (answers[index] === question.answer ? 1 : 0), 0), total: quiz.length };
}

export function categoryTitle(id: string): Bilingual {
  return topicThemes.find((theme) => theme.id === id)?.title ?? { en: id, bn: id };
}

/** Topics grouped under their categories, in category order; empty categories are left out. */
export function groupByCategory<T extends { theme: string }>(items: T[]): Array<{ category: TopicTheme; items: T[] }> {
  return topicThemes.map((category) => ({ category, items: items.filter((item) => item.theme === category.id) })).filter((group) => group.items.length > 0);
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const pair = (en: string, bn: string): Bilingual => ({ en, bn });

/** What a version changes compared with the approved version, for the reviewer. */
export function describeTopicChanges(candidate: TopicDraft, approved: TopicDraft | null): Bilingual[] {
  if (!approved) return [pair("New topic: nothing has been approved yet, so students have not seen any of it.", "নতুন বিষয়: এখনো কিছু অনুমোদিত হয়নি, তাই শিক্ষার্থীরা এর কিছুই দেখেনি।")];
  const changes: Bilingual[] = [];
  if (candidate.theme !== approved.theme) {
    const from = categoryTitle(approved.theme), to = categoryTitle(candidate.theme);
    changes.push(pair(`Category: ${from.en} → ${to.en}`, `বিভাগ: ${from.bn} → ${to.bn}`));
  }
  if (candidate.emoji !== approved.emoji) changes.push(pair(`Card symbol: ${approved.emoji} → ${candidate.emoji}`, `কার্ডের চিহ্ন: ${approved.emoji} → ${candidate.emoji}`));
  const text = (label: Label, a: Bilingual, b: Bilingual) => {
    if (a.en !== b.en) changes.push(pair(`${label[0]} (English) changed`, `${label[1]} (ইংরেজি) বদলেছে`));
    if (a.bn !== b.bn) changes.push(pair(`${label[0]} (Bangla) changed`, `${label[1]} (বাংলা) বদলেছে`));
  };
  text(["Title", "শিরোনাম"], candidate.title, approved.title);
  text(["Short introduction", "ছোট পরিচিতি"], candidate.tagline, approved.tagline);
  if (candidate.minutes !== approved.minutes) changes.push(pair(`Reading time: ${approved.minutes} → ${candidate.minutes} minutes`, `পড়ার সময়: ${bnDigits(approved.minutes)} → ${bnDigits(candidate.minutes)} মিনিট`));
  const sections = Math.max(candidate.sections.length, approved.sections.length);
  for (let index = 0; index < sections; index += 1) {
    const now = candidate.sections[index], before = approved.sections[index], n = index + 1;
    if (!before) changes.push(pair(`Section ${n} added`, `অংশ ${bnDigits(n)} যোগ হয়েছে`));
    else if (!now) changes.push(pair(`Section ${n} removed`, `অংশ ${bnDigits(n)} বাদ দেওয়া হয়েছে`));
    else {
      text([`Section ${n} heading`, `অংশ ${bnDigits(n)}-এর শিরোনাম`], now.heading, before.heading);
      text([`Section ${n} text`, `অংশ ${bnDigits(n)}-এর লেখা`], now.body, before.body);
    }
  }
  if (!same(candidate.funFacts, approved.funFacts)) changes.push(pair(`“Did you know?” facts changed (${approved.funFacts.length} → ${candidate.funFacts.length})`, `“জানো কি?” তথ্য বদলেছে (${bnDigits(approved.funFacts.length)} → ${bnDigits(candidate.funFacts.length)})`));
  const questions = Math.max(candidate.quiz.length, approved.quiz.length);
  for (let index = 0; index < questions; index += 1) {
    const now = candidate.quiz[index], before = approved.quiz[index], n = index + 1;
    if (!before) changes.push(pair(`Quiz question ${n} added`, `কুইজের প্রশ্ন ${bnDigits(n)} যোগ হয়েছে`));
    else if (!now) changes.push(pair(`Quiz question ${n} removed`, `কুইজের প্রশ্ন ${bnDigits(n)} বাদ দেওয়া হয়েছে`));
    else if (!same(now, before)) changes.push(pair(`Quiz question ${n} changed (question, answers or correct answer)`, `কুইজের প্রশ্ন ${bnDigits(n)} বদলেছে (প্রশ্ন, উত্তর বা সঠিক উত্তর)`));
  }
  if (!same(candidate.sourceNote, approved.sourceNote)) changes.push(pair("Source note changed", "উৎসের নোট বদলেছে"));
  return changes;
}

/** True when a draft differs from the content it was based on. */
export function topicChanged(candidate: TopicDraft, base: TopicDraft): boolean {
  return describeTopicChanges(candidate, base).length > 0;
}

/** A date and time in the page language; SQLite UTC timestamps are read as UTC. */
export function formatWhen(value: string | null | undefined, language: Language): string {
  if (!value) return "";
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(" ", "T")}Z` : value;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(language === "bn" ? "bn-BD" : "en-AU", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

/** Numbers in the page language: Bangla digits in Bangla mode. */
export function formatNumber(value: number, language: Language): string {
  return value.toLocaleString(language === "bn" ? "bn-BD" : "en-AU");
}
