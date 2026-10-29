import { test, expect, type Browser, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

const password = "Topic-approval-password-2026";

/** Runs a statement against the isolated test database. */
function fixture(sql: string, ...values: string[]) {
  if (!process.env.BANGLA_E2E_DB?.includes("bangla-e2e-")) throw new Error("Isolated test database required.");
  const db = new Database(process.env.BANGLA_E2E_DB);
  try { db.prepare(sql).run(...values); } finally { db.close(); }
}

/** A signed-in browser for an approved teacher. Self sign-ups wait for an administrator: approve directly, then sign in. */
async function teacher(browser: Browser, baseURL: string | undefined, name: string, suffix: string) {
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": `${name}-${suffix}` } });
  const email = `${name}-${suffix}@example.com`;
  expect((await context.request.post("/api/auth/sign-up", { data: { email, displayName: `${name} ${suffix}`, password } })).status()).toBe(201);
  fixture("UPDATE adults SET role = 'teacher', teacher_status = 'approved', approval_status = 'approved' WHERE email = ?", email);
  expect((await context.request.post("/api/auth/sign-in", { data: { email, password } })).status()).toBe(200);
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
    await author.getByRole("navigation", { name: "Portal navigation" }).getByRole("link", { name: "Topics", exact: true }).click();
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
    fixture("UPDATE students SET approval_status = 'approved' WHERE username = ?", `tea-${suffix}`);
    expect((await studentContext.request.post("/api/student/sign-in", { data: { username: `tea-${suffix}`, password } })).status()).toBe(200);
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

/** A JSON API call made by the signed-in page, so its session cookie is sent. */
async function api(page: Page, method: string, url: string, data?: unknown) {
  return page.evaluate(async ({ method, url, data }) => {
    const response = await fetch(url, { method, headers: data ? { "Content-Type": "application/json" } : {}, body: data ? JSON.stringify(data) : undefined });
    return { status: response.status, body: await response.json() };
  }, { method, url, data });
}

test("after an edit is sent back, the next editor starts from the approved version and can switch to the sent-back one", async ({ browser, baseURL }) => {
  test.setTimeout(90000);
  const suffix = randomUUID().slice(0, 8);
  const id = "ethnic-communities", wrongTitle = `A wrong title ${suffix}`;
  const authorContext = await teacher(browser, baseURL, "editor", suffix);
  const reviewerContext = await teacher(browser, baseURL, "checker", suffix);
  try {
    const author = await authorContext.newPage(), page = await reviewerContext.newPage();
    for (const each of [author, page]) { each.setDefaultTimeout(15000); await each.goto("/teach"); }
    const { topic } = (await api(author, "GET", `/api/topics/${id}`)).body;
    const approvedTitle = topic.approved.content.title.en, minutes = topic.approved.content.minutes;
    const saved = await api(author, "PUT", `/api/topics/${id}`, { ...topic.head.content, title: { ...topic.head.content.title, en: wrongTitle }, baseVersion: topic.head.version });
    expect(saved.status).toBe(200);
    const rejected = saved.body.version;
    expect((await api(page, "POST", `/api/topics/${id}/versions/${rejected}`, { decision: "reject", note: "This title is wrong." })).status).toBe(200);

    await page.goto(`/teach/topics?edit=${id}`);
    const title = page.getByLabel("Title (English)", { exact: true });
    await expect(page.getByRole("note")).toContainText(`Version ${rejected} was sent back by checker ${suffix}: This title is wrong.`);
    await expect(title).toHaveValue(approvedTitle);
    await page.getByRole("button", { name: "Continue from the sent-back version instead", exact: true }).click();
    await expect(title).toHaveValue(wrongTitle);
    await page.getByRole("button", { name: "Start again from the approved version", exact: true }).click();
    await expect(title).toHaveValue(approvedTitle);

    const readingTime = page.getByLabel("Reading time (minutes)", { exact: true });
    await readingTime.fill(String(minutes + 2));
    // Switching versions asks before throwing away unsaved changes.
    page.once("dialog", (dialog) => void dialog.dismiss());
    await page.getByRole("button", { name: "Continue from the sent-back version instead", exact: true }).click();
    await expect(readingTime).toHaveValue(String(minutes + 2));
    await expect(title).toHaveValue(approvedTitle);

    await page.getByRole("button", { name: "Save and send for approval", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Students will not see it until" })).toBeVisible();
    const changes = page.getByRole("region", { name: "What changed" });
    await expect(changes).toContainText(`Reading time: ${minutes} → ${minutes + 2} minutes`);
    await expect(changes).not.toContainText("Title (English) changed");
    await expect(page.getByRole("region", { name: "Student view preview" }).getByRole("heading", { level: 1, name: approvedTitle, exact: true })).toBeVisible();

    // Leave the topic as students already see it.
    const waiting = (await api(page, "GET", `/api/topics/${id}`)).body.topic.head.version;
    expect((await api(page, "POST", `/api/topics/${id}/versions/${waiting}`, { decision: "reject", note: "Test clean-up." })).status).toBe(200);
  } finally {
    await authorContext.close().catch(() => undefined);
    await reviewerContext.close().catch(() => undefined);
  }
});
