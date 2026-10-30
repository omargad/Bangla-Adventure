import { test, expect, request as apiRequest, type APIRequestContext } from "@playwright/test";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

const password = "Classes-admin-password-2026";

// Self sign-ups wait for an administrator: this approves the account and grants the role directly.
function grant(address: string, role: "teacher" | "admin") {
  if (!process.env.BANGLA_E2E_DB?.includes("bangla-e2e-")) throw new Error("An isolated E2E database is required.");
  const db = new Database(process.env.BANGLA_E2E_DB);
  db.prepare(role === "admin" ? "UPDATE adults SET role = 'admin', approval_status = 'approved' WHERE email = ?" : "UPDATE adults SET role = 'teacher', teacher_status = 'approved', approval_status = 'approved' WHERE email = ?").run(address);
  db.close();
}

// API setup sends the session cookie itself: the request context does not resend Secure cookies over http.
async function signUp(api: APIRequestContext, data: Record<string, string>, role: "teacher" | "admin") {
  expect((await api.post("/api/auth/sign-up", { data })).status()).toBe(201);
  grant(data.email, role);
  const response = await api.post("/api/auth/sign-in", { data: { email: data.email, password: data.password } });
  expect(response.status()).toBe(200);
  const cookie = response.headersArray().find((header) => header.name.toLowerCase() === "set-cookie" && header.value.startsWith("ba_adult_session="));
  return cookie!.value.split(";")[0];
}

test("an administrator opens and manages another teacher's class from the teacher workspace", async ({ page, baseURL }) => {
  test.setTimeout(90000);
  const suffix = randomUUID().slice(0, 8);
  const className = `Owned class ${suffix}`, teacherEmail = `classes-teacher-${suffix}@example.com`, adminEmail = `classes-admin-${suffix}@example.com`;

  const teacher = await apiRequest.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": `classes-teacher-${suffix}` } });
  try {
    const headers = { cookie: await signUp(teacher, { email: teacherEmail, displayName: "Owning Teacher", password }, "teacher") };
    const created = await teacher.post("/api/classes", { headers, data: { name: className } });
    expect(created.status()).toBe(201);
    const classId = (await created.json()).class.id;
    expect((await teacher.post(`/api/classes/${classId}/activities`, { headers, data: { title: "Festivals check-in", questions: [
      { prompt: "Which month starts the Bengali year?", options: ["Boishakh", "Poush"], answer: 0 },
    ] } })).status()).toBe(201);
    expect((await teacher.post(`/api/classes/${classId}/announcements`, { headers, data: { body: "Read the Pohela Boishakh topic." } })).status()).toBe(201);
  } finally {
    await teacher.dispose();
  }

  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `classes-admin-${suffix}` });
  expect((await page.request.post("/api/auth/sign-up", { data: { email: adminEmail, displayName: "Classes Admin", password } })).status()).toBe(201);
  grant(adminEmail, "admin");
  expect((await page.request.post("/api/auth/sign-in", { data: { email: adminEmail, password } })).status()).toBe(200);

  await page.goto("/admin");
  await page.getByRole("navigation", { name: "Portal navigation" }).getByRole("link", { name: "All classes", exact: true }).click();
  await expect(page).toHaveURL(/\/teach$/);
  await expect(page.getByRole("heading", { name: "All classes", level: 1 })).toBeVisible();
  await page.getByLabel("Find a class").fill(suffix);
  const card = page.getByRole("button", { name: new RegExp(className) });
  await expect(card).toContainText("Teacher: Owning Teacher");
  await card.click();

  const head = page.getByRole("region", { name: className });
  await expect(head.getByRole("heading", { name: className, level: 1 })).toBeVisible();
  await expect(head).toContainText("Teacher: Owning Teacher");
  const nav = page.getByRole("navigation", { name: "Portal navigation" });
  await nav.getByRole("button", { name: "Activities & quizzes", exact: true }).click();
  await expect(page.getByRole("region", { name: "Activities and submissions" })).toContainText("Festivals check-in");

  await nav.getByRole("button", { name: "Announcements", exact: true }).click();
  const announcements = page.getByRole("region", { name: "Announcements" });
  await expect(announcements).toContainText("Read the Pohela Boishakh topic.");
  await announcements.getByLabel("New announcement").fill(`Administrator note ${suffix}`);
  await announcements.getByRole("button", { name: "Post", exact: true }).click();
  const note = announcements.getByRole("listitem").filter({ hasText: `Administrator note ${suffix}` });
  await expect(note).toBeVisible();
  await expect(note).toContainText("Posted by Classes Admin");
  // Removing an announcement asks first.
  page.once("dialog", (dialog) => void dialog.accept());
  await note.getByRole("button", { name: "Remove" }).click();
  await expect(note).toHaveCount(0);

  page.once("dialog", (dialog) => void dialog.accept());
  await head.getByRole("button", { name: "Delete class" }).click();
  await expect(head).toHaveCount(0);
  await nav.getByRole("button", { name: "All classes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "All classes", level: 1 })).toBeVisible();
  await expect(card).toHaveCount(0);
  // Other specs may or may not have left classes behind: either the search finds nothing,
  // or the platform is empty and the administrator sees the platform-wide empty state.
  await expect(page.getByText(/^(No class matches your search\.|No teacher has created a class yet\.)$/)).toBeVisible();
});
