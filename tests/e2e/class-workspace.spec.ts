import { test, expect, request as apiRequest, type APIRequestContext } from "@playwright/test";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

const password = "Class-workspace-password-2026";

// Self sign-ups wait for an administrator: this approves the account and grants the role directly.
function grant(address: string, role: "teacher" | "admin" | "student") {
  if (!process.env.BANGLA_E2E_DB?.includes("bangla-e2e-")) throw new Error("An isolated E2E database is required.");
  const db = new Database(process.env.BANGLA_E2E_DB);
  db.prepare(role === "student" ? "UPDATE students SET approval_status = 'approved' WHERE username = ?" : role === "admin" ? "UPDATE adults SET role = 'admin', approval_status = 'approved' WHERE email = ?" : "UPDATE adults SET role = 'teacher', teacher_status = 'approved', approval_status = 'approved' WHERE email = ?").run(address);
  db.close();
}

// API setup sends the session cookie itself: the request context does not resend Secure cookies over http.
async function signUp(api: APIRequestContext, kind: "auth" | "student", data: Record<string, string>, role: "teacher" | "admin" | "student") {
  expect((await api.post(`/api/${kind}/sign-up`, { data })).status()).toBe(201);
  grant(kind === "student" ? data.username : data.email, role);
  return signIn(api, kind, data);
}
async function signIn(api: APIRequestContext, kind: "auth" | "student", data: Record<string, string>) {
  const response = await api.post(`/api/${kind}/sign-in`, { data: kind === "student" ? { username: data.username, password: data.password } : { email: data.email, password: data.password } });
  expect(response.status()).toBe(200);
  const cookie = response.headersArray().find((header) => header.name.toLowerCase() === "set-cookie" && /^ba_(adult|student)_session=/.test(header.value));
  return cookie!.value.split(";")[0];
}

test("the gradebook counts only published activities, summaries count questions properly and deleting a class says so", async ({ page, browser, baseURL }) => {
  test.setTimeout(120000);
  const suffix = randomUUID().slice(0, 8);
  const className = `Workspace class ${suffix}`, teacherEmail = `workspace-teacher-${suffix}@example.com`, adminEmail = `workspace-admin-${suffix}@example.com`;
  const teacherAccount = { email: teacherEmail, displayName: "Workspace Teacher", password };
  const adminAccount = { email: adminEmail, displayName: "Workspace Admin", password };

  const api = await apiRequest.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": `workspace-setup-${suffix}` } });
  try {
    const teacher = { cookie: await signUp(api, "auth", teacherAccount, "teacher") };
    const admin = { cookie: await signUp(api, "auth", adminAccount, "admin") };
    const student = { cookie: await signUp(api, "student", { username: `workspace-${suffix}`, displayName: "Maya Workspace", password }, "student") };
    const created = await api.post("/api/classes", { headers: teacher, data: { name: className } });
    expect(created.status()).toBe(201);
    const classId = (await created.json()).class.id;
    const activity = async (title: string, questions: number) => {
      const response = await api.post(`/api/classes/${classId}/activities`, { headers: teacher, data: { title, questions: Array.from({ length: questions }, (_, index) => ({ prompt: `Question ${index + 1}?`, options: ["Yes", "No"], answer: 0 })) } });
      expect(response.status()).toBe(201);
      return (await response.json()).activity;
    };
    const published = await activity("Published check-in", 1);
    await activity("Waiting quiz", 2);
    expect((await api.patch(`/api/classes/${classId}/activities`, { headers: admin, data: { activityId: published.id, approvalStatus: "approved", revision: published.revision } })).status()).toBe(200);
    expect((await api.post(`/api/classes/${classId}/students`, { headers: teacher, data: { username: `workspace-${suffix}` } })).status()).toBe(200);
    expect((await api.post("/api/student/submit", { headers: student, data: { activityId: published.id, answers: [0] } })).status()).toBe(200);
  } finally {
    await api.dispose();
  }

  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `workspace-teacher-${suffix}` });
  await signIn(page.request, "auth", teacherAccount);
  await page.goto("/teach");
  await page.getByLabel("Find a class").fill(suffix);
  const card = page.getByRole("button", { name: new RegExp(className) });
  await expect(card).toContainText("1 student · 2 activities · 1 submission");
  await card.click();
  const nav = page.getByRole("navigation", { name: "Portal navigation" });

  await nav.getByRole("button", { name: "Activities & quizzes", exact: true }).click();
  const activities = page.getByRole("region", { name: "Activities and submissions" });
  await expect(activities.getByRole("article").filter({ hasText: "Published check-in" })).toContainText("1 question · open");
  await expect(activities.getByRole("article").filter({ hasText: "Waiting quiz" })).toContainText("2 questions · open");

  // Students see only the published activity, so the gradebook has one column and Maya is 1 of 1 done.
  await nav.getByRole("button", { name: "Results", exact: true }).click();
  const results = page.getByRole("region", { name: "Gradebook and attendance" });
  await expect(results).toContainText("1 activity is not published yet (waiting for approval or changes requested). Students cannot see it, so it is not shown here or counted in Done.");
  const gradebook = results.getByRole("region", { name: "Gradebook", exact: true });
  await expect(gradebook.getByRole("columnheader")).toHaveCount(5);
  await expect(gradebook.getByRole("columnheader").last()).toHaveText("Published check-in");
  await expect(gradebook.getByRole("row").filter({ hasText: "Maya Workspace" }).getByRole("cell").nth(0)).toHaveText("1/1");
  const byActivity = page.getByRole("region", { name: "Submissions by activity" });
  await expect(byActivity.getByRole("article")).toHaveCount(1);
  await expect(byActivity.getByRole("article")).toContainText("1 question · open");

  // Bangla counts with টি.
  await page.locator(".portal-topbar").getByRole("button", { name: "বাংলা" }).click();
  await expect(page.getByRole("region", { name: "কার্যক্রম অনুযায়ী জমা" }).getByRole("article")).toContainText("১টি প্রশ্ন · খোলা");
  await page.locator(".portal-topbar").getByRole("button", { name: "English" }).click();

  // A class created and then deleted in the same visit: the deletion message replaces "Class created…".
  await nav.getByRole("button", { name: "My classes", exact: true }).click();
  const throwaway = `Throwaway ${suffix}`;
  await page.getByLabel("New class name").fill(throwaway);
  await page.getByRole("button", { name: "Create class", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Class created. Open it to allocate students." })).toBeVisible();
  await page.getByLabel("Find a class").fill(throwaway);
  await page.getByRole("button", { name: new RegExp(throwaway) }).click();
  await expect(page.getByRole("heading", { name: throwaway, level: 1 })).toBeVisible();
  await expect(page.getByText("Class created. Open it to allocate students.")).toHaveCount(0);
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Delete class" }).click();
  await expect(page.getByRole("heading", { name: "My classes", level: 1 })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: `${throwaway} was deleted, with its activities and submissions.` })).toBeVisible();
  await expect(page.getByText("Class created. Open it to allocate students.")).toHaveCount(0);

  // The administrator's Grades & results view counts the same way.
  const adminContext = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": `workspace-admin-${suffix}` } });
  try {
    const adminPage = await adminContext.newPage();
    await signIn(adminPage.request, "auth", adminAccount);
    await adminPage.goto("/admin/results");
    await adminPage.getByLabel("Search classes").fill(suffix);
    const classRow = adminPage.getByRole("row").filter({ hasText: className });
    await expect(classRow).toContainText("2 activities");
    await classRow.getByRole("button", { name: `View results: ${className}` }).click();
    const panel = adminPage.getByRole("region", { name: `Results: ${className}` });
    await expect(panel).toContainText("1 student ·");
    await expect(panel).toContainText("1 activity is not published yet");
    const adminGradebook = panel.getByRole("region", { name: "Gradebook", exact: true });
    await expect(adminGradebook.getByRole("columnheader")).toHaveCount(5);
    await expect(adminGradebook.getByRole("row").filter({ hasText: "Maya Workspace" }).getByRole("cell").nth(0)).toHaveText("1/1");
  } finally {
    await adminContext.close();
  }
});
