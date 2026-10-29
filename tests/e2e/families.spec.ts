import { test, expect, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

const password = "Families-e2e-password-2026";

function fixture<T>(callback: (db: Database.Database) => T): T {
  if (!process.env.BANGLA_E2E_DB?.includes("bangla-e2e-")) throw new Error("An isolated E2E database is required.");
  const db = new Database(process.env.BANGLA_E2E_DB);
  try { return callback(db); } finally { db.close(); }
}

// Self sign-ups wait for an administrator: this approves the account and grants the role directly.
async function signUpAs(page: Page, email: string, displayName: string, role: "admin" | "teacher") {
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `families-${email}` });
  expect((await page.request.post("/api/auth/sign-up", { data: { email, displayName, password } })).status()).toBe(201);
  fixture((db) => db.prepare(role === "admin"
    ? "UPDATE adults SET role = 'admin', approval_status = 'approved' WHERE email = ?"
    : "UPDATE adults SET role = 'teacher', teacher_status = 'approved', approval_status = 'approved' WHERE email = ?").run(email));
  expect((await page.request.post("/api/auth/sign-in", { data: { email, password } })).status()).toBe(200);
}

test("an administrator imports a family CSV and gets a printable sign-in sheet per family", async ({ page }) => {
  test.setTimeout(90000);
  const suffix = randomUUID().slice(0, 8);
  await signUpAs(page, `families-admin-${suffix}@example.com`, "Families Admin", "admin");
  await page.goto("/admin");
  // The browser sends the session cookie; the API request context does not resend Secure cookies over http.
  const created = await page.evaluate(async (name) => {
    const response = await fetch("/api/classes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    return { status: response.status, data: await response.json() };
  }, `Family class ${suffix}`);
  expect(created.status).toBe(201);
  const classId = created.data.class.id;
  await page.getByRole("button", { name: "Import families (CSV)", exact: true }).click();
  const panel = page.getByRole("region", { name: "Import families (CSV)" });
  await expect(panel.getByRole("link", { name: "Download the family CSV template" })).toHaveAttribute("download", "family-import-template.csv");
  const file = panel.getByLabel("Family list (CSV file)");

  await file.setInputFiles({ name: "broken.csv", mimeType: "text/csv", buffer: Buffer.from(`student name,parent name,parent email\nGood ${suffix},Parent ${suffix},good-${suffix}@example.com\nBad ${suffix},Parent,not-an-email\n`) });
  await panel.getByRole("button", { name: "Upload and create accounts" }).click();
  await expect(panel.getByRole("list", { name: "Rows to fix" })).toContainText("Line 3:");
  expect(fixture((db) => db.prepare("SELECT count(*) AS n FROM students WHERE display_name = ?").get(`Good ${suffix}`) as { n: number }).n).toBe(0);

  const parentEmail = `farida-${suffix}@example.com`;
  await file.setInputFiles({ name: "families.csv", mimeType: "text/csv", buffer: Buffer.from(`﻿Student,Parent,E-mail\r\nMaya ${suffix},Farida ${suffix},${parentEmail}\r\nArif ${suffix},Farida ${suffix},${parentEmail}\r\nNadia ${suffix},Karim ${suffix},karim-${suffix}@example.com\r\n`) });
  await panel.getByLabel("Also add the students to a class (optional)").selectOption(classId);
  await panel.getByRole("button", { name: "Upload and create accounts" }).click();
  await expect(panel.getByRole("status")).toHaveText(`3 student accounts and 2 new parent accounts created. The students were added to Family class ${suffix}.`);

  const family = panel.getByRole("region", { name: `Family of Farida ${suffix}` });
  await expect(family).toContainText(parentEmail);
  await expect(family.getByRole("row")).toHaveCount(3, { timeout: 5000 });
  const parentPassword = await family.locator("dd code").nth(1).innerText();
  expect(parentPassword).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{2}$/);
  const mayaRow = family.getByRole("row").filter({ hasText: `Maya ${suffix}` });
  const mayaUsername = await mayaRow.locator("code").first().innerText();
  const mayaPassword = await mayaRow.locator("code").nth(1).innerText();
  await expect(panel.getByRole("region", { name: `Family of Karim ${suffix}` })).toContainText(`Nadia ${suffix}`);

  // Printed, only the sheet shows and every family gets a titled page of its own, so a page handed out shows one family only.
  await page.emulateMedia({ media: "print" });
  const groups = page.locator(".family-sheet .family-sheet-group");
  expect(await groups.evaluateAll((items) => items.map((item) => getComputedStyle(item).breakAfter))).toEqual(["page", "auto"]);
  await expect(groups.first().locator(".family-sheet-print-title")).toBeVisible();
  await expect(groups.first().getByRole("row").filter({ hasText: `Maya ${suffix}` })).toBeVisible();
  await expect(page.getByRole("button", { name: "Print sign-in sheet" })).toBeHidden();
  await page.emulateMedia({ media: "screen" });

  // On a phone each child's details stack, so the temporary password is in full view, not off the edge of the card.
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 375, height: 800 });
  const passwordBox = await family.locator("tbody tr").filter({ hasText: `Maya ${suffix}` }).locator("code").nth(1).boundingBox();
  const familyBox = await family.boundingBox();
  expect(passwordBox && familyBox ? passwordBox.x + passwordBox.width <= familyBox.x + familyBox.width : false).toBe(true);
  await expect(family.locator("tbody tr").filter({ hasText: `Maya ${suffix}` }).locator("td").nth(2)).toHaveAttribute("data-label", /Temporary password/);
  if (viewport) await page.setViewportSize(viewport);

  const [download] = await Promise.all([page.waitForEvent("download"), panel.getByRole("button", { name: "Download sign-in sheet" }).click()]);
  expect(download.suggestedFilename()).toBe("family-sign-in-sheet.csv");
  const sheet = await readFile(await download.path(), "utf8");
  expect(sheet).toContain(`"Maya ${suffix}","${mayaUsername}","${mayaPassword}","Farida ${suffix}","${parentEmail}","${parentPassword}"`);

  // The new parent and the students are linked, approved, in the class, and must change their passwords.
  fixture((db) => {
    const parent = db.prepare("SELECT id, role, approval_status, must_change_password FROM adults WHERE email = ?").get(parentEmail) as { id: string; role: string; approval_status: string; must_change_password: number };
    expect([parent.role, parent.approval_status, parent.must_change_password]).toEqual(["parent", "approved", 1]);
    const children = db.prepare("SELECT s.display_name AS name FROM parent_student_links l JOIN students s ON s.id = l.student_id WHERE l.parent_id = ? ORDER BY s.display_name").all(parent.id) as { name: string }[];
    expect(children.map((child) => child.name)).toEqual([`Arif ${suffix}`, `Maya ${suffix}`]);
    expect((db.prepare("SELECT count(*) AS n FROM student_class_enrollments WHERE class_id = ? AND active = 1").get(classId) as { n: number }).n).toBe(3);
  });

  // The sheet is the only copy of the passwords: leaving the page asks first.
  const prompts: string[] = [];
  page.on("dialog", (dialog) => { prompts.push(dialog.message()); void dialog.dismiss(); });
  await page.getByRole("navigation", { name: "Portal navigation" }).getByRole("link", { name: "Class allocation" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  expect(prompts.some((prompt) => prompt.includes("cannot be shown again"))).toBe(true);
  await expect(family).toBeVisible();
});

test("a teacher adds two students to a class by ticking them", async ({ page }) => {
  test.setTimeout(90000);
  const suffix = randomUUID().slice(0, 8);
  const tag = `tick${suffix}`;
  for (const [username, displayName] of [[`${tag}.one`, `Tick One ${tag}`], [`${tag}.two`, `Tick Two ${tag}`], [`${tag}.three`, `Tick Three ${tag}`]]) {
    await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `families-${username}` });
    expect((await page.request.post("/api/student/sign-up", { data: { username, displayName, password } })).status()).toBe(201);
  }
  await page.context().clearCookies();
  fixture((db) => db.prepare("UPDATE students SET approval_status = 'approved' WHERE username LIKE ?").run(`${tag}.%`));
  await signUpAs(page, `families-teacher-${suffix}@example.com`, "Ticking Teacher", "teacher");

  const className = `Ticked class ${suffix}`;
  await page.goto("/teach");
  await page.getByLabel("New class name").fill(className);
  await page.getByRole("button", { name: "Create class", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(className) }).click();

  const panel = page.getByRole("region", { name: "Allocate students" });
  await panel.getByRole("searchbox", { name: "Find students" }).fill(tag);
  const choices = panel.getByRole("list", { name: "Students you can add" });
  await expect(choices.getByRole("checkbox")).toHaveCount(3);
  await choices.getByRole("checkbox", { name: new RegExp(`Tick One ${tag}`) }).check();
  await choices.getByRole("checkbox", { name: new RegExp(`Tick Three ${tag}`) }).check();
  await panel.getByRole("button", { name: "Add selected (2)", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("2 students added to this class.");

  const allocated = page.locator(".family-link-list");
  await expect(allocated).toContainText(`${tag}.one`);
  await expect(allocated).toContainText(`${tag}.three`);
  await expect(allocated).not.toContainText(`${tag}.two`);
  await expect(choices.getByRole("checkbox")).toHaveCount(1);
  await expect(choices).toContainText(`Tick Two ${tag}`);
  await expect(panel.getByRole("button", { name: "Add selected (0)", exact: true })).toBeDisabled();

  // Select all shown, in Bangla.
  await page.getByRole("button", { name: "বাংলা", exact: true }).first().click();
  const bangla = page.getByRole("region", { name: "শিক্ষার্থী বরাদ্দ" });
  await expect(bangla.getByRole("list", { name: "যাদের যোগ করা যায়" }).getByRole("checkbox")).toHaveCount(1);
  await bangla.getByRole("button", { name: "দেখানো সবাইকে বাছাই" }).click();
  await bangla.getByRole("button", { name: "বাছাই করাদের যোগ করুন (১)" }).click();
  await expect(bangla.getByRole("status")).toHaveText("১ জন শিক্ষার্থী এই ক্লাসে যোগ হয়েছে।");
  await expect(allocated).toContainText(`${tag}.two`);
});
