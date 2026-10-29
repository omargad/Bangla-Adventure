import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const dir = mkdtempSync(path.join(tmpdir(), "bangla-topic-approval-"));
process.env.DATABASE_PATH = path.join(dir, "test.db");
const { getDb } = await import("../db/index.ts");
const { adults, students, classes, classStudents, studentClassEnrollments, userAuditEvents } = await import("../db/schema.ts");
const { bootstrapSql } = await import("../db/bootstrap.ts");
const { migrateAccessControl } = await import("../db/access-migration.ts");
const { migrateContent } = await import("../db/content-migration.ts");
const catalog = await import("../lib/curriculum-catalog.ts");
const model = await import("../lib/topic-model.ts");
const { topics: shipped, topicThemes } = await import("../app/topics-content.ts");
const db = await getDb();
db.insert(adults).values([
  { id: "admin", email: "admin@example.com", displayName: "Admin Ayesha", role: "admin", passwordHash: "fixture" },
  { id: "author", email: "author@example.com", displayName: "Teacher Tania", role: "teacher", teacherStatus: "approved", passwordHash: "fixture" },
  { id: "reviewer", email: "reviewer@example.com", displayName: "Teacher Rafi", role: "teacher", teacherStatus: "approved", passwordHash: "fixture" },
  { id: "pending", email: "pending@example.com", displayName: "Pending", role: "parent", teacherStatus: "pending", passwordHash: "fixture" },
  { id: "parent", email: "parent@example.com", displayName: "Parent", passwordHash: "fixture" },
]).run();
db.insert(students).values([
  { id: "maya", username: "maya", displayName: "Maya", passwordHash: "fixture" },
  { id: "rohan", username: "rohan", displayName: "Rohan", passwordHash: "fixture" },
]).run();
after(() => rmSync(dir, { recursive: true, force: true }));

const pair = (en, bn) => ({ en, bn });
const draft = (overrides = {}) => ({
  theme: "our-country", emoji: "🏞️", title: pair("The tea gardens of Sylhet", "সিলেটের চা-বাগান"), tagline: pair("Green hills where tea grows.", "সবুজ পাহাড়ে চা জন্মায়।"), minutes: 4,
  sections: [{ heading: pair("Rows of tea", "সারি সারি চা-গাছ"), body: pair("Tea bushes grow on the hills of Sylhet.", "সিলেটের পাহাড়ে চা-গাছ জন্মায়।") }],
  funFacts: [], quiz: [{ question: pair("Where do the tea gardens grow?", "চা-বাগান কোথায়?"), options: [pair("Sylhet hills", "সিলেটের পাহাড়ে"), pair("The sea", "সমুদ্রে")], answer: 0 }],
  ...overrides,
});
const learnerIds = async () => (await catalog.getCatalog()).map((topic) => topic.id);

test("drafts need every reader-facing text in English and Bangla, within limits", () => {
  const valid = model.validateTopicDraft({ ...draft(), title: pair("  The tea gardens of Sylhet  ", "সিলেটের চা-বাগান"), sources: [{ bookId: "made-up", note: pair("x", "y") }] });
  assert.equal(valid.title.en, "The tea gardens of Sylhet");
  assert.equal("sources" in valid, false, "NCTB sources are kept by the server, never taken from the editor");
  assert.equal(valid.sourceNote, undefined);
  for (const [bad, message] of [
    [{ theme: "politics" }, /category/],
    [{ emoji: " " }, /emoji/],
    [{ title: pair("Tea", "") }, /Title \(Bangla\)/],
    [{ tagline: pair("x".repeat(501), "চা") }, /Short introduction \(English\).*500/],
    [{ minutes: 0 }, /1–60/],
    [{ sections: [] }, /1–12/],
    [{ sections: Array.from({ length: 13 }, () => draft().sections[0]) }, /1–12/],
    [{ sections: [{ heading: pair("Rows", "সারি"), body: pair("", "লেখা") }] }, /Section 1 text \(English\)/],
    [{ quiz: Array.from({ length: 11 }, () => draft().quiz[0]) }, /at most 10/],
    [{ quiz: [{ ...draft().quiz[0], options: [pair("Only", "একটি")] }] }, /2–6 answer options/],
    [{ quiz: [{ ...draft().quiz[0], answer: 2 }] }, /correct answer/],
    [{ quiz: [{ ...draft().quiz[0], options: [pair("Same", "এক"), pair("same", "দুই")] }] }, /different answer options/],
    [{ sourceNote: pair("Class 4 textbook", "") }, /Source note \(Bangla\)/],
  ]) {
    assert.throws(() => model.validateTopicDraft(draft(bad)), (error) => error instanceof model.TopicError && message.test(error.message) && error.messageBn.length > 0, JSON.stringify(bad));
  }
  assert.equal(model.validateTopicDraft(draft({ quiz: [] })).quiz.length, 0, "a quiz is optional");
  assert.deepEqual(model.validateTopicDraft(draft({ sourceNote: pair("Class 4 textbook", "চতুর্থ শ্রেণির বই") })).sourceNote, pair("Class 4 textbook", "চতুর্থ শ্রেণির বই"));
  for (const topic of shipped) model.validateTopicDraft(topic);
});

test("the review rules: only pending versions are decided, never over a newer approval", () => {
  assert.throws(() => model.checkReview(undefined, 0, "approve"), (error) => error.status === 404);
  assert.throws(() => model.checkReview({ version: 2, status: "approved" }, 2, "reject"), (error) => error.status === 409);
  assert.throws(() => model.checkReview({ version: 1, status: "rejected" }, 0, "approve"), (error) => error.status === 409);
  assert.throws(() => model.checkReview({ version: 2, status: "pending" }, 3, "approve"), /newer version/);
  model.checkReview({ version: 2, status: "pending" }, 3, "reject");
  model.checkReview({ version: 4, status: "pending" }, 3, "approve");
  model.checkReview({ version: 1, status: "pending" }, null, "approve");
  assert.deepEqual(model.statusesAfterApproval([
    { version: 1, status: "approved" }, { version: 2, status: "rejected" }, { version: 3, status: "pending" }, { version: 4, status: "pending" }, { version: 5, status: "pending" },
  ], 4), [{ version: 1, status: "superseded" }, { version: 3, status: "superseded" }, { version: 4, status: "approved" }]);
  assert.equal(model.canRestartFromApproved([{ version: 1, status: "rejected" }], 0), true);
  assert.equal(model.canRestartFromApproved([{ version: 1, status: "approved" }, { version: 2, status: "rejected" }, { version: 3, status: "rejected" }], 1), true);
  assert.equal(model.canRestartFromApproved([{ version: 1, status: "rejected" }, { version: 2, status: "pending" }], 0), false, "a waiting version is never skipped");
  assert.equal(model.canRestartFromApproved([{ version: 1, status: "approved" }], 1), false, "nothing was sent back");
  assert.equal(model.canRestartFromApproved([{ version: 1, status: "rejected" }], null), false, "a new topic has no approved version");
});

test("change summaries, quiz marking, grouping and formatting", () => {
  const before = model.validateTopicDraft(draft());
  assert.match(model.describeTopicChanges(before, null)[0].en, /New topic/);
  assert.deepEqual(model.describeTopicChanges(before, before), []);
  const after = model.validateTopicDraft(draft({
    theme: "culture", title: pair("The tea gardens of Sylhet", "সিলেটের চা বাগান"), minutes: 6,
    sections: [...draft().sections, { heading: pair("Tea workers", "চা-শ্রমিক"), body: pair("Many families pick tea.", "অনেক পরিবার চা তোলে।") }], quiz: [],
  }));
  const changes = model.describeTopicChanges(after, before);
  assert.deepEqual(changes.map((change) => change.en), [
    "Category: Our country — symbols, rivers & nature → Culture, crafts & celebrations", "Title (Bangla) changed", "Reading time: 4 → 6 minutes", "Section 2 added", "Quiz question 1 removed",
  ]);
  assert.ok(changes.every((change) => change.bn.length > 0));
  assert.equal(model.topicChanged(after, before), true);

  const quiz = before.quiz.concat([{ question: pair("Colour?", "রং?"), options: [pair("Green", "সবুজ"), pair("Blue", "নীল"), pair("Red", "লাল")], answer: 2 }]);
  assert.deepEqual(model.gradeTopicQuiz(quiz, [0, 2]), { score: 2, total: 2 });
  assert.deepEqual(model.gradeTopicQuiz(quiz, [1, 2]), { score: 1, total: 2 });
  for (const answers of [[0], [0, 3], [0, "2"], "0,2", [0, 1.5]]) assert.equal(model.gradeTopicQuiz(quiz, answers), null);
  assert.equal(model.gradeTopicQuiz([], []), null);

  const groups = model.groupByCategory([{ id: "a", theme: "literature" }, { id: "b", theme: "history" }, { id: "c", theme: "literature" }, { id: "d", theme: "unknown" }]);
  assert.deepEqual(groups.map((group) => [group.category.id, group.items.map((item) => item.id)]), [["history", ["b"]], ["literature", ["a", "c"]]]);
  assert.deepEqual(model.categoryTitle("our-country"), topicThemes.find((theme) => theme.id === "our-country").title);

  assert.match(model.newTopicId("Tea gardens of Sylhet!", "a1b2c3"), /^tea-gardens-of-sylhet-a1b2c3$/);
  assert.equal(model.newTopicId("চা-বাগান", "a1b2c3"), "topic-a1b2c3");
  assert.ok(model.TOPIC_ID_PATTERN.test(model.newTopicId("x".repeat(200), "a1b2c3")));
  assert.equal(model.formatWhen("2026-10-28 09:05:00", "en"), new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short" }).format(new Date("2026-10-28T09:05:00Z")));
  assert.match(model.formatWhen("2026-10-28T09:05:00.000Z", "bn"), /[০-৯]/);
  assert.equal(model.formatWhen("not a date", "en"), "");
  assert.equal(model.formatNumber(15, "bn"), "১৫");
});

test("a teacher's new topic stays hidden from learners until another teacher approves it", async () => {
  const shippedCount = (await catalog.getCatalog()).length;
  assert.equal(shippedCount, shipped.length);
  assert.ok((await catalog.getCatalog()).every((topic) => topic.baseline && topic.version === 0), "shipped topics are the approved baseline");
  await assert.rejects(catalog.createTopic("parent", draft()), (error) => error.status === 403);
  await assert.rejects(catalog.createTopic("pending", draft()), (error) => error.status === 403);
  await assert.rejects(catalog.createTopic("author", draft({ title: pair("", "চা") })), (error) => error.status === 400);
  const { topicId, version } = await catalog.createTopic("author", draft());
  assert.equal(version, 1);
  assert.match(topicId, /^the-tea-gardens-of-sylhet-[0-9a-f]{6}$/);
  assert.equal((await learnerIds()).includes(topicId), false);
  assert.equal(await catalog.findApprovedTopic(topicId), null);
  await assert.rejects(catalog.recordTopicProgress("maya", topicId), /valid learning topic/);

  const listed = (await catalog.listStaffTopics()).find((topic) => topic.id === topicId);
  assert.equal(listed.approved, null);
  assert.deepEqual(listed.pendingVersions, [1]);
  assert.equal(listed.latest.authorName, "Teacher Tania");
  const preview = await catalog.getTopicVersion(topicId, 1);
  assert.equal(preview.version.content.title.bn, "সিলেটের চা-বাগান");
  assert.match(preview.changes[0].en, /New topic/);

  await assert.rejects(catalog.reviewTopicVersion("reviewer", topicId, 1, { decision: "approve" }), /I have read the whole lesson/);
  await assert.rejects(catalog.reviewTopicVersion("parent", topicId, 1, { decision: "approve", confirmedRead: true }), (error) => error.status === 403);
  await assert.rejects(catalog.reviewTopicVersion("reviewer", topicId, 1, { decision: "maybe" }), /approve or send back/);
  const approved = await catalog.reviewTopicVersion("reviewer", topicId, 1, { decision: "approve", confirmedRead: true });
  assert.equal(approved.status, "approved");
  const visible = (await catalog.getCatalog()).find((topic) => topic.id === topicId);
  assert.equal(visible.theme, "our-country");
  assert.equal(visible.baseline, false);
  assert.equal((await catalog.getCatalog()).length, shippedCount + 1);
  const history = await catalog.getStaffTopic(topicId);
  assert.equal(history.versions[0].reviewerName, "Teacher Rafi");
  assert.ok(history.versions[0].reviewedAt);
  await assert.rejects(catalog.reviewTopicVersion("reviewer", topicId, 1, { decision: "reject", note: "Too late" }), (error) => error.status === 409);
  const audit = db.select().from(userAuditEvents).all().filter((event) => event.targetId === topicId).map((event) => [event.action, event.actorId]);
  assert.deepEqual(audit, [["topic-created", "author"], ["topic-version-approved", "reviewer"]]);
});

test("an edit of an approved topic stays hidden until approved; a rejected edit changes nothing", async () => {
  const id = "national-symbols";
  const original = await catalog.findApprovedTopic(id);
  assert.equal(original.theme, "our-country", "Symbols of Bangladesh is no longer filed under history");
  const head = (await catalog.getStaffTopic(id)).head;
  assert.equal(head.version, 0);
  const edit = { ...head.content, theme: "culture", title: pair("Symbols of our country", original.title.bn), baseVersion: 0 };
  await assert.rejects(catalog.submitTopicEdit("author", id, { ...head.content, baseVersion: 0 }), /Nothing has changed/);
  await assert.rejects(catalog.submitTopicEdit("author", id, { ...edit, baseVersion: undefined }), /Reload the topic/);
  await assert.rejects(catalog.submitTopicEdit("author", "no-such-topic", edit), (error) => error.status === 404);
  assert.equal((await catalog.submitTopicEdit("author", id, edit)).version, 1);
  await assert.rejects(catalog.submitTopicEdit("reviewer", id, edit), (error) => error.status === 409, "a stale editor cannot overwrite the newer version");
  assert.equal((await catalog.findApprovedTopic(id)).title.en, original.title.en, "students keep the approved version");

  await assert.rejects(catalog.reviewTopicVersion("reviewer", id, 1, { decision: "reject", note: " " }), /Write a note/);
  await catalog.reviewTopicVersion("reviewer", id, 1, { decision: "reject", note: "Please keep the Bangla title in step." });
  assert.equal((await catalog.findApprovedTopic(id)).title.en, original.title.en);
  assert.deepEqual((await catalog.listStaffTopics()).find((topic) => topic.id === id).pendingVersions, []);

  // The author fixes the rejected version; the fix builds on it and is approved by an administrator.
  const fixed = { ...edit, title: pair("Symbols of our country", "আমাদের দেশের প্রতীক"), baseVersion: 1 };
  assert.equal((await catalog.submitTopicEdit("author", id, fixed)).version, 2);
  assert.equal((await catalog.getTopicVersion(id, 2)).changes.some((change) => change.en.startsWith("Category:")), true);
  await catalog.reviewTopicVersion("admin", id, 2, { decision: "approve", confirmedRead: true, note: "Checked with the class book." });
  const now = await catalog.findApprovedTopic(id);
  assert.equal(now.title.bn, "আমাদের দেশের প্রতীক");
  assert.equal(now.theme, "culture", "staff can set a topic's category");
  assert.deepEqual(now.sources, original.sources, "NCTB sources survive edits");
  assert.deepEqual((await catalog.getStaffTopic(id)).versions.map((version) => [version.version, version.status, version.baseline]), [[0, "superseded", true], [1, "rejected", false], [2, "approved", false]]);
  await assert.rejects(catalog.reviewTopicVersion("admin", id, 0, { decision: "approve", confirmedRead: true }), (error) => error.status === 409);
});

test("approving a later version supersedes older pending ones and an older one cannot replace it", async () => {
  const { topicId } = await catalog.createTopic("author", draft({ title: pair("River boats", "নদীর নৌকা") }));
  const base = { ...draft({ title: pair("River boats", "নদীর নৌকা") }) };
  await catalog.submitTopicEdit("reviewer", topicId, { ...base, minutes: 5, baseVersion: 1 });
  await catalog.submitTopicEdit("author", topicId, { ...base, minutes: 6, baseVersion: 2 });
  await catalog.reviewTopicVersion("admin", topicId, 3, { decision: "approve", confirmedRead: true });
  assert.deepEqual((await catalog.getStaffTopic(topicId)).versions.map((version) => version.status), ["superseded", "superseded", "approved"]);
  await assert.rejects(catalog.reviewTopicVersion("admin", topicId, 2, { decision: "approve", confirmedRead: true }), (error) => error.status === 409);
  assert.equal((await catalog.findApprovedTopic(topicId)).minutes, 6);
});

test("finishing a topic quiz counts as reading and keeps the best server-side score", async () => {
  const topic = await catalog.findApprovedTopic("pohela-boishakh");
  const right = topic.quiz.map((question) => question.answer);
  const wrong = topic.quiz.map((question) => (question.answer + 1) % question.options.length);
  await assert.rejects(catalog.recordTopicProgress("maya", "pohela-boishakh", [0]), /Answer every quiz question/);
  const first = await catalog.recordTopicProgress("maya", "pohela-boishakh", wrong);
  assert.deepEqual(first.quiz, { score: 0, total: topic.quiz.length, best: 0 });
  const second = await catalog.recordTopicProgress("maya", "pohela-boishakh", right);
  assert.equal(second.quiz.best, topic.quiz.length);
  const third = await catalog.recordTopicProgress("maya", "pohela-boishakh", wrong);
  assert.deepEqual(third.quiz, { score: 0, total: topic.quiz.length, best: topic.quiz.length });
  await catalog.recordTopicProgress("maya", "folk-tales");
  const progress = await catalog.topicProgressFor("maya", await catalog.getCatalog());
  assert.deepEqual(progress.readTopicIds.sort(), ["folk-tales", "pohela-boishakh"]);
  assert.deepEqual(progress.quizScores, { "pohela-boishakh": { best: topic.quiz.length, total: topic.quiz.length } });
  assert.deepEqual((await catalog.topicProgressFor("maya", [await catalog.findApprovedTopic("folk-tales")])).readTopicIds, ["folk-tales"], "only approved topics count");

  db.insert(classes).values({ id: "class", teacherId: "author", name: "Sunday 11:30", joinCode: "TOP234" }).run();
  db.insert(classStudents).values([{ id: "roster-maya", classId: "class", displayName: "Maya", tokenHash: "a" }, { id: "roster-rohan", classId: "class", displayName: "Rohan", tokenHash: "b" }]).run();
  db.insert(studentClassEnrollments).values([
    { id: "e1", studentId: "maya", classId: "class", classStudentId: "roster-maya" },
    { id: "e2", studentId: "rohan", classId: "class", classStudentId: "roster-rohan", active: false },
  ]).run();
  const results = await catalog.classTopicProgress("class");
  assert.equal(results.approvedTopics, (await learnerIds()).length);
  assert.deepEqual(results.students, [{ rosterId: "roster-maya", displayName: "Maya", topicsRead: 2, quizzesDone: 1, quizPercent: 100 }], "removed students are left out");
});

test("after an edit is sent back, the next edit can start again from the approved version", async () => {
  const id = "british-rule";
  const original = await catalog.findApprovedTopic(id);
  const start = (await catalog.getStaffTopic(id)).head.content;
  await catalog.submitTopicEdit("author", id, { ...start, title: pair("A rejected title", start.title.bn), baseVersion: 0 });
  await catalog.reviewTopicVersion("reviewer", id, 1, { decision: "reject", note: "This title is wrong." });

  const staff = await catalog.getStaffTopic(id);
  assert.equal(staff.head.version, 1);
  assert.equal(staff.head.content.title.en, "A rejected title", "the sent-back version stays available to its author");
  assert.equal(staff.canStartFromApproved, true);
  assert.deepEqual(staff.approved, { version: 0, content: start });

  // Another teacher fixes a typo starting from what students see, so the rejected title is not carried over.
  const typo = { ...staff.approved.content, tagline: pair(`${start.tagline.en} Fixed.`, start.tagline.bn), baseVersion: 0 };
  await assert.rejects(catalog.submitTopicEdit("reviewer", id, { ...staff.approved.content, baseVersion: 0 }), /Nothing has changed/, "compared with the approved version");
  const saved = await catalog.submitTopicEdit("reviewer", id, typo);
  assert.equal(saved.version, 2);
  const preview = await catalog.getTopicVersion(id, 2);
  assert.equal(preview.version.content.title.en, original.title.en);
  assert.equal(preview.version.basedOn, 0);
  assert.deepEqual(preview.changes.map((change) => change.en), ["Short introduction (English) changed"]);
  assert.deepEqual(preview.version.content.sources, original.sources);
  assert.equal((await catalog.getStaffTopic(id)).canStartFromApproved, false, "a waiting version is never skipped");
  await assert.rejects(catalog.submitTopicEdit("author", id, { ...typo, minutes: 9 }), (error) => error.status === 409, "the approved version is no longer a base once a newer version waits");

  await catalog.reviewTopicVersion("admin", id, 2, { decision: "approve", confirmedRead: true });
  const now = await catalog.findApprovedTopic(id);
  assert.equal(now.title.en, original.title.en);
  assert.match(now.tagline.en, /Fixed\.$/);

  const { topicId } = await catalog.createTopic("author", draft({ title: pair("Hill tracts", "পার্বত্য চট্টগ্রাম") }));
  await catalog.reviewTopicVersion("reviewer", topicId, 1, { decision: "reject", note: "Add more detail." });
  const unpublished = await catalog.getStaffTopic(topicId);
  assert.equal(unpublished.canStartFromApproved, false);
  assert.equal(unpublished.approved, null);
  await assert.rejects(catalog.submitTopicEdit("author", topicId, { ...draft({ title: pair("Hill tracts", "পার্বত্য চট্টগ্রাম"), minutes: 7 }), baseVersion: 0 }), (error) => error.status === 409);
});

test("a quiz score counts only while the topic still has the quiz it was earned on", async () => {
  const id = "pohela-boishakh";
  const before = await catalog.findApprovedTopic(id);
  const right = before.quiz.map((question) => question.answer);
  const scores = async () => (await catalog.topicProgressFor("maya", await catalog.getCatalog())).quizScores;
  assert.deepEqual((await scores())[id], { best: before.quiz.length, total: before.quiz.length });
  assert.equal(catalog.quizKey(before.quiz), catalog.quizKey(structuredClone(before.quiz)));
  assert.equal(catalog.quizKey([]), null);

  // An approved edit that leaves the quiz alone keeps the score.
  let head = (await catalog.getStaffTopic(id)).head;
  await catalog.submitTopicEdit("author", id, { ...head.content, minutes: head.content.minutes + 1, baseVersion: head.version });
  await catalog.reviewTopicVersion("reviewer", id, head.version + 1, { decision: "approve", confirmedRead: true });
  assert.deepEqual((await scores())[id], { best: before.quiz.length, total: before.quiz.length });

  // Rewritten questions with the same number of answers: the old best no longer counts.
  head = (await catalog.getStaffTopic(id)).head;
  const rewritten = head.content.quiz.map((question, index) => ({ ...question, question: pair(`Rewritten question ${index + 1}?`, `নতুন প্রশ্ন ${index + 1}?`) }));
  await catalog.submitTopicEdit("author", id, { ...head.content, quiz: rewritten, baseVersion: head.version });
  await catalog.reviewTopicVersion("reviewer", id, head.version + 1, { decision: "approve", confirmedRead: true });
  assert.equal((await scores())[id], undefined);
  assert.equal((await catalog.classTopicProgress("class")).students[0].quizzesDone, 0);
  const wrong = right.map((answer, index) => (answer + 1) % rewritten[index].options.length);
  assert.deepEqual((await catalog.recordTopicProgress("maya", id, wrong)).quiz, { score: 0, total: right.length, best: 0 }, "the new quiz starts afresh");
  assert.deepEqual((await scores())[id], { best: 0, total: right.length });

  // The quiz removed: the topic still counts as read, but no quiz result is reported.
  head = (await catalog.getStaffTopic(id)).head;
  await catalog.submitTopicEdit("author", id, { ...head.content, quiz: [], baseVersion: head.version });
  await catalog.reviewTopicVersion("reviewer", id, head.version + 1, { decision: "approve", confirmedRead: true });
  const progress = await catalog.topicProgressFor("maya", await catalog.getCatalog());
  assert.ok(progress.readTopicIds.includes(id));
  assert.equal(progress.quizScores[id], undefined);
  const results = (await catalog.classTopicProgress("class")).students[0];
  assert.equal(results.topicsRead, 2);
  assert.equal(results.quizzesDone, 0);
  assert.equal(results.quizPercent, null);
});

test("the content migration adds its table and columns and carries earlier admin edits over once, crediting their author", () => {
  const sqlite = new Database(":memory:");
  sqlite.exec(bootstrapSql);
  migrateAccessControl(sqlite);
  const edited = { ...shipped[0], theme: "history", title: pair("An earlier admin title", shipped[0].title.bn) };
  sqlite.prepare("INSERT INTO topic_updates (topic_id, data_json, version, updated_at) VALUES (?, ?, ?, ?)").run(shipped[0].id, JSON.stringify(edited), 2, "2026-10-01T10:00:00.000Z");
  sqlite.prepare("INSERT INTO topic_updates (topic_id, data_json, version, updated_at) VALUES (?, ?, ?, ?)").run(shipped[2].id, JSON.stringify({ ...shipped[2], minutes: 9 }), 1, "2026-10-02T10:00:00.000Z");
  sqlite.prepare("INSERT INTO adults (id, email, display_name, password_hash, role) VALUES ('old-admin', 'old@example.com', 'Old Admin', 'x', 'admin'), ('new-admin', 'new@example.com', 'New Admin', 'x', 'admin')").run();
  const auditEdit = sqlite.prepare("INSERT INTO user_audit_events (id, actor_id, target_id, target_type, action, details_json, created_at) VALUES (?, ?, ?, 'topic', 'topic-preview-updated', '{}', ?)");
  auditEdit.run("a1", "old-admin", shipped[0].id, "2026-09-30 10:00:00");
  auditEdit.run("a2", "new-admin", shipped[0].id, "2026-10-01 10:00:00");
  auditEdit.run("a3", "removed-admin", shipped[2].id, "2026-10-02 10:00:00");
  sqlite.prepare("INSERT INTO topic_updates (topic_id, data_json, version, updated_at) VALUES (?, ?, ?, ?)").run("retired-topic", JSON.stringify(edited), 1, "2026-10-01T10:00:00.000Z");
  sqlite.prepare("INSERT INTO topic_updates (topic_id, data_json, version, updated_at) VALUES (?, ?, ?, ?)").run(shipped[1].id, "{not json", 1, "2026-10-01T10:00:00.000Z");
  sqlite.prepare("INSERT INTO students (id, username, display_name, password_hash) VALUES ('s', 's', 'S', 'x')").run();
  sqlite.prepare("INSERT INTO student_topic_progress (student_id, topic_id) VALUES ('s', ?)").run(shipped[0].id);
  migrateContent(sqlite);
  migrateContent(sqlite);
  const rows = sqlite.prepare("SELECT * FROM topic_versions ORDER BY topic_id = ? DESC").all(shipped[0].id);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].topic_id, shipped[0].id);
  assert.equal(rows[0].status, "approved");
  assert.equal(rows[0].baseline, 1);
  assert.equal(rows[0].version, 2);
  assert.equal(rows[0].created_by, "new-admin", "the administrator who saved the edit last is credited");
  assert.equal(rows[1].created_by, null, "an author whose account is gone is not guessed");
  // An edit carried over before authors were credited gets its author on the next start.
  sqlite.prepare("UPDATE topic_versions SET created_by = NULL").run();
  migrateContent(sqlite);
  assert.deepEqual(sqlite.prepare("SELECT created_by FROM topic_versions ORDER BY topic_id = ? DESC").all(shipped[0].id).map((row) => row.created_by), ["new-admin", null]);
  const data = JSON.parse(rows[0].data_json);
  assert.equal(data.title.en, "An earlier admin title");
  assert.equal(data.theme, shipped[0].theme);
  assert.deepEqual(data.quiz, shipped[0].quiz);
  assert.equal("id" in data, false);
  const progress = sqlite.prepare("SELECT * FROM student_topic_progress").get();
  assert.equal(progress.quiz_best_score, null);
  const progressColumns = sqlite.prepare("PRAGMA table_info(student_topic_progress)").all().map((column) => column.name);
  for (const column of ["quiz_best_score", "quiz_total", "quiz_key", "quiz_completed_at"]) assert.ok(progressColumns.includes(column), column);
  sqlite.close();
});
