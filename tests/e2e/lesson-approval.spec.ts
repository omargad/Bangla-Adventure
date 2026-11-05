import { test, expect, type Browser, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const password = "Lesson-approval-password-2026";
const lessonTitle = "Bangladesh through six seasons";

/** Runs a statement against the isolated test database. */
function fixture(sql: string, ...values: string[]) {
  if (!process.env.BANGLA_E2E_DB?.includes("bangla-e2e-")) throw new Error("Isolated test database required.");
  const db = new Database(process.env.BANGLA_E2E_DB);
  try {
    db.prepare(sql).run(...values);
  } finally { db.close(); }
}
async function signedInStaff(browser: Browser, baseURL: string | undefined, suffix: string, role: "teacher" | "admin" = "teacher") {
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": `lesson-${role}-${suffix}` } });
  const email = `lesson-${role}-${suffix}@example.com`;
  expect((await context.request.post("/api/auth/sign-up", { data: { email, displayName: `${role} ${suffix}`, password } })).status()).toBe(201);
  // Self sign-ups wait for an administrator: approve directly, then sign in.
  fixture("UPDATE adults SET role = ?, teacher_status = ?, approval_status = 'approved' WHERE email = ?", role, role === "teacher" ? "approved" : "none", email);
  expect((await context.request.post("/api/auth/sign-in", { data: { email, password } })).status()).toBe(200);
  return context;
}

async function signedInStudent(browser: Browser, baseURL: string | undefined, suffix: string) {
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": `lesson-student-${suffix}` } });
  const username = `lessons-${suffix}`;
  expect((await context.request.post("/api/student/sign-up", { data: { username, displayName: "Lesson learner", password } })).status()).toBe(201);
  fixture("UPDATE students SET approval_status = 'approved' WHERE username = ?", username);
  expect((await context.request.post("/api/student/sign-in", { data: { username, password } })).status()).toBe(200);
  return context;
}

/** Use the browser's session: its Secure cookie works on loopback, unlike APIRequestContext at 127.0.0.1. */
async function api(page: Page, method: string, url: string, data?: unknown) {
  return page.evaluate(async ({ method, url, data }) => {
    const response = await fetch(url, { method, headers: data ? { "Content-Type": "application/json" } : {}, body: data ? JSON.stringify(data) : undefined });
    return { status: response.status, body: await response.json() };
  }, { method, url, data });
}

async function learnerRecording(page: Page, url: string) {
  return page.evaluate(async (url) => {
    const response = await fetch(url);
    return { status: response.status, bytes: [...new Uint8Array(await response.arrayBuffer())] };
  }, url);
}

/** The student's lesson list with every level shown. */
async function openAllLessons(student: Page) {
  await student.goto("/adventure");
  await student.getByRole("button", { name: /^All levels/ }).click();
  await expect(student.getByRole("region", { name: "General conversation" })).toBeVisible();
}

test("a teacher can preview a lesson, but only an administrator can withdraw and approve it", async ({ browser, baseURL }) => {
  test.setTimeout(120000);
  const suffix = randomUUID().slice(0, 8);
  const teacherContext = await signedInStaff(browser, baseURL, suffix);
  const adminContext = await signedInStaff(browser, baseURL, suffix, "admin");
  const studentContext = await signedInStudent(browser, baseURL, suffix);
  try {
    const teacher = await teacherContext.newPage(), admin = await adminContext.newPage(), student = await studentContext.newPage();
    for (const page of [teacher, admin, student]) page.setDefaultTimeout(15000);

    // Students see the lesson under its category.
    await openAllLessons(student);
    await expect(student.getByRole("region", { name: "Places and nature" }).getByRole("heading", { name: lessonTitle, exact: true })).toBeVisible();

    await teacher.goto("/teach");
    await teacher.getByRole("navigation", { name: "Portal navigation" }).getByRole("link", { name: "Lessons", exact: true }).click();
    await expect(teacher).toHaveURL(/\/studio$/);
    const category = teacher.getByRole("region", { name: "Places and nature" });
    await expect(category).toContainText("Approved");
    await category.getByRole("button", { name: `Preview lesson: ${lessonTitle}`, exact: true }).click();
    await expect(teacher).toHaveURL(/\/studio\?lesson=six-seasons$/);
    await expect(teacher.getByRole("heading", { level: 2, name: lessonTitle, exact: true }).first()).toBeVisible();
    await expect(teacher.getByText("ছয় ঋতুর বাংলাদেশ").first()).toBeVisible();

    // The preview switches to Bangla and shows the Bangla dialogue students hear.
    const preview = teacher.getByRole("region", { name: "Student view preview" });
    await preview.getByRole("group", { name: "Preview language" }).getByRole("button", { name: "বাংলা", exact: true }).click();
    await preview.getByRole("navigation", { name: "পাঠের অংশ" }).getByRole("button", { name: /শুনি/ }).click();
    await expect(preview.getByText("তোমার প্রিয় ঋতু কোনটি?", { exact: true })).toBeVisible();
    await expect(preview.getByText("✓ সঠিক উত্তর").first()).toBeVisible();
    await expect(teacher.getByRole("region", { name: "Approval history" })).toBeVisible();
    await expect(teacher.getByRole("region", { name: "Your decision" })).toHaveCount(0);
    await expect(teacher.getByRole("button", { name: "Save video check", exact: true })).toHaveCount(0);
    expect((await api(teacher, "GET", "/api/auth/session")).body).toMatchObject({ authenticated: true, role: "teacher" });
    const deniedApproval = await api(teacher, "POST", "/api/studio/lessons/six-seasons", { decision: "approve", confirmedRead: true });
    expect(deniedApproval.status).toBe(403);
    expect(deniedApproval.body.error).toBe("Administrator access required.");

    await admin.goto("/admin");
    await admin.getByRole("navigation", { name: "Portal navigation" }).getByRole("link", { name: "Lessons", exact: true }).click();
    await admin.getByRole("button", { name: `Preview lesson: ${lessonTitle}`, exact: true }).click();
    const adminPreview = admin.getByRole("region", { name: "Student view preview" });
    await adminPreview.getByRole("group", { name: "Preview language" }).getByRole("button", { name: "বাংলা", exact: true }).click();

    // Withdrawing needs a reason and hides the lesson from the student at once.
    const decision = admin.getByRole("region", { name: "Your decision" });
    // The setup Admin reviewed this exact content fixture before publication.
    await expect(admin.getByRole("region", { name: "Lesson details" })).toContainText("Approved by FixtureSetup admin");
    await expect(decision.getByRole("button", { name: "Confirm my review", exact: true })).toHaveCount(0);
    const withdraw = decision.getByRole("button", { name: "Withdraw from students", exact: true });
    await expect(withdraw).toBeDisabled();
    await decision.getByLabel("Why are you withdrawing it? (needed)").fill("The Bangla season names need a native speaker's check.");
    await withdraw.click();
    await expect(admin.getByRole("status").filter({ hasText: "Withdrawn. Students and parents no longer see this lesson." })).toBeVisible();
    await expect(admin.getByRole("region", { name: "Lesson details" })).toContainText("Withdrawn · hidden from students");

    await openAllLessons(student);
    await expect(student.getByRole("heading", { name: lessonTitle, exact: true })).toHaveCount(0);
    await student.goto("/adventure?module=six-seasons");
    await expect(student.getByText("That lesson is not available at the moment. Choose another lesson below.")).toBeVisible();

    // Approving again needs every part of the lesson opened and the full-review tick.
    const confirm = decision.getByRole("checkbox", { name: "I have reviewed the whole lesson in English and Bangla" });
    const approve = decision.getByRole("button", { name: "Approve for students", exact: true });
    await expect(confirm).toBeDisabled();
    await expect(approve).toBeDisabled();
    const parts = adminPreview.getByRole("navigation", { name: "পাঠের অংশ" });
    for (const part of ["শুরু", "শুনি", "পড়ি", "বলি", "লিখি", "দেখি", "যাচাই"]) await parts.getByRole("button", { name: new RegExp(`${part}$`) }).click();
    await expect(decision.getByText("Parts of the lesson opened: 7 of 7")).toBeVisible();
    await confirm.check();
    await approve.click();
    await expect(admin.getByRole("status").filter({ hasText: "Approved. Students can open this lesson again." })).toBeVisible();
    await expect(admin.getByRole("region", { name: "Approval history" })).toContainText(`admin ${suffix}`);

    await openAllLessons(student);
    await expect(student.getByRole("region", { name: "Places and nature" }).getByRole("heading", { name: lessonTitle, exact: true })).toBeVisible();
  } finally {
    await teacherContext.close().catch(() => undefined);
    await adminContext.close().catch(() => undefined);
    await studentContext.close().catch(() => undefined);
  }
});

test("beside the sidebar, the English lesson preview keeps all seven tabs inside its frame", async ({ browser, baseURL }) => {
  const teacherContext = await signedInStaff(browser, baseURL, randomUUID().slice(0, 8));
  try {
    const teacher = await teacherContext.newPage();
    await teacher.goto("/studio?lesson=hello-me");
    const frame = teacher.getByRole("region", { name: "Student view preview" }).locator(".lesson-preview-frame");
    const tabs = frame.getByRole("navigation", { name: "Lesson sections" }).getByRole("button");
    await expect(tabs).toHaveCount(7);
    // Between the phone layout (780px) and about 830px the frame is narrowest; the long English names fit there too.
    for (const width of [781, 800, 820, 900, 1280]) {
      await teacher.setViewportSize({ width, height: 900 });
      const [frameBox, lastBox] = [(await frame.boundingBox())!, (await tabs.last().boundingBox())!];
      expect(lastBox.x + lastBox.width, `${width}px`).toBeLessThanOrEqual(frameBox.x + frameBox.width);
      await expect(tabs.last()).toHaveText(/Mastery$/);
      await expect(tabs.last()).toHaveCSS("font-size", "12px");
    }
  } finally {
    await teacherContext.close().catch(() => undefined);
  }
});

test("a teacher's recording stays pending until a separate administrator listens and approves it", async ({ browser, baseURL }) => {
  test.setTimeout(90000);
  const suffix = randomUUID().slice(0, 8);
  const teacherContext = await signedInStaff(browser, baseURL, suffix);
  const adminContext = await signedInStaff(browser, baseURL, suffix, "admin");
  const studentContext = await signedInStudent(browser, baseURL, suffix);
  const speaker = `Recording speaker ${suffix}`;
  const bytes = readFileSync(new URL("../../public/audio/lesson-my-day-dialogue.ogg", import.meta.url));
  try {
    const teacher = await teacherContext.newPage(), admin = await adminContext.newPage(), student = await studentContext.newPage();
    for (const page of [teacher, admin, student]) page.setDefaultTimeout(15000);
    await student.goto("/student");
    expect((await api(student, "GET", "/api/auth/session")).body).toMatchObject({ authenticated: true, role: "student" });
    await teacher.goto("/studio?lesson=my-day");
    const recordings = teacher.getByRole("region", { name: "Human audio recordings", exact: true });
    await recordings.getByText("Upload a recording", { exact: true }).click();
    await recordings.getByLabel("Speaker name (for the credit)").fill(speaker);
    await recordings.getByLabel(/Audio file \(MP3/).setInputFiles({ name: `${suffix}.ogg`, mimeType: "audio/ogg", buffer: bytes });
    await recordings.getByRole("checkbox", { name: /The speaker \(and a guardian/ }).check();
    const uploaded = teacher.waitForResponse((response) => response.url().endsWith("/api/studio/media") && response.request().method() === "POST");
    await recordings.getByRole("button", { name: "Upload for review", exact: true }).click();
    const upload = await uploaded;
    expect(upload.status()).toBe(201);
    const { asset } = await upload.json();
    await expect(recordings.getByRole("status")).toContainText("Uploaded for administrator review.");
    const teacherRow = recordings.getByRole("listitem").filter({ hasText: speaker });
    await expect(teacherRow).toContainText("Waiting for review");
    await expect(teacherRow.getByRole("button", { name: "Approve recording", exact: true })).toHaveCount(0);
    await expect(teacher.getByRole("button", { name: "Save video check", exact: true })).toHaveCount(0);
    expect((await api(teacher, "GET", "/api/auth/session")).body).toMatchObject({ authenticated: true, role: "teacher" });
    const deniedApproval = await api(teacher, "PATCH", "/api/studio/media", { id: asset.id, reviewStatus: "approved", confirmedListened: true });
    expect(deniedApproval.status).toBe(403);
    expect(deniedApproval.body.error).toBe("Administrator access required.");
    const learnerAudio = `/api/audio/my-day/dialogue?v=${encodeURIComponent(asset.id)}`;
    expect((await learnerRecording(student, learnerAudio)).status).toBe(404);

    await admin.goto("/studio?lesson=my-day");
    const adminRow = admin.getByRole("region", { name: "Human audio recordings", exact: true }).getByRole("listitem").filter({ hasText: speaker });
    const approve = adminRow.getByRole("button", { name: "Approve recording", exact: true });
    await expect(approve).toBeDisabled();
    await adminRow.locator("audio").evaluate((element: HTMLAudioElement) => element.play());
    await adminRow.getByRole("checkbox", { name: "I listened to the whole recording", exact: true }).check();
    await approve.click();
    await expect(adminRow).toContainText("Approved · in use");
    const published = await learnerRecording(student, learnerAudio);
    expect(published.status).toBe(200);
    expect(Buffer.from(published.bytes)).toEqual(bytes);
    await adminRow.getByRole("button", { name: "Stop using it", exact: true }).click();
    await expect(adminRow).toContainText("Retired");
    expect((await learnerRecording(student, learnerAudio)).status).toBe(404);
  } finally {
    await teacherContext.close().catch(() => undefined);
    await adminContext.close().catch(() => undefined);
    await studentContext.close().catch(() => undefined);
  }
});
