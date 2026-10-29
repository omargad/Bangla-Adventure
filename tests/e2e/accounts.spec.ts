import { test, expect, type Browser, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

const password = "Accounts-admin-password-2026";

/** The first administrator: registers, is approved and promoted directly (as the server-side grant does), then signs in. */
async function administrator(page: Page, suffix: string) {
  const address = `accounts-admin-${suffix}@example.com`;
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `accounts-admin-${suffix}` });
  expect((await page.request.post("/api/auth/sign-up", { data: { email: address, displayName: "Accounts Admin", password } })).status()).toBe(201);
  if (!process.env.BANGLA_E2E_DB?.includes("bangla-e2e-")) throw new Error("An isolated E2E database is required.");
  const db = new Database(process.env.BANGLA_E2E_DB);
  db.prepare("UPDATE adults SET role = 'admin', approval_status = 'approved' WHERE email = ?").run(address);
  db.close();
  expect((await page.request.post("/api/auth/sign-in", { data: { email: address, password } })).status()).toBe(200);
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "People make the adventure" })).toBeVisible();
}

async function newPage(browser: Browser, baseURL: string | undefined, name: string) {
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": `accounts-${name}-${randomUUID()}` } });
  return { context, page: await context.newPage() };
}

/** The temporary password from the one-time sign-in details on the Users page. */
async function temporaryPassword(admin: Page, heading: RegExp) {
  const sheet = admin.getByRole("region", { name: heading });
  await expect(sheet).toBeVisible();
  const value = await sheet.locator(".credential-sheet dd code").nth(1).innerText();
  expect(value).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{2}$/);
  // Printing shows the sign-in details and hides the rest of the page.
  await admin.emulateMedia({ media: "print" });
  await expect(admin.locator(".credential-sheet dd code").nth(1)).toBeVisible();
  await expect(admin.getByRole("button", { name: "Print sign-in details" })).toBeHidden();
  await admin.emulateMedia({ media: "screen" });
  return value;
}

test("an administrator creates a teacher who must choose a password before reaching the teacher workspace", async ({ page, browser, baseURL }) => {
  test.setTimeout(90000);
  const suffix = randomUUID().slice(0, 8);
  const teacherEmail = `made-teacher-${suffix}@example.com`;
  await administrator(page, suffix);
  await page.getByRole("button", { name: "Create user", exact: true }).click();
  await page.getByRole("combobox", { name: "Account type" }).selectOption("teacher");
  await expect(page.getByLabel("Username")).toHaveCount(0);
  await page.getByLabel("Display name", { exact: true }).fill("Made Teacher");
  await page.getByLabel("Email", { exact: true }).fill(teacherEmail);
  await expect(page.getByLabel(/Initial password/)).toHaveCount(0);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  const issued = await temporaryPassword(page, /Account created: Made Teacher/);
  const sheet = page.getByRole("region", { name: /Account created/ });
  await expect(sheet.getByRole("list", { name: "One-time recovery codes" }).locator("code")).toHaveCount(8);
  await expect(sheet).toContainText("not a second sign-in step");
  await expect(sheet).toContainText("choose your own password");
  await expect(page.getByRole("button", { name: "Print sign-in details" })).toBeVisible();

  const { context, page: teacher } = await newPage(browser, baseURL, "teacher");
  try {
    await teacher.goto("/grown-ups?returnTo=%2Fteach");
    await teacher.getByLabel("Email", { exact: true }).fill(teacherEmail);
    await teacher.getByLabel("Password", { exact: true }).fill(issued);
    await teacher.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(teacher).toHaveURL(/\/account\/password\?returnTo=%2Fteach$/);
    await expect(teacher.getByRole("heading", { name: "Choose your own password" })).toBeVisible();
    await teacher.goto("/teach");
    await expect(teacher).toHaveURL(/\/account\/password\?returnTo=%2Fteach$/);

    await teacher.getByLabel("Temporary password", { exact: true }).fill(issued);
    await teacher.getByLabel(/^New password/).fill("my-own-teacher-secret");
    await teacher.getByLabel("Type the new password again", { exact: true }).fill("my-own-teacher-secret");
    await teacher.getByRole("button", { name: "Save my new password" }).click();
    await expect(teacher.getByRole("heading", { name: "Save your new recovery codes" })).toBeVisible();
    await expect(teacher.getByRole("list", { name: "One-time recovery codes" }).locator("code")).toHaveCount(8);
    await teacher.getByRole("button", { name: /saved them — continue/ }).click();
    await expect(teacher).toHaveURL(/\/teach$/);
    await expect(teacher.getByLabel("New class name")).toBeVisible();
  } finally { await context.close(); }
});

test("self sign-ups wait until an administrator approves them from the queue", async ({ page, browser, baseURL }) => {
  test.setTimeout(90000);
  const suffix = randomUUID().slice(0, 8);
  const parentEmail = `queued-parent-${suffix}@example.com`, username = `queued-${suffix}`, applicant = `queued-teacher-${suffix}@example.com`;

  const { context: parentContext, page: parent } = await newPage(browser, baseURL, "parent");
  const { context: studentContext, page: student } = await newPage(browser, baseURL, "student");
  try {
    await parent.goto("/grown-ups?mode=sign-up");
    await parent.getByLabel(/Your name/).fill("Queued Parent");
    await parent.getByLabel("Email", { exact: true }).fill(parentEmail);
    await parent.getByLabel(/Password/).fill(password);
    await parent.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(parent.getByRole("heading", { name: "Account created — waiting for approval" })).toBeVisible();
    await parent.getByRole("button", { name: /saved them — back to sign in/ }).click();
    await parent.getByLabel("Password", { exact: true }).fill(password);
    await parent.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(parent.locator(".auth-error")).toContainText("waiting for an administrator to approve it");

    await student.goto("/student?mode=sign-up");
    await student.getByLabel("Student name", { exact: true }).fill("Queued Student");
    await student.getByLabel("Username", { exact: true }).fill(username);
    await student.getByLabel("Password", { exact: true }).fill(password);
    await student.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(student.getByRole("status").filter({ hasText: "waiting for an administrator to approve it" })).toBeVisible();
    await student.getByLabel("Password", { exact: true }).fill(password);
    await student.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(student.locator(".auth-error")).toContainText("waiting for an administrator to approve it");
    expect((await parent.request.post("/api/auth/sign-up", { data: { email: applicant, displayName: "Queued Applicant", password, accountType: "teacher" } })).status()).toBe(201);

    await administrator(page, suffix);
    const queue = page.getByRole("region", { name: /Waiting for approval/ });
    const parentItem = queue.getByRole("listitem").filter({ hasText: parentEmail });
    await expect(parentItem).toContainText("Parent");
    await parentItem.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Queued Parent is approved" })).toBeVisible();
    await expect(parentItem).toHaveCount(0);
    const studentItem = queue.getByRole("listitem").filter({ hasText: username });
    await expect(studentItem).toContainText("Student");
    await studentItem.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(studentItem).toHaveCount(0);
    const applicantItem = queue.getByRole("listitem").filter({ hasText: applicant });
    await expect(applicantItem).toContainText("Teacher request");
    await applicantItem.getByRole("button", { name: "Decline", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Queued Applicant was declined and cannot sign in" })).toBeVisible();
    await expect(applicantItem).toHaveCount(0);

    await parent.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(parent).toHaveURL(/\/family$/);
    await expect(parent.getByRole("heading", { name: "No children linked yet" })).toBeVisible();
    await student.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(student.getByRole("heading", { name: "My Learning", exact: true })).toBeVisible();
    const declined = await page.request.post("/api/auth/sign-in", { data: { email: applicant, password } });
    expect(declined.status()).toBe(403);
    expect((await declined.json()).approvalStatus).toBe("declined");

    // Declined by mistake: approving the account from the Declined filter grants the teacher request too.
    await page.getByRole("combobox", { name: "Filter users" }).selectOption("declined");
    await page.getByLabel("Search users").fill(applicant);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const declinedRow = page.getByRole("row").filter({ hasText: applicant });
    await expect(declinedRow).toContainText("Teacher request declined along with the account");
    await declinedRow.getByRole("button", { name: "Approve as teacher", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Queued Applicant is approved as a teacher" })).toBeVisible();
    const approved = await parent.request.post("/api/auth/sign-in", { data: { email: applicant, password } });
    expect(approved.status()).toBe(200);
    expect((await approved.json()).adult.role).toBe("teacher");
  } finally { await parentContext.close(); await studentContext.close(); }
});

test("an administrator-created student chooses a password, and an administrator resets it when forgotten", async ({ page, browser, baseURL }) => {
  test.setTimeout(90000);
  const suffix = randomUUID().slice(0, 8);
  const username = `made-student-${suffix}`;
  await administrator(page, suffix);
  await page.getByRole("button", { name: "Create user", exact: true }).click();
  await page.getByRole("combobox", { name: "Account type" }).selectOption("student");
  await expect(page.getByLabel("Email", { exact: true })).toHaveCount(0);
  await page.getByLabel("Display name", { exact: true }).fill("Made Student");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  const issued = await temporaryPassword(page, /Account created: Made Student/);

  const signInStudent = async (student: Page, secret: string) => {
    await student.goto("/student");
    await student.getByLabel("Username", { exact: true }).fill(username);
    await student.getByLabel("Password", { exact: true }).fill(secret);
    await student.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(student).toHaveURL(/\/student\/password$/);
    // The form is a full page load: let it hydrate before typing, or React resets the fields.
    await student.waitForLoadState("networkidle");
  };
  const choosePassword = async (student: Page, current: string, next: string) => {
    await expect(async () => {
      await student.getByLabel("Temporary password", { exact: true }).fill(current);
      await student.getByLabel(/^New password/).fill(next);
      await student.getByLabel("Type the new password again", { exact: true }).fill(next);
      await expect(student.getByLabel("Temporary password", { exact: true })).toHaveValue(current, { timeout: 500 });
    }).toPass();
    await student.getByRole("button", { name: "Save my new password" }).click();
    await expect(student.getByRole("heading", { name: "My Learning", exact: true })).toBeVisible();
  };

  const { context, page: student } = await newPage(browser, baseURL, "student");
  try {
    await signInStudent(student, issued);
    await choosePassword(student, issued, "first-own-password");

    // The student forgets that password: the administrator issues a new temporary one.
    await page.getByRole("button", { name: "Students", exact: true }).click();
    await page.getByLabel("Search users").fill(username);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const row = page.getByRole("row").filter({ hasText: username });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Reset password", exact: true }).click();
    const reset = await temporaryPassword(page, /Password reset: Made Student/);
    expect(reset).not.toBe(issued);
    await expect(row).toContainText("Temporary password not yet changed");

    await student.reload();
    await expect(student.getByRole("tab", { name: "Sign in" })).toBeVisible();
    await signInStudent(student, reset);
    await choosePassword(student, reset, "second-own-password");
  } finally { await context.close(); }
});
