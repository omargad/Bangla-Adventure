import { createHash } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { adults, studentTopicProgress, topicVersions, userAuditEvents } from "../db/schema";
import { topics as shippedTopics, type Bilingual, type Topic, type TopicQuizQuestion } from "../app/topics-content";
import { topicSourceLinks, type SourceOverride } from "./library-links";
import { currentMembers } from "./class-roster";
import { canTeach } from "./roles";
import {
  canRestartFromApproved, checkReview, describeTopicChanges, gradeTopicQuiz, newTopicId, statusesAfterApproval, topicChanged, TopicError, TOPIC_LIMITS,
  validateTopicDraft, type TopicContent, type TopicVersionStatus,
} from "./topic-model";

/**
 * Topics students may read: the latest approved version of each topic. The
 * shipped topics in app/topics-content.ts are the approved baseline (version 0);
 * teachers and administrators add and edit topics as pending versions in
 * topic_versions, and nothing reaches learners until someone approves it.
 */
export type CatalogTopic = Topic & { version: number; baseline: boolean; approvedAt: string | null };
export type VersionSummary = {
  version: number; status: TopicVersionStatus; baseline: boolean; basedOn: number | null;
  authorName: string | null; createdAt: string | null; reviewerName: string | null; reviewedAt: string | null; reviewNote: string;
};
export type StaffTopicSummary = {
  id: string; theme: string; emoji: string; title: Bilingual;
  approved: VersionSummary | null; latest: VersionSummary; pendingVersions: number[];
};

type Db = Awaited<ReturnType<typeof getDb>>;
type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Reader = Db | Transaction;
type VersionRow = typeof topicVersions.$inferSelect;
type TopicState = { id: string; shipped: Topic | null; rows: VersionRow[]; approved: VersionRow | null };

const shippedById = new Map(shippedTopics.map((topic) => [topic.id, topic]));
/** The content of a topic without its id and catalogue fields, as stored in a version. */
function contentOf(topic: Topic | CatalogTopic): TopicContent {
  const content: Partial<CatalogTopic> = { ...topic };
  delete content.id; delete content.version; delete content.baseline; delete content.approvedAt;
  return content as TopicContent;
}

function readContent(row: VersionRow): TopicContent | null {
  try { return JSON.parse(row.dataJson) as TopicContent; } catch { return null; }
}

/** Every topic with its stored versions: shipped topics first, then new topics oldest first. */
function topicStates(db: Reader, onlyId?: string): TopicState[] {
  const rows = db.select().from(topicVersions).where(onlyId ? eq(topicVersions.topicId, onlyId) : undefined).orderBy(asc(topicVersions.version)).all();
  const byTopic = new Map<string, VersionRow[]>();
  for (const row of rows) byTopic.set(row.topicId, [...(byTopic.get(row.topicId) ?? []), row]);
  const shippedIds = shippedTopics.map((topic) => topic.id).filter((id) => !onlyId || id === onlyId);
  const newIds = [...byTopic.keys()].filter((id) => !shippedById.has(id))
    .sort((a, b) => byTopic.get(a)![0].createdAt.localeCompare(byTopic.get(b)![0].createdAt) || a.localeCompare(b));
  return [...shippedIds, ...newIds].map((id) => {
    const versions = byTopic.get(id) ?? [];
    return { id, shipped: shippedById.get(id) ?? null, rows: versions, approved: versions.find((row) => row.status === "approved") ?? null };
  });
}

/** The approved content of a topic, or null when nothing has been approved yet. */
function approvedTopic(state: TopicState): CatalogTopic | null {
  if (state.approved) {
    const content = readContent(state.approved);
    return content ? { ...content, id: state.id, version: state.approved.version, baseline: state.approved.baseline, approvedAt: state.approved.reviewedAt } : null;
  }
  return state.shipped ? { ...state.shipped, version: 0, baseline: true, approvedAt: null } : null;
}

/** The newest version of a topic: what an editor starts from. */
function headOf(state: TopicState): { version: number; status: TopicVersionStatus; content: TopicContent } | null {
  const row = state.rows.at(-1);
  if (row) { const content = readContent(row); return content ? { version: row.version, status: row.status, content } : null; }
  return state.shipped ? { version: 0, status: "approved", content: contentOf(state.shipped) } : null;
}

function nameLookup(db: Reader, rows: VersionRow[]) {
  const ids = [...new Set(rows.flatMap((row) => [row.createdBy, row.reviewedBy]).filter((id): id is string => Boolean(id)))];
  const names = new Map(ids.length ? db.select({ id: adults.id, name: adults.displayName }).from(adults).where(inArray(adults.id, ids)).all().map((row) => [row.id, row.name]) : []);
  return (id: string | null) => (id ? names.get(id) ?? null : null);
}

function summaries(state: TopicState, name: (id: string | null) => string | null): VersionSummary[] {
  const stored = state.rows.map((row): VersionSummary => ({
    version: row.version, status: row.status, baseline: row.baseline, basedOn: row.basedOn, authorName: name(row.createdBy), createdAt: row.createdAt,
    reviewerName: name(row.reviewedBy), reviewedAt: row.reviewedAt, reviewNote: row.reviewNote,
  }));
  if (!state.shipped) return stored;
  // The shipped text: approved as a baseline, superseded once a later version is approved.
  return [{ version: 0, status: state.approved ? "superseded" : "approved", baseline: true, basedOn: null, authorName: null, createdAt: null, reviewerName: null, reviewedAt: null, reviewNote: "" }, ...stored];
}

/** Approved topics only: what students, parents and every learner page receive. */
export async function getCatalog(): Promise<CatalogTopic[]> {
  const db = await getDb();
  return topicStates(db).map(approvedTopic).filter((topic): topic is CatalogTopic => topic !== null);
}

/** Every topic with its approval state, for the staff topics area. */
export async function listStaffTopics(): Promise<StaffTopicSummary[]> {
  const db = await getDb();
  const states = topicStates(db);
  const name = nameLookup(db, states.flatMap((state) => state.rows));
  return states.flatMap((state) => {
    const head = headOf(state);
    if (!head) return [];
    const versions = summaries(state, name);
    const approvedVersion = approvedTopic(state)?.version;
    return [{
      id: state.id, theme: head.content.theme, emoji: head.content.emoji, title: head.content.title,
      approved: versions.find((version) => version.version === approvedVersion && version.status === "approved") ?? null,
      latest: versions.at(-1)!, pendingVersions: versions.filter((version) => version.status === "pending").map((version) => version.version),
    }];
  });
}

/**
 * One topic for the editor and its history: the newest version's content, the
 * approved content, whether an edit may start again from the approved version
 * (every later version was sent back) and every version.
 */
export async function getStaffTopic(topicId: string) {
  const db = await getDb();
  const [state] = topicStates(db, topicId);
  const head = state ? headOf(state) : null;
  if (!state || !head) throw new TopicError("Topic not found.", "বিষয়টি পাওয়া যায়নি।", 404);
  const approved = approvedTopic(state);
  return {
    id: state.id, head, approvedVersion: approved?.version ?? null,
    approved: approved ? { version: approved.version, content: contentOf(approved) } : null,
    canStartFromApproved: canRestartFromApproved(state.rows, approved?.version ?? null),
    versions: summaries(state, nameLookup(db, state.rows)),
  };
}

/** One version in full, with the approved version and what changed between them. */
export async function getTopicVersion(topicId: string, version: number) {
  const db = await getDb();
  const [state] = topicStates(db, topicId);
  const summary = state ? summaries(state, nameLookup(db, state.rows)).find((item) => item.version === version) : undefined;
  const row = state?.rows.find((item) => item.version === version);
  const content = row ? readContent(row) : version === 0 && state?.shipped ? contentOf(state.shipped) : null;
  if (!state || !summary || !content) throw new TopicError("That version of the topic was not found.", "বিষয়ের ওই সংস্করণটি পাওয়া যায়নি।", 404);
  const approved = approvedTopic(state);
  return {
    id: state.id, version: { ...summary, content }, latestVersion: headOf(state)?.version ?? version,
    approved: approved ? { version: approved.version, baseline: approved.baseline, content: contentOf(approved) } : null,
    changes: approved && approved.version === version ? [] : describeTopicChanges(content, approved ? contentOf(approved) : null),
  };
}

function requireStaff(tx: Transaction, actorId: string) {
  const actor = tx.select({ role: adults.role, status: adults.status, teacherStatus: adults.teacherStatus }).from(adults).where(eq(adults.id, actorId)).get();
  if (!actor || !canTeach(actor)) throw new TopicError("An approved teacher or administrator account is required.", "অনুমোদিত শিক্ষক বা প্রশাসকের অ্যাকাউন্ট প্রয়োজন।", 403);
}

function audit(tx: Transaction, actorId: string, topicId: string, action: string, details: Record<string, unknown>) {
  tx.insert(userAuditEvents).values({ id: crypto.randomUUID(), actorId, targetId: topicId, targetType: "topic", action, detailsJson: JSON.stringify(details) }).run();
}

/** A new topic, saved as version 1 waiting for approval. */
export async function createTopic(actorId: string, raw: unknown) {
  const draft = validateTopicDraft(raw);
  const db = await getDb();
  return db.transaction((tx) => {
    requireStaff(tx, actorId);
    let topicId = "";
    do topicId = newTopicId(draft.title.en, crypto.randomUUID().slice(0, 6));
    while (shippedById.has(topicId) || tx.select({ id: topicVersions.id }).from(topicVersions).where(eq(topicVersions.topicId, topicId)).get());
    tx.insert(topicVersions).values({
      id: crypto.randomUUID(), topicId, version: 1, dataJson: JSON.stringify({ ...draft, sources: [] }), status: "pending", createdBy: actorId, createdAt: new Date().toISOString(),
    }).run();
    audit(tx, actorId, topicId, "topic-created", { version: 1, theme: draft.theme });
    return { topicId, version: 1 };
  });
}

/**
 * An edit, saved as a new pending version. Students keep the approved version until
 * this one is approved. baseVersion is the version the editor loaded: the newest one,
 * or the approved one when every later version was sent back (so a rejected change is
 * never carried forward unasked). Any other base means someone saved in the meantime,
 * so two people cannot overwrite each other's work unseen.
 */
export async function submitTopicEdit(actorId: string, topicId: string, raw: unknown) {
  const draft = validateTopicDraft(raw);
  const baseVersion = (raw as { baseVersion?: unknown }).baseVersion;
  if (!Number.isInteger(baseVersion) || Number(baseVersion) < 0) throw new TopicError("Reload the topic before saving.", "সংরক্ষণের আগে বিষয়টি আবার খুলুন।");
  const db = await getDb();
  return db.transaction((tx) => {
    requireStaff(tx, actorId);
    const [state] = topicStates(tx, topicId);
    const head = state ? headOf(state) : null;
    if (!state || !head) throw new TopicError("Topic not found.", "বিষয়টি পাওয়া যায়নি।", 404);
    const approved = approvedTopic(state);
    const restart = approved !== null && baseVersion === approved.version && baseVersion !== head.version && canRestartFromApproved(state.rows, approved.version);
    if (head.version !== baseVersion && !restart) throw new TopicError("Someone saved a newer version of this topic. Reload it before saving.", "কেউ এই বিষয়ের নতুন সংস্করণ সংরক্ষণ করেছেন। সংরক্ষণের আগে আবার খুলুন।", 409);
    const base = restart ? contentOf(approved) : head.content;
    if (!topicChanged(draft, base)) throw new TopicError("Nothing has changed yet. Edit the topic before saving.", "এখনো কিছু বদলায়নি। সংরক্ষণের আগে বিষয়টি সম্পাদনা করুন।");
    const version = head.version + 1, basedOn = Number(baseVersion);
    tx.insert(topicVersions).values({
      id: crypto.randomUUID(), topicId, version, dataJson: JSON.stringify({ ...draft, sources: base.sources ?? [] }), status: "pending",
      basedOn, createdBy: actorId, createdAt: new Date().toISOString(),
    }).run();
    audit(tx, actorId, topicId, "topic-edit-submitted", { version, basedOn });
    return { topicId, version };
  });
}

/**
 * Approve a pending version (it becomes what students see) or send it back with a
 * note. Approval needs the reviewer's confirmation that they read all of it in
 * English and Bangla, and records who approved it and when. Authors may approve
 * their own work; the record still names them as the reviewer.
 */
export async function reviewTopicVersion(actorId: string, topicId: string, version: number, raw: unknown) {
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const decision = body.decision === "approve" || body.decision === "reject" ? body.decision : null;
  if (!decision) throw new TopicError("Choose approve or send back.", "অনুমোদন বা ফেরত পাঠানো বেছে নিন।");
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note.length > TOPIC_LIMITS.note) throw new TopicError("Keep the note to 1000 characters.", "নোট ১০০০ অক্ষরের মধ্যে রাখুন।");
  if (decision === "reject" && !note) throw new TopicError("Write a note so the author knows what to change.", "লেখক কী বদলাবেন তা জানাতে একটি নোট লিখুন।");
  if (decision === "approve" && body.confirmedRead !== true) throw new TopicError("Tick “I have read the whole lesson in English and Bangla” before approving.", "অনুমোদনের আগে “আমি পুরো পাঠ ইংরেজি ও বাংলায় পড়েছি” টিক দিন।");
  const db = await getDb();
  return db.transaction((tx) => {
    requireStaff(tx, actorId);
    const [state] = topicStates(tx, topicId);
    if (!state || (!state.shipped && !state.rows.length)) throw new TopicError("Topic not found.", "বিষয়টি পাওয়া যায়নি।", 404);
    const target = version === 0 && state.shipped ? { version: 0, status: (state.approved ? "superseded" : "approved") as TopicVersionStatus } : state.rows.find((row) => row.version === version);
    checkReview(target, state.approved?.version ?? (state.shipped ? 0 : null), decision);
    const reviewedAt = new Date().toISOString();
    const reviewed = { reviewedBy: actorId, reviewedAt, reviewNote: note };
    if (decision === "reject") {
      tx.update(topicVersions).set({ status: "rejected", ...reviewed }).where(and(eq(topicVersions.topicId, topicId), eq(topicVersions.version, version))).run();
    } else {
      for (const change of statusesAfterApproval(state.rows, version)) {
        tx.update(topicVersions).set(change.version === version ? { status: change.status, ...reviewed } : { status: change.status })
          .where(and(eq(topicVersions.topicId, topicId), eq(topicVersions.version, change.version))).run();
      }
    }
    audit(tx, actorId, topicId, decision === "approve" ? "topic-version-approved" : "topic-version-rejected", { version, ...(note ? { note } : {}) });
    return { topicId, version, status: decision === "approve" ? "approved" : "rejected", reviewedAt };
  });
}

/** An approved topic by id, or null: learner APIs refuse anything else. */
export async function findApprovedTopic(topicId: unknown): Promise<CatalogTopic | null> {
  if (typeof topicId !== "string") return null;
  return (await getCatalog()).find((topic) => topic.id === topicId) ?? null;
}

/**
 * A fingerprint of a quiz's questions, answers and correct answers. A stored score
 * counts only while the approved topic still has exactly the quiz it was earned on.
 */
export function quizKey(quiz: TopicQuizQuestion[]): string | null {
  if (!quiz.length) return null;
  const canonical = quiz.map((item) => [item.question.en, item.question.bn, item.options.map((option) => [option.en, option.bn]), item.answer]);
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 32);
}

/** The best quiz score in a progress row, when it was earned on the topic's current quiz. */
function currentScore(row: typeof studentTopicProgress.$inferSelect, key: string | null) {
  return key !== null && row.quizKey === key && row.quizBestScore !== null && row.quizTotal ? { best: row.quizBestScore, total: row.quizTotal } : null;
}

/**
 * Records that a student read a topic. With quiz answers it also marks the quiz on
 * the server and keeps the student's best score (finishing the quiz counts as reading).
 */
export async function recordTopicProgress(studentId: string, topicId: unknown, answers?: unknown) {
  const topic = await findApprovedTopic(topicId);
  if (!topic) throw new TopicError("Choose a valid learning topic.", "একটি সঠিক শেখার বিষয় বেছে নাও।");
  const result = answers === undefined ? null : gradeTopicQuiz(topic.quiz, answers);
  if (answers !== undefined && !result) throw new TopicError("Answer every quiz question first.", "আগে সব প্রশ্নের উত্তর দাও।");
  const db = await getDb();
  return db.transaction((tx) => {
    const now = new Date().toISOString();
    const where = and(eq(studentTopicProgress.studentId, studentId), eq(studentTopicProgress.topicId, topic.id));
    const existing = tx.select().from(studentTopicProgress).where(where).get();
    if (!existing) tx.insert(studentTopicProgress).values({ studentId, topicId: topic.id, completedAt: now }).run();
    if (!result) return { read: true, topicId: topic.id, quiz: null };
    // A score earned on a quiz that has since been changed is replaced, not compared.
    const key = quizKey(topic.quiz);
    const previous = existing ? currentScore(existing, key)?.best ?? null : null;
    const best = Math.max(previous ?? -1, result.score);
    if (best !== previous) tx.update(studentTopicProgress).set({ quizBestScore: best, quizTotal: result.total, quizKey: key, quizCompletedAt: now }).where(where).run();
    return { read: true, topicId: topic.id, quiz: { score: result.score, total: result.total, best } };
  });
}

/** Each approved topic's id with the fingerprint of its current quiz (null when it has none). */
function quizKeys(topics: Array<Pick<Topic, "id" | "quiz">>) {
  return new Map(topics.map((topic) => [topic.id, quizKey(topic.quiz)]));
}

/**
 * A student's reading and quiz progress, counting only topics that are approved now
 * and only scores earned on each topic's current quiz.
 */
export async function topicProgressFor(studentId: string, approvedTopics: Array<Pick<Topic, "id" | "quiz">>) {
  const db = await getDb();
  const keys = quizKeys(approvedTopics);
  const rows = db.select().from(studentTopicProgress).where(eq(studentTopicProgress.studentId, studentId)).all().filter((row) => keys.has(row.topicId));
  return {
    readTopicIds: rows.map((row) => row.topicId),
    quizScores: Object.fromEntries(rows.flatMap((row) => {
      const score = currentScore(row, keys.get(row.topicId) ?? null);
      return score ? [[row.topicId, score]] : [];
    })),
  };
}

/** Topics read and topic-quiz results for each student allocated to a class, for its teacher. */
export async function classTopicProgress(classId: string) {
  const db = await getDb();
  const keys = quizKeys(await getCatalog());
  // The class's current students with an account, A–Z and by their current name, as in the gradebook.
  const roster = currentMembers(db, [classId]).flatMap((member) => member.studentId ? [{ rosterId: member.id, studentId: member.studentId, displayName: member.displayName }] : []);
  const progress = roster.length ? db.select().from(studentTopicProgress).where(inArray(studentTopicProgress.studentId, roster.map((row) => row.studentId))).all().filter((row) => keys.has(row.topicId)) : [];
  return {
    approvedTopics: keys.size,
    students: roster.map((student) => {
      const rows = progress.filter((row) => row.studentId === student.studentId);
      const quizzes = rows.flatMap((row) => currentScore(row, keys.get(row.topicId) ?? null) ?? []);
      const score = quizzes.reduce((sum, quiz) => sum + quiz.best, 0), total = quizzes.reduce((sum, quiz) => sum + quiz.total, 0);
      return { rosterId: student.rosterId, displayName: student.displayName, topicsRead: rows.length, quizzesDone: quizzes.length, quizPercent: total ? Math.round((score / total) * 100) : null };
    }),
  };
}

/** A topic's cited textbooks with the links readers follow (see lib/library-links.ts for the rule). */
export function topicReferences(topic: Pick<Topic, "sources">, overrides?: Map<string, SourceOverride>) {
  return topicSourceLinks(topic.sources, overrides);
}

const MAX_TOPIC_BODY = 400_000;

/** A JSON object request body, or the response to send instead (topics are large but bounded). */
export async function readTopicBody(request: Request): Promise<Record<string, unknown> | Response> {
  const text = await request.text().catch(() => "");
  if (text.length > MAX_TOPIC_BODY) return Response.json({ error: "This topic is too long to save.", errorBn: "বিষয়টি সংরক্ষণের জন্য খুব বড়।" }, { status: 413 });
  try {
    const body = JSON.parse(text);
    if (body && typeof body === "object" && !Array.isArray(body)) return body;
  } catch { /* answered below */ }
  return Response.json({ error: "Provide the topic fields.", errorBn: "বিষয়ের তথ্যগুলো দিন।" }, { status: 400 });
}

/** The API answer for a refusal (in both languages) or an unexpected failure. */
export function topicErrorResponse(error: unknown): Response {
  if (error instanceof TopicError) return Response.json({ error: error.message, errorBn: error.messageBn }, { status: error.status });
  return Response.json({ error: "Topics are temporarily unavailable. Please retry.", errorBn: "বিষয়গুলো এখন পাওয়া যাচ্ছে না। আবার চেষ্টা করুন।" }, { status: 503 });
}
