import { test, expect, type BrowserContext, type Page, type TestInfo } from "@playwright/test";

test.skip(!process.env.BANGLA_DEMO_E2E_DB, "Run with playwright.demo.config.ts to use a fresh isolated demo.");
const capture = async (page: Page, info: TestInfo, name: string) => {
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
};

test("capture and verify the connected story in all four roles", async ({ browser, baseURL }, info) => {
  const contexts: BrowserContext[] = [];
  const rolePage = async (role: string, email?: string) => {
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
    contexts.push(context);
    const response = await context.request.post(role === "student" ? "/api/student/sign-in" : "/api/auth/sign-in", {
      data: email ? { email, password: process.env.BANGLA_DEMO_E2E_PASSWORD } : { username: "camel", password: process.env.BANGLA_DEMO_E2E_PASSWORD },
    });
    expect(response.status()).toBe(200);
    return context.newPage();
  };
  try {
    const admin = await rolePage("admin", "admin@admin.com");
    await admin.goto("/admin");
    await expect(admin.getByRole("heading", { name: "Waiting for approval (3)" })).toBeVisible();
    await capture(admin, info, "01-admin-approval-queue");
    await admin.goto("/admin/classes");
    await expect(admin.getByText("Demo Class", { exact: true }).first()).toBeVisible();
    await capture(admin, info, "02-admin-class-allocation");

    const teacher = await rolePage("teacher", "timmarco@gmail.com");
    await teacher.goto("/teach");
    await teacher.getByRole("button", { name: /Demo Class/ }).click();
    await expect(teacher.getByRole("heading", { name: "Students in this class (6)" })).toBeVisible();
    await capture(teacher, info, "03-teacher-roster");
    for (const [label, file, text] of [
      ["Activities & quizzes", "04-teacher-activities", "4. Our heritage showcase: crafts of Bengal"],
      ["Results", "05-teacher-marks", "Gradebook and attendance"],
      ["Attendance", "06-teacher-attendance", "Camel"],
      ["Announcements", "07-teacher-announcements", "Demo heritage journey: Our Bangladesh."],
      ["Class sources", "08-teacher-sources", "National Curriculum and Textbook Board"],
    ]) {
      await teacher.getByRole("navigation", { name: "Portal navigation" }).getByRole("button", { name: label, exact: true }).click();
      await expect(teacher.getByText(text, { exact: false }).first()).toBeVisible();
      if (label === "Attendance") {
        // Show an existing saved session, not today's intentionally blank attendance form.
        const db = await import("better-sqlite3");
        const sqlite = new db.default(process.env.BANGLA_DEMO_E2E_DB!, { readonly: true });
        const row = sqlite.prepare("SELECT max(session_date) AS date FROM class_attendance").get() as { date: string };
        sqlite.close();
        await teacher.locator('input[type="date"]').fill(row.date);
        await expect(teacher.getByText(/^Last saved by Tim Marco/)).toBeVisible();
      }
      await capture(teacher, info, file);
    }

    const student = await rolePage("student");
    await student.goto("/student");
    await expect(student.getByRole("heading", { name: "My Learning", exact: true })).toBeVisible();
    await expect(student.getByRole("region", { name: "Student progress" })).toContainText("3 / 4");
    await capture(student, info, "09-camel-learning");
    await student.getByRole("button", { name: "My activities", exact: true }).click();
    await expect(student.getByRole("heading", { name: "My class activities" })).toBeVisible();
    await capture(student, info, "10-camel-activities");
    await student.getByRole("button", { name: "My results", exact: true }).click();
    await expect(student.getByRole("table")).toContainText("Pohela Boishakh");
    await capture(student, info, "11-camel-results");

    const parent = await rolePage("parent", "franksamo@gmail.com");
    await parent.goto("/family");
    await expect(parent.getByRole("heading", { name: "Your child's learning" })).toBeVisible();
    await expect(parent.getByRole("region", { name: "Camel", exact: true })).toContainText("Attended 3 of 3 classes");
    await expect(parent.getByText("Maya Rahman", { exact: true })).toHaveCount(0);
    await capture(parent, info, "12-parent-camel-overview");
    await admin.goto("/admin/results");
    await expect(admin.getByText("Demo Class", { exact: true }).first()).toBeVisible();
    await capture(admin, info, "13-admin-results");
  } finally { for (const context of contexts) await context.close(); }
});
