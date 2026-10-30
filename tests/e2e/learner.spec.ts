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

test("Bangla mode reaches the tab title and labels on signed-in pages, including the worksheet, book and adventure pages", async ({ page }) => {
  await page.goto("/alphabet");
  await expect(page).toHaveTitle("Bornomala — the Bangla alphabet | Bangla Adventures");
  await page.locator(".portal-topbar").getByRole("button", { name: "বাংলা", exact: true }).click();
  await expect(page).toHaveTitle("বর্ণমালা — বাংলা বর্ণ | Bangla Adventures");
  // The hub's own header is hidden inside the portal, but its label still follows the language.
  await expect(page.locator(".explore-header nav")).toHaveAttribute("aria-label", "বিভাগ");
  await expect(page.getByRole("button", { name: /^স আর ক মিলে স্ক।/ })).toBeVisible();

  // Server-rendered pages take the language from the portal around them.
  await page.goto("/worksheets");
  await expect(page).toHaveTitle("প্রিন্ট করার ওয়ার্কশিট | Bangla Adventures");
  await expect(page.locator(".adult-header nav")).toHaveAttribute("aria-label", "প্ল্যাটফর্মের তথ্য");
  await expect(page.getByRole("heading", { level: 1, name: "প্রতিটি পাঠের জন্য একটি প্রিন্ট করার ওয়ার্কশিট।" })).toBeVisible();
  await page.goto("/books");
  await expect(page).toHaveTitle("এনসিটিবি Book Bridge | Bangla Adventures");
  await expect(page.getByRole("region", { name: "এনসিটিবি যাচাইয়ের সারাংশ" })).toBeVisible();
  await page.locator(".portal-topbar").getByRole("button", { name: "English", exact: true }).click();
  await expect(page).toHaveTitle("NCTB Book Bridge | Bangla Adventures");
  await expect(page.getByRole("navigation", { name: "Book Bridge navigation" })).toBeVisible();
  await expect(page.getByRole("region", { name: "NCTB audit summary" })).toBeVisible();

  // The adventure page has its own switch.
  await page.goto("/adventure");
  await page.locator(".language-switch").getByRole("button", { name: "বাংলা", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "মূল মেনু" })).toBeVisible();
  await expect(page.locator(".language-switch")).toHaveAttribute("aria-label", "ভাষা");
  await expect(page.getByRole("img", { name: "হাসিখুশি বাঘ আর বাংলাদেশের চেনা জায়গাসহ নদীর রঙিন ছবির মানচিত্র" })).toBeVisible();
});

// Students now see only approved topics, so the draft notices are gone; the textbook sources stay.
test("approved topics appear by category without draft notices", async ({ page }) => {
  await page.goto("/topics");
  await expect(page.getByRole("region", { name: "Our country — symbols, rivers & nature" }).getByRole("button", { name: /Symbols of Bangladesh/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "History & the national story" }).getByRole("button", { name: /Symbols of Bangladesh/ })).toHaveCount(0);
  await expect(page.getByText(/Candidate content — review mode/i)).toHaveCount(0);
  await page.getByRole("button", { name: /Ekushey — the day a language was defended/i }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Ekushey/ })).toBeVisible();
  await expect(page.getByText(/Draft for educator review/i)).toHaveCount(0);
  await expect(page.getByText(/This topic is linked to these NCTB government textbooks/i)).toBeVisible();
});
