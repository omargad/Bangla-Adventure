import { test, expect, type Browser, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

/**
 * The administrator's switch "Teachers' topics need an administrator's approval". It is one setting for
 * the whole installation, so this spec runs in its own Playwright project before the other browser specs
 * (see playwright.config.ts) and always leaves the switch on, as every other spec expects.
 */
const password = "Approval-setting-password-2026";
const SWITCH = "Teachers' topics need an administrator's approval";

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
    await api(adminPage, "PUT", "/api/admin/approval-settings", { teacherTopicsNeedApproval: true }).catch(() => undefined);
    for (const context of [admin.context, teacher.context, tempAdmin.context, studentContext]) await context.close().catch(() => undefined);
  }
});
