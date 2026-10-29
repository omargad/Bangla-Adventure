import { test, expect } from "@playwright/test";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

const password = "Import-teacher-password-2026";

// Self sign-ups wait for an administrator: this approves the account as a teacher directly.
function approveTeacher(address: string) {
  if (!process.env.BANGLA_E2E_DB?.includes("bangla-e2e-")) throw new Error("An isolated E2E database is required.");
  const db = new Database(process.env.BANGLA_E2E_DB);
  db.prepare("UPDATE adults SET role = 'teacher', teacher_status = 'approved', approval_status = 'approved' WHERE email = ?").run(address);
  db.close();
}

test("teacher uploads a CSV and a provisioned student replaces the temporary password", async ({ page, browser, baseURL }) => {
  test.setTimeout(90000);
  const suffix = randomUUID().slice(0, 8);
  const teacherEmail = `import-${suffix}@example.com`, username = `csv-${suffix}`, className = `CSV class ${suffix}`;
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `import-teacher-${suffix}` });
  expect((await page.request.post("/api/auth/sign-up", { data: { email: teacherEmail, displayName: "Import Teacher", password } })).status()).toBe(201);
  approveTeacher(teacherEmail);
  expect((await page.request.post("/api/auth/sign-in", { data: { email: teacherEmail, password } })).status()).toBe(200);

  await page.goto("/teach");
  await page.getByLabel("New class name").fill(className);
  await page.getByRole("button", { name: "Create class", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(className) }).click();
  const panel = page.getByRole("region", { name: "Add students from a CSV file" });
  await expect(panel.getByRole("link", { name: "Download the CSV template" })).toHaveAttribute("download", "student-list-template.csv");
  const file = panel.getByLabel("Student list (CSV file)");

  await file.setInputFiles({ name: "broken.csv", mimeType: "text/csv", buffer: Buffer.from("name,username\nGood Row,\n,missing-name\nBad Name,a b\n") });
  await panel.getByRole("button", { name: "Upload and create accounts" }).click();
  const errors = panel.getByRole("list", { name: "Rows to fix" });
  await expect(errors).toContainText("Line 3:");
  await expect(errors).toContainText("Line 4:");
  await expect(page.locator(".family-link-list li")).toHaveCount(0);

  // Unique names: an upload refuses a second account for a name that already has one, and retries share the database.
  await file.setInputFiles({ name: "students.csv", mimeType: "text/csv", buffer: Buffer.from(`﻿name,username\r\n"Hossain, Nadia ${suffix}",${username}\r\nMaya Rahman ${suffix},\r\n`) });
  await panel.getByRole("button", { name: "Upload and create accounts" }).click();
  await expect(panel.getByRole("status")).toHaveText("2 student accounts created and added to this class.");
  const row = panel.getByRole("row").filter({ hasText: username });
  const temporaryPassword = await row.locator("code").nth(1).innerText();
  expect(temporaryPassword).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{2}$/);
  await expect(page.locator(".family-link-list")).toContainText(username);

  const [download] = await Promise.all([page.waitForEvent("download"), panel.getByRole("button", { name: "Download sign-in sheet" }).click()]);
  expect(download.suggestedFilename()).toBe("student-sign-in-sheet.csv");
  const sheet = await readFile(await download.path(), "utf8");
  expect(sheet).toContain(`"Hossain, Nadia ${suffix}","${username}","${temporaryPassword}"`);

  // Printing shows the sheet and hides the rest of the page.
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".student-import-sheet").getByRole("row").filter({ hasText: username })).toBeVisible();
  await expect(page.getByRole("button", { name: "Print sign-in sheet" })).toBeHidden();
  await page.emulateMedia({ media: "screen" });

  // The passwords exist only on screen: other sections keep them, and leaving the class asks first.
  const prompts: string[] = [];
  page.on("dialog", (dialog) => { prompts.push(dialog.message()); void dialog.dismiss(); });
  const teacherNav = page.getByRole("navigation", { name: "Portal navigation" });
  await teacherNav.getByRole("button", { name: "Results", exact: true }).click();
  await teacherNav.getByRole("button", { name: "Students", exact: true }).click();
  await expect(row).toBeVisible();
  await teacherNav.getByRole("button", { name: "My classes", exact: true }).click();
  await teacherNav.getByRole("link", { name: "Content review" }).click();
  await expect(page).toHaveURL(/\/teach$/);
  await expect(row).toBeVisible();
  expect(prompts).toHaveLength(2);
  for (const prompt of prompts) expect(prompt).toContain("cannot be shown again");

  const studentContext = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": `import-student-${suffix}` } });
  try {
    const student = await studentContext.newPage();
    await student.goto("/student");
    await student.getByLabel("Username", { exact: true }).fill(username);
    await student.getByLabel("Password", { exact: true }).fill(temporaryPassword);
    await student.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(student).toHaveURL(/\/student\/password$/);
    await expect(student.getByRole("heading", { name: "Choose your own password" })).toBeVisible();
    await student.goto("/student");
    await expect(student).toHaveURL(/\/student\/password$/);

    await student.getByLabel("Temporary password", { exact: true }).fill(temporaryPassword);
    await student.getByLabel(/^New password/).fill("my-own-secret-1");
    await student.getByLabel("Type the new password again", { exact: true }).fill("my-own-secret-2");
    await student.getByRole("button", { name: "Save my new password" }).click();
    await expect(student.locator(".auth-error[role=alert]")).toHaveText("The two new passwords do not match.");
    await student.getByLabel("Type the new password again", { exact: true }).fill("my-own-secret-1");
    await student.getByRole("button", { name: "Save my new password" }).click();
    await expect(student).toHaveURL(/\/student$/);
    await expect(student.getByRole("heading", { name: "My Learning", exact: true })).toBeVisible();
    await student.getByRole("navigation", { name: "Portal navigation" }).getByRole("button", { name: "My activities", exact: true }).click();
    await expect(student.getByRole("heading", { name: className })).toBeVisible();

    // A voluntary change stays inside the student portal.
    await student.getByRole("navigation", { name: "Portal navigation" }).getByRole("link", { name: "Change password" }).click();
    await expect(student).toHaveURL(/\/student\/password$/);
    await expect(student.getByRole("heading", { name: "Change your password", level: 1 })).toBeVisible();
    await expect(student.getByRole("navigation", { name: "Portal navigation" }).getByRole("link", { name: "Change password" })).toHaveAttribute("aria-current", "page");
  } finally { await studentContext.close(); }
});
