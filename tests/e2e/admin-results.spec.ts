import { test, expect, request as apiRequest, type APIRequestContext } from "@playwright/test";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

const password = "Results-admin-password-2026";

function grant(address: string, role: "teacher" | "admin") {
  if (!process.env.BANGLA_E2E_DB?.includes("bangla-e2e-")) throw new Error("An isolated E2E database is required.");
  const db = new Database(process.env.BANGLA_E2E_DB);
  db.prepare(role === "admin" ? "UPDATE adults SET role = 'admin' WHERE email = ?" : "UPDATE adults SET role = 'teacher', teacher_status = 'approved' WHERE email = ?").run(address);
  db.close();
}

// API setup sends the session cookie itself: the request context does not resend Secure cookies over http.
async function signUp(api: APIRequestContext, route: string, data: Record<string, string>) {
  const response = await api.post(route, { data });
  expect(response.status()).toBe(201);
  const cookie = response.headersArray().find((header) => header.name.toLowerCase() === "set-cookie" && /^ba_(adult|student)_session=/.test(header.value));
  return cookie!.value.split(";")[0];
}

test("an administrator reviews another teacher's class results and resets a submission", async ({ page, baseURL }) => {
  test.setTimeout(90000);
  const suffix = randomUUID().slice(0, 8);
  const className = `Results class ${suffix}`, teacherEmail = `results-teacher-${suffix}@example.com`, adminEmail = `results-admin-${suffix}@example.com`;

  const teacher = await apiRequest.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": `results-teacher-${suffix}` } });
  const student = await apiRequest.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": `results-student-${suffix}` } });
  try {
    const teacherCookie = { cookie: await signUp(teacher, "/api/auth/sign-up", { email: teacherEmail, displayName: "Results Teacher", password }) };
    grant(teacherEmail, "teacher");
    const created = await teacher.post("/api/classes", { headers: teacherCookie, data: { name: className } });
    expect(created.status()).toBe(201);
    const classId = (await created.json()).class.id;
    const activity = await teacher.post(`/api/classes/${classId}/activities`, { headers: teacherCookie, data: { title: "Festivals check-in", questions: [
      { prompt: "Which month starts the Bengali year?", options: ["Boishakh", "Poush"], answer: 0 },
      { prompt: "What do shops open on Pohela Boishakh?", options: ["Halkhata", "Umbrellas"], answer: 0 },
    ] } });
    expect(activity.status()).toBe(201);
    const activityId = (await activity.json()).activity.id;
    const studentCookie = { cookie: await signUp(student, "/api/student/sign-up", { username: `results-${suffix}`, displayName: "Maya Results", password }) };
    expect((await teacher.post(`/api/classes/${classId}/students`, { headers: teacherCookie, data: { username: `results-${suffix}` } })).status()).toBe(200);
    expect((await student.post("/api/student/submit", { headers: studentCookie, data: { activityId, answers: [0, 1] } })).status()).toBe(200);
  } finally {
    await teacher.dispose();
    await student.dispose();
  }

  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `results-admin-${suffix}` });
  expect((await page.request.post("/api/auth/sign-up", { data: { email: adminEmail, displayName: "Results Admin", password } })).status()).toBe(201);
  grant(adminEmail, "admin");

  await page.goto("/admin");
  await page.getByRole("navigation", { name: "Portal navigation" }).getByRole("link", { name: "Grades & results" }).click();
  await expect(page).toHaveURL(/\/admin\/results$/);
  await expect(page.getByRole("heading", { name: "Grades & results", level: 1 })).toBeVisible();
  await page.getByLabel("Search classes").fill(suffix);
  const classRow = page.getByRole("row").filter({ hasText: className });
  await expect(classRow).toContainText("Results Teacher");
  await expect(classRow).toContainText("50%");
  const view = classRow.getByRole("button", { name: `View results: ${className}` });
  await view.click();
  await expect(view).toHaveAttribute("aria-expanded", "true");

  const results = page.getByRole("region", { name: `Results: ${className}` });
  await expect(results.getByRole("heading", { level: 2 })).toBeFocused();
  await expect(results.getByRole("link", { name: "Download CSV" })).toHaveAttribute("href", /\/grades\?format=csv$/);
  const submission = results.getByRole("row").filter({ hasText: "Maya Results" });
  await expect(submission).toContainText("Festivals check-in");
  await expect(submission).toContainText("1/2");

  page.once("dialog", (dialog) => void dialog.accept());
  await submission.getByRole("button", { name: "Reset" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Submission reset" })).toHaveText("Submission reset. The student can submit the activity again.");
  await expect(results).toContainText("No submissions yet.");
  await expect(classRow.getByRole("cell").nth(4)).toHaveText("—");
});
