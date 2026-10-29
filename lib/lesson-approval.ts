import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db";
import { adults, contentApprovals, contentReviews, mediaAssets, userAuditEvents, videoReviews } from "../db/schema";
import { lessons } from "../app/curriculum";
import { canTeach } from "./roles";
import {
  checkLessonDecision, learnerVideo, LessonError, lessonStatus, videoTakenDown, type LearnerVideo, type LessonStatus,
} from "./lesson-model";

/**
 * The shared teacher approval of the 18 lessons. content_approvals keeps one row
 * per decision and the newest row is the lesson's state, so every teacher and
 * administrator sees the same status. Learners (students, parents, every
 * learner page and API) only get approved lessons. Human audio and video checks
 * are shared between staff too: anyone can play and approve a recording, and the
 * newest video check decides which video learners get.
 */
export type LessonApproval = { lessonId: string; status: LessonStatus; baseline: boolean; changedByName: string | null; changedAt: string | null; note: string };
export type LessonHistoryEntry = { status: "approved" | "withdrawn"; baseline: boolean; changedByName: string | null; changedAt: string; note: string };

type Db = Awaited<ReturnType<typeof getDb>>;
type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Reader = Db | Transaction;
type ApprovalRow = typeof contentApprovals.$inferSelect;
type VideoRow = typeof videoReviews.$inferSelect;

const lessonById = new Map(lessons.map((lesson) => [lesson.id, lesson]));
export const isLessonId = (value: unknown): value is string => typeof value === "string" && lessonById.has(value);
const AUDIO_STATUSES = new Set(["pending", "changes-requested", "approved", "retired"]);

/** A lesson's approval records, oldest first. */
function approvalRows(db: Reader, lessonId?: string): ApprovalRow[] {
  return db.select().from(contentApprovals)
    .where(and(eq(contentApprovals.contentType, "lesson"), lessonId ? eq(contentApprovals.contentId, lessonId) : undefined))
    .orderBy(sql`rowid`).all();
}

function latestByLesson(rows: ApprovalRow[]): Map<string, ApprovalRow> {
  const latest = new Map<string, ApprovalRow>();
  for (const row of rows) latest.set(row.contentId, row);
  return latest;
}

/** The newest video check of each lesson, whoever made it. */
function latestVideoChecks(db: Reader, lessonId?: string): Map<string, VideoRow> {
  const rows = db.select().from(videoReviews).where(lessonId ? eq(videoReviews.lessonId, lessonId) : undefined).orderBy(desc(videoReviews.updatedAt)).all();
  const latest = new Map<string, VideoRow>();
  for (const row of rows) if (!latest.has(row.lessonId)) latest.set(row.lessonId, row);
  return latest;
}

function namesById(db: Reader, ids: Array<string | null>) {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const names = new Map(wanted.length ? db.select({ id: adults.id, name: adults.displayName }).from(adults).where(inArray(adults.id, wanted)).all().map((row) => [row.id, row.name]) : []);
  return (id: string | null) => (id ? names.get(id) ?? null : null);
}

function namesByEmail(db: Reader, emails: string[]) {
  const wanted = [...new Set(emails)];
  const names = new Map(wanted.length ? db.select({ email: adults.email, name: adults.displayName }).from(adults).where(inArray(adults.email, wanted)).all().map((row) => [row.email, row.name]) : []);
  return (email: string) => names.get(email) ?? null;
}

function approvalOf(lessonId: string, row: ApprovalRow | undefined, name: (id: string | null) => string | null): LessonApproval {
  return { lessonId, status: lessonStatus(row), baseline: row?.baseline ?? false, changedByName: name(row?.changedBy ?? null), changedAt: row?.changedAt ?? null, note: row?.note ?? "" };
}

/** Lessons learners may open, in curriculum order. */
export async function approvedLessonIds(): Promise<string[]> {
  const db = await getDb();
  const latest = latestByLesson(approvalRows(db));
  return lessons.filter((lesson) => lessonStatus(latest.get(lesson.id)) === "approved").map((lesson) => lesson.id);
}

export async function isLessonApproved(lessonId: unknown): Promise<boolean> {
  if (!isLessonId(lessonId)) return false;
  const db = await getDb();
  return lessonStatus(approvalRows(db, lessonId).at(-1)) === "approved";
}

/**
 * What the learner pages need: the approved lessons and, for lessons whose video
 * a teacher took down, the replacement video (or null for no video).
 */
export async function learnerLessonView(): Promise<{ approvedIds: string[]; videos: Record<string, LearnerVideo | null> }> {
  const db = await getDb();
  const latest = latestByLesson(approvalRows(db));
  const checks = latestVideoChecks(db);
  const approvedIds = lessons.filter((lesson) => lessonStatus(latest.get(lesson.id)) === "approved").map((lesson) => lesson.id);
  const videos: Record<string, LearnerVideo | null> = {};
  for (const id of approvedIds) {
    const check = checks.get(id);
    if (videoTakenDown(check)) videos[id] = learnerVideo(lessonById.get(id)!.video, check);
  }
  return { approvedIds, videos };
}

/** Every lesson's shared state for the Studio list, with every staff member's recordings waiting for review. */
export async function lessonStudioList() {
  const db = await getDb();
  const rows = approvalRows(db);
  const latest = latestByLesson(rows);
  const checks = latestVideoChecks(db);
  const pending = db.select().from(mediaAssets).where(eq(mediaAssets.reviewStatus, "pending")).orderBy(desc(mediaAssets.createdAt)).all().filter((asset) => lessonById.has(asset.lessonId));
  const name = namesById(db, [...latest.values()].map((row) => row.changedBy));
  const uploader = namesByEmail(db, pending.map((asset) => asset.ownerEmail));
  return {
    lessons: lessons.map((lesson) => {
      const check = checks.get(lesson.id);
      return {
        ...approvalOf(lesson.id, latest.get(lesson.id), name),
        pendingAudio: pending.filter((asset) => asset.lessonId === lesson.id).length,
        video: check ? { status: check.status, suitabilityStatus: check.suitabilityStatus, takenDown: videoTakenDown(check), replaced: Boolean(learnerVideo(lesson.video, check)?.replaced) } : null,
      };
    }),
    pendingRecordings: pending.map((asset) => ({
      id: asset.id, lessonId: asset.lessonId, slot: asset.slot, speakerName: asset.speakerName, dialect: asset.dialect,
      consentConfirmed: asset.consentConfirmed, createdAt: asset.createdAt, uploaderName: uploader(asset.ownerEmail),
    })),
  };
}

/**
 * One lesson for the Studio: its approval and history, every staff member's
 * recordings, the newest video check (and what learners get because of it) and
 * every optional specialist check.
 */
export async function lessonStudioDetail(lessonId: string) {
  const lesson = lessonById.get(lessonId);
  if (!lesson) throw new LessonError("Lesson not found.", "পাঠটি পাওয়া যায়নি।", 404);
  const db = await getDb();
  const rows = approvalRows(db, lessonId);
  const recordings = db.select().from(mediaAssets).where(eq(mediaAssets.lessonId, lessonId)).orderBy(desc(mediaAssets.createdAt)).all();
  const check = latestVideoChecks(db, lessonId).get(lessonId) ?? null;
  const specialist = db.select().from(contentReviews).where(eq(contentReviews.lessonId, lessonId)).orderBy(desc(contentReviews.updatedAt)).all();
  const name = namesById(db, [...rows.map((row) => row.changedBy), ...recordings.map((asset) => asset.reviewedBy)]);
  const account = namesByEmail(db, [...recordings, ...specialist, ...(check ? [check] : [])].map((row) => row.ownerEmail));
  return {
    approval: approvalOf(lessonId, rows.at(-1), name),
    history: rows.map((row): LessonHistoryEntry => ({ status: row.status, baseline: row.baseline, changedByName: name(row.changedBy), changedAt: row.changedAt, note: row.note })).reverse(),
    recordings: recordings.map((asset) => ({
      id: asset.id, slot: asset.slot, originalName: asset.originalName, byteSize: asset.byteSize, speakerName: asset.speakerName, dialect: asset.dialect,
      consentConfirmed: asset.consentConfirmed, reviewStatus: asset.reviewStatus, notes: asset.notes, createdAt: asset.createdAt,
      uploaderName: account(asset.ownerEmail), reviewerName: name(asset.reviewedBy), reviewedAt: asset.reviewedAt,
    })),
    video: check ? {
      status: check.status, captionsStatus: check.captionsStatus, suitabilityStatus: check.suitabilityStatus, replacementUrl: check.replacementUrl,
      notes: check.notes, checkedAt: check.checkedAt ?? check.updatedAt, checkerName: account(check.ownerEmail),
    } : null,
    learnerVideo: learnerVideo(lesson.video, check),
    specialistChecks: specialist.map((review) => ({
      id: review.id, reviewType: review.reviewType, status: review.status, reviewerName: review.reviewerName, notes: review.notes,
      reviewedAt: review.reviewedAt, updatedAt: review.updatedAt, recordedBy: account(review.ownerEmail),
    })),
  };
}

function requireStaff(tx: Transaction, actorId: string) {
  const actor = tx.select({ role: adults.role, status: adults.status, teacherStatus: adults.teacherStatus }).from(adults).where(eq(adults.id, actorId)).get();
  if (!actor || !canTeach(actor)) throw new LessonError("An approved teacher or administrator account is required.", "অনুমোদিত শিক্ষক বা প্রশাসকের অ্যাকাউন্ট প্রয়োজন।", 403);
}

function audit(tx: Transaction, actorId: string, lessonId: string, action: string, details: Record<string, unknown>) {
  tx.insert(userAuditEvents).values({ id: crypto.randomUUID(), actorId, targetId: lessonId, targetType: "lesson", action, detailsJson: JSON.stringify(details) }).run();
}

/**
 * A teacher or administrator approves a lesson (students see it again) or
 * withdraws it (students and parents stop seeing it at once). The decision is
 * recorded under the signed-in account, never a typed name.
 */
export async function decideLesson(actorId: string, lessonId: string, raw: Record<string, unknown>): Promise<LessonApproval> {
  if (!isLessonId(lessonId)) throw new LessonError("Lesson not found.", "পাঠটি পাওয়া যায়নি।", 404);
  const db = await getDb();
  db.transaction((tx) => {
    requireStaff(tx, actorId);
    const { decision, note } = checkLessonDecision(lessonStatus(approvalRows(tx, lessonId).at(-1)), raw);
    tx.insert(contentApprovals).values({
      id: crypto.randomUUID(), contentType: "lesson", contentId: lessonId, status: decision === "approve" ? "approved" : "withdrawn",
      baseline: false, changedBy: actorId, changedAt: new Date().toISOString(), note,
    }).run();
    audit(tx, actorId, lessonId, decision === "approve" ? "lesson-approved" : "lesson-withdrawn", note ? { note } : {});
  });
  const rows = approvalRows(db, lessonId);
  return approvalOf(lessonId, rows.at(-1), namesById(db, [actorId]));
}

/**
 * Any teacher or administrator may approve, retire or send back any staff
 * member's recording. Approving needs recorded consent and the reviewer's
 * confirmation that they listened to it; it retires the slot's previous track
 * whoever uploaded it, and records who approved.
 */
export async function reviewRecording(actorId: string, raw: Record<string, unknown>) {
  const id = typeof raw.id === "string" ? raw.id.trim().slice(0, 80) : "";
  const reviewStatus = typeof raw.reviewStatus === "string" ? raw.reviewStatus : "";
  if (!id || !AUDIO_STATUSES.has(reviewStatus)) throw new LessonError("Invalid recording review.", "রেকর্ডিংয়ের পর্যালোচনা ঠিক নেই।");
  if (raw.notes !== undefined && typeof raw.notes !== "string") throw new LessonError("The note must be text.", "নোট লেখা আকারে দিন।");
  const notes = typeof raw.notes === "string" ? raw.notes.trim() : "";
  if (notes.length > 1500) throw new LessonError("Keep the note under 1500 characters.", "নোট ১,৫০০ অক্ষরের মধ্যে রাখুন।");
  const db = await getDb();
  return db.transaction((tx) => {
    requireStaff(tx, actorId);
    const asset = tx.select().from(mediaAssets).where(eq(mediaAssets.id, id)).get();
    if (!asset) throw new LessonError("Recording not found.", "রেকর্ডিংটি পাওয়া যায়নি।", 404);
    const now = new Date().toISOString();
    if (reviewStatus === "approved") {
      if (!asset.consentConfirmed) throw new LessonError("Consent must be confirmed before approval.", "অনুমোদনের আগে সম্মতি নিশ্চিত করতে হবে।");
      if (raw.confirmedListened !== true) throw new LessonError("Play the recording and tick “I listened to the whole recording” before approving it.", "অনুমোদনের আগে রেকর্ডিংটি বাজিয়ে “আমি পুরো রেকর্ডিং শুনেছি” টিক দিন।");
      tx.update(mediaAssets).set({ reviewStatus: "retired", updatedAt: now })
        .where(and(eq(mediaAssets.lessonId, asset.lessonId), eq(mediaAssets.slot, asset.slot), eq(mediaAssets.reviewStatus, "approved"))).run();
    }
    const updated = tx.update(mediaAssets).set({ reviewStatus, notes, reviewedBy: actorId, reviewedAt: now, updatedAt: now }).where(eq(mediaAssets.id, id)).returning().get();
    audit(tx, actorId, asset.lessonId, `lesson-audio-${reviewStatus}`, { recordingId: id, slot: asset.slot });
    return updated;
  });
}

const MAX_BODY = 20_000;

/** A JSON object request body, or the response to send instead. */
export async function readLessonBody(request: Request): Promise<Record<string, unknown> | Response> {
  const text = await request.text().catch(() => "");
  if (text.length > MAX_BODY) return Response.json({ error: "This request is too long.", errorBn: "অনুরোধটি খুব বড়।" }, { status: 413 });
  try {
    const body = JSON.parse(text);
    if (body && typeof body === "object" && !Array.isArray(body)) return body;
  } catch { /* answered below */ }
  return Response.json({ error: "Send a valid JSON object.", errorBn: "সঠিক তথ্য পাঠান।" }, { status: 400 });
}

/** The API answer for a refusal (in both languages) or an unexpected failure. */
export function lessonErrorResponse(error: unknown): Response {
  if (error instanceof LessonError) return Response.json({ error: error.message, errorBn: error.messageBn }, { status: error.status });
  return Response.json({ error: "Lessons are temporarily unavailable. Please retry.", errorBn: "পাঠগুলো এখন পাওয়া যাচ্ছে না। আবার চেষ্টা করুন।" }, { status: 503 });
}

/** The refusal learner APIs give for a lesson that is not approved (or does not exist). */
export function lessonUnavailable(status = 404): Response {
  return Response.json({ error: "That lesson is not available to learners right now.", errorBn: "এই পাঠটি এখন শিক্ষার্থীদের জন্য খোলা নেই।" }, { status });
}
