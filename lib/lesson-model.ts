// Rules for the 18 lessons: the shared teacher approval, what learners may open,
// category grouping and the video learners get after a video check. Pure
// functions shared by the API, the Studio, the learner pages and the tests;
// database access lives in lib/lesson-approval.ts.
import { lessonCategories, type Lesson, type LessonCategory } from "../app/curriculum";

/** Approved lessons reach learners; withdrawn ones and lessons nobody has approved yet do not. */
export type LessonStatus = "approved" | "withdrawn" | "waiting";
export type LessonDecision = "approve" | "withdraw";
export type LessonVideo = Lesson["video"];
/** The video in a lesson as learners get it; `replaced` marks a teacher-chosen replacement. */
export type LearnerVideo = LessonVideo & { replaced?: boolean };
export type VideoCheck = { status: string; suitabilityStatus: string; replacementUrl: string };

export const LESSON_NOTE_LIMIT = 1000;

/** A refusal with a message in both languages and the HTTP status to answer with. */
export class LessonError extends Error {
  constructor(message: string, public messageBn: string, public status = 400) { super(message); }
}

/** A lesson's state from its newest approval record; a lesson without any record waits for approval. */
export function lessonStatus(latest: { status: string } | null | undefined): LessonStatus {
  if (latest?.status === "approved") return "approved";
  return latest?.status === "withdrawn" ? "withdrawn" : "waiting";
}

/**
 * Checks an approve or withdraw request against the lesson's current state and
 * returns the decision with its trimmed note. Approving needs the reviewer's
 * confirmation that they went through the whole lesson in both languages;
 * withdrawing needs a reason so colleagues know what to fix.
 */
export function checkLessonDecision(current: LessonStatus, raw: Record<string, unknown>): { decision: LessonDecision; note: string } {
  const decision = raw.decision;
  if (decision !== "approve" && decision !== "withdraw") throw new LessonError("Choose to approve or withdraw the lesson.", "পাঠটি অনুমোদন বা সরিয়ে নেওয়ার একটি বেছে নিন।");
  if (raw.note !== undefined && raw.note !== null && typeof raw.note !== "string") throw new LessonError("The note must be text.", "নোট লেখা আকারে দিন।");
  const note = typeof raw.note === "string" ? raw.note.trim() : "";
  if (note.length > LESSON_NOTE_LIMIT) throw new LessonError(`Keep the note under ${LESSON_NOTE_LIMIT} characters.`, `নোট ${LESSON_NOTE_LIMIT.toLocaleString("bn-BD")} অক্ষরের মধ্যে রাখুন।`);
  if (decision === "approve") {
    if (raw.confirmedRead !== true) {
      throw new LessonError("Tick “I have reviewed the whole lesson in English and Bangla” before approving.", "অনুমোদনের আগে “আমি পুরো পাঠ ইংরেজি ও বাংলায় দেখেছি” টিক দিন।");
    }
    if (current === "approved") throw new LessonError("This lesson is already approved. Reload to see who approved it.", "পাঠটি আগেই অনুমোদিত। কে অনুমোদন করেছেন দেখতে আবার খুলুন।", 409);
  } else {
    if (!note) throw new LessonError("Say why you are withdrawing the lesson, so colleagues know what to fix.", "পাঠটি কেন সরিয়ে নিচ্ছেন লিখুন, যাতে সহকর্মীরা জানেন কী ঠিক করতে হবে।");
    if (current !== "approved") throw new LessonError("Students already cannot see this lesson. Reload to see its status.", "শিক্ষার্থীরা এই পাঠ আগে থেকেই দেখতে পায় না। অবস্থা দেখতে আবার খুলুন।", 409);
  }
  return { decision, note };
}

/** The lessons learners may open, in curriculum order. */
export function visibleLessons<T extends { id: string }>(items: readonly T[], approvedIds: Iterable<string>): T[] {
  const approved = new Set(approvedIds);
  return items.filter((item) => approved.has(item.id));
}

/**
 * Assignments as an adult sees them. Staff keep every assignment, marked when its
 * lesson is not available to learners; parents only see assignments of lessons
 * learners may open.
 */
export function learnerAssignments<T extends { lessonId: string }>(rows: readonly T[], approvedIds: Iterable<string>, staff: boolean): Array<T & { lessonAvailable: boolean }> {
  const approved = new Set(approvedIds);
  const marked = rows.map((row) => ({ ...row, lessonAvailable: approved.has(row.lessonId) }));
  return staff ? marked : marked.filter((row) => row.lessonAvailable);
}

export function lessonCategory(id: LessonCategory) {
  return lessonCategories.find((category) => category.id === id) ?? { id, icon: "📘", title: { en: id, bn: id } };
}

/** Lessons grouped under their categories, in category order; empty categories are left out. */
export function groupLessonsByCategory<T extends { category: LessonCategory }>(items: readonly T[]): Array<{ category: (typeof lessonCategories)[number]; items: T[] }> {
  return lessonCategories
    .map((category) => ({ category, items: items.filter((item) => item.category === category.id) }))
    .filter((group) => group.items.length > 0);
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/** The video id in a YouTube watch, short, embed or privacy-enhanced link; null for anything else. */
export function youtubeVideoId(value: string): string | null {
  let url: URL;
  try { url = new URL(value.trim()); } catch { return null; }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.replace(/^(www\.|m\.)/, "");
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.slice(1);
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    id = url.pathname === "/watch" ? url.searchParams.get("v") : (/^\/(embed|shorts|live)\/([^/]+)$/.exec(url.pathname)?.[2] ?? null);
  }
  return id && YOUTUBE_ID.test(id) ? id : null;
}

/** A replacement link typed in a video check: empty, or a link to one YouTube video. */
export function validateReplacementUrl(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return "";
  if (value.length > 400 || !youtubeVideoId(value)) {
    throw new LessonError("Paste a link to one YouTube video (https://www.youtube.com/watch?v=…), or leave the replacement empty.", "একটি YouTube ভিডিওর লিংক দিন (https://www.youtube.com/watch?v=…), অথবা বিকল্পের ঘরটি ফাঁকা রাখুন।");
  }
  return value;
}

/** True when a video check takes the original video out of the lesson. */
export function videoTakenDown(check: VideoCheck | null | undefined): boolean {
  return Boolean(check && (check.status === "replace" || check.status === "unavailable" || check.suitabilityStatus === "unsuitable"));
}

/**
 * The video learners get after the newest video check. A video marked
 * unsuitable, to be replaced or unavailable is never shown; the teacher's
 * replacement YouTube link is used instead when there is one.
 */
export function learnerVideo(original: LessonVideo, check: VideoCheck | null | undefined): LearnerVideo | null {
  if (!videoTakenDown(check)) return original;
  const id = youtubeVideoId(check!.replacementUrl);
  if (!id) return null;
  return { id, title: "A video chosen by your teacher", channel: "YouTube", duration: "", reason: "A teacher checked the original video and chose this one instead.", replaced: true };
}
