import { test, expect } from "@playwright/test";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

test.beforeEach(async ({ page, context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": `learner-test-${randomUUID()}` });
  const username = `learner-${randomUUID().slice(0, 12)}`, password = "Learning-test-password";
  const response = await page.request.post("/api/student/sign-up", { data: { username, displayName: "Learning test", password } });
  expect(response.status()).toBe(201);
  // Self sign-ups wait for an administrator: approve directly, then sign in.
  if (!process.env.BANGLA_E2E_DB?.includes("bangla-e2e-")) throw new Error("An isolated E2E database is required.");
  const db = new Database(process.env.BANGLA_E2E_DB);
  db.prepare("UPDATE students SET approval_status = 'approved' WHERE username = ?").run(username);
  db.close();
  expect((await page.request.post("/api/student/sign-in", { data: { username, password } })).status()).toBe(200);
});

for (const width of [1366, 390]) {
  test(`student sidebar exposes learning topics directly at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/student");
    const openMenu = async () => {
      if (width < 650) {
        await page.getByRole("button", { name: "Menu", exact: true }).click();
        await expect(page.locator(".portal-sidebar")).toHaveCSS("left", "0px");
      }
    };
    await openMenu();
    const navigation = page.getByRole("navigation", { name: "Portal navigation" });
    await expect(navigation.getByRole("link", { name: "Learning topics", exact: true })).toHaveCount(1);
    await navigation.getByRole("link", { name: "Learning topics", exact: true }).click();
    await expect(page).toHaveURL(/\/topics$/);
    await openMenu();
    await expect(navigation.getByRole("link", { name: "Learning topics", exact: true })).toHaveAttribute("aria-current", "page");
    await navigation.getByRole("link", { name: "Sources & references", exact: true }).click();
    await expect(page).toHaveURL(/\/references$/);
    await openMenu();
    await expect(navigation.getByRole("link", { name: "Learning topics", exact: true })).toHaveCount(1);
    await navigation.getByRole("link", { name: "My Learning", exact: true }).click();
    await expect(page).toHaveURL(/\/student$/);
    await page.reload();
    await openMenu();
    await expect(navigation.getByRole("link", { name: "Learning topics", exact: true })).toBeVisible();
  });
}

test("student home refresh stays in My Learning and guided practice remains available", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/student$/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "My Learning", exact: true })).toBeVisible();
  await page.goto("/adventure");
  await expect(page.getByRole("button", { name: /Start|শুরু/ }).first()).toBeVisible();
});

test("the learn hub lists the activity cards and they navigate", async ({ page }) => {
  await page.goto("/learn");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("link", { name: /Bornomala|alphabet/i }).first().click();
  await expect(page).toHaveURL(/\/alphabet/);
  await expect(page.getByText("স্বরবর্ণ").first()).toBeVisible();
});

test("alphabet shows vowels, consonants and conjuncts", async ({ page }) => {
  await page.goto("/alphabet");
  await expect(page.getByRole("heading", { name: /যুক্তবর্ণ/ })).toBeVisible();
  await expect(page.getByText("অজগর").first()).toBeVisible();
});

test("the counting game reveals the answer after a pick", async ({ page }) => {
  await page.goto("/numbers");
  const options = page.locator(".counting-option");
  await expect(options.first()).toBeVisible();
  await options.first().click();
  await expect(page.locator(".counting-result")).toBeVisible();
});

test("a story can be opened and paged to its question", async ({ page }) => {
  await page.goto("/stories");
  await page.locator(".story-card").first().click();
  await expect(page.locator(".story-page")).toBeVisible();
  // Page through to the comprehension question.
  for (let i = 0; i < 5; i += 1) {
    const next = page.getByRole("button", { name: /Next page|Question time|পরের পাতা|প্রশ্নের পালা/ });
    if (await next.isVisible().catch(() => false)) {
      await next.click();
    } else {
      break;
    }
  }
  await expect(page.locator(".counting-question")).toBeVisible();
});

test("language toggle switches an activity page to Bangla", async ({ page }) => {
  await page.goto("/phrasebook");
  await page.locator(".portal-topbar").getByRole("button", { name: "বাংলা", exact: true }).click();
  await expect(page.locator(".portal-topbar").getByRole("button", { name: "English", exact: true })).toBeVisible();
});

test("topic prototypes disclose their draft review status", async ({ page }) => {
  await page.goto("/topics");
  await expect(page.getByText(/Candidate content — review mode/i)).toBeVisible();
  await page.getByRole("button", { name: /Ekushey — the day a language was defended/i }).click();
  await expect(page.getByText(/Draft for educator review/i)).toBeVisible();
  await expect(page.getByText(/candidate NCTB evidence anchors/i)).toBeVisible();
});
