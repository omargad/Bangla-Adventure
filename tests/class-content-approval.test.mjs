import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";

// "Who needs approval": the switches for teachers' class activities and class sources, beside the topics one. Absent
// settings are on; while a switch is off an approved teacher's activity or source in their own class is approved at once
// and audited as an automatic approval under the teacher; what was already waiting keeps waiting.
const dir = mkdtempSync(path.join(tmpdir(), "bangla-class-content-approval-"));
process.env.DATABASE_PATH = path.join(dir, "test.db");
const { getDb } = await import("../db/index.ts");
const { adults, appSettings, classes, classActivities, userAuditEvents } = await import("../db/schema.ts");
const settings = await import("../lib/approval-settings.ts");
const activities = await import("../lib/class-activities.ts");
const sources = await import("../lib/class-sources.ts");
const { listUsers, automaticApproval } = await import("../lib/user-management.ts");
const messages = await import("../app/teach/class-publishing.ts");
const { switchChangedMessage, classStillWaiting, settingChangedMessage, stillWaiting } = await import("../app/teach/topics/ApprovalSetting.tsx");
const db = await getDb();
db.insert(adults).values([
  { id: "admin", email: "admin@example.com", displayName: "Admin Ayesha", role: "admin", passwordHash: "fixture", approvalStatus: "approved" },
  { id: "admin-two", email: "admin2@example.com", displayName: "Admin Babul", role: "admin", passwordHash: "fixture", approvalStatus: "approved" },
  { id: "temp-admin", email: "temp@example.com", displayName: "Admin Temp", role: "admin", passwordHash: "fixture", approvalStatus: "approved", mustChangePassword: true },
  { id: "rina", email: "rina@example.com", displayName: "Teacher Rina", role: "teacher", teacherStatus: "approved", passwordHash: "fixture", approvalStatus: "approved" },
  { id: "karim", email: "karim@example.com", displayName: "Teacher Karim", role: "teacher", teacherStatus: "approved", passwordHash: "fixture", approvalStatus: "approved" },
  { id: "temp-teacher", email: "temp-teacher@example.com", displayName: "Teacher Temp", role: "teacher", teacherStatus: "approved", passwordHash: "fixture", approvalStatus: "approved", mustChangePassword: true },
  { id: "parent", email: "parent@example.com", displayName: "Parent Nila", passwordHash: "fixture", approvalStatus: "approved" },
]).run();
db.insert(classes).values([
  { id: "sunday", teacherId: "rina", name: "Sunday 11:30", joinCode: "SUN111" },
  { id: "saturday", teacherId: "karim", name: "Saturday 10:00", joinCode: "SAT100" },
  { id: "temp-class", teacherId: "temp-teacher", name: "Temporary class", joinCode: "TMP100" },
]).run();
after(() => rmSync(dir, { recursive: true, force: true }));

const staff = (id, role = "teacher") => ({ id, role, status: "active", teacherStatus: role === "teacher" ? "approved" : "none" });
const rina = staff("rina"), karim = staff("karim"), admin = staff("admin", "admin");
const quiz = (title) => ({ title, instructions: "Answer both.", topicId: null, questions: [{ prompt: "Which river?", options: ["Padma", "Thames"], correctIndex: 0 }] });
const link = (titleEn, url = "https://example.org/reading") => ({ titleEn, titleBn: "", url, note: "" });
const events = (targetId, actions) => db.select().from(userAuditEvents).where(eq(userAuditEvents.targetId, targetId)).all()
  .filter((event) => !actions || actions.includes(event.action)).map((event) => [event.action, event.actorId, JSON.parse(event.detailsJson)]);
const activity = (id) => db.select().from(classActivities).where(eq(classActivities.id, id)).get();
const learnerSources = async (classId) => (await sources.sourcesOf([classId])).map((source) => source.titleEn);
const forbidden = (error) => error.status === 403 && /Only an administrator can change who needs approval/.test(error.message) && error.messageBn === "কার অনুমোদন লাগবে, তা শুধু প্রশাসক বদলাতে পারেন।";

test("every switch is on until an administrator changes it, and nothing is stored before then", async () => {
  assert.equal(db.select().from(appSettings).all().length, 0);
  for (const key of [settings.TEACHER_TOPIC_APPROVAL, settings.TEACHER_ACTIVITY_APPROVAL, settings.TEACHER_SOURCE_APPROVAL]) assert.equal(settings.approvalRequired(db, key), true, key);
  const current = await settings.getApprovalSettings();
  assert.deepEqual([current.teacherTopicsNeedApproval, current.teacherActivitiesNeedApproval, current.teacherSourcesNeedApproval], [true, true, true]);
  assert.deepEqual(current.lastChanged, { teacherTopicsNeedApproval: null, teacherActivitiesNeedApproval: null, teacherSourcesNeedApproval: null });
  assert.deepEqual(await settings.publishingFor("rina", settings.TEACHER_ACTIVITY_APPROVAL), { onSave: "review", teachersNeedApproval: true });
  assert.deepEqual(await settings.publishingFor("admin", settings.TEACHER_SOURCE_APPROVAL), { onSave: "admin", teachersNeedApproval: true });
  assert.deepEqual(await settings.waitingClassContent(), { activities: 0, sources: 0 });
  // The keys and labels the audit rows carry.
  assert.deepEqual(settings.APPROVAL_SETTINGS.map((setting) => [setting.field, setting.key, setting.label.en]), [
    ["teacherTopicsNeedApproval", "teacher-topics-need-approval", "Teachers' topics need an administrator's approval"],
    ["teacherActivitiesNeedApproval", "teacher-class-activities-need-approval", "Teachers' class activities need an administrator's approval"],
    ["teacherSourcesNeedApproval", "teacher-class-sources-need-approval", "Teachers' class sources need an administrator's approval"],
  ]);
  for (const setting of settings.APPROVAL_SETTINGS) assert.ok(setting.label.bn && setting.label.bn !== setting.label.en);
});

test("with the switches on, a teacher's activity and source wait and an administrator's are approved at once, as before", async () => {
  const waiting = await activities.createClassActivity("rina", "sunday", quiz("Rivers quiz (waiting)"));
  assert.equal(waiting.publishedDirectly, null);
  assert.deepEqual([waiting.activity.approvalStatus, waiting.activity.reviewedBy, waiting.activity.reviewedAt], ["pending", null, null]);
  const own = await activities.createClassActivity("admin", "saturday", quiz("Administrator's quiz"));
  assert.equal(own.publishedDirectly, "admin");
  assert.deepEqual([own.activity.approvalStatus, own.activity.reviewedBy], ["approved", "admin"]);
  assert.deepEqual(events("sunday", ["class-activity-created", "class-activity-reviewed"]).map(([action, actor, details]) => [action, actor, details.approvalStatus, details.automatic]),
    [["class-activity-created", "rina", "pending", undefined]], "a waiting activity is only recorded as added");

  const source = await sources.addClassSource(rina, "sunday", link("Waiting reading"));
  assert.deepEqual([source.approvalStatus, source.publishedDirectly, source.reviewedBy], ["pending", null, null]);
  const byAdmin = await sources.addClassSource(admin, "saturday", link("Administrator's map", "https://example.org/map"));
  assert.deepEqual([byAdmin.approvalStatus, byAdmin.publishedDirectly, byAdmin.reviewedBy], ["approved", "admin", "admin"]);
  assert.deepEqual(await learnerSources("sunday"), []);
  assert.deepEqual(await settings.waitingClassContent(), { activities: 1, sources: 1 });
});

test("only an administrator changes the switches; each value is checked, and refusals store and record nothing", async () => {
  for (const actor of ["rina", "parent", "temp-admin", "nobody"]) {
    await assert.rejects(settings.setApprovalSettings(actor, { teacherActivitiesNeedApproval: false }), forbidden, actor);
    await assert.rejects(settings.setApprovalSettings(actor, { teacherSourcesNeedApproval: false }), forbidden, actor);
  }
  const invalid = [
    [{}, /topics, class activities or class sources/], [null, /topics, class activities or class sources/], [[], /topics, class activities or class sources/],
    [{ somethingElse: false }, /topics, class activities or class sources/],
    [{ teacherActivitiesNeedApproval: "false" }, /class activities need/], [{ teacherSourcesNeedApproval: 0 }, /class sources need/],
    // One bad value refuses the whole change, even beside a good one.
    [{ teacherActivitiesNeedApproval: false, teacherSourcesNeedApproval: "no" }, /class sources need/],
  ];
  for (const [body, message] of invalid) {
    await assert.rejects(settings.setApprovalSettings("admin", body), (error) => error.status === 400 && message.test(error.message) && error.messageBn.length > 0, JSON.stringify(body));
  }
  assert.equal(db.select().from(appSettings).all().length, 0, "nothing is stored");
  assert.equal(events(settings.TEACHER_ACTIVITY_APPROVAL).length + events(settings.TEACHER_SOURCE_APPROVAL).length, 0, "nothing is recorded");

  // The account is checked again inside the change: an administrator suspended since signing in is refused.
  db.update(adults).set({ status: "suspended" }).where(eq(adults.id, "admin-two")).run();
  await assert.rejects(settings.setApprovalSettings("admin-two", { teacherActivitiesNeedApproval: false }), forbidden);
  db.update(adults).set({ status: "active" }).where(eq(adults.id, "admin-two")).run();
  assert.equal(settings.teacherActivitiesNeedApproval(db), true);
});

test("an administrator changes any subset of the switches; each change is audited once with its label, and the same value again records nothing", async () => {
  const changed = await settings.setApprovalSettings("admin", { teacherActivitiesNeedApproval: false });
  assert.deepEqual([changed.changed, changed.changedSettings], [true, ["teacherActivitiesNeedApproval"]]);
  assert.deepEqual([changed.teacherTopicsNeedApproval, changed.teacherActivitiesNeedApproval, changed.teacherSourcesNeedApproval], [true, false, true], "only the switch given changes");
  assert.equal(changed.lastChanged.teacherActivitiesNeedApproval.changedByName, "Admin Ayesha");
  assert.ok(changed.lastChanged.teacherActivitiesNeedApproval.changedAt);
  assert.deepEqual([changed.lastChanged.teacherTopicsNeedApproval, changed.lastChanged.teacherSourcesNeedApproval, changed.changedByName], [null, null, null], "the topics fields still describe the topics switch");
  assert.deepEqual(events(settings.TEACHER_ACTIVITY_APPROVAL), [["approval-setting-changed", "admin", { setting: settings.TEACHER_ACTIVITY_APPROVAL, from: true, to: false, targetLabel: settings.TEACHER_ACTIVITY_APPROVAL_LABEL }]]);
  assert.equal(db.select().from(userAuditEvents).where(eq(userAuditEvents.targetId, settings.TEACHER_ACTIVITY_APPROVAL)).get().targetType, "setting");

  // Two switches in one change: the one already off records nothing; the one that changes records one row.
  const both = await settings.setApprovalSettings("admin-two", { teacherActivitiesNeedApproval: false, teacherSourcesNeedApproval: false });
  assert.deepEqual(both.changedSettings, ["teacherSourcesNeedApproval"]);
  assert.equal(events(settings.TEACHER_ACTIVITY_APPROVAL).length, 1);
  assert.deepEqual(events(settings.TEACHER_SOURCE_APPROVAL), [["approval-setting-changed", "admin-two", { setting: settings.TEACHER_SOURCE_APPROVAL, from: true, to: false, targetLabel: settings.TEACHER_SOURCE_APPROVAL_LABEL }]]);
  assert.equal(both.lastChanged.teacherSourcesNeedApproval.changedByName, "Admin Babul");
  const again = await settings.setApprovalSettings("admin", { teacherActivitiesNeedApproval: false, teacherSourcesNeedApproval: false });
  assert.deepEqual([again.changed, again.changedSettings], [false, []]);
  assert.equal(events(settings.TEACHER_ACTIVITY_APPROVAL).length + events(settings.TEACHER_SOURCE_APPROVAL).length, 2, "the same value again records nothing");
  assert.equal(again.lastChanged.teacherSourcesNeedApproval.changedByName, "Admin Babul", "nor changes who last changed it");
  assert.equal(settings.teacherTopicsNeedApproval(db), true, "the topics switch is untouched");
  assert.equal(events(settings.TEACHER_TOPIC_APPROVAL).length, 0);
  // The topics-only form the API took before keeps working and touches only topics.
  await assert.rejects(settings.setTeacherTopicApproval("admin", { teacherActivitiesNeedApproval: true }), (error) => error.status === 400 && /teachers' topics/.test(error.message));
  assert.equal(settings.teacherActivitiesNeedApproval(db), false);
});

test("with activity approval off, an approved teacher's new activity in their own class is approved at once and audited as automatic", async () => {
  assert.deepEqual(await settings.publishingFor("rina", settings.TEACHER_ACTIVITY_APPROVAL), { onSave: "setting", teachersNeedApproval: false });
  assert.deepEqual(await settings.publishingFor("admin", settings.TEACHER_ACTIVITY_APPROVAL), { onSave: "admin", teachersNeedApproval: false });
  const before = events("sunday").length;
  const saved = await activities.createClassActivity("rina", "sunday", quiz("Rivers quiz (published)"));
  assert.equal(saved.publishedDirectly, "setting");
  assert.deepEqual([saved.activity.approvalStatus, saved.activity.status, saved.activity.reviewedBy, saved.activity.createdBy], ["approved", "open", null, "rina"], "approved and open, with no administrator named as its reviewer");
  assert.ok(saved.activity.reviewedAt);
  const label = { en: "Sunday 11:30", bn: "Sunday 11:30" };
  assert.deepEqual(events("sunday").slice(before), [
    ["class-activity-created", "rina", { activityId: saved.activity.id, title: "Rivers quiz (published)", approvalStatus: "approved", revision: 1, targetLabel: label }],
    ["class-activity-reviewed", "rina", { activityId: saved.activity.id, title: "Rivers quiz (published)", approvalStatus: "approved", revision: 1, automatic: true, setting: settings.TEACHER_ACTIVITY_APPROVAL, targetLabel: label }],
  ]);
  // Students see an approved activity only while it is open, as for any approved activity.
  await activities.changeActivityStatus("rina", "sunday", saved.activity.id, "closed");
  assert.equal(activity(saved.activity.id).approvalStatus, "approved");

  // What was waiting before the switch was turned off still waits, and an administrator still reviews it.
  const stillPending = db.select().from(classActivities).all().filter((row) => row.title === "Rivers quiz (waiting)");
  assert.deepEqual(stillPending.map((row) => row.approvalStatus), ["pending"]);
  assert.deepEqual(await settings.waitingClassContent(), { activities: 1, sources: 1 });

  // The scope and every other rule are unchanged: not another teacher's class, not with a temporary password.
  await assert.rejects(activities.createClassActivity("karim", "sunday", quiz("Not mine")), (error) => error.status === 404 && error.messageBn === "ক্লাসটি পাওয়া যায়নি।");
  await assert.rejects(activities.createClassActivity("temp-teacher", "temp-class", quiz("Temporary")), (error) => error.status === 403);
  assert.equal(db.select().from(classActivities).all().filter((row) => ["Not mine", "Temporary"].includes(row.title)).length, 0);
  // An administrator's own activity is still approved by them, with no automatic record.
  const own = await activities.createClassActivity("admin", "sunday", quiz("Administrator's second quiz"));
  assert.deepEqual([own.publishedDirectly, own.activity.reviewedBy], ["admin", "admin"]);
  assert.equal(events("sunday", ["class-activity-reviewed"]).length, 1);
});

test("with source approval off, a teacher's new or edited source is shown at once and audited as automatic; a teacher still cannot review", async () => {
  const before = events("sunday").length;
  const added = await sources.addClassSource(rina, "sunday", link("Published reading", "https://example.org/published"));
  assert.deepEqual([added.approvalStatus, added.publishedDirectly, added.reviewedBy], ["approved", "setting", null]);
  assert.ok(added.reviewedAt);
  assert.deepEqual(await learnerSources("sunday"), ["Published reading"], "students and parents of the class see it at once; the waiting one stays hidden");
  const label = { en: "Sunday 11:30", bn: "Sunday 11:30" };
  assert.deepEqual(events("sunday").slice(before), [
    ["class-source-added", "rina", { sourceId: added.id, url: "https://example.org/published", targetLabel: label }],
    ["class-source-reviewed", "rina", { sourceId: added.id, approvalStatus: "approved", revision: 1, automatic: true, setting: settings.TEACHER_SOURCE_APPROVAL, targetLabel: label }],
  ]);

  // An edit is shown at once too, including an edit of a source that was waiting from before (it no longer waits).
  const waiting = (await sources.listClassSources(rina, "sunday")).find((source) => source.titleEn === "Waiting reading");
  assert.equal(waiting.approvalStatus, "pending", "turning the switch off published nothing that was waiting");
  const edited = await sources.updateClassSource(rina, "sunday", waiting.id, { ...link("Waiting reading, revised", "https://example.org/revised"), revision: waiting.revision });
  assert.deepEqual([edited.approvalStatus, edited.publishedDirectly, edited.revision], ["approved", "setting", waiting.revision + 1]);
  assert.deepEqual(events("sunday", ["class-source-reviewed"]).at(-1)[2], { sourceId: waiting.id, approvalStatus: "approved", revision: edited.revision, automatic: true, setting: settings.TEACHER_SOURCE_APPROVAL, targetLabel: label });
  assert.deepEqual(await learnerSources("sunday"), ["Waiting reading, revised", "Published reading"], "oldest first");

  // Only an administrator reviews, whatever the switch says; another teacher's class stays out of reach.
  await assert.rejects(sources.reviewClassSource(rina, "sunday", added.id, { approvalStatus: "rejected", revision: added.revision, reviewNote: "Mine" }), (error) => error.status === 403);
  assert.equal(await sources.addClassSource(karim, "sunday", link("Not mine")), null);
  await assert.rejects(sources.addClassSource(staff("temp-teacher"), "temp-class", link("Temporary")), (error) => error.status === 403);
  // An administrator can still send an approved-at-once source back.
  const sentBack = await sources.reviewClassSource(admin, "sunday", added.id, { approvalStatus: "rejected", revision: added.revision, reviewNote: "Check the link." });
  assert.deepEqual([sentBack.approvalStatus, sentBack.reviewedBy], ["rejected", "admin"]);
  assert.deepEqual(await learnerSources("sunday"), ["Waiting reading, revised"]);
});

test("turning a switch on again makes only later saves wait", async () => {
  const on = await settings.setApprovalSettings("admin", { teacherActivitiesNeedApproval: true, teacherSourcesNeedApproval: true });
  assert.deepEqual(on.changedSettings, ["teacherActivitiesNeedApproval", "teacherSourcesNeedApproval"]);
  assert.deepEqual(events(settings.TEACHER_ACTIVITY_APPROVAL).at(-1)[2], { setting: settings.TEACHER_ACTIVITY_APPROVAL, from: false, to: true, targetLabel: settings.TEACHER_ACTIVITY_APPROVAL_LABEL });
  const later = await activities.createClassActivity("rina", "sunday", quiz("Later quiz"));
  assert.deepEqual([later.publishedDirectly, later.activity.approvalStatus], [null, "pending"]);
  assert.equal(db.select().from(classActivities).all().find((row) => row.title === "Rivers quiz (published)").approvalStatus, "approved", "what was approved at once stays approved");
  const revised = (await sources.listClassSources(rina, "sunday")).find((source) => source.titleEn === "Waiting reading, revised");
  const edit = await sources.updateClassSource(rina, "sunday", revised.id, { ...link("Waiting reading, third", "https://example.org/third") });
  assert.deepEqual([edit.approvalStatus, edit.publishedDirectly], ["pending", null], "a teacher's edit waits again and is hidden until approved");
  assert.deepEqual(await learnerSources("sunday"), []);
  assert.deepEqual(await settings.publishingFor("rina", settings.TEACHER_SOURCE_APPROVAL), { onSave: "review", teachersNeedApproval: true });
});

test("Recent changes labels an automatic approval as published at once, under the teacher", async () => {
  assert.equal(automaticApproval(JSON.stringify({ automatic: true, setting: settings.TEACHER_SOURCE_APPROVAL })), true);
  assert.equal(automaticApproval(JSON.stringify({ self: true })), false);
  assert.equal(automaticApproval("not json"), false);
  const listed = (await listUsers("admin", new URLSearchParams())).audit;
  const automatic = listed.filter((event) => event.automatic);
  assert.ok(automatic.length >= 2);
  for (const event of automatic) {
    assert.ok(["class-activity-reviewed", "class-source-reviewed"].includes(event.action), event.action);
    assert.deepEqual(event.actor, { kind: "account", name: "Teacher Rina" });
  }
  const page = readFileSync(new URL("../app/admin/UserManagement.tsx", import.meta.url), "utf8");
  for (const [action, en] of [["class-activity-reviewed", "Class activity published at once (approval was off)"], ["class-source-reviewed", "Class source published at once (approval was off)"], ["topic-version-approved", "Topic published at once (approval was off)"]]) {
    assert.match(page, new RegExp(`"${action}": \\["${en.replace(/[()]/g, "\\$&")}", "[^"]+"\\]`), action);
  }
});

test("the teacher and the administrator are told what a save did and what is still waiting, in English and Bangla", () => {
  assert.equal(messages.activitySavedMessage(null).en, "Activity submitted for Admin approval. Students and parents cannot see it yet.");
  assert.equal(messages.activitySavedMessage("admin").en, "Activity approved and published to the class.");
  assert.match(messages.activitySavedMessage("setting").en, /^Activity published to the class\. .*teachers' class activities do not need an administrator's approval at the moment\.$/);
  assert.match(messages.activitySavedMessage("setting").bn, /প্রশাসকের অনুমোদন লাগে না/);
  assert.equal(messages.activitySaveButton("review").en, "Submit for Admin approval");
  assert.equal(messages.activitySaveButton("setting").en, "Publish to the class");
  assert.match(messages.activityFormNote("setting").en, /published to the class as soon as you save it/);
  assert.equal(messages.activitiesIntro("review", true).en, "Teachers submit activities for Admin approval. Students and parents see only approved activities.");
  assert.match(messages.activitiesIntro("setting", false).en, /switched off approval for teachers' class activities/);
  assert.match(messages.activitiesIntro("admin", false).en, /^Approval for teachers' class activities is off/);
  assert.equal(messages.sourceSavedMessage(null, false).en, "Source submitted for Admin approval. Students and parents cannot see it yet.");
  assert.equal(messages.sourceSavedMessage(null, true).en, "Source updated and submitted for Admin approval. It is hidden until approved again.");
  assert.match(messages.sourceSavedMessage("setting", false).en, /^Source published\. .*do not need an administrator's approval at the moment\.$/);
  assert.match(messages.sourceSavedMessage("setting", true).en, /^Source updated\. Students in this class and their parents see the change now/);
  assert.equal(messages.sourceSaveButton("setting").en, "Save and show to the class");
  assert.match(messages.sourcesIntro("setting", false).bn, /অনুমোদন বন্ধ/);
  for (const value of [null, "admin", "setting"]) for (const edited of [true, false]) assert.notEqual(messages.sourceSavedMessage(value, edited).bn, messages.sourceSavedMessage(value, edited).en);

  assert.equal(switchChangedMessage("teacherActivitiesNeedApproval", false, 0).en, "Approval for teachers' class activities is off. An activity a teacher adds to their own class is now published to the class as soon as they save it.");
  assert.equal(switchChangedMessage("teacherSourcesNeedApproval", false, 2).en, "Approval for teachers' class sources is off. A source a teacher adds or edits in their own class is now shown to the class as soon as they save it. 2 class sources are still waiting for approval: turning approval off does not publish them, so an administrator still reviews them in their classes (All classes, then Class sources).");
  assert.equal(switchChangedMessage("teacherActivitiesNeedApproval", true, 3).en, "Approval for teachers' class activities is on. Teachers' new activities wait for an administrator again.");
  assert.match(switchChangedMessage("teacherSourcesNeedApproval", true, 0).bn, /চালু হয়েছে/);
  assert.deepEqual(switchChangedMessage("teacherTopicsNeedApproval", false, 1), settingChangedMessage(false, 1), "the topics switch says what it said before");
  assert.equal(classStillWaiting("activities", 1, "en"), "1 class activity is still waiting for approval: turning approval off does not publish it, so an administrator still reviews it in its class (All classes, then Activities & quizzes).");
  assert.match(classStillWaiting("sources", 3, "bn"), /^৩টি ক্লাসের উৎস এখনো অনুমোদনের অপেক্ষায়/);
  assert.match(stillWaiting(2, "en", false), /reviews them on the Topics page\.$/);
  assert.match(stillWaiting(2, "en"), /reviews them below\.$/);
});

test("the class routes decide on the server, through the libraries tested above, and tell the page what a save will do", () => {
  const read = (route) => readFileSync(new URL(`../app/api/classes/[id]/${route}`, import.meta.url), "utf8");
  const activitiesRoute = read("activities/route.ts");
  assert.match(activitiesRoute, /await createClassActivity\(user\.id, id, /, "a new activity is approved or held by createClassActivity");
  assert.doesNotMatch(activitiesRoute, /tx\.insert\(classActivities\)/, "the route no longer inserts activities itself");
  assert.match(activitiesRoute, /publishedDirectly \}, \{ status: 201 \}/);
  assert.match(read("sources/route.ts"), /publishingFor\(actor\.id, TEACHER_SOURCE_APPROVAL\)/);
  assert.match(read("route.ts"), /publishing: \{ activities: await publishingFor\(user\.id, TEACHER_ACTIVITY_APPROVAL\) \}/);
});
