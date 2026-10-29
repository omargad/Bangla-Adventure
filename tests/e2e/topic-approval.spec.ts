import { test, expect, type Browser } from "@playwright/test";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

const password = "Topic-approval-password-2026";

/** A signed-in browser for an approved teacher. */
async function teacher(browser: Browser, baseURL: string | undefined, name: string, suffix: string) {
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": `${name}-${suffix}` } });
  const email = `${name}-${suffix}@example.com`;
  expect((await context.request.post("/api/auth/sign-up", { data: { email, displayName: `${name} ${suffix}`, password } })).status()).toBe(201);
  if (!process.env.BANGLA_E2E_DB?.includes("bangla-e2e-")) throw new Error("Isolated test database required.");
  const fixture = new Database(process.env.BANGLA_E2E_DB);
  fixture.prepare("UPDATE adults SET role = 'teacher', teacher_status = 'approved' WHERE email = ?").run(email);
  fixture.close();
  return context;
}

test("a teacher writes a bilingual topic, another previews it in Bangla and approves it, and a student's quiz counts", async ({ browser, baseURL }) => {
  test.setTimeout(120000);
  const suffix = randomUUID().slice(0, 8);
  const title = `Tea gardens ${suffix}`, titleBn = `সিলেটের চা-বাগান ${suffix}`;
  const authorContext = await teacher(browser, baseURL, "author", suffix);
  const reviewerContext = await teacher(browser, baseURL, "reviewer", suffix);
  const studentContext = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": `topic-student-${suffix}` } });
  try {
    const author = await authorContext.newPage(), reviewer = await reviewerContext.newPage(), student = await studentContext.newPage();
    for (const page of [author, reviewer, student]) page.setDefaultTimeout(15000);

    await author.goto("/teach");
    await author.getByRole("navigation", { name: "Portal navigation" }).getByRole("link", { name: "Lessons & topics", exact: true }).click();
    await expect(author).toHaveURL(/\/teach\/topics$/);
    // The topic list loads after the page is interactive.
    await expect(author.getByRole("region", { name: "Waiting for approval" })).toBeVisible();
    await author.getByRole("button", { name: /New topic/ }).click();
    await author.getByRole("combobox", { name: "Category", exact: true }).selectOption("our-country");
    await author.getByLabel("Card emoji", { exact: true }).fill("🍵");
    await author.getByLabel("Title (English)", { exact: true }).fill(title);
    await author.getByLabel("Title (Bangla)", { exact: true }).fill(titleBn);
    await author.getByLabel("Short introduction (English)", { exact: true }).fill("Green hills where tea grows.");
    await author.getByLabel("Short introduction (Bangla)", { exact: true }).fill("সবুজ পাহাড়ে চা জন্মায়।");
    await author.getByLabel("Section 1 heading (English)", { exact: true }).fill("Rows of tea");
    await author.getByLabel("Section 1 heading (Bangla)", { exact: true }).fill("সারি সারি চা-গাছ");
    await author.getByLabel("Section 1 text (English)", { exact: true }).fill("Tea bushes grow on the green hills of Sylhet.");
    await author.getByLabel("Section 1 text (Bangla)", { exact: true }).fill("সিলেটের সবুজ পাহাড়ে চা-গাছ জন্মায়।");
    await author.getByRole("button", { name: /Add a quiz question/ }).click();
    await author.getByLabel("Question 1 (English)", { exact: true }).fill("Where do the tea gardens grow?");
    await author.getByLabel("Question 1 (Bangla)", { exact: true }).fill("চা-বাগান কোথায় জন্মায়?");
    await author.getByLabel("Question 1 answer 1 (English)", { exact: true }).fill("In the sea");
    await author.getByLabel("Question 1 answer 1 (Bangla)", { exact: true }).fill("সমুদ্রে");
    await author.getByLabel("Question 1 answer 2 (English)", { exact: true }).fill("On the hills");
    await author.getByLabel("Question 1 answer 2 (Bangla)", { exact: true }).fill("পাহাড়ে");
    await author.getByRole("radio", { name: "Question 1: answer 2 is correct", exact: true }).check();
    await author.getByRole("button", { name: "Save and send for approval", exact: true }).click();
    await expect(author.getByRole("status").filter({ hasText: "Students will not see it until" })).toBeVisible();

    // The waiting topic is invisible to students.
    expect((await studentContext.request.post("/api/student/sign-up", { data: { username: `tea-${suffix}`, displayName: "Tea learner", password } })).status()).toBe(201);
    await student.goto("/topics");
    await expect(student.getByRole("button", { name: /Symbols of Bangladesh/ })).toBeVisible();
    await expect(student.getByRole("button", { name: new RegExp(title) })).toHaveCount(0);

    await reviewer.goto("/teach/topics");
    await reviewer.getByRole("region", { name: "Waiting for approval" }).getByRole("button", { name: `Preview & review: ${title}`, exact: true }).click();
    await expect(reviewer.getByRole("heading", { level: 1, name: title, exact: true })).toBeVisible();
    await reviewer.getByRole("group", { name: "Preview language" }).getByRole("button", { name: "বাংলা", exact: true }).click();
    await expect(reviewer.getByRole("heading", { level: 1, name: titleBn, exact: true })).toBeVisible();
    await expect(reviewer.getByText("সিলেটের সবুজ পাহাড়ে চা-গাছ জন্মায়।", { exact: true })).toBeVisible();
    await reviewer.getByRole("group", { name: "Preview language" }).getByRole("button", { name: "Side by side", exact: true }).click();
    await expect(reviewer.getByRole("heading", { level: 2, name: title, exact: true })).toBeVisible();
    await expect(reviewer.getByRole("heading", { level: 2, name: titleBn, exact: true })).toBeVisible();
    const approve = reviewer.getByRole("button", { name: "Approve and publish to students", exact: true });
    await expect(approve).toBeDisabled();
    await reviewer.getByRole("checkbox", { name: "I have read the whole lesson in English and Bangla" }).check();
    await approve.click();
    await expect(reviewer.getByRole("status").filter({ hasText: "Approved. Students now see" })).toBeVisible();
    await expect(reviewer.getByRole("region", { name: "Version history" })).toContainText(`reviewer ${suffix}`);

    const topicsRead = student.locator(".workspace-stats div").filter({ hasText: "Topics read" }).locator("strong");
    await student.goto("/student");
    await expect(topicsRead).toHaveText(/^0 \/ \d+$/);
    await expect(student.getByRole("region", { name: "Our country — symbols, rivers & nature" }).getByRole("heading", { name: title, exact: true })).toBeVisible();
    await student.goto("/topics");
    const category = student.getByRole("region", { name: "Our country — symbols, rivers & nature" });
    await category.getByRole("button", { name: new RegExp(title) }).click();
    await expect(student.getByRole("heading", { level: 1, name: title, exact: true })).toBeVisible();
    await student.getByRole("button", { name: "On the hills", exact: true }).click();
    await student.getByRole("button", { name: "Check my answers", exact: true }).click();
    await expect(student.getByText("You got 1 out of 1!", { exact: true })).toBeVisible();
    await expect(student.getByText(/Saved\. This topic now counts as read/)).toBeVisible();
    await student.goto("/student");
    await expect(topicsRead).toHaveText(/^1 \/ \d+$/);
  } finally {
    await authorContext.close().catch(() => undefined);
    await reviewerContext.close().catch(() => undefined);
    await studentContext.close().catch(() => undefined);
  }
});
