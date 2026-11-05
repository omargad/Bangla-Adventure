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

/** Provision staff in the isolated fixture; content approval uses the actual application. */
async function staff(browser: Browser, baseURL: string | undefined, name: string, suffix: string, role: "teacher" | "admin" = "teacher") {
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": `${name}-${suffix}` } });
  const email = `${name}-${suffix}@example.com`;
  expect((await context.request.post("/api/auth/sign-up", { data: { email, displayName: `${name} ${suffix}`, password } })).status()).toBe(201);
  fixture("UPDATE adults SET role = ?, teacher_status = ?, approval_status = 'approved' WHERE email = ?", role, role === "teacher" ? "approved" : "none", email);
  expect((await context.request.post("/api/auth/sign-in", { data: { email, password } })).status()).toBe(200);
  return context;
}

test("a teacher submits a bilingual topic, a separate administrator publishes it, and a student's quiz counts", async ({ browser, baseURL }) => {
  test.setTimeout(120000);
  const suffix = randomUUID().slice(0, 8);
  const title = `Tea gardens ${suffix}`, titleBn = `সিলেটের চা-বাগান ${suffix}`;
  const authorContext = await staff(browser, baseURL, "author", suffix);
  const reviewerContext = await staff(browser, baseURL, "reviewer", suffix, "admin");
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
    await author.getByRole("button", { name: "Submit for administrator review", exact: true }).click();
    await expect(author.getByRole("status").filter({ hasText: "Students will not see this version until an administrator approves it." })).toBeVisible();
    await expect(author.getByRole("region", { name: "Version history" })).toBeVisible();
    await expect(author.getByRole("button", { name: "Approve and publish to students", exact: true })).toHaveCount(0);
    await expect(author.getByRole("button", { name: "Send back to the author", exact: true })).toHaveCount(0);
    const submittedId = new URL(author.url()).searchParams.get("topic")!;
    expect((await api(author, "GET", "/api/auth/session")).body).toMatchObject({ authenticated: true, role: "teacher" });
    const deniedApproval = await api(author, "POST", `/api/topics/${submittedId}/versions/1`, { decision: "approve", confirmedRead: true });
    expect(deniedApproval.status).toBe(403);
    expect(deniedApproval.body.error).toBe("Administrator access required.");

    // The waiting topic is invisible to students.
    expect((await studentContext.request.post("/api/student/sign-up", { data: { username: `tea-${suffix}`, displayName: "Tea learner", password } })).status()).toBe(201);
    fixture("UPDATE students SET approval_status = 'approved' WHERE username = ?", `tea-${suffix}`);
    expect((await studentContext.request.post("/api/student/sign-in", { data: { username: `tea-${suffix}`, password } })).status()).toBe(200);
    await student.goto("/topics");
    await expect(student.getByRole("button", { name: /Symbols of Bangladesh/ })).toBeVisible();
    await expect(student.getByRole("button", { name: new RegExp(title) })).toHaveCount(0);

    await reviewer.goto("/admin");
    await reviewer.getByRole("navigation", { name: "Portal navigation" }).getByRole("link", { name: "Topics", exact: true }).click();
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
    await reviewer.getByRole("checkbox", { name: "I have read the whole topic, including its quiz, in English and Bangla" }).check();
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
  const authorContext = await staff(browser, baseURL, "editor", suffix);
  const reviewerContext = await staff(browser, baseURL, "checker", suffix, "admin");
  try {
    const author = await authorContext.newPage(), reviewer = await reviewerContext.newPage();
    const page = author;
    for (const each of [author, reviewer]) { each.setDefaultTimeout(15000); await each.goto("/teach"); }
    const { topic } = (await api(author, "GET", `/api/topics/${id}`)).body;
    const approvedTitle = topic.approved.content.title.en, minutes = topic.approved.content.minutes;
    const saved = await api(author, "PUT", `/api/topics/${id}`, { ...topic.head.content, title: { ...topic.head.content.title, en: wrongTitle }, baseVersion: topic.head.version });
    expect(saved.status).toBe(200);
    const rejected = saved.body.version;
    await reviewer.goto(`/teach/topics?topic=${id}&version=${rejected}`);
    await reviewer.getByLabel("Note for the author (needed to send it back)").fill("This title is wrong.");
    await reviewer.getByRole("button", { name: "Send back to the author", exact: true }).click();
    await expect(reviewer.getByRole("status").filter({ hasText: "Sent back to the author" })).toBeVisible();

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

    await page.getByRole("button", { name: "Submit for administrator review", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Students will not see this version until" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve and publish to students", exact: true })).toHaveCount(0);
    const changes = page.getByRole("region", { name: "What changed" });
    await expect(changes).toContainText(`Reading time: ${minutes} → ${minutes + 2} minutes`);
    await expect(changes).not.toContainText("Title (English) changed");
    await expect(page.getByRole("region", { name: "Student view preview" }).getByRole("heading", { level: 1, name: approvedTitle, exact: true })).toBeVisible();

    // Leave the topic as students already see it.
    const waiting = (await api(page, "GET", `/api/topics/${id}`)).body.topic.head.version;
    expect((await api(reviewer, "POST", `/api/topics/${id}/versions/${waiting}`, { decision: "reject", note: "Test clean-up." })).status).toBe(200);
  } finally {
    await authorContext.close().catch(() => undefined);
    await reviewerContext.close().catch(() => undefined);
  }
});

test("only an administrator can withdraw and restore a teacher's approved topic", async ({ browser, baseURL }) => {
  test.setTimeout(90000);
  const suffix = randomUUID().slice(0, 8);
  const title = `Rivers of Bengal ${suffix}`;
  const teacherContext = await staff(browser, baseURL, "topic-author", suffix);
  const adminContext = await staff(browser, baseURL, "withdrawer", suffix, "admin");
  const studentContext = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": `withdraw-student-${suffix}` } });
  try {
    const author = await teacherContext.newPage(), page = await adminContext.newPage(), student = await studentContext.newPage();
    for (const each of [author, page, student]) each.setDefaultTimeout(15000);
    await author.goto("/teach");
    await page.goto("/admin");
    const pair = (en: string, bn: string) => ({ en, bn });
    const created = await api(author, "POST", "/api/topics", {
      theme: "our-country", emoji: "🌊", title: pair(title, `বাংলার নদী ${suffix}`), tagline: pair("Rivers everywhere.", "সবখানে নদী।"), minutes: 3,
      sections: [{ heading: pair("Many rivers", "অনেক নদী"), body: pair("Bengal has many rivers.", "বাংলায় অনেক নদী আছে।") }], funFacts: [], quiz: [],
    });
    expect(created.status).toBe(201);
    const id = created.body.topicId;
    expect((await api(page, "POST", `/api/topics/${id}/versions/1`, { decision: "approve", confirmedRead: true })).status).toBe(200);
    await author.goto(`/teach/topics?topic=${id}`);
    await expect(author.getByRole("region", { name: "Version history" })).toBeVisible();
    await expect(author.getByRole("button", { name: "Withdraw from students", exact: true })).toHaveCount(0);
    expect((await api(author, "POST", `/api/topics/${id}`, { decision: "withdraw", note: "Teacher cannot withdraw." })).status).toBe(403);

    expect((await studentContext.request.post("/api/student/sign-up", { data: { username: `river-${suffix}`, displayName: "River learner", password } })).status()).toBe(201);
    fixture("UPDATE students SET approval_status = 'approved' WHERE username = ?", `river-${suffix}`);
    expect((await studentContext.request.post("/api/student/sign-in", { data: { username: `river-${suffix}`, password } })).status()).toBe(200);
    await student.goto("/topics");
    await expect(student.getByRole("button", { name: new RegExp(title) })).toBeVisible();

    await page.goto(`/teach/topics?topic=${id}`);
    const decision = page.getByRole("region", { name: "Your decision" });
    const withdraw = decision.getByRole("button", { name: "Withdraw from students", exact: true });
    await expect(withdraw).toBeDisabled();
    await decision.getByLabel(/Why are you withdrawing it/).fill("A river is named wrongly.");
    await withdraw.click();
    await expect(page.getByRole("status").filter({ hasText: "Withdrawn. Students and parents no longer see this topic." })).toBeVisible();
    await expect(page.getByRole("region", { name: "Version details" })).toContainText("Withdrawn · hidden from students");

    await student.goto("/topics");
    await expect(student.getByRole("button", { name: /Symbols of Bangladesh/ })).toBeVisible();
    await expect(student.getByRole("button", { name: new RegExp(title) })).toHaveCount(0);
    await author.reload();
    await expect(author.getByRole("region", { name: "Version details" })).toContainText("Withdrawn · hidden from students");
    await expect(author.getByRole("button", { name: "Approve again and show to students", exact: true })).toHaveCount(0);
    expect((await api(author, "POST", `/api/topics/${id}`, { decision: "approve", confirmedRead: true })).status).toBe(403);

    const again = decision.getByRole("button", { name: "Approve again and show to students", exact: true });
    await expect(again).toBeDisabled();
    await decision.getByRole("checkbox", { name: "I have read the whole topic, including its quiz, in English and Bangla" }).check();
    await again.click();
    await expect(page.getByRole("status").filter({ hasText: "Approved again." })).toBeVisible();
    await expect(page.getByRole("region", { name: "Version history" })).toContainText("Withdrawn from students");
    await student.goto("/topics");
    await expect(student.getByRole("button", { name: new RegExp(title) })).toBeVisible();
  } finally {
    await teacherContext.close().catch(() => undefined);
    await adminContext.close().catch(() => undefined);
    await studentContext.close().catch(() => undefined);
  }
});
