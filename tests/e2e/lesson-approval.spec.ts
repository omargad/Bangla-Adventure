import { test, expect, type Browser, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

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
async function signedInTeacher(browser: Browser, baseURL: string | undefined, suffix: string) {
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": `lesson-teacher-${suffix}` } });
  const email = `lesson-teacher-${suffix}@example.com`;
  expect((await context.request.post("/api/auth/sign-up", { data: { email, displayName: `Teacher ${suffix}`, password } })).status()).toBe(201);
  // Self sign-ups wait for an administrator: approve directly, then sign in.
  fixture("UPDATE adults SET role = 'teacher', teacher_status = 'approved', approval_status = 'approved' WHERE email = ?", email);
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

/** The student's lesson list with every level shown. */
async function openAllLessons(student: Page) {
  await student.goto("/adventure");
  await student.getByRole("button", { name: /^All levels/ }).click();
  await expect(student.getByRole("region", { name: "General conversation" })).toBeVisible();
}

test("a teacher previews a lesson in Bangla, withdraws it from students and approves it again after a full review", async ({ browser, baseURL }) => {
  test.setTimeout(120000);
  const suffix = randomUUID().slice(0, 8);
  const teacherContext = await signedInTeacher(browser, baseURL, suffix);
  const studentContext = await signedInStudent(browser, baseURL, suffix);
  try {
    const teacher = await teacherContext.newPage(), student = await studentContext.newPage();
    for (const page of [teacher, student]) page.setDefaultTimeout(15000);

    // Students see the lesson under its category.
    await openAllLessons(student);
    await expect(student.getByRole("region", { name: "Places and nature" }).getByRole("heading", { name: lessonTitle, exact: true })).toBeVisible();

    await teacher.goto("/teach");
    await teacher.getByRole("navigation", { name: "Portal navigation" }).getByRole("link", { name: "Lessons", exact: true }).click();
    await expect(teacher).toHaveURL(/\/studio$/);
    const category = teacher.getByRole("region", { name: "Places and nature" });
    await expect(category).toContainText("Approved · baseline");
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

    // Withdrawing needs a reason and hides the lesson from the student at once.
    const decision = teacher.getByRole("region", { name: "Your decision" });
    // A lesson approved only as a baseline can also take a real review without being hidden first.
    await expect(decision.getByRole("button", { name: "Confirm my review", exact: true })).toBeDisabled();
    const withdraw = decision.getByRole("button", { name: "Withdraw from students", exact: true });
    await expect(withdraw).toBeDisabled();
    await decision.getByLabel("Why are you withdrawing it? (needed)").fill("The Bangla season names need a native speaker's check.");
    await withdraw.click();
    await expect(teacher.getByRole("status").filter({ hasText: "Withdrawn. Students and parents no longer see this lesson." })).toBeVisible();
    await expect(teacher.getByRole("region", { name: "Lesson details" })).toContainText("Withdrawn · hidden from students");

    await openAllLessons(student);
    await expect(student.getByRole("heading", { name: lessonTitle, exact: true })).toHaveCount(0);
    await student.goto("/adventure?module=six-seasons");
    await expect(student.getByText("That lesson is not available at the moment. Choose another lesson below.")).toBeVisible();

    // Approving again needs every part of the lesson opened and the full-review tick.
    const confirm = decision.getByRole("checkbox", { name: "I have reviewed the whole lesson in English and Bangla" });
    const approve = decision.getByRole("button", { name: "Approve for students", exact: true });
    await expect(confirm).toBeDisabled();
    await expect(approve).toBeDisabled();
    const parts = preview.getByRole("navigation", { name: "পাঠের অংশ" });
    for (const part of ["শুরু", "শুনি", "পড়ি", "বলি", "লিখি", "দেখি", "যাচাই"]) await parts.getByRole("button", { name: new RegExp(`${part}$`) }).click();
    await expect(decision.getByText("Parts of the lesson opened: 7 of 7")).toBeVisible();
    await confirm.check();
    await approve.click();
    await expect(teacher.getByRole("status").filter({ hasText: "Approved. Students can open this lesson again." })).toBeVisible();
    await expect(teacher.getByRole("region", { name: "Approval history" })).toContainText(`Teacher ${suffix}`);

    await openAllLessons(student);
    await expect(student.getByRole("region", { name: "Places and nature" }).getByRole("heading", { name: lessonTitle, exact: true })).toBeVisible();
  } finally {
    await teacherContext.close().catch(() => undefined);
    await studentContext.close().catch(() => undefined);
  }
});
