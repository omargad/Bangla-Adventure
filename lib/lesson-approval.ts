import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { getDb } from "../db";
import { adults, contentApprovals, contentReviews, lessonVersions, mediaAssets, shippedContentState, userAuditEvents, videoReviews } from "../db/schema";
import { lessons } from "../app/curriculum";
import { canPublishContent } from "./roles";
import { LESSON_AUDIO_SLOT, type RecordingMap } from "./voice-playback";
import type { LessonSnapshot } from "./lesson-content";
import {
  checkLessonDecision, learnerVideo, LessonError, lessonStatus, validateReplacementUrl, videoTakenDown, type LearnerVideo, type LessonStatus,
} from "./lesson-model";

/**
 * Administrator approval of the 18 shared lessons. content_approvals keeps one row
 * per decision and the newest row is the lesson's state, so every teacher and
 * administrator sees the same status. Learners (students, parents, every
 * learner page and API) only get approved lessons. Human audio and video checks
 * are shared between staff too: teachers can preview and submit recordings;
 * only administrators approve recordings or change the video learners get.
 */
export type LessonApproval = { lessonId: string; status: LessonStatus; baseline: boolean; changedByName: string | null; changedAt: string | null; note: string };
export type LessonHistoryEntry = { status: "approved" | "withdrawn"; baseline: boolean; changedByName: string | null; changedAt: string; note: string };

type Db = Awaited<ReturnType<typeof getDb>>;
type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Reader = Db | Transaction;
type ApprovalRow = typeof contentApprovals.$inferSelect;
type VideoRow = typeof videoReviews.$inferSelect;
type LessonVersionRow = typeof lessonVersions.$inferSelect;

const lessonById = new Map(lessons.map((lesson) => [lesson.id, lesson]));
export const isLessonId = (value: unknown): value is string => typeof value === "string" && lessonById.has(value);
const AUDIO_STATUSES = new Set(["pending", "changes-requested", "approved", "retired"]);

function versionRows(db: Reader, lessonId: string): LessonVersionRow[] {
  return db.select().from(lessonVersions).where(eq(lessonVersions.lessonId, lessonId)).orderBy(lessonVersions.version).all();
}

function snapshotOf(row: LessonVersionRow | undefined): LessonSnapshot | null {
  if (!row) return null;
  try { return JSON.parse(row.dataJson) as LessonSnapshot; } catch { return null; }
}

function approvedSnapshot(db: Reader, lessonId: string): LessonSnapshot | null {
  if (lessonStatus(approvalRows(db, lessonId).at(-1)) !== "approved") return null;
  return snapshotOf(versionRows(db, lessonId).find((row) => row.status === "approved"));
}

export async function getApprovedLessonSnapshot(lessonId: string): Promise<LessonSnapshot | null> {
  const db = await getDb();
  const snapshot = approvedSnapshot(db, lessonId);
  return snapshot ? learnerSnapshot(snapshot, effectiveVideo(db, lessonId, snapshot, latestVideoChecks(db, lessonId).get(lessonId))) : null;
}

/** Staff preview only. Callers must authorize staff before exposing this candidate. */
export async function getCandidateLessonSnapshot(lessonId: string): Promise<LessonSnapshot | null> {
  return snapshotOf(versionRows(await getDb(), lessonId).at(-1));
}

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

/** Only explicit administrator decisions change the learner's video. */
function latestVideoChecks(db: Reader, lessonId?: string, publishedOnly = true, videoId?: string): Map<string, VideoRow> {
  const rows = db.select().from(videoReviews).where(and(lessonId ? eq(videoReviews.lessonId, lessonId) : undefined, videoId ? eq(videoReviews.videoId, videoId) : undefined, publishedOnly ? isNotNull(videoReviews.adminDecidedAt) : undefined)).orderBy(desc(videoReviews.updatedAt), desc(sql`${videoReviews}.rowid`)).all();
  const latest = new Map<string, VideoRow>();
  for (const row of rows) if (!latest.has(row.lessonId)) latest.set(row.lessonId, row);
  return latest;
}

/** Text publication never manufactures a media review. Only the unchanged
 * primary video already available in an upgraded installation retains its
 * legacy availability; fresh installations need a separate Admin decision. */
function effectiveVideo(db: Reader, lessonId: string, snapshot: LessonSnapshot, check?: VideoRow | null): LearnerVideo | null {
  if (check?.videoId !== snapshot.lesson.video.id) check = latestVideoChecks(db, lessonId, true, snapshot.lesson.video.id).get(lessonId);
  if (check?.videoId === snapshot.lesson.video.id) {
    if (videoTakenDown(check)) return learnerVideo(snapshot.lesson.video, check);
    return check.status === "approved" && ["suitable", "supervision-required"].includes(check.suitabilityStatus) ? snapshot.lesson.video : null;
  }
  const state = db.select().from(shippedContentState).where(and(eq(shippedContentState.contentType, "lesson"), eq(shippedContentState.contentId, lessonId))).get();
  try {
    const legacy = state?.baselineJson ? JSON.parse(state.baselineJson) as LessonSnapshot : null;
    return legacy?.lesson.video.id === snapshot.lesson.video.id ? snapshot.lesson.video : null;
  } catch { return null; }
}

/** Omitted media must also be absent from server-component/JSON payloads, not
 * merely hidden by the player. Playlists/alternatives have no publication
 * decision of their own, so they remain staff preview material. */
function learnerSnapshot(snapshot: LessonSnapshot, video: LearnerVideo | null): LessonSnapshot {
  return { ...snapshot, lesson: { ...snapshot.lesson,
    video: video ?? { id: "", title: "", channel: "", duration: "", reason: "" },
    playlist: { id: "", title: "", channel: "" }, extraVideos: [],
  } };
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
  return lessons.filter((lesson) => lessonStatus(latest.get(lesson.id)) === "approved" && approvedSnapshot(db, lesson.id)).map((lesson) => lesson.id);
}

export async function isLessonApproved(lessonId: unknown): Promise<boolean> {
  if (!isLessonId(lessonId)) return false;
  const db = await getDb();
  return approvedSnapshot(db, lessonId) !== null;
}

/**
 * What the learner pages need: the approved lessons and, for lessons whose video
 * an administrator took down, the replacement video (or null for no video).
 */
export async function learnerLessonView(): Promise<{ approvedIds: string[]; videos: Record<string, LearnerVideo | null>; snapshots: Record<string, LessonSnapshot> }> {
  const db = await getDb();
  const latest = latestByLesson(approvalRows(db));
  const checks = latestVideoChecks(db);
  const snapshots: Record<string, LessonSnapshot> = {};
  for (const lesson of lessons) {
    const snapshot = lessonStatus(latest.get(lesson.id)) === "approved" ? approvedSnapshot(db, lesson.id) : null;
    if (snapshot) snapshots[lesson.id] = snapshot;
  }
  const approvedIds = Object.keys(snapshots);
  const videos: Record<string, LearnerVideo | null> = {};
  for (const id of approvedIds) {
    const check = checks.get(id);
    videos[id] = effectiveVideo(db, id, snapshots[id], check);
    snapshots[id] = learnerSnapshot(snapshots[id], videos[id]);
  }
  return { approvedIds, videos, snapshots };
}

/** Approved recordings with recorded consent, newest first: what learners hear. */
function approvedRecordingRows(db: Reader, lessonId?: string, slot?: string) {
  return db.select().from(mediaAssets)
    .where(and(eq(mediaAssets.reviewStatus, "approved"), eq(mediaAssets.consentConfirmed, true), lessonId ? eq(mediaAssets.lessonId, lessonId) : undefined, slot ? eq(mediaAssets.slot, slot) : undefined))
    .orderBy(desc(mediaAssets.updatedAt)).all();
}

/** The human recording learners hear for one part of a lesson, after administrator approval. */
export async function approvedRecording(lessonId: string, slot: string) {
  if (!isLessonId(lessonId) || !LESSON_AUDIO_SLOT.test(slot)) return null;
  return approvedRecordingRows(await getDb(), lessonId, slot)[0] ?? null;
}

function recordingMap(db: Reader, lessonIds: readonly string[]): RecordingMap {
  const wanted = new Set(lessonIds);
  const recordings: RecordingMap = {};
  for (const asset of approvedRecordingRows(db, lessonIds.length === 1 ? lessonIds[0] : undefined)) {
    const key = `${asset.lessonId}/${asset.slot}`;
    if (wanted.has(asset.lessonId) && LESSON_AUDIO_SLOT.test(asset.slot) && !(key in recordings)) recordings[key] = asset.id;
  }
  return recordings;
}

/**
 * Which parts of these lessons have an approved human recording, keyed
 * `${lessonId}/${slot}` with the recording id, so learner pages play it before
 * any computer or device voice. It is the same choice /api/audio makes.
 */
export async function approvedRecordings(lessonIds: readonly string[]): Promise<RecordingMap> {
  return recordingMap(await getDb(), lessonIds);
}

/** Every lesson's shared state for the Studio list, with every staff member's recordings waiting for review. */
export async function lessonStudioList() {
  const db = await getDb();
  const rows = approvalRows(db);
  const latest = latestByLesson(rows);
  const pending = db.select().from(mediaAssets).where(eq(mediaAssets.reviewStatus, "pending")).orderBy(desc(mediaAssets.createdAt)).all().filter((asset) => lessonById.has(asset.lessonId));
  const name = namesById(db, [...latest.values()].map((row) => row.changedBy));
  const uploader = namesByEmail(db, pending.map((asset) => asset.ownerEmail));
  return {
    lessons: lessons.map((lesson) => {
      const current = versionRows(db, lesson.id).at(-1);
      const video = snapshotOf(current)?.lesson.video;
      const check = video ? latestVideoChecks(db, lesson.id, true, video.id).get(lesson.id) : undefined;
      return {
        ...approvalOf(lesson.id, latest.get(lesson.id), name),
        pendingRevision: current?.status === "pending" ? current.version : null,
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
 * recordings (and the one learners hear for each part, chosen exactly as
 * /api/audio chooses it), the newest video check, the effective administrator
 * video decision and every optional specialist check.
 */
export async function lessonStudioDetail(lessonId: string) {
  const lesson = lessonById.get(lessonId);
  if (!lesson) throw new LessonError("Lesson not found.", "পাঠটি পাওয়া যায়নি।", 404);
  const db = await getDb();
  const rows = approvalRows(db, lessonId);
  const versions = versionRows(db, lessonId);
  const candidate = versions.at(-1);
  const snapshot = snapshotOf(candidate);
  if (!candidate || !snapshot) throw new LessonError("Lesson content is unavailable.", "পাঠের বিষয়বস্তু পাওয়া যাচ্ছে না।", 503);
  const publishedSnapshot = approvedSnapshot(db, lessonId);
  const recordings = db.select().from(mediaAssets).where(eq(mediaAssets.lessonId, lessonId)).orderBy(desc(mediaAssets.createdAt)).all();
  const check = latestVideoChecks(db, lessonId, false, snapshot.lesson.video.id).get(lessonId) ?? null;
  const publishedCheck = latestVideoChecks(db, lessonId, true, snapshot.lesson.video.id).get(lessonId) ?? null;
  const specialist = db.select().from(contentReviews).where(eq(contentReviews.lessonId, lessonId)).orderBy(desc(contentReviews.updatedAt)).all();
  const name = namesById(db, [...rows.map((row) => row.changedBy), ...recordings.map((asset) => asset.reviewedBy)]);
  const account = namesByEmail(db, [...recordings, ...specialist, ...(check ? [check] : [])].map((row) => row.ownerEmail));
  return {
    snapshot,
    contentFingerprint: candidate.fingerprint,
    pendingRevision: candidate.status === "pending" ? { version: candidate.version, fingerprint: candidate.fingerprint } : null,
    approvedSnapshot: publishedSnapshot,
    revisions: versions.map(({ version, fingerprint, status, baseline, reviewedAt, reviewNote }) => ({ version, fingerprint, status, baseline, reviewedAt, reviewNote })),
    approval: approvalOf(lessonId, rows.at(-1), name),
    history: rows.map((row): LessonHistoryEntry => ({ status: row.status, baseline: row.baseline, changedByName: name(row.changedBy), changedAt: row.changedAt, note: row.note })).reverse(),
    recordings: recordings.map((asset) => ({
      id: asset.id, slot: asset.slot, originalName: asset.originalName, byteSize: asset.byteSize, speakerName: asset.speakerName, dialect: asset.dialect,
      consentConfirmed: asset.consentConfirmed, reviewStatus: asset.reviewStatus, notes: asset.notes, createdAt: asset.createdAt,
      uploaderName: account(asset.ownerEmail), reviewerName: name(asset.reviewedBy), reviewedAt: asset.reviewedAt,
    })),
    learnerRecordings: recordingMap(db, [lessonId]),
    video: check ? {
      status: check.status, captionsStatus: check.captionsStatus, suitabilityStatus: check.suitabilityStatus, replacementUrl: check.replacementUrl,
      notes: check.notes, checkedAt: check.checkedAt ?? check.updatedAt, checkerName: account(check.ownerEmail), adminDecidedAt: check.adminDecidedAt,
    } : null,
    learnerVideo: publishedSnapshot ? effectiveVideo(db, lessonId, publishedSnapshot) : null,
    candidateVideo: learnerVideo(snapshot.lesson.video, publishedCheck?.videoId === snapshot.lesson.video.id ? publishedCheck : null),
    specialistChecks: specialist.map((review) => ({
      id: review.id, reviewType: review.reviewType, status: review.status, reviewerName: review.reviewerName, notes: review.notes,
      reviewedAt: review.reviewedAt, updatedAt: review.updatedAt, recordedBy: account(review.ownerEmail),
    })),
  };
}

function requirePublisher(tx: Transaction, actorId: string) {
  const actor = tx.select({ id: adults.id, email: adults.email, role: adults.role, status: adults.status, teacherStatus: adults.teacherStatus, approvalStatus: adults.approvalStatus, mustChangePassword: adults.mustChangePassword }).from(adults).where(eq(adults.id, actorId)).get();
  if (!actor || !canPublishContent(actor)) throw new LessonError("Administrator approval is required to publish or review shared content.", "সবার জন্য বিষয়বস্তু প্রকাশ বা পর্যালোচনার সিদ্ধান্ত নিতে প্রশাসকের অনুমোদন প্রয়োজন।", 403);
  return actor;
}

function audit(tx: Transaction, actorId: string, lessonId: string, action: string, details: Record<string, unknown>) {
  tx.insert(userAuditEvents).values({ id: crypto.randomUUID(), actorId, targetId: lessonId, targetType: "lesson", action, detailsJson: JSON.stringify(details) }).run();
}

/**
 * An administrator approves a lesson (students see it again) or
 * withdraws it (students and parents stop seeing it at once). Approving a
 * lesson that is approved only as a baseline records the administrator's review while
 * students keep seeing it. The decision is recorded under the signed-in
 * account, never a typed name.
 */
export async function decideLesson(actorId: string, lessonId: string, raw: Record<string, unknown>): Promise<LessonApproval> {
  if (!isLessonId(lessonId)) throw new LessonError("Lesson not found.", "পাঠটি পাওয়া যায়নি।", 404);
  const db = await getDb();
  db.transaction((tx) => {
    requirePublisher(tx, actorId);
    const latest = approvalRows(tx, lessonId).at(-1);
    const current = lessonStatus(latest);
    const versions = versionRows(tx, lessonId);
    const candidate = versions.at(-1);
    if (raw.decision === "approve" && (!candidate || raw.contentFingerprint !== candidate.fingerprint || candidate.status === "rejected")) {
      throw new LessonError("The lesson revision changed. Reload and review its current English and Bangla content before approving.", "পাঠের সংস্করণ বদলেছে। আবার খুলে বর্তমান ইংরেজি ও বাংলা বিষয়বস্তু দেখে অনুমোদন দিন।", 409);
    }
    const pending = candidate?.status === "pending";
    const { decision, note } = checkLessonDecision(current, raw, (latest?.baseline ?? false) || pending);
    const now = new Date().toISOString();
    if (decision === "approve" && candidate) {
      tx.update(lessonVersions).set({ status: "superseded" }).where(and(eq(lessonVersions.lessonId, lessonId), inArray(lessonVersions.status, ["approved", "pending"]))).run();
      tx.update(lessonVersions).set({ status: "approved", baseline: false, reviewedBy: actorId, reviewedAt: now, reviewNote: note }).where(eq(lessonVersions.id, candidate.id)).run();
    }
    tx.insert(contentApprovals).values({
      id: crypto.randomUUID(), contentType: "lesson", contentId: lessonId, status: decision === "approve" ? "approved" : "withdrawn",
      baseline: false, changedBy: actorId, changedAt: now, note,
    }).run();
    const reviewedBaseline = decision === "approve" && current === "approved";
    audit(tx, actorId, lessonId, decision === "approve" ? "lesson-approved" : "lesson-withdrawn", { version: candidate?.version, contentFingerprint: candidate?.fingerprint, ...(note ? { note } : {}), ...(reviewedBaseline ? { reviewedBaseline: true } : {}) });
  });
  const rows = approvalRows(db, lessonId);
  return approvalOf(lessonId, rows.at(-1), namesById(db, [actorId]));
}

/**
 * An administrator may approve, retire or send back any staff
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
    requirePublisher(tx, actorId);
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

/**
 * A staff member's uploaded recording (the file is already stored). An administrator's own upload is
 * approved at once (they chose the file and confirmed the speaker's consent), replacing the slot's
 * previous track as an approval does, and audited as lesson-audio-approved with { self: true }. Anyone
 * else's waits for an administrator. The account is checked inside the transaction.
 */
export async function saveUploadedRecording(actorId: string, recording: Pick<typeof mediaAssets.$inferInsert, "lessonId" | "slot" | "objectKey" | "originalName" | "contentType" | "byteSize" | "speakerName" | "dialect" | "consentConfirmed">) {
  const db = await getDb();
  return db.transaction((tx) => {
    const actor = tx.select({ email: adults.email, role: adults.role, status: adults.status, teacherStatus: adults.teacherStatus, approvalStatus: adults.approvalStatus, mustChangePassword: adults.mustChangePassword }).from(adults).where(eq(adults.id, actorId)).get();
    if (!actor) throw new LessonError("Sign in required.", "সাইন ইন করা প্রয়োজন।", 401);
    const publish = canPublishContent(actor) && recording.consentConfirmed === true;
    const now = new Date().toISOString();
    if (publish) {
      tx.update(mediaAssets).set({ reviewStatus: "retired", updatedAt: now })
        .where(and(eq(mediaAssets.lessonId, recording.lessonId), eq(mediaAssets.slot, recording.slot), eq(mediaAssets.reviewStatus, "approved"))).run();
    }
    const asset = tx.insert(mediaAssets).values({
      id: crypto.randomUUID(), ownerEmail: actor.email, ...recording, reviewStatus: publish ? "approved" : "pending",
      // As an approval does, the decision time is written (updated_at orders a slot's approved tracks).
      ...(publish ? { reviewedBy: actorId, reviewedAt: now, updatedAt: now } : {}),
    }).returning().get();
    audit(tx, actorId, recording.lessonId, "lesson-audio-uploaded", { recordingId: asset.id, slot: asset.slot });
    if (publish) audit(tx, actorId, recording.lessonId, "lesson-audio-approved", { recordingId: asset.id, slot: asset.slot, self: true });
    return asset;
  });
}

/** An administrator's video decision and its audit record are committed together. */
export async function saveVideoReview(actorId: string, raw: Record<string, unknown>) {
  const db = await getDb();
  return db.transaction((tx) => {
    const actor = requirePublisher(tx, actorId);
    const value = (input: unknown, maxLength: number) => typeof input === "string" ? input.trim().slice(0, maxLength) : "";
    const lessonId = value(raw.lessonId, 60);
    if (!isLessonId(lessonId)) throw new LessonError("Unknown lesson.", "পাঠটি পাওয়া যায়নি।");
    const candidate = versionRows(tx, lessonId).at(-1);
    const snapshot = snapshotOf(candidate);
    if (!candidate || !snapshot || raw.contentFingerprint !== candidate.fingerprint || raw.videoId !== snapshot.lesson.video.id) {
      throw new LessonError("The video preview changed. Reload the lesson and review the current video before saving your decision.", "ভিডিওর প্রিভিউ বদলেছে। পাঠটি আবার খুলে বর্তমান ভিডিও দেখে সিদ্ধান্ত সংরক্ষণ করুন।", 409);
    }
    const status = value(raw.status, 30);
    const captionsStatus = value(raw.captionsStatus, 30);
    const suitabilityStatus = value(raw.suitabilityStatus, 30);
    const notes = value(raw.notes, 1500);
    if (!["pending", "approved", "replace", "unavailable"].includes(status)) throw new LessonError("Invalid video status.", "ভিডিওর অবস্থা ঠিক নেই।");
    if (!["unchecked", "available", "partial", "missing"].includes(captionsStatus)) throw new LessonError("Invalid captions status.", "ক্যাপশনের অবস্থা ঠিক নেই।");
    if (!["unchecked", "suitable", "supervision-required", "unsuitable"].includes(suitabilityStatus)) throw new LessonError("Invalid suitability status.", "উপযোগিতার অবস্থা ঠিক নেই।");
    const replacementUrl = validateReplacementUrl(raw.replacementUrl);
    const now = new Date().toISOString();
    const existing = tx.select({ id: videoReviews.id }).from(videoReviews)
      .where(and(eq(videoReviews.ownerEmail, actor.email), eq(videoReviews.lessonId, lessonId), eq(videoReviews.videoId, snapshot.lesson.video.id))).get();
    const values = { videoId: snapshot.lesson.video.id, status, captionsStatus, suitabilityStatus, replacementUrl, notes, checkedAt: now, updatedAt: now, adminDecidedAt: now };
    const review = existing
      ? tx.update(videoReviews).set(values).where(eq(videoReviews.id, existing.id)).returning().get()
      : tx.insert(videoReviews).values({ id: crypto.randomUUID(), ownerEmail: actor.email, lessonId, ...values }).returning().get();
    audit(tx, actorId, lessonId, "lesson-video-checked", { status, suitabilityStatus, takenDown: videoTakenDown(review), replacementUrl, videoId: snapshot.lesson.video.id, contentFingerprint: candidate.fingerprint });
    return { review, created: !existing };
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
