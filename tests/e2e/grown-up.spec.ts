import { test, expect } from "@playwright/test";
import Database from "better-sqlite3";

// A unique email per run so repeated runs don't collide on the account table.
function uniqueEmail() {
  return `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

test("visiting a guarded page redirects to grown-up sign in", async ({ page }) => {
  await page.goto("/family");
  await expect(page).toHaveURL(/\/grown-ups/);
  await expect(page.getByRole("tab", { name: /Sign in/ })).toBeVisible();
});

test("a grown-up can create an account and reach the dashboard once an administrator approves it", async ({ page }) => {
  const address = uniqueEmail();
  await page.goto("/grown-ups");
  await page.getByRole("tab", { name: /Create account/ }).click();
  await page.getByLabel(/Your name/).fill("E2E Parent");
  await page.getByLabel("Email").fill(address);
  await page.getByLabel(/Password/).fill("e2e-strong-password");
  await page.getByRole("button", { name: /Create account/ }).click();

  // Sign-up shows the one-time recovery codes; the account then waits for an administrator.
  await expect(page.getByRole("heading", { name: "Save your recovery codes" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "waiting for an administrator to approve it" })).toBeVisible();
  await page.getByRole("button", { name: /saved them/i }).click();
  await page.getByLabel("Email").fill(address);
  await page.getByLabel("Password", { exact: true }).fill("e2e-strong-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".auth-error")).toContainText("waiting for an administrator to approve it");

  if (!process.env.BANGLA_E2E_DB?.includes("bangla-e2e-")) throw new Error("An isolated E2E database is required.");
  const db = new Database(process.env.BANGLA_E2E_DB);
  db.prepare("UPDATE adults SET approval_status = 'approved' WHERE email = ?").run(address);
  db.close();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await expect(page).toHaveURL(/\/family/);
  // No child is linked yet, so the heading does not say "child" or "children".
  await expect(page.getByRole("heading", { level: 1, name: "Learning records" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No children linked yet" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create learner profile" })).toHaveCount(0);
  // Parents get no link to the staff lesson review.
  await expect(page.locator("a[href=\"/studio\"]")).toHaveCount(0);
});

test("health endpoint responds ok", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.status).toBe("ok");
});
