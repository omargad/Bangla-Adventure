import { test, expect, type Browser, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

/**
 * The administrator's "Who needs approval" switches: "Teachers' topics need an administrator's approval",
 * "Teachers' class activities need an administrator's approval" and "Teachers' class sources need an
 * administrator's approval". Each is one setting for the whole installation, so this spec runs in its own
 * Playwright project before the other browser specs (see playwright.config.ts), one test at a time, and always
 * leaves every switch on, as every other spec expects.
 */
test.describe.configure({ mode: "serial" });
const password = "Approval-setting-password-2026";
const SWITCH = "Teachers' topics need an administrator's approval";
const ACTIVITY_SWITCH = "Teachers' class activities need an administrator's approval";
const SOURCE_SWITCH = "Teachers' class sources need an administrator's approval";
const ALL_ON = { teacherTopicsNeedApproval: true, teacherActivitiesNeedApproval: true, teacherSourcesNeedApproval: true };

function fixture(sql: string, ...values: Array<string | number>) {
  if (!process.env.BANGLA_E2E_DB?.includes("bangla-e2e-")) throw new Error("Isolated test database required.");
  const db = new Database(process.env.BANGLA_E2E_DB);
  try { db.prepare(sql).run(...values); } finally { db.close(); }
}

async function staff(browser: Browser, baseURL: string | undefined, name: string, suffix: string, role: "teacher" | "admin") {
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": `${name}-${suffix}` } });
  await context.addCookies([{ name: "ba_language", value: "en", url: baseURL! }]);
  const email = `${name}-${suffix}@example.com`;
  expect((await context.request.post("/api/auth/sign-up", { data: { email, displayName: `${name} ${suffix}`, password } })).status()).toBe(201);
  fixture("UPDATE adults SET role = ?, teacher_status = ?, approval_status = 'approved' WHERE email = ?", role, role === "teacher" ? "approved" : "none", email);
  expect((await context.request.post("/api/auth/sign-in", { data: { email, password } })).status()).toBe(200);
  return { context, email };
}

async function api(page: Page, method: string, url: string, data?: unknown) {
  return page.evaluate(async ({ method, url, data }) => {
    const response = await fetch(url, { method, headers: data ? { "Content-Type": "application/json" } : {}, body: data ? JSON.stringify(data) : undefined });
    return { status: response.status, body: await response.json() };
  }, { method, url, data });
}

const pair = (en: string, bn: string) => ({ en, bn });
const topic = (title: string) => ({
  theme: "culture", emoji: "🎨", title: pair(title, `${title} (বাংলা)`), tagline: pair("Colours of Bengal.", "বাংলার রং।"), minutes: 3,
  sections: [{ heading: pair("Painted rickshaws", "রঙিন রিকশা"), body: pair("Rickshaws in Dhaka are painted brightly.", "ঢাকার রিকশা উজ্জ্বল রঙে আঁকা।") }], funFacts: [], quiz: [],
});

test("an administrator turns teachers' topic approval off and on; waiting edits keep waiting and the wording follows", async ({ browser, baseURL }) => {
  test.setTimeout(120000);
  const suffix = randomUUID().slice(0, 8);
  const admin = await staff(browser, baseURL, "setting-admin", suffix, "admin");
  const teacher = await staff(browser, baseURL, "setting-teacher", suffix, "teacher");
  const tempAdmin = await staff(browser, baseURL, "setting-temp", suffix, "admin");
  const studentContext = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": `setting-student-${suffix}` } });
  const adminPage = await admin.context.newPage();
  try {
    const teacherPage = await teacher.context.newPage(), tempPage = await tempAdmin.context.newPage(), student = await studentContext.newPage();
    for (const page of [adminPage, teacherPage, tempPage, student]) page.setDefaultTimeout(15000);

    // On by default: the administrator sees the switch on, and the teacher is told topics wait.
    await adminPage.goto("/teach/topics");
    const setting = adminPage.getByRole("region", { name: "Who needs approval" });
    const toggle = setting.getByRole("switch", { name: new RegExp(SWITCH) });
    await expect(toggle).toBeChecked();
    await expect(setting).toContainText("On: a topic a teacher writes or edits waits on this page");
    await teacherPage.goto("/teach/topics");
    await expect(teacherPage.getByText("Write or edit a topic, then submit it for administrator review.", { exact: false })).toBeVisible();
    await expect(teacherPage.getByRole("region", { name: "Who needs approval" })).toHaveCount(0);

    // If the settings do not answer, the topics are still listed and the panel shows its own error.
    const settingsDown = (route: import("@playwright/test").Route) => route.request().method() === "GET"
      ? route.fulfill({ status: 503, json: { error: "Settings are temporarily unavailable. Please retry.", errorBn: "সেটিংস এখন পাওয়া যাচ্ছে না। আবার চেষ্টা করুন।" } })
      : route.continue();
    await adminPage.route("**/api/admin/approval-settings*", settingsDown);
    await adminPage.reload();
    await expect(adminPage.getByRole("region", { name: "Waiting for approval" })).toBeVisible();
    await expect(setting.getByRole("alert")).toHaveText("Settings are temporarily unavailable. Please retry.");
    await expect(adminPage.locator("main > .auth-error")).toHaveCount(0);
    await adminPage.unroute("**/api/admin/approval-settings*", settingsDown);
    await adminPage.reload();
    await expect(toggle).toBeChecked();

    // Neither a teacher, a parent nor a student can open Administration › Who needs approval.
    await teacherPage.goto("/admin/approvals");
    await expect(teacherPage).toHaveURL(/\/teach$/);
    await student.goto("/admin/approvals");
    await expect(student).toHaveURL(/\/grown-ups\?returnTo=%2Fadmin%2Fapprovals$/);
    const parentContext = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": `setting-parent-${suffix}` } });
    try {
      expect((await parentContext.request.post("/api/auth/sign-up", { data: { email: `setting-parent-${suffix}@example.com`, displayName: "Setting parent", password } })).status()).toBe(201);
      fixture("UPDATE adults SET approval_status = 'approved' WHERE email = ?", `setting-parent-${suffix}@example.com`);
      expect((await parentContext.request.post("/api/auth/sign-in", { data: { email: `setting-parent-${suffix}@example.com`, password } })).status()).toBe(200);
      const parentPage = await parentContext.newPage();
      await parentPage.goto("/admin/approvals");
      await expect(parentPage).toHaveURL(/\/family$/);
    } finally { await parentContext.close(); }

    // Only an administrator changes it: a teacher is refused, and so is an administrator still on a temporary password.
    const denied = await api(teacherPage, "PUT", "/api/admin/approval-settings", { teacherTopicsNeedApproval: false });
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({ error: "Administrator access required.", errorBn: "প্রশাসকের অ্যাকাউন্ট প্রয়োজন।" });
    await tempPage.goto("/teach");
    fixture("UPDATE adults SET must_change_password = 1 WHERE email = ?", tempAdmin.email);
    const temporary = await api(tempPage, "PUT", "/api/admin/approval-settings", { teacherTopicsNeedApproval: false });
    expect(temporary.status).toBe(403);
    expect(temporary.body).toMatchObject({ mustChangePassword: true });

    // A teacher's topic saved while approval is on waits.
    const waiting = await api(teacherPage, "POST", "/api/topics", topic(`Waiting rickshaw art ${suffix}`));
    expect(waiting.status).toBe(201);
    expect(waiting.body).toMatchObject({ status: "pending", publishedDirectly: null });

    // Turning it off says that what is waiting stays waiting.
    await adminPage.reload();
    await toggle.click();
    await expect(adminPage.getByRole("status").filter({ hasText: "Approval for teachers' topics is off." })).toContainText("still waiting for approval: turning approval off does not publish");
    await expect(toggle).not.toBeChecked();
    await expect(setting).toContainText("Off: a topic a teacher writes or edits is published to students as soon as they save it.");
    await expect(setting.getByRole("note")).toContainText("still waiting for approval");
    await expect(setting).toContainText(`Last changed by setting-admin ${suffix}`);

    // The teacher's Topics page now says their topics publish at once, and a new one does.
    await teacherPage.goto("/teach/topics");
    await expect(teacherPage.getByText("An administrator has switched off approval for teachers' topics, so your new topics and edits are published to students as soon as you save them.", { exact: false })).toBeVisible();
    await teacherPage.getByRole("button", { name: /New topic/ }).click();
    await expect(teacherPage.getByText("An administrator has switched off approval for teachers' topics, so students see your topic as soon as you save it.", { exact: false })).toBeVisible();
    const title = `Published kantha ${suffix}`;
    await teacherPage.getByRole("combobox", { name: "Category", exact: true }).selectOption("culture");
    await teacherPage.getByLabel("Title (English)", { exact: true }).fill(title);
    await teacherPage.getByLabel("Title (Bangla)", { exact: true }).fill(`নকশিকাঁথা ${suffix}`);
    await teacherPage.getByLabel("Short introduction (English)", { exact: true }).fill("Quilts with stories.");
    await teacherPage.getByLabel("Short introduction (Bangla)", { exact: true }).fill("গল্পের কাঁথা।");
    await teacherPage.getByLabel("Section 1 heading (English)", { exact: true }).fill("Stitches");
    await teacherPage.getByLabel("Section 1 heading (Bangla)", { exact: true }).fill("ফোঁড়");
    await teacherPage.getByLabel("Section 1 text (English)", { exact: true }).fill("Kantha quilts are stitched by hand.");
    await teacherPage.getByLabel("Section 1 text (Bangla)", { exact: true }).fill("নকশিকাঁথা হাতে সেলাই করা হয়।");
    await teacherPage.getByRole("button", { name: "Save and publish to students", exact: true }).click();
    await expect(teacherPage.getByRole("status").filter({ hasText: "Published as version 1. Students see it now: teachers' topics do not need an administrator's approval at the moment." })).toBeVisible();
    await expect(teacherPage.getByRole("region", { name: "Version history" })).toContainText("Published at once (teachers' topics did not need approval)");

    expect((await studentContext.request.post("/api/student/sign-up", { data: { username: `setting-${suffix}`, displayName: "Setting learner", password } })).status()).toBe(201);
    fixture("UPDATE students SET approval_status = 'approved' WHERE username = ?", `setting-${suffix}`);
    expect((await studentContext.request.post("/api/student/sign-in", { data: { username: `setting-${suffix}`, password } })).status()).toBe(200);
    await student.goto("/topics");
    await expect(student.getByRole("button", { name: new RegExp(title) })).toBeVisible();
    await expect(student.getByRole("button", { name: new RegExp(`Waiting rickshaw art ${suffix}`) })).toHaveCount(0);
    const staffTopics = (await api(adminPage, "GET", "/api/topics")).body;
    expect(staffTopics.topics.find((item: { id: string }) => item.id === waiting.body.topicId).pendingVersions).toEqual([1]);

    // The change is in Recent changes, and turning approval on makes teachers' topics wait again.
    await adminPage.goto("/admin");
    await adminPage.getByText("Recent changes", { exact: true }).click();
    await expect(adminPage.locator(".audit-list li").filter({ hasText: "Approval setting changed" }).first()).toContainText(SWITCH);
    await adminPage.goto("/teach/topics");
    await toggle.click();
    await expect(adminPage.getByRole("status").filter({ hasText: "Approval for teachers' topics is on. Teachers' new topics and edits wait for an administrator again." })).toBeVisible();
    await expect(toggle).toBeChecked();
    const after = await api(teacherPage, "POST", "/api/topics", topic(`Waiting again ${suffix}`));
    expect(after.body).toMatchObject({ status: "pending" });
  } finally {
    // Every other browser spec expects teachers' topics to wait.
    // (The checks above end with it on; this puts it back if the scenario stopped part way.)
    await adminPage.goto("/teach/topics").catch(() => undefined);
    await api(adminPage, "PUT", "/api/admin/approval-settings", ALL_ON).catch(() => undefined);
    for (const context of [admin.context, teacher.context, tempAdmin.context, studentContext]) await context.close().catch(() => undefined);
  }
});

test("an administrator turns approval for teachers' class activities and sources off and on; waiting work keeps waiting and the class workspace says what a save does", async ({ browser, baseURL }) => {
  test.setTimeout(150000);
  const suffix = randomUUID().slice(0, 8);
  const admin = await staff(browser, baseURL, "class-setting-admin", suffix, "admin");
  const teacher = await staff(browser, baseURL, "class-setting-teacher", suffix, "teacher");
  const studentContext = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": `class-setting-student-${suffix}` } });
  const adminPage = await admin.context.newPage();
  try {
    const teacherPage = await teacher.context.newPage(), student = await studentContext.newPage();
    for (const page of [adminPage, teacherPage, student]) page.setDefaultTimeout(15000);
    const username = `class-setting-${suffix}`, className = `Approval switch class ${suffix}`;
    expect((await studentContext.request.post("/api/student/sign-up", { data: { username, displayName: "Switch learner", password } })).status()).toBe(201);
    fixture("UPDATE students SET approval_status = 'approved' WHERE username = ?", username);
    expect((await studentContext.request.post("/api/student/sign-in", { data: { username, password } })).status()).toBe(200);
    await student.goto("/student");
    const feed = async () => (await api(student, "GET", "/api/student/feed")).body.classes.find((item: { name: string }) => item.name === className);

    // The teacher's class, with the student in it. Saved while approval is on, an activity and a source wait.
    await teacherPage.goto("/teach");
    const created = await api(teacherPage, "POST", "/api/classes", { name: className });
    expect(created.status).toBe(201);
    const classId = created.body.class.id;
    expect((await api(teacherPage, "POST", `/api/classes/${classId}/students`, { username })).status).toBe(200);
    const question = [{ prompt: "Which river?", options: ["Padma", "Thames"], answer: 0 }];
    const waitingActivity = await api(teacherPage, "POST", `/api/classes/${classId}/activities`, { title: `Waiting quiz ${suffix}`, questions: question });
    expect(waitingActivity.status).toBe(201);
    expect(waitingActivity.body).toMatchObject({ publishedDirectly: null, activity: { approvalStatus: "pending" } });
    const waitingSource = await api(teacherPage, "POST", `/api/classes/${classId}/sources`, { titleEn: `Waiting link ${suffix}`, url: "https://example.org/waiting" });
    expect(waitingSource.status).toBe(201);
    expect(waitingSource.body.source).toMatchObject({ approvalStatus: "pending", publishedDirectly: null });
    expect((await api(teacherPage, "GET", `/api/classes/${classId}`)).body.publishing).toEqual({ activities: { onSave: "review", teachersNeedApproval: true } });

    // Only an administrator changes the switches.
    const denied = await api(teacherPage, "PUT", "/api/admin/approval-settings", { teacherActivitiesNeedApproval: false, teacherSourcesNeedApproval: false });
    expect(denied.status).toBe(403);

    // The administrator finds the switches under Administration › Who needs approval; all three are on.
    await adminPage.goto("/admin");
    await adminPage.getByRole("navigation", { name: "Portal navigation" }).getByRole("link", { name: "Who needs approval", exact: true }).click();
    await expect(adminPage).toHaveURL(/\/admin\/approvals$/);
    await expect(adminPage.getByRole("heading", { level: 1, name: "Who needs approval" })).toBeVisible();
    const panel = adminPage.getByRole("region", { name: "Who needs approval" });
    const topics = panel.getByRole("switch", { name: new RegExp(SWITCH) });
    const activities = panel.getByRole("switch", { name: new RegExp(ACTIVITY_SWITCH) });
    const sources = panel.getByRole("switch", { name: new RegExp(SOURCE_SWITCH) });
    for (const toggle of [topics, activities, sources]) await expect(toggle).toBeChecked();
    const item = (field: string) => panel.locator(`[data-setting="${field}"]`);
    await expect(item("teacherActivitiesNeedApproval")).toContainText("On: an activity or quiz a teacher adds to their class waits in Activities & quizzes until an administrator approves it.");
    // Each switch is named by its label alone (the On/Off badge is not read out) and described by what on means;
    // the page's heading is not repeated inside the panel.
    await expect(activities).toHaveAccessibleName(ACTIVITY_SWITCH);
    await expect(activities).toHaveAccessibleDescription("On: an activity or quiz a teacher adds to their class waits in Activities & quizzes until an administrator approves it.");
    await expect(panel.getByRole("group")).toHaveCount(0);
    await expect(adminPage.getByRole("heading", { name: "Who needs approval" })).toHaveCount(1);

    // Turning each off says that what is waiting stays waiting; the topics switch is left alone. While the change is
    // saved the switch keeps keyboard focus and stays enabled, and another press is ignored rather than sent.
    let release = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    let puts = 0;
    const hold = async (route: import("@playwright/test").Route) => {
      if (route.request().method() === "PUT") { puts += 1; await held; }
      await route.continue();
    };
    await adminPage.route("**/api/admin/approval-settings", hold);
    await activities.focus();
    await adminPage.keyboard.press("Space");
    await expect(panel).toHaveAttribute("aria-busy", "true");
    await expect(activities).toBeEnabled();
    await expect(activities).toBeFocused();
    await adminPage.keyboard.press("Space");
    release();
    await expect(panel.getByRole("status")).toContainText("Approval for teachers' class activities is off.");
    await expect(panel).toHaveAttribute("aria-busy", "false");
    await expect(activities).toBeFocused();
    await adminPage.unroute("**/api/admin/approval-settings", hold);
    expect(puts).toBe(1);
    await expect(panel.getByRole("status")).toContainText("still waiting for approval: turning approval off does not publish");
    await expect(activities).not.toBeChecked();
    const activityGroup = item("teacherActivitiesNeedApproval");
    await expect(activities).toHaveAccessibleName(ACTIVITY_SWITCH);
    await expect(activities).toHaveAccessibleDescription(/^Off: an activity or quiz .* class activit(y is|ies are) still waiting for approval/);
    await expect(activityGroup).toContainText("Off: an activity or quiz a teacher adds to their own class is published to the class as soon as they save it");
    await expect(activityGroup.getByRole("note")).toContainText(/class activit(y is|ies are) still waiting for approval/);
    await expect(activityGroup).toContainText(`Last changed by class-setting-admin ${suffix}`);
    await sources.click();
    await expect(panel.getByRole("status")).toContainText("Approval for teachers' class sources is off.");
    await expect(sources).not.toBeChecked();
    await expect(item("teacherSourcesNeedApproval").getByRole("note")).toContainText(/class sources? (is|are) still waiting for approval/);
    await expect(item("teacherSourcesNeedApproval")).toContainText("A teacher's edit of a source you sent back or withdrew still waits for an administrator.");
    await expect(topics).toBeChecked();
    // The same panel is on the Topics page, showing the same settings.
    await adminPage.goto("/teach/topics");
    await expect(adminPage.getByRole("region", { name: "Who needs approval" }).getByRole("switch", { name: new RegExp(ACTIVITY_SWITCH) })).not.toBeChecked();

    // The teacher's class workspace now says a new activity is published at once, and it is.
    await teacherPage.goto("/teach");
    await teacherPage.getByLabel("Find a class").fill(suffix);
    await teacherPage.getByRole("button", { name: new RegExp(className) }).click();
    const nav = teacherPage.getByRole("navigation", { name: "Portal navigation" });
    await nav.getByRole("button", { name: "Activities & quizzes", exact: true }).click();
    await expect(teacherPage.getByText("An administrator has switched off approval for teachers' class activities, so your new activities are published to the class as soon as you save them.", { exact: false })).toBeVisible();
    await expect(teacherPage.getByRole("region", { name: "New activity" })).toContainText("Teachers' class activities do not need an administrator's approval at the moment");
    await teacherPage.getByLabel("Activity title", { exact: true }).fill(`Published quiz ${suffix}`);
    await teacherPage.getByLabel("Question 1", { exact: true }).fill("Which month starts the Bengali year?");
    await teacherPage.getByLabel("Question 1 option 1", { exact: true }).fill("Boishakh");
    await teacherPage.getByLabel("Question 1 option 2", { exact: true }).fill("Poush");
    await teacherPage.getByRole("button", { name: "Publish to the class", exact: true }).click();
    await expect(teacherPage.getByRole("status").filter({ hasText: "Activity published to the class." })).toContainText("teachers' class activities do not need an administrator's approval at the moment");
    const published = teacherPage.getByRole("region", { name: "Activities and submissions" }).getByRole("article").filter({ hasText: `Published quiz ${suffix}` });
    await expect(published).toContainText("Approved · published");
    await expect(teacherPage.getByRole("region", { name: "Activities and submissions" }).getByRole("article").filter({ hasText: `Waiting quiz ${suffix}` })).toContainText("Awaiting Admin approval");

    // Class sources: a new source is shown at once, and so is an edit of the one that was waiting.
    await nav.getByRole("button", { name: "Class sources", exact: true }).click();
    const sourcePanel = teacherPage.getByRole("region", { name: "Class sources" });
    await expect(sourcePanel).toContainText("An administrator has switched off approval for teachers' class sources");
    const form = sourcePanel.getByRole("form", { name: "Add a source" });
    await form.getByLabel("Title (English)", { exact: true }).fill(`Published link ${suffix}`);
    await form.getByLabel("Link", { exact: true }).fill("https://example.org/published");
    await form.getByRole("button", { name: "Save and show to the class", exact: true }).click();
    await expect(sourcePanel.getByRole("status")).toContainText("Source published. Students in this class and their parents can see it now");
    await sourcePanel.getByRole("button", { name: `Edit Waiting link ${suffix}`, exact: true }).click();
    await sourcePanel.getByRole("form", { name: "Edit source" }).getByLabel("Title (English)", { exact: true }).fill(`Edited link ${suffix}`);
    await sourcePanel.getByRole("form", { name: "Edit source" }).getByRole("button", { name: "Save and show to the class", exact: true }).click();
    await expect(sourcePanel.getByRole("status")).toContainText("Source updated. Students in this class and their parents see the change now");

    // The student sees the published activity and both sources, but not the activity that was waiting.
    const shown = await feed();
    expect(shown.activities.map((item: { title: string }) => item.title)).toEqual([`Published quiz ${suffix}`]);
    expect(shown.sources.map((item: { titleEn: string }) => item.titleEn).sort()).toEqual([`Edited link ${suffix}`, `Published link ${suffix}`]);

    // An administrator sends the edited source back. The teacher's page says an edit of it waits, even with the
    // switch off, and saving it again unchanged does not show it to the class.
    const listedSources = (await api(adminPage, "GET", `/api/classes/${classId}/sources`)).body.sources as Array<{ id: string; titleEn: string; revision: number }>;
    const editedSource = listedSources.find((item) => item.titleEn === `Edited link ${suffix}`)!;
    const sentBack = await api(adminPage, "PATCH", `/api/classes/${classId}/sources`, { sourceId: editedSource.id, approvalStatus: "rejected", revision: editedSource.revision, reviewNote: "Use the Bangla page." });
    expect(sentBack.status).toBe(200);
    await nav.getByRole("button", { name: "Activities & quizzes", exact: true }).click();
    await nav.getByRole("button", { name: "Class sources", exact: true }).click();
    await expect(sourcePanel).toContainText("An edit of a source an administrator sent back still waits for an administrator's approval.");
    await sourcePanel.getByRole("button", { name: `Edit Edited link ${suffix}`, exact: true }).click();
    const editForm = sourcePanel.getByRole("form", { name: "Edit source" });
    await expect(editForm).toContainText("An administrator sent this source back, so your edit waits for an administrator's approval");
    await editForm.getByRole("button", { name: "Submit source for Admin approval", exact: true }).click();
    await expect(sourcePanel.getByRole("status")).toContainText("Source updated and submitted for Admin approval.");
    await expect(sourcePanel.getByRole("listitem").filter({ hasText: `Edited link ${suffix}` })).toContainText("Review note: Use the Bangla page.");
    expect((await feed()).sources.map((item: { titleEn: string }) => item.titleEn)).toEqual([`Published link ${suffix}`]);

    // Recent changes names the automatic approvals under the teacher.
    await adminPage.goto("/admin");
    await adminPage.getByText("Recent changes", { exact: true }).click();
    await expect(adminPage.locator(".audit-list li").filter({ hasText: "Class source published at once (approval was off)" }).first()).toContainText(`By: class-setting-teacher ${suffix}`);
    await expect(adminPage.locator(".audit-list li").filter({ hasText: "Class activity published at once (approval was off)" }).first()).toContainText(`By: class-setting-teacher ${suffix}`);

    // Turning the switches on again affects only later saves.
    await adminPage.goto("/admin/approvals");
    await activities.click();
    await expect(panel.getByRole("status")).toHaveText("Approval for teachers' class activities is on. Teachers' new activities wait for an administrator again.");
    await sources.click();
    await expect(panel.getByRole("status")).toHaveText("Approval for teachers' class sources is on. Teachers' new and edited sources wait for an administrator again.");
    await expect(sources).toBeChecked();
    const later = await api(teacherPage, "POST", `/api/classes/${classId}/activities`, { title: `Later quiz ${suffix}`, questions: question });
    expect(later.body).toMatchObject({ publishedDirectly: null, activity: { approvalStatus: "pending" } });
    const laterSource = await api(teacherPage, "POST", `/api/classes/${classId}/sources`, { titleEn: `Later link ${suffix}`, url: "https://example.org/later" });
    expect(laterSource.body.source).toMatchObject({ approvalStatus: "pending", publishedDirectly: null });
    const after = await feed();
    expect(after.activities.map((item: { title: string }) => item.title)).toEqual([`Published quiz ${suffix}`]);
    expect(after.sources).toHaveLength(1);
    await teacherPage.reload();
    await teacherPage.getByLabel("Find a class").fill(suffix);
    await teacherPage.getByRole("button", { name: new RegExp(className) }).click();
    await nav.getByRole("button", { name: "Activities & quizzes", exact: true }).click();
    await expect(teacherPage.getByRole("button", { name: "Submit for Admin approval", exact: true })).toBeVisible();
  } finally {
    // Every other browser spec expects teachers' work to wait.
    await adminPage.goto("/admin/approvals").catch(() => undefined);
    await api(adminPage, "PUT", "/api/admin/approval-settings", ALL_ON).catch(() => undefined);
    for (const context of [admin.context, teacher.context, studentContext]) await context.close().catch(() => undefined);
  }
});
