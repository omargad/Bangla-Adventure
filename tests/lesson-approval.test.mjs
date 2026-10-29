import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(path.join(tmpdir(), "bangla-lesson-approval-"));
process.env.DATABASE_PATH = path.join(dir, "test.db");
const { getDb } = await import("../db/index.ts");
const { adults, contentApprovals, mediaAssets, userAuditEvents, videoReviews } = await import("../db/schema.ts");
const { migrateContent } = await import("../db/content-migration.ts");
const approval = await import("../lib/lesson-approval.ts");
const model = await import("../lib/lesson-model.ts");
const { lessons, lessonCategories } = await import("../app/curriculum.ts");
const db = await getDb();
db.insert(adults).values([
  { id: "admin", email: "admin@example.com", displayName: "Admin Ayesha", role: "admin", passwordHash: "fixture" },
  { id: "teacher", email: "teacher@example.com", displayName: "Teacher Tania", role: "teacher", teacherStatus: "approved", passwordHash: "fixture" },
  { id: "colleague", email: "colleague@example.com", displayName: "Teacher Rafi", role: "teacher", teacherStatus: "approved", passwordHash: "fixture" },
  { id: "parent", email: "parent@example.com", displayName: "Parent", passwordHash: "fixture" },
]).run();
after(() => rmSync(dir, { recursive: true, force: true }));

const ids = lessons.map((lesson) => lesson.id);
const confirmRead = { decision: "approve", confirmedRead: true };

test("every lesson has a bilingual category, grouped in category order with General conversation first", () => {
  assert.equal(lessons.length, 18);
  const known = new Set(lessonCategories.map((category) => category.id));
  for (const lesson of lessons) assert.ok(known.has(lesson.category), `${lesson.id}: unknown category ${lesson.category}`);
  for (const category of lessonCategories) {
    assert.ok(category.title.en && category.title.bn && category.title.en !== category.title.bn, `${category.id}: needs English and Bangla titles`);
    assert.ok(lessons.some((lesson) => lesson.category === category.id), `${category.id}: has no lessons`);
  }
  const groups = model.groupLessonsByCategory(lessons);
  assert.deepEqual(groups.map((group) => group.category.id), lessonCategories.map((category) => category.id));
  assert.equal(groups[0].category.title.en, "General conversation");
  assert.deepEqual(groups[0].items.map((lesson) => lesson.id), ["hello-me", "my-family", "food-please", "my-day", "school-home", "directions", "friendship-help"]);
  assert.equal(groups.reduce((sum, group) => sum + group.items.length, 0), 18, "every lesson appears exactly once");
  // Empty categories are left out, and lesson order inside a category is kept.
  const few = model.groupLessonsByCategory(lessons.filter((lesson) => ["poetry-place", "hello-me", "living-arts"].includes(lesson.id)));
  assert.deepEqual(few.map((group) => [group.category.id, group.items.map((lesson) => lesson.id)]), [["conversation", ["hello-me"]], ["arts-literature", ["living-arts", "poetry-place"]]]);
  assert.equal(model.lessonCategory("projects").title.bn, "প্রকল্প");
});

test("the decision rules: approving needs the full-review tick, withdrawing needs a reason, and stale decisions are refused", () => {
  assert.equal(model.lessonStatus(undefined), "waiting");
  assert.equal(model.lessonStatus({ status: "approved" }), "approved");
  assert.equal(model.lessonStatus({ status: "withdrawn" }), "withdrawn");
  const refused = (current, raw, pattern, status = 400) => assert.throws(() => model.checkLessonDecision(current, raw), (error) => error instanceof model.LessonError && error.status === status && pattern.test(error.message) && error.messageBn.length > 0);
  refused("approved", { decision: "publish" }, /approve or withdraw/);
  refused("withdrawn", { decision: "approve" }, /reviewed the whole lesson in English and Bangla/);
  refused("withdrawn", { decision: "approve", confirmedRead: "yes" }, /reviewed the whole lesson/);
  refused("approved", confirmRead, /already approved/, 409);
  refused("approved", { decision: "withdraw", note: "   " }, /why you are withdrawing/);
  refused("withdrawn", { decision: "withdraw", note: "Typo" }, /already cannot see/, 409);
  refused("waiting", { decision: "withdraw", note: "Typo" }, /already cannot see/, 409);
  refused("approved", { decision: "withdraw", note: "x".repeat(model.LESSON_NOTE_LIMIT + 1) }, /under 1000/);
  refused("approved", { decision: "withdraw", note: 7 }, /must be text/);
  assert.deepEqual(model.checkLessonDecision("approved", { decision: "withdraw", note: "  Wrong Bangla spelling  " }), { decision: "withdraw", note: "Wrong Bangla spelling" });
  assert.deepEqual(model.checkLessonDecision("waiting", confirmRead), { decision: "approve", note: "" });
  assert.deepEqual(model.checkLessonDecision("withdrawn", { ...confirmRead, note: "Fixed" }), { decision: "approve", note: "Fixed" });
  // A lesson approved only as a baseline takes a real review while students keep seeing it.
  assert.deepEqual(model.checkLessonDecision("approved", { ...confirmRead, note: "Read it all" }, true), { decision: "approve", note: "Read it all" });
  assert.throws(() => model.checkLessonDecision("approved", { decision: "approve" }, true), /reviewed the whole lesson/);
  assert.throws(() => model.checkLessonDecision("approved", confirmRead, false), (error) => error.status === 409);
  assert.deepEqual(model.checkLessonDecision("approved", { decision: "withdraw", note: "Typo" }, true), { decision: "withdraw", note: "Typo" });
});

test("learners get approved lessons in curriculum order, and parents only see assignments of approved lessons", () => {
  assert.deepEqual(model.visibleLessons(lessons, ["six-seasons", "hello-me", "made-up"]).map((lesson) => lesson.id), ["hello-me", "six-seasons"]);
  assert.deepEqual(model.visibleLessons(lessons, []), []);
  const rows = [{ id: "a", lessonId: "hello-me" }, { id: "b", lessonId: "six-seasons" }];
  assert.deepEqual(model.learnerAssignments(rows, ["hello-me"], false), [{ id: "a", lessonId: "hello-me", lessonAvailable: true }]);
  assert.deepEqual(model.learnerAssignments(rows, ["hello-me"], true).map((row) => [row.id, row.lessonAvailable]), [["a", true], ["b", false]]);
});

test("video checks: a taken-down video is hidden from learners unless a YouTube replacement is given", () => {
  for (const [url, id] of [
    ["https://www.youtube.com/watch?v=RJ34xfoHJC8", "RJ34xfoHJC8"], ["https://youtu.be/RJ34xfoHJC8", "RJ34xfoHJC8"],
    ["https://m.youtube.com/watch?v=RJ34xfoHJC8&t=30", "RJ34xfoHJC8"], ["https://www.youtube-nocookie.com/embed/RJ34xfoHJC8", "RJ34xfoHJC8"],
    ["http://www.youtube.com/watch?v=RJ34xfoHJC8", null], ["https://example.com/watch?v=RJ34xfoHJC8", null], ["https://www.youtube.com/watch?v=short", null], ["not a link", null],
  ]) assert.equal(model.youtubeVideoId(url), id, url);
  assert.equal(model.validateReplacementUrl("  "), "");
  assert.equal(model.validateReplacementUrl(" https://youtu.be/RJ34xfoHJC8 "), "https://youtu.be/RJ34xfoHJC8");
  assert.throws(() => model.validateReplacementUrl("https://example.com/video"), (error) => error instanceof model.LessonError && /YouTube/.test(error.message));
  const original = lessons[0].video;
  const check = (status, suitabilityStatus, replacementUrl = "") => ({ status, suitabilityStatus, replacementUrl });
  assert.equal(model.learnerVideo(original, null), original);
  assert.equal(model.learnerVideo(original, check("approved", "suitable")), original);
  assert.equal(model.learnerVideo(original, check("pending", "supervision-required")), original, "a supervised video stays");
  for (const takenDown of [check("replace", "unchecked"), check("unavailable", "suitable"), check("approved", "unsuitable")]) {
    assert.equal(model.videoTakenDown(takenDown), true);
    assert.equal(model.learnerVideo(original, takenDown), null);
  }
  const replaced = model.learnerVideo(original, check("replace", "unsuitable", "https://youtu.be/ZjUjsrN3qi0"));
  assert.equal(replaced.id, "ZjUjsrN3qi0");
  assert.equal(replaced.replaced, true);
  assert.equal(model.learnerVideo(original, check("replace", "unchecked", "https://example.com/x")), null, "an old non-YouTube link is never shown");
});

test("all 18 lessons start approved as a baseline, once, and the migration is safe to repeat", async () => {
  assert.deepEqual(await approval.approvedLessonIds(), ids);
  const rows = db.select().from(contentApprovals).all();
  assert.equal(rows.length, 18);
  assert.ok(rows.every((row) => row.contentType === "lesson" && row.status === "approved" && row.baseline && row.changedBy === null));
  const sqlite = new Database(process.env.DATABASE_PATH);
  try {
    migrateContent(sqlite);
    migrateContent(sqlite);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM content_approvals").get().n, 18);
    const columns = sqlite.prepare("PRAGMA table_info(media_assets)").all().map((column) => column.name);
    assert.ok(columns.includes("reviewed_by") && columns.includes("reviewed_at"));
  } finally { sqlite.close(); }
  const list = await approval.lessonStudioList();
  assert.equal(list.lessons.length, 18);
  assert.ok(list.lessons.every((row) => row.status === "approved" && row.baseline));
});

test("a teacher withdraws a lesson for everyone, it leaves every learner view, and another teacher re-approves it", async () => {
  await assert.rejects(approval.decideLesson("parent", "six-seasons", { decision: "withdraw", note: "No" }), (error) => error.status === 403);
  await assert.rejects(approval.decideLesson("teacher", "made-up", { decision: "withdraw", note: "No" }), (error) => error.status === 404);
  const withdrawn = await approval.decideLesson("teacher", "six-seasons", { decision: "withdraw", note: "The Bangla season names need checking." });
  assert.deepEqual({ status: withdrawn.status, by: withdrawn.changedByName, baseline: withdrawn.baseline }, { status: "withdrawn", by: "Teacher Tania", baseline: false });
  assert.equal(await approval.isLessonApproved("six-seasons"), false);
  assert.equal((await approval.approvedLessonIds()).includes("six-seasons"), false);
  assert.equal((await approval.learnerLessonView()).approvedIds.includes("six-seasons"), false);
  assert.equal(await approval.isLessonApproved("made-up"), false);

  // A server restart re-runs the migration; it must never re-approve a withdrawn lesson.
  const recordsOf = () => db.select().from(contentApprovals).where(eq(contentApprovals.contentId, "six-seasons")).all().length;
  const before = recordsOf();
  const sqlite = new Database(process.env.DATABASE_PATH);
  try {
    migrateContent(sqlite);
    migrateContent(sqlite);
  } finally { sqlite.close(); }
  assert.equal(await approval.isLessonApproved("six-seasons"), false);
  assert.equal(recordsOf(), before);

  // The state is shared: the administrator and every teacher see the same decision.
  const listed = (await approval.lessonStudioList()).lessons.find((row) => row.lessonId === "six-seasons");
  assert.deepEqual([listed.status, listed.changedByName, listed.note], ["withdrawn", "Teacher Tania", "The Bangla season names need checking."]);

  await assert.rejects(approval.decideLesson("colleague", "six-seasons", { decision: "approve" }), (error) => error.status === 400);
  const back = await approval.decideLesson("colleague", "six-seasons", { ...confirmRead, note: "Season names checked." });
  assert.deepEqual([back.status, back.changedByName], ["approved", "Teacher Rafi"]);
  assert.equal(await approval.isLessonApproved("six-seasons"), true);
  await assert.rejects(approval.decideLesson("admin", "six-seasons", confirmRead), (error) => error.status === 409);

  const detail = await approval.lessonStudioDetail("six-seasons");
  assert.deepEqual(detail.history.map((entry) => [entry.status, entry.baseline, entry.changedByName]), [["approved", false, "Teacher Rafi"], ["withdrawn", false, "Teacher Tania"], ["approved", true, null]]);
  const audit = db.select().from(userAuditEvents).all().filter((event) => event.targetId === "six-seasons");
  assert.deepEqual(audit.map((event) => [event.actorId, event.action, event.targetType]), [["teacher", "lesson-withdrawn", "lesson"], ["colleague", "lesson-approved", "lesson"]]);
  assert.equal(JSON.parse(audit[0].detailsJson).note, "The Bangla season names need checking.");
});

test("a teacher confirms a full review of a baseline lesson without hiding it from students", async () => {
  await assert.rejects(approval.decideLesson("teacher", "food-please", { decision: "approve" }), (error) => error.status === 400);
  const reviewed = await approval.decideLesson("teacher", "food-please", { ...confirmRead, note: "Read every part in both languages." });
  assert.deepEqual([reviewed.status, reviewed.baseline, reviewed.changedByName, reviewed.note], ["approved", false, "Teacher Tania", "Read every part in both languages."]);
  assert.equal(await approval.isLessonApproved("food-please"), true, "students keep the lesson throughout");
  // Once reviewed, a second approval is stale.
  await assert.rejects(approval.decideLesson("colleague", "food-please", confirmRead), (error) => error.status === 409);
  const detail = await approval.lessonStudioDetail("food-please");
  assert.deepEqual(detail.history.map((entry) => [entry.status, entry.baseline, entry.changedByName]), [["approved", false, "Teacher Tania"], ["approved", true, null]]);
  const listed = (await approval.lessonStudioList()).lessons.find((row) => row.lessonId === "food-please");
  assert.deepEqual([listed.status, listed.baseline], ["approved", false]);
  const event = db.select().from(userAuditEvents).all().find((item) => item.targetId === "food-please");
  assert.deepEqual([event.action, JSON.parse(event.detailsJson).reviewedBaseline], ["lesson-approved", true]);
});

test("any teacher can approve a colleague's recording after listening, and the approval names them", async () => {
  const recording = (id, ownerEmail, reviewStatus = "pending", consentConfirmed = true) => ({
    id, ownerEmail, lessonId: "hello-me", slot: "dialogue", objectKey: `human-audio/hello-me/dialogue/${id}.ogg`, originalName: `${id}.ogg`,
    contentType: "audio/ogg", byteSize: 10, speakerName: "Nadia", dialect: "Dhaka", consentConfirmed, reviewStatus,
  });
  db.insert(mediaAssets).values([recording("old", "admin@example.com", "approved"), recording("new", "teacher@example.com"), recording("no-consent", "teacher@example.com", "pending", false)]).run();
  const list = await approval.lessonStudioList();
  assert.deepEqual(list.pendingRecordings.map((item) => [item.id, item.uploaderName]).sort(), [["new", "Teacher Tania"], ["no-consent", "Teacher Tania"]]);
  assert.equal(list.lessons.find((row) => row.lessonId === "hello-me").pendingAudio, 2);

  await assert.rejects(approval.reviewRecording("parent", { id: "new", reviewStatus: "approved", confirmedListened: true }), (error) => error.status === 403);
  await assert.rejects(approval.reviewRecording("colleague", { id: "new", reviewStatus: "approved" }), /Play the recording/);
  await assert.rejects(approval.reviewRecording("colleague", { id: "no-consent", reviewStatus: "approved", confirmedListened: true }), /Consent/);
  await assert.rejects(approval.reviewRecording("colleague", { id: "missing", reviewStatus: "approved", confirmedListened: true }), (error) => error.status === 404);
  await assert.rejects(approval.reviewRecording("colleague", { id: "new", reviewStatus: "live" }), (error) => error.status === 400);
  const approved = await approval.reviewRecording("colleague", { id: "new", reviewStatus: "approved", confirmedListened: true });
  assert.deepEqual([approved.reviewStatus, approved.reviewedBy], ["approved", "colleague"]);
  assert.ok(approved.reviewedAt);
  const statuses = Object.fromEntries(db.select().from(mediaAssets).all().map((asset) => [asset.id, asset.reviewStatus]));
  assert.deepEqual(statuses, { old: "retired", new: "approved", "no-consent": "pending" }, "the slot's previous track is retired whoever uploaded it");
  const detail = await approval.lessonStudioDetail("hello-me");
  const shown = detail.recordings.find((item) => item.id === "new");
  assert.deepEqual([shown.uploaderName, shown.reviewerName], ["Teacher Tania", "Teacher Rafi"]);
  assert.ok(db.select().from(userAuditEvents).all().some((event) => event.action === "lesson-audio-approved" && event.actorId === "colleague" && event.targetId === "hello-me"));
});

test("the newest video check from any teacher decides the video learners get", async () => {
  const check = (id, ownerEmail, status, suitabilityStatus, replacementUrl, updatedAt) => ({ id, ownerEmail, lessonId: "my-family", videoId: "uHTorwKsVFg", status, suitabilityStatus, replacementUrl, captionsStatus: "available", updatedAt });
  db.insert(videoReviews).values(check("first", "teacher@example.com", "approved", "suitable", "", "2026-10-01T00:00:00.000Z")).run();
  assert.equal((await approval.learnerLessonView()).videos["my-family"], undefined, "an approved video is unchanged");
  db.insert(videoReviews).values(check("second", "colleague@example.com", "approved", "unsuitable", "", "2026-10-02T00:00:00.000Z")).run();
  assert.equal((await approval.learnerLessonView()).videos["my-family"], null);
  db.update(videoReviews).set({ status: "replace", replacementUrl: "https://youtu.be/h-egsGh_VbQ", updatedAt: "2026-10-03T00:00:00.000Z" }).where(eq(videoReviews.id, "second")).run();
  const view = await approval.learnerLessonView();
  assert.deepEqual([view.videos["my-family"].id, view.videos["my-family"].replaced], ["h-egsGh_VbQ", true]);
  const detail = await approval.lessonStudioDetail("my-family");
  assert.equal(detail.video.status, "replace");
  assert.equal(detail.learnerVideo.id, "h-egsGh_VbQ");
  assert.equal((await approval.lessonStudioList()).lessons.find((row) => row.lessonId === "my-family").video.takenDown, true);
});
