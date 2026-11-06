import { test, expect, request as apiRequest, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

const password = "Grown-up-wording-password-2026";

function fixture<T>(callback: (db: Database.Database) => T): T {
  if (!process.env.BANGLA_E2E_DB?.includes("bangla-e2e-")) throw new Error("An isolated E2E database is required.");
  const db = new Database(process.env.BANGLA_E2E_DB);
  try { return callback(db); } finally { db.close(); }
}

/** A signed-in browser for a new adult account, adjusted in the database first. */
async function adult(browser: Browser, baseURL: string | undefined, name: string, sql: string) {
  const device = `wording-${name}-${randomUUID()}`;
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": device } });
  const email = `wording-${name}-${randomUUID().slice(0, 8)}@example.com`;
  expect((await context.request.post("/api/auth/sign-up", { data: { email, displayName: `Wording ${name}`, password } })).status()).toBe(201);
  fixture((db) => db.prepare(sql).run(email));
  expect((await context.request.post("/api/auth/sign-in", { data: { email, password } })).status()).toBe(200);
  return { context, email, page: await context.newPage() };
}

// API setup sends the session cookie itself: the request context does not resend Secure cookies over http.
async function cookieFor(api: APIRequestContext, kind: "auth" | "student", data: Record<string, string>, device: string) {
  const response = await api.post(`/api/${kind}/sign-in`, { data, headers: { "x-forwarded-for": device } });
  expect(response.status()).toBe(200);
  const cookie = response.headersArray().find((header) => header.name.toLowerCase() === "set-cookie" && /^ba_(adult|student)_session=/.test(header.value));
  return { cookie: cookie!.value.split(";")[0] };
}

test("the grown-up sign-in page greets every adult, not only parents", async ({ page }) => {
  await page.goto("/grown-ups");
  await expect(page.locator(".adult-brand small")).toHaveText("Grown-up sign in");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Help a child’s next adventure begin.");
  await expect(page.getByText("Parent sign in")).toHaveCount(0);
  await page.getByRole("button", { name: "বাংলায় দেখুন" }).click();
  await expect(page.locator(".adult-brand small")).toHaveText("বড়দের সাইন ইন");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("শিশুর নতুন অভিযানের শুরুতে পাশে থাকুন।");
  // The teacher and administrator pages keep their own headings.
  await page.goto("/grown-ups?returnTo=%2Fteach");
  await expect(page.locator(".adult-brand small")).toHaveText("শিক্ষকের সাইন ইন");
});

test("an adult with a temporary password is sent to the password form even when switching accounts", async ({ browser, baseURL }) => {
  const { context, page } = await adult(browser, baseURL, "temporary", "UPDATE adults SET role = 'teacher', teacher_status = 'approved', approval_status = 'approved', must_change_password = 1 WHERE email = ?");
  try {
    await page.goto("/grown-ups?switchAccount=1");
    await expect(page).toHaveURL(/\/account\/password\?returnTo=%2Fteach$/);
    await expect(page.getByRole("heading", { name: "Choose your own password" })).toBeVisible();
    await page.goto("/grown-ups?returnTo=%2Fadmin&switchAccount=1");
    await expect(page).toHaveURL(/\/account\/password\?returnTo=/);
    await expect(page.getByRole("tab", { name: "Sign in", exact: true })).toHaveCount(0);
  } finally { await context.close(); }
});

test("a parent is warned that teacher approval ends the family view, and so is the administrator approving it", async ({ browser, baseURL }) => {
  test.setTimeout(90000);
  const parent = await adult(browser, baseURL, "parent", "UPDATE adults SET approval_status = 'approved' WHERE email = ?");
  const admin = await adult(browser, baseURL, "admin", "UPDATE adults SET role = 'admin', approval_status = 'approved' WHERE email = ?");
  try {
    await parent.page.goto("/teach");
    const warning = "once approved, this becomes a teacher account. The family dashboard closes, and the classes and results of children linked to you are no longer shown to this account.";
    await expect(parent.page.getByRole("note")).toContainText(warning);
    await parent.page.getByRole("button", { name: "Request teacher access", exact: true }).click();
    await expect(parent.page.getByRole("heading", { name: "Your teacher request is with us" })).toBeVisible();
    await expect(parent.page.getByText("Your family account works as usual while you wait.")).toBeVisible();
    await expect(parent.page.getByRole("note")).toContainText(warning);
    await parent.page.getByRole("button", { name: "বাংলা" }).click();
    await expect(parent.page.getByRole("note")).toContainText("অনুমোদনের পর এটি শিক্ষকের অ্যাকাউন্ট হয়ে যাবে।");

    await admin.page.goto("/admin");
    const queued = admin.page.locator(".approval-list li").filter({ hasText: parent.email });
    await expect(queued).toContainText("Approving makes this a teacher account: its family dashboard and linked children’s classes and results stop showing.");
    await expect(queued.getByRole("button", { name: "Approve", exact: true })).toBeVisible();
    await admin.page.getByLabel("Search users").fill(parent.email);
    await admin.page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(admin.page.locator(".management-table tbody tr").filter({ hasText: parent.email })).toContainText("Approving makes this a teacher account");
  } finally {
    await parent.context.close();
    await admin.context.close();
  }
});

test("a narration error on the parent page addresses the parent politely in Bangla", async ({ browser, baseURL }) => {
  test.setTimeout(120000);
  const suffix = randomUUID().slice(0, 8);
  const emails = { admin: `wording-narration-admin-${suffix}@example.com`, parent: `wording-narration-parent-${suffix}@example.com` };
  const username = `wording.narration.${suffix}`;
  const api = await apiRequest.newContext({ baseURL });
  try {
    for (const [role, address] of Object.entries(emails)) {
      expect((await api.post("/api/auth/sign-up", { data: { email: address, displayName: `Narration ${role}`, password }, headers: { "x-forwarded-for": `wording-${role}-${suffix}` } })).status()).toBe(201);
    }
    fixture((db) => {
      db.prepare("UPDATE adults SET role = 'admin', approval_status = 'approved' WHERE email = ?").run(emails.admin);
      db.prepare("UPDATE adults SET approval_status = 'approved' WHERE email = ?").run(emails.parent);
    });
    const registered = await api.post("/api/student/sign-up", { data: { username, displayName: "Narration child", password }, headers: { "x-forwarded-for": `wording-student-${suffix}` } });
    expect(registered.status()).toBe(201);
    const studentId = (await registered.json()).student.id as string;
    fixture((db) => db.prepare("UPDATE students SET approval_status = 'approved' WHERE id = ?").run(studentId));
    const admin = await cookieFor(api, "auth", { email: emails.admin, password }, `wording-admin-${suffix}`);
    const created = await api.post("/api/classes", { headers: admin, data: { name: `Narration class ${suffix}` } });
    expect(created.status()).toBe(201);
    const classId = (await created.json()).class.id as string;
    expect((await api.post(`/api/classes/${classId}/students`, { headers: admin, data: { studentIds: [studentId] } })).status()).toBe(200);
    expect((await api.post("/api/admin/family-links", { headers: admin, data: { studentId, parentEmail: emails.parent, confirmed: true } })).status()).toBe(200);
    const activity = await api.post(`/api/classes/${classId}/activities`, { headers: admin, data: { title: `River check ${suffix}`, instructions: "Read the question and choose one answer.", questions: [{ prompt: "কোনটি নদী?", options: ["Padma", "A mountain"], answer: 0 }] } });
    expect(activity.status()).toBe(201);
  } finally { await api.dispose(); }

  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": `wording-parent-ui-${suffix}` } });
  try {
    const page: Page = await context.newPage();
    expect((await page.request.post("/api/auth/sign-in", { data: { email: emails.parent, password } })).status()).toBe(200);
    // The voice service is unavailable and says nothing of its own.
    await page.route("**/api/narration", (route) => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
    await page.goto("/family");
    await expect(page.getByRole("heading", { level: 1, name: "Your child's learning" })).toBeVisible();
    await page.locator(".portal-topbar").getByRole("button", { name: "বাংলা" }).click();
    const control = page.locator('[data-narration-kind="activity"][data-narration-slot="instructions"]');
    await control.getByRole("button", { name: "নির্দেশনা শুনুন", exact: true }).click();
    await expect(control.getByRole("alert")).toHaveText("কণ্ঠ প্রস্তুত করা যায়নি। সংযোগ দেখে আবার চেষ্টা করুন।");
    await expect(control.getByRole("button", { name: "আবার চেষ্টা করুন: নির্দেশনা শুনুন", exact: true })).toBeVisible();
  } finally { await context.close(); }
});
