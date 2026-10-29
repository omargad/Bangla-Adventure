import { test, expect, type Browser, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

const password = "Sources-e2e-password-2026";

/** Changes the isolated test database directly (account roles and approvals, older records). */
function withFixture<T>(change: (db: Database.Database) => T): T {
  if (!process.env.BANGLA_E2E_DB?.includes("bangla-e2e-")) throw new Error("Isolated test database required.");
  const fixture = new Database(process.env.BANGLA_E2E_DB);
  try { return change(fixture); } finally { fixture.close(); }
}

/**
 * A signed-in browser for a new adult, promoted to teacher or administrator in the
 * test database. Self sign-ups wait for an administrator: approve directly, then sign in.
 */
async function adult(browser: Browser, baseURL: string | undefined, role: "teacher" | "admin", suffix: string) {
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": `sources-${role}-${suffix}` } });
  const email = `sources-${role}-${suffix}@example.com`;
  expect((await context.request.post("/api/auth/sign-up", { data: { email, displayName: `Sources ${role} ${suffix}`, password } })).status()).toBe(201);
  withFixture((db) => db.prepare(role === "admin"
    ? "UPDATE adults SET role = 'admin', approval_status = 'approved' WHERE email = ?"
    : "UPDATE adults SET role = 'teacher', teacher_status = 'approved', approval_status = 'approved' WHERE email = ?").run(email));
  expect((await context.request.post("/api/auth/sign-in", { data: { email, password } })).status()).toBe(200);
  return context;
}

async function signedInStudent(browser: Browser, baseURL: string | undefined, username: string) {
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": `sources-student-${username}` } });
  expect((await context.request.post("/api/student/sign-up", { data: { username, displayName: `Learner ${username}`, password } })).status()).toBe(201);
  withFixture((db) => db.prepare("UPDATE students SET approval_status = 'approved' WHERE username = ?").run(username));
  expect((await context.request.post("/api/student/sign-in", { data: { username, password } })).status()).toBe(200);
  return context;
}

/** Calls the API from the signed-in page, so the browser sends its own session cookie. */
async function api(page: Page, url: string, body: unknown) {
  return page.evaluate(async ({ url, body }) => {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  }, { url, body });
}

test("an administrator updates a textbook's yearly link and students' Sources & references links to it", async ({ browser, baseURL }) => {
  test.setTimeout(90000);
  const suffix = randomUUID().slice(0, 8);
  const adminContext = await adult(browser, baseURL, "admin", suffix);
  const studentContext = await signedInStudent(browser, baseURL, `links-${suffix}`);
  try {
    const admin = await adminContext.newPage(), student = await studentContext.newPage();
    admin.setDefaultTimeout(15000); student.setDefaultTimeout(15000);
    await admin.goto("/admin");
    await admin.getByRole("navigation", { name: "Portal navigation" }).getByRole("link", { name: "Sources", exact: true }).click();
    await expect(admin).toHaveURL(/\/admin\/sources$/);
    const book = admin.getByRole("article", { name: "Geography and Environment", exact: true });
    await expect(book).toContainText("Official NCTB page");
    const field = book.getByLabel("Geography and Environment — Whole book: this year's link", { exact: true });

    // Another website is allowed but flagged before saving.
    await field.fill("https://example.org/geography.pdf");
    await expect(book.getByRole("note")).toContainText("not on the NCTB website");
    const yearly = `https://nctb.gov.bd/pages/static-pages/geography-${suffix}`;
    await field.fill(yearly);
    await expect(book.getByRole("note")).toHaveCount(0);
    await book.getByRole("button", { name: "Save link", exact: true }).click();
    await expect(admin.getByRole("status").filter({ hasText: "Link saved" })).toBeVisible();
    await expect(book).toContainText("Your link");
    await expect(book.getByRole("button", { name: "Remove my link", exact: true })).toBeVisible();

    await student.goto("/student");
    await student.getByRole("navigation", { name: "Portal navigation" }).getByRole("link", { name: "Sources & references", exact: true }).click();
    await expect(student).toHaveURL(/\/references$/);
    await expect(student.getByRole("link", { name: "Geography and Environment — This year's edition", exact: true })).toHaveAttribute("href", yearly);
    // Books that cover several classes link each class to its own NCTB page.
    await expect(student.getByRole("link", { name: "Amar Bangla Boi (My Bangla Book) — Class 3: Official NCTB page", exact: true })).toHaveAttribute("href", /^https:\/\/nctb\.gov\.bd\/pages\/static-pages\//);
    // The page follows the Bangla switch.
    await student.getByRole("button", { name: "বাংলা", exact: true }).click();
    await expect(student.getByRole("heading", { level: 1, name: "উৎস ও তথ্যসূত্র" })).toBeVisible();
    await expect(student.getByRole("link", { name: "ভূগোল ও পরিবেশ — এ বছরের সংস্করণ", exact: true })).toHaveAttribute("href", yearly);
  } finally {
    await adminContext.close();
    await studentContext.close();
  }
});

test("a teacher adds a class source that the class's student sees", async ({ browser, baseURL }) => {
  test.setTimeout(90000);
  const suffix = randomUUID().slice(0, 8);
  const className = `Sunday sources ${suffix}`;
  const teacherContext = await adult(browser, baseURL, "teacher", suffix);
  const studentContext = await signedInStudent(browser, baseURL, `class-${suffix}`);
  const outsiderContext = await signedInStudent(browser, baseURL, `outside-${suffix}`);
  try {
    const teacher = await teacherContext.newPage(), student = await studentContext.newPage(), outsider = await outsiderContext.newPage();
    for (const page of [teacher, student, outsider]) page.setDefaultTimeout(15000);
    await teacher.goto("/teach");
    const created = await api(teacher, "/api/classes", { name: className });
    expect(created.status).toBe(201);
    expect((await api(teacher, `/api/classes/${created.data.class.id}/students`, { username: `class-${suffix}` })).status).toBe(200);

    await teacher.reload();
    await teacher.getByRole("button", { name: new RegExp(className) }).click();
    await teacher.getByRole("navigation", { name: "Portal navigation" }).getByRole("button", { name: "Class sources", exact: true }).click();
    const panel = teacher.getByRole("region", { name: "Class sources" });
    await expect(panel.getByText("No sources for this class yet.", { exact: true })).toBeVisible();
    const form = panel.getByRole("form", { name: "Add a source" });
    await form.getByLabel("Title (English)", { exact: true }).fill("Boishakh songs");
    await form.getByLabel("Title (Bangla)", { exact: true }).fill("বৈশাখের গান");
    await form.getByLabel("Link", { exact: true }).fill("https://example.org/boishakh-songs");
    await form.getByLabel("Note for students (optional)", { exact: true }).fill("Listen before Sunday.");
    await form.getByRole("button", { name: "Add source", exact: true }).click();
    await expect(panel.getByRole("status")).toContainText("Source added");
    await expect(panel.getByRole("link", { name: "Boishakh songs", exact: true })).toHaveAttribute("href", "https://example.org/boishakh-songs");

    await student.goto("/references");
    const mine = student.getByRole("region", { name: "My class sources" });
    await expect(mine.getByRole("heading", { name: className })).toBeVisible();
    await expect(mine.getByRole("link", { name: "Boishakh songs", exact: true })).toHaveAttribute("href", "https://example.org/boishakh-songs");
    await expect(mine).toContainText("Listen before Sunday.");
    await student.getByRole("button", { name: "বাংলা", exact: true }).click();
    await expect(student.getByRole("region", { name: "আমার ক্লাসের উৎস" }).getByRole("link", { name: "বৈশাখের গান", exact: true })).toBeVisible();
    // My activities shows the same sources with the class (the page stays in Bangla).
    await student.goto("/student?section=activities");
    await expect(student.getByRole("region", { name: `${className}: ক্লাসের উৎস` }).getByRole("link", { name: "বৈশাখের গান", exact: true })).toHaveAttribute("href", "https://example.org/boishakh-songs");

    // A student who is not in the class does not see it.
    await outsider.goto("/references");
    await expect(outsider.getByRole("region", { name: "My class sources" })).toBeVisible();
    await expect(outsider.getByRole("link", { name: "Boishakh songs", exact: true })).toHaveCount(0);
  } finally {
    await teacherContext.close();
    await studentContext.close();
    await outsiderContext.close();
  }
});

test("an administrator restores a link held back from before only administrators could change links", async ({ browser, baseURL }) => {
  test.setTimeout(90000);
  const suffix = randomUUID().slice(0, 8);
  const title = "The secondary Bangla readers (Charupath & Anandapath for Class 6, Saptabarna, Sahitya Kanika)";
  const oldLink = `https://nctb.gov.bd/pages/static-pages/readers-${suffix}`;
  // What the start-up check leaves for a link a teacher saved under the old rules.
  withFixture((db) => db.prepare("INSERT OR REPLACE INTO knowledge_sources (id, updated_by, data_json) VALUES ('literature-secondary', 'old-teacher@example.com', ?)").run(JSON.stringify({
    reviewed: true, heldLinks: { downloadUrl: oldLink, setBy: "old-teacher@example.com", heldAt: new Date().toISOString(), reasons: ["not-admin"] },
  })));
  const adminContext = await adult(browser, baseURL, "admin", `held-${suffix}`);
  const studentContext = await signedInStudent(browser, baseURL, `held-${suffix}`);
  try {
    const admin = await adminContext.newPage(), student = await studentContext.newPage();
    admin.setDefaultTimeout(15000); student.setDefaultTimeout(15000);
    await student.goto("/references");
    await expect(student.getByRole("link", { name: `${title} — Class 6: Official NCTB page`, exact: true })).toBeVisible();
    await expect(student.locator(`a[href="${oldLink}"]`)).toHaveCount(0);

    await admin.goto("/admin/sources");
    const checks = admin.getByRole("region", { name: "Links to check" });
    const card = checks.getByRole("article", { name: title, exact: true });
    await expect(card.getByRole("link", { name: oldLink, exact: true })).toHaveAttribute("href", oldLink);
    await expect(card).toContainText("Not saved by an administrator");
    await expect(card).toContainText("old-teacher@example.com");
    await card.getByRole("button", { name: `Restore: ${title}`, exact: true }).click();
    await expect(admin.getByRole("status").filter({ hasText: "Link restored" })).toBeVisible();
    await expect(checks).toHaveCount(0);

    // One link for the whole book now, instead of one per class.
    await student.reload();
    await expect(student.getByRole("link", { name: `${title} — This year's edition`, exact: true })).toHaveAttribute("href", oldLink);
    await expect(student.getByRole("link", { name: `${title} — Class 6: Official NCTB page`, exact: true })).toHaveCount(0);
  } finally {
    await adminContext.close();
    await studentContext.close();
  }
});
