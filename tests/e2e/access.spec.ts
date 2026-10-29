import { test, expect, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

const password = "Browser-test-password-2026";
const email = () => `access-${randomUUID()}@example.com`;

test.beforeEach(async ({ context }) => {
  const key = randomUUID().replaceAll("-", "");
  await context.setExtraHTTPHeaders({ "x-forwarded-for": `2001:db8:${key.slice(0, 4)}:${key.slice(4, 8)}::1` });
});

// Self sign-ups wait for an administrator; this approves the account (and sets its role) directly.
function fixtureRole(address: string, role: string) {
  if (!process.env.BANGLA_E2E_DB?.includes("bangla-e2e-")) throw new Error("An isolated E2E database is required.");
  const db = new Database(process.env.BANGLA_E2E_DB);
  db.prepare("UPDATE adults SET role = ?, teacher_status = ?, approval_status = 'approved' WHERE email = ?").run(role, role === "teacher" ? "approved" : "none", address);
  db.close();
}

function approveStudent(username: string) {
  if (!process.env.BANGLA_E2E_DB?.includes("bangla-e2e-")) throw new Error("An isolated E2E database is required.");
  const db = new Database(process.env.BANGLA_E2E_DB);
  db.prepare("UPDATE students SET approval_status = 'approved' WHERE username = ?").run(username);
  db.close();
}

async function signIn(page: Page, address: string) {
  expect((await page.request.post("/api/auth/sign-in", { data: { email: address, password } })).status()).toBe(200);
}

test("admin home and refresh retain the current portal", async ({ page }) => {
  const owner = email();
  await page.request.post("/api/auth/sign-up", { data: { email: owner, displayName: "Refresh Administrator", password } });
  fixtureRole(owner, "admin");
  await signIn(page, owner);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "People make the adventure" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "People make the adventure" })).toBeVisible();
  await page.goto("/");
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("navigation", { name: "Portal navigation" })).toBeVisible();
});

test("a signed-in parent can switch to the administrator account without an access-denied loop", async ({ page }) => {
  const owner = email(), parent = email();
  await page.request.post("/api/auth/sign-up", { data: { email: owner, displayName: "Switch Administrator", password } });
  fixtureRole(owner, "admin");
  await page.request.post("/api/auth/sign-up", { data: { email: parent, displayName: "Switch Parent", password } });
  fixtureRole(parent, "parent");
  await signIn(page, parent);
  await page.goto("/admin");
  await expect(page.getByText(parent, { exact: false })).toBeVisible();
  await page.getByRole("link", { name: "Sign in as administrator", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Administrator sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Create account" })).toHaveCount(0);
  await page.getByLabel("Email", { exact: true }).fill(parent);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".auth-error")).toContainText("does not have administrator access");
  await page.getByLabel("Email", { exact: true }).fill(owner);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "People make the adventure" })).toBeVisible();
  await page.reload();
  expect(await page.evaluate(async () => (await fetch("/api/admin/users")).status)).toBe(200);
});

test("an open admin tab follows an account switch and cannot keep stale admin access", async ({ page, context }) => {
  const owner = email(), parent = email();
  await page.request.post("/api/auth/sign-up", { data: { email: parent, displayName: "Other Parent", password } });
  fixtureRole(parent, "parent");
  await page.request.post("/api/auth/sign-up", { data: { email: owner, displayName: "Tab Administrator", password } });
  fixtureRole(owner, "admin");
  await signIn(page, owner);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "People make the adventure" })).toBeVisible();
  const otherTab = await context.newPage();
  try {
    await otherTab.goto("/grown-ups?switchAccount=1");
    await otherTab.getByLabel("Email", { exact: true }).fill(parent);
    await otherTab.getByLabel("Password", { exact: true }).fill(password);
    await otherTab.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(otherTab).toHaveURL(/\/family$/);
    await page.bringToFront();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page).toHaveURL(/\/family$/);
    await expect(page.getByRole("heading", { name: "Your children's learning" })).toBeVisible();
    expect(await page.evaluate(async () => (await fetch("/api/admin/users")).status)).toBe(403);
  } finally { await otherTab.close(); }
});

test("teacher registration waits for approval and cannot sign in or access staff APIs", async ({ page }) => {
  const applicant = email();
  await page.goto("/teach");
  await page.getByRole("tab", { name: "Create account", exact: true }).click();
  await expect(page.getByLabel("Account type")).toHaveValue("teacher");
  await page.getByLabel(/Your name/).fill("Teacher Applicant");
  await page.getByLabel("Email", { exact: true }).fill(applicant);
  await page.getByLabel(/Password/).fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Account created — waiting for approval" })).toBeVisible();
  await page.getByRole("button", { name: /saved them/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "waiting for an administrator to approve it" })).toBeVisible();
  expect(await page.evaluate(async () => (await fetch("/api/classes")).status)).toBe(401);
  expect(await page.evaluate(async () => (await fetch("/api/admin/users")).status)).toBe(401);
  await page.getByLabel("Email", { exact: true }).fill(applicant);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".auth-error")).toContainText("waiting for an administrator to approve it");
  await expect(page).toHaveURL(/\/grown-ups/);
});

test("administrator approves a teacher and manages accounts through the UI", async ({ page }) => {
  const owner = email();
  const applicant = email();
  const parent = email();
  await page.request.post("/api/auth/sign-up", { data: { email: applicant, displayName: "Approval Candidate", password, accountType: "teacher" } });
  await page.request.post("/api/auth/sign-up", { data: { email: parent, displayName: "Managed Parent", password } });
  await page.request.post("/api/auth/sign-up", { data: { email: owner, displayName: "Test Administrator", password } });
  fixtureRole(owner, "admin");
  await signIn(page, owner);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "People make the adventure" })).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
  await page.getByRole("button", { name: "Adults", exact: true }).click();
  await expect(page.getByRole("table")).toBeVisible();
  await page.getByLabel("Search users").fill(applicant);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: applicant });
  page.on("dialog", (dialog) => dialog.accept());
  await row.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(row.getByText("teacher", { exact: true })).toBeVisible();
  await page.getByLabel("Search users").fill(parent);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const parentRow = page.getByRole("row").filter({ hasText: parent });
  await parentRow.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Display name", { exact: true }).fill("Updated Parent");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(parentRow.getByText("Updated Parent", { exact: true })).toBeVisible();
  await parentRow.getByRole("button", { name: "Suspend", exact: true }).click();
  await expect(parentRow.getByText("suspended", { exact: true })).toBeVisible();
  expect((await page.request.post("/api/auth/sign-in", { data: { email: parent, password } })).status()).toBe(401);
});

test("approved teacher can create a class and sees its dashboard totals", async ({ page }) => {
  const teacher = email();
  await page.request.post("/api/auth/sign-up", { data: { email: teacher, displayName: "Class Teacher", password } });
  fixtureRole(teacher, "teacher");
  await signIn(page, teacher);
  await page.goto("/teach");
  await page.getByLabel("New class name").fill("Adventure Club");
  await page.getByRole("button", { name: "Create class", exact: true }).click();
  await expect(page.getByRole("button", { name: /Adventure Club/ })).toBeVisible();
  await page.getByRole("button", { name: /Adventure Club/ }).click();
  await expect(page.getByRole("heading", { name: "Adventure Club", exact: true })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Find students", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add selected (0)", exact: true })).toBeDisabled();
  expect(await page.evaluate(async () => (await fetch("/api/admin/users")).status)).toBe(403);
});

test("student dashboard does not continuously reload its feed", async ({ page }) => {
  let feeds = 0;
  page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/student/feed") feeds++; });
  const username = `child-${randomUUID().slice(0, 12)}`;
  await page.request.post("/api/student/sign-up", { data: { username, displayName: "Learner", password } });
  approveStudent(username);
  expect((await page.request.post("/api/student/sign-in", { data: { username, password } })).status()).toBe(200);
  await page.goto("/student");
  await expect(page.getByRole("link", { name: "Sign out", exact: true })).toBeVisible();
  await page.waitForTimeout(1200);
  expect(feeds).toBeGreaterThan(0);
  expect(feeds).toBeLessThanOrEqual(2);
});

test("administrator links a parent who can monitor only their child and cannot edit schoolwork", async ({ page, browser, baseURL }) => {
  const owner = email();
  const parent = email();
  const username = `family-${randomUUID().slice(0, 10)}`;
  const childResponse = await page.request.post("/api/student/sign-up", { data: { username, displayName: "Family Test Learner", password } });
  expect(childResponse.status()).toBe(201);
  const childId = (await childResponse.json()).student.id;
  approveStudent(username);
  await page.request.post("/api/auth/sign-up", { data: { email: parent, displayName: "Family Test Parent", password } });
  fixtureRole(parent, "parent");
  const ownerResponse = await page.request.post("/api/auth/sign-up", { data: { email: owner, displayName: "Family Administrator", password } });
  const ownerId = (await ownerResponse.json()).adult.id;
  fixtureRole(owner, "admin");
  await signIn(page, owner);
  const fixture = new Database(process.env.BANGLA_E2E_DB!);
  const classId = randomUUID(), rosterId = randomUUID(), activityId = randomUUID();
  fixture.prepare("INSERT INTO classes (id, teacher_id, name, join_code) VALUES (?, ?, ?, ?)").run(classId, ownerId, "Family Reading Class", randomUUID());
  fixture.prepare("INSERT INTO class_students (id, class_id, display_name, token_hash) VALUES (?, ?, ?, ?)").run(rosterId, classId, "Family Test Learner", randomUUID());
  fixture.prepare("INSERT INTO student_class_enrollments (id, student_id, class_id, class_student_id) VALUES (?, ?, ?, ?)").run(randomUUID(), childId, classId, rosterId);
  fixture.prepare("INSERT INTO class_activities (id, class_id, title) VALUES (?, ?, ?)").run(activityId, classId, "Family reading quiz");
  fixture.prepare("INSERT INTO activity_submissions (id, activity_id, student_id, score, total) VALUES (?, ?, ?, 1, 2)").run(randomUUID(), activityId, rosterId);
  fixture.close();
  await page.goto("/admin");
  await page.getByRole("button", { name: "Students", exact: true }).click();
  await page.getByLabel("Search users").fill(username);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("row").filter({ hasText: username }).getByRole("button", { name: "Family access", exact: true }).click();
  await page.getByLabel("Parent account email").fill(parent);
  await page.getByLabel(/I verified this adult/).check();
  await page.getByRole("button", { name: "Link parent", exact: true }).click();
  await expect(page.getByText(/Parent linked\./)).toBeVisible();

  const parentContext = await browser.newContext({ baseURL });
  try {
    const parentPage = await parentContext.newPage();
    expect((await parentPage.request.post("/api/auth/sign-in", { data: { email: parent, password } })).status()).toBe(200);
    await parentPage.goto("/family");
    await expect(parentPage.getByRole("heading", { name: "Family Test Learner", exact: true })).toBeVisible();
    await expect(parentPage.getByRole("heading", { name: "Family Reading Class", exact: true })).toBeVisible();
    await expect(parentPage.getByRole("cell", { name: "1 / 2", exact: true })).toBeVisible();
    await expect(parentPage.getByText("50%", { exact: true })).toBeVisible();
    for (const url of ["/api/profiles", "/api/progress", "/api/assignments", "/api/admin/family-links"]) {
      expect(await parentPage.evaluate(async (path) => (await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, url)).toBe(403);
    }
    expect(await parentPage.evaluate(async () => (await fetch("/api/classes")).status)).toBe(403);
    await parentPage.setViewportSize({ width: 360, height: 850 });
    expect(await parentPage.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    page.on("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Remove access", exact: true }).click();
    await expect(page.getByText("Parent access removed. Learning records are unchanged.")).toBeVisible();
    await parentPage.getByRole("button", { name: "Refresh progress", exact: true }).click();
    await expect(parentPage.getByRole("heading", { name: "No children linked yet" })).toBeVisible();
    await expect(parentPage.getByRole("heading", { name: "Family Test Learner", exact: true })).toHaveCount(0);
  } finally { await parentContext.close(); }
});

for (const width of [360, 768]) {
  test(`landing page is usable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 850 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "How will you join us?" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Teacher sign in", exact: true })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`landing-${width}.png`) });
    await page.locator(".welcome-accounts").screenshot({ path: testInfo.outputPath(`accounts-${width}.png`) });
  });
}
