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
  const activity = page.getByRole("region", { name: "Activities and submissions" }).getByRole("article").filter({ hasText: "Festivals check-in" });
  await expect(activity).toContainText("Awaiting Admin approval");
  await activity.getByText("Preview instructions and questions", { exact: true }).click();
  await expect(activity).toContainText("Which month starts the Bengali year?");
  await activity.getByRole("checkbox", { name: "I have reviewed all the content above.", exact: true }).check();
  await activity.getByRole("button", { name: "Approve and publish", exact: true }).click();
  await expect(activity).toContainText("Approved by Admin · published");

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

test("a class whose teacher is suspended needs a new teacher on /admin/classes, which sends a teacher to /teach", async ({ page, baseURL }) => {
  test.setTimeout(90000);
  const suffix = randomUUID().slice(0, 8);
  const className = `Orphaned class ${suffix}`, teacherEmail = `orphan-teacher-${suffix}@example.com`, nextEmail = `next-teacher-${suffix}@example.com`, adminEmail = `orphan-admin-${suffix}@example.com`;

  const api = await apiRequest.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": `orphan-setup-${suffix}` } });
  let classId = "";
  try {
    const headers = { cookie: await signUp(api, { email: teacherEmail, displayName: `Leaving Teacher ${suffix}`, password }, "teacher") };
    const created = await api.post("/api/classes", { headers, data: { name: className } });
    expect(created.status()).toBe(201);
    classId = (await created.json()).class.id;
    await signUp(api, { email: nextEmail, displayName: `Next Teacher ${suffix}`, password }, "teacher");
  } finally {
    await api.dispose();
  }

  // A teacher who opens the administrator's page goes to their own workspace, not the parent page.
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `orphan-teacher-${suffix}` });
  expect((await page.request.post("/api/auth/sign-in", { data: { email: teacherEmail, password } })).status()).toBe(200);
  await page.goto("/admin/classes");
  await expect(page).toHaveURL(/\/teach$/);

  // The teacher is suspended; their class keeps pointing to them.
  const db = new Database(process.env.BANGLA_E2E_DB!);
  db.prepare("UPDATE adults SET status = 'suspended' WHERE email = ?").run(teacherEmail);
  db.close();

  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `orphan-admin-${suffix}` });
  expect((await page.request.post("/api/auth/sign-up", { data: { email: adminEmail, displayName: "Orphan Admin", password } })).status()).toBe(201);
  grant(adminEmail, "admin");
  expect((await page.request.post("/api/auth/sign-in", { data: { email: adminEmail, password } })).status()).toBe(200);
  await page.goto("/admin/classes");
  const needing = page.getByRole("region", { name: "Classes that need a new teacher" });
  await expect(needing).toContainText(`${className} · Teacher: Leaving Teacher ${suffix}`);
  await expect(page.getByRole("option", { name: new RegExp(`${className} .* · Needs a new teacher$`) })).toHaveCount(1);
  await needing.getByRole("button", { name: className, exact: true }).click();
  await expect(page.getByLabel("Choose a class")).toHaveValue(classId);
  const panel = page.getByRole("region", { name: "Class teacher" });
  await expect(panel).toContainText("This teacher's account is no longer an active, approved teacher.");

  await panel.getByLabel("Change teacher").selectOption({ label: `Next Teacher ${suffix} · ${nextEmail}` });
  page.once("dialog", (dialog) => void dialog.accept());
  await panel.getByRole("button", { name: "Save teacher", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: `${className} is now taught by Next Teacher ${suffix}.` })).toBeVisible();
  await expect(panel).not.toContainText("no longer an active, approved teacher");
  await expect(page.getByRole("option", { name: new RegExp(`${className} .* · Needs a new teacher$`) })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Classes that need a new teacher" }).getByRole("button", { name: className, exact: true })).toHaveCount(0);
});
