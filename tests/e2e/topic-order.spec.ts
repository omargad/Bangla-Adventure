import { test, expect } from "@playwright/test";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { browserApi, createFixtureAccount } from "./helpers/content-fixtures";

function fixture(callback: (db: Database.Database) => void) {
  if (!process.env.BANGLA_E2E_DB?.includes("bangla-e2e-")) throw new Error("An isolated E2E database is required.");
  const db = new Database(process.env.BANGLA_E2E_DB);
  try { callback(db); } finally { db.close(); }
}

test("topic choices vary, retain selection when language changes, and save canonical indexes on both attempts", async ({ page, browser, baseURL }, testInfo) => {
  const suffix = randomUUID().slice(0, 8), password = "Topic-order-fixture-password";
  const username = `topic-order-${suffix}`;
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `topic-order-${suffix}` });
  await page.context().addCookies([{ name: "ba_language", value: "en", url: baseURL! }]);
  const pair = (en: string, bn: string) => ({ en, bn });
  const questions = ["A", "B", "C"].map((letter) => ({
    question: pair(`Choose the correct ${letter}.`, `${letter}-এর সঠিক উত্তর বেছে নাও।`),
    options: [pair(`Correct ${letter}`, `সঠিক ${letter}`), pair(`Other ${letter}`, `অন্য ${letter}`), pair(`Third ${letter}`, `তৃতীয় ${letter}`)],
    answer: 0,
  }));
  // The reviewer and learner have independent cookies throughout the scenario.
  const admin = await createFixtureAccount(browser, baseURL, "admin", "TopicOrder");
  let topicId: string;
  try {
    const response = await browserApi(admin.page, "POST", "/api/topics", {
      theme: "our-country", emoji: "🌊", title: pair(`Topic order ${suffix}`, `বিষয়ের উত্তর ${suffix}`), tagline: pair("Three practice questions.", "তিনটি অনুশীলনের প্রশ্ন।"), minutes: 2,
      sections: [{ heading: pair("Practice", "অনুশীলন"), body: pair("Choose the correct option for each question.", "প্রতিটি প্রশ্নের সঠিক উত্তর বেছে নাও।") }], funFacts: [], quiz: questions,
    });
    expect(response.status).toBe(201);
    topicId = response.body.topicId as string;
    expect((await browserApi(admin.page, "POST", `/api/topics/${topicId}/versions/1`, { decision: "approve", confirmedRead: true })).status).toBe(200);
  } finally { await admin.context.close(); }
  expect((await page.request.post("/api/student/sign-up", { data: { username, displayName: "Topic order learner", password } })).status()).toBe(201);
  fixture((db) => { db.prepare("UPDATE students SET approval_status='approved' WHERE username=?").run(username); });
  expect((await page.request.post("/api/student/sign-in", { data: { username, password } })).status()).toBe(200);
  await page.goto(`/topics?topic=${topicId}`);
  const fieldsets = page.locator(".topic-question");
  await expect(fieldsets).toHaveCount(3);
  const initialOrder = await fieldsets.nth(0).locator(".topic-option").allTextContents();
  for (let question = 0; question < 3; question += 1) await fieldsets.nth(question).locator(".topic-option").first().click();
  const firstSubmission = page.waitForRequest((request) => request.url().endsWith("/api/student/topic-progress") && request.method() === "POST");
  await page.getByRole("button", { name: "Check my answers", exact: true }).click();
  const firstAnswers = (await firstSubmission).postDataJSON().answers as number[];
  expect(firstAnswers.filter((answer) => answer === 0)).toHaveLength(1);
  await expect(page.getByRole("status").filter({ hasText: "You got 1 out of 3!" })).toBeVisible();
  await expect(page.getByText("Your best so far: 1 out of 3", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(fieldsets.nth(0).locator(".topic-option").first()).not.toHaveText(initialOrder[0]);
  const retryOrder = await fieldsets.nth(0).locator(".topic-option").allTextContents();
  expect(retryOrder).not.toEqual(initialOrder);
  for (let question = 0; question < 3; question += 1) await fieldsets.nth(question).getByRole("button", { name: `Correct ${["A", "B", "C"][question]}`, exact: true }).click();
  const selectedPositions = await fieldsets.evaluateAll((sets) => sets.map((set) => Array.from(set.querySelectorAll(".topic-option")).findIndex((option) => option.getAttribute("aria-pressed") === "true")));
  await page.locator(".portal-topbar").getByRole("button", { name: "বাংলা", exact: true }).click();
  for (let question = 0; question < 3; question += 1) await expect(fieldsets.nth(question).getByRole("button", { name: `সঠিক ${["A", "B", "C"][question]}`, exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(await fieldsets.evaluateAll((sets) => sets.map((set) => Array.from(set.querySelectorAll(".topic-option")).findIndex((option) => option.getAttribute("aria-pressed") === "true")))).toEqual(selectedPositions);
  const secondSubmission = page.waitForRequest((request) => request.url().endsWith("/api/student/topic-progress") && request.method() === "POST");
  await page.getByRole("button", { name: "উত্তর মিলিয়ে দেখো", exact: true }).click();
  expect((await secondSubmission).postDataJSON().answers).toEqual([0, 0, 0]);
  await expect(page.getByText("এ পর্যন্ত তোমার সেরা: ৩টির মধ্যে ৩টি", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("topic-options-bangla-results.jpg"), fullPage: true });
  await page.reload();
  await expect(page.getByText("এ পর্যন্ত তোমার সেরা: ৩টির মধ্যে ৩টি", { exact: true })).toBeVisible();
});
