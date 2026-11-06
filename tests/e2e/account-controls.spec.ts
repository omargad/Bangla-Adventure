import { test, expect, type Browser, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

const password = "Account-controls-password-2026";

function fixture<T>(callback: (db: Database.Database) => T): T {
  if (!process.env.BANGLA_E2E_DB?.includes("bangla-e2e-")) throw new Error("An isolated E2E database is required.");
  const db = new Database(process.env.BANGLA_E2E_DB);
  try { return callback(db); } finally { db.close(); }
}

async function newPage(browser: Browser, baseURL: string | undefined) {
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": `account-controls-${randomUUID()}` } });
  return { context, page: await context.newPage() };
}

/** A self sign-up approved directly, with the role given, as an administrator would. */
async function adult(page: Page, role: "parent" | "teacher" | "admin", displayName: string) {
  const email = `controls-${role}-${randomUUID().slice(0, 8)}@example.com`;
  expect((await page.request.post("/api/auth/sign-up", { data: { email, displayName, password } })).status()).toBe(201);
  fixture((db) => db.prepare("UPDATE adults SET role = ?, teacher_status = ?, approval_status = 'approved' WHERE email = ?").run(role, role === "teacher" ? "approved" : "none", email));
  return email;
}

/** What a same-origin request from the page answers, sent by the browser with its cookies. */
async function call(page: Page, url: string, method = "GET", body?: object) {
  return page.evaluate(async ([url, method, body]) => {
    const response = await fetch(url as string, { method: method as string, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json().catch(() => null) };
  }, [url, method, body] as const);
}

const cookie = async (page: Page, name: string) => (await page.context().cookies()).find((item) => item.name === name)?.value ?? "";

test("a suspended account is told so after the right password, and only then", async ({ page }) => {
  const email = await adult(page, "parent", "Suspended Parent");
  fixture((db) => db.prepare("UPDATE adults SET status = 'suspended' WHERE email = ?").run(email));
  const wrong = await page.request.post("/api/auth/sign-in", { data: { email, password: "not-the-password-1" } });
  expect(wrong.status()).toBe(401);
  expect((await wrong.json()).error).toBe("That email and password do not match.");
  const right = await page.request.post("/api/auth/sign-in", { data: { email, password } });
  expect(right.status()).toBe(403);
  expect(await right.json()).toEqual({ error: "This account is suspended. Please contact the administrator.", errorBn: "এই অ্যাকাউন্টটি স্থগিত আছে। অনুগ্রহ করে প্রশাসকের সঙ্গে যোগাযোগ করুন।", accountStatus: "suspended" });

  await page.goto("/grown-ups");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("This account is suspended. Please contact the administrator.")).toBeVisible();

  const username = `paused-${randomUUID().slice(0, 8)}`;
  expect((await page.request.post("/api/student/sign-up", { data: { username, displayName: "Paused Child", password } })).status()).toBe(201);
  fixture((db) => db.prepare("UPDATE students SET status = 'suspended', approval_status = 'approved' WHERE username = ?").run(username));
  expect((await page.request.post("/api/student/sign-in", { data: { username, password: "wrong-password" } })).status()).toBe(401);
  const child = await page.request.post("/api/student/sign-in", { data: { username, password } });
  expect(child.status()).toBe(403);
  expect((await child.json()).errorBn).toBe("এই অ্যাকাউন্টটি স্থগিত আছে। বড়দের কাউকে প্রশাসকের সঙ্গে যোগাযোগ করতে বলো।");
});

test("signing in again ends the session the browser held before", async ({ page, baseURL }) => {
  const first = await adult(page, "parent", "First Parent");
  const second = await adult(page, "parent", "Second Parent");
  expect((await page.request.post("/api/auth/sign-in", { data: { email: first, password } })).status()).toBe(200);
  await page.goto("/account");
  const firstToken = await cookie(page, "ba_adult_session");
  expect(firstToken).not.toBe("");
  const sessionWith = async (token: string) => (await (await fetch(`${baseURL}/api/auth/session`, { headers: { cookie: `ba_adult_session=${token}` } })).json()).authenticated;
  expect(await sessionWith(firstToken)).toBe(true);

  // The page signs in as someone else, as the sign-in form does; the browser sends the old cookie with it.
  expect((await call(page, "/api/auth/sign-in", "POST", { email: second, password })).status).toBe(200);
  const secondToken = await cookie(page, "ba_adult_session");
  expect(secondToken).not.toBe(firstToken);
  expect(await sessionWith(firstToken)).toBe(false);
  expect(await sessionWith(secondToken)).toBe(true);
  expect(fixture((db) => db.prepare("SELECT count(*) AS n FROM adult_sessions s JOIN adults a ON a.id = s.adult_id WHERE a.email = ?").get(first) as { n: number }).n).toBe(0);
});

test("a teacher with a class cannot delete the account, and the account page says what the export holds", async ({ page }) => {
  const email = await adult(page, "teacher", "Teaching Teacher");
  expect((await page.request.post("/api/auth/sign-in", { data: { email, password } })).status()).toBe(200);
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Your data", exact: true })).toBeVisible();
  await expect(page.getByText(/the names of the classes you teach/)).toBeVisible();
  await expect(page.getByText(/ask an administrator to move them to another teacher first/)).toBeVisible();
  expect((await call(page, "/api/classes", "POST", { name: "Kept class" })).status).toBe(201);

  await page.getByLabel("Current password").last().fill(password);
  await page.getByRole("textbox", { name: /to confirm/ }).fill("DELETE");
  await page.getByRole("button", { name: "Permanently delete account" }).click();
  await expect(page.locator(".account-danger").getByRole("alert")).toHaveText("You still teach classes. Ask an administrator to move them to another teacher before deleting this account.");
  expect(fixture((db) => db.prepare("SELECT count(*) AS n FROM classes c JOIN adults a ON a.id = c.teacher_id WHERE a.email = ?").get(email) as { n: number }).n).toBe(1);

  const exported = await call(page, "/api/account/export");
  expect(exported.status).toBe(200);
  expect(exported.data.classesTaught.map((item: { name: string }) => item.name)).toEqual(["Kept class"]);
  expect(exported.data.account.role).toBe("teacher");
});

test("Recent changes names each change and who made it", async ({ page, browser, baseURL }) => {
  test.setTimeout(60000);
  const parentEmail = await adult(page, "parent", "Leaving Parent");
  const adminEmail = await adult(page, "admin", "Audit Admin");
  expect((await page.request.post("/api/auth/sign-in", { data: { email: parentEmail, password } })).status()).toBe(200);
  await page.goto("/account");
  await expect(page.getByText(/the children an administrator linked to you/)).toBeVisible();
  expect((await call(page, "/api/account/delete", "POST", { password })).status).toBe(200);

  const { context, page: admin } = await newPage(browser, baseURL);
  try {
    expect((await admin.request.post("/api/auth/sign-in", { data: { email: adminEmail, password } })).status()).toBe(200);
    await admin.goto("/admin");
    await admin.getByText("Recent changes", { exact: true }).click();
    const entry = admin.locator(".audit-list li").filter({ hasText: "Account deleted by its owner" }).filter({ hasText: "Leaving Parent" }).first();
    await expect(entry).toBeVisible();
    await expect(entry).toContainText("By: Deleted account");
    await expect(admin.locator(".audit-list li").filter({ hasText: "By: " }).first()).toBeVisible();
  } finally { await context.close(); }
});
