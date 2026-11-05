import { test, expect } from "@playwright/test";
import { lessons } from "../../app/curriculum";
import { getLessonBanglaCopy, lessonSupportModels } from "../../app/lesson-locales";
import { createFixtureAccount } from "./helpers/content-fixtures";

test("an approved learner snapshot shows Bangla scaffolds in every session and the complete written number reference", async ({ browser, baseURL }, testInfo) => {
  const { context, page } = await createFixtureAccount(browser, baseURL, "student", "LocalizedLesson");
  const copy = getLessonBanglaCopy("numbers-colours")!;
  try {
    await page.goto("/adventure");
    await page.getByRole("button", { name: "বাংলা", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "bn");
    await page.goto("/adventure?module=numbers-colours");
    const lesson = page.getByRole("dialog");
    await expect(lesson.locator(".module-overview-banner p")).toHaveText(copy.lesson.summary);
    await expect(lesson.locator(".module-overview-banner p")).toHaveAttribute("lang", "bn");
    await expect(lesson.locator(".family-mission")).toContainText(copy.lesson.familyMission);
    const tabs = lesson.getByRole("navigation", { name: "পাঠের অংশ" });

    await tabs.getByRole("button", { name: /শুনি$/ }).click();
    await expect(lesson.locator(".session-check h4")).toHaveText(copy.extension.listening.check.prompt);
    await expect(lesson.locator(".session-check h4")).toHaveAttribute("lang", "bn");
    await expect(lesson.getByText(copy.extension.listening.focus, { exact: true })).toBeVisible();

    await tabs.getByRole("button", { name: /পড়ি$/ }).click();
    const reference = lesson.getByRole("region", { name: lessonSupportModels["numbers-colours"].title.bn });
    await expect(reference.locator("dt")).toHaveCount(14);
    await expect(reference).toContainText("দশ");
    await expect(reference).toContainText("হলুদ");
    await expect(reference.getByRole("button")).toHaveCount(0);
    await expect(lesson.getByText(copy.lesson.teaching[0].body, { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("bangla-numbers-written-reference.jpg"), fullPage: true });

    await tabs.getByRole("button", { name: /বলি$/ }).click();
    await expect(lesson.getByText(copy.extension.speaking.mission, { exact: true })).toHaveAttribute("lang", "bn");
    await expect(lesson.getByText(copy.extension.speaking.roleA, { exact: true })).toBeVisible();

    await tabs.getByRole("button", { name: /লিখি$/ }).click();
    await expect(lesson.getByText(copy.extension.writing.mission, { exact: true })).toHaveAttribute("lang", "bn");
    await expect(lesson.getByText(copy.lesson.practice[0].instruction, { exact: true })).toBeVisible();

    await tabs.getByRole("button", { name: /দেখি$/ }).click();
    await expect(lesson.getByText(copy.lesson.culture.body, { exact: true })).toHaveAttribute("lang", "bn");
    await expect(lesson.getByText(copy.extension.watch.before, { exact: true })).toBeVisible();
    await expect(lesson.locator(".playlist-card")).toHaveCount(0);
    await expect(lesson.locator("iframe")).toHaveCount(0);

    await tabs.getByRole("button", { name: /যাচাই$/ }).click();
    await expect(lesson.locator(".lesson-quiz-question legend span").nth(1)).toHaveText(copy.lesson.quiz[0].question);
    await expect(lesson.locator(".lesson-quiz-question legend span").nth(1)).toHaveAttribute("lang", "bn");
  } finally { await context.close(); }
});

test("changing a staff preview language keeps canonical answer selection and exposes translated advanced notes", async ({ browser, baseURL }, testInfo) => {
  const { context, page } = await createFixtureAccount(browser, baseURL, "admin", "PreviewLocalization");
  try {
    await page.goto("/studio?lesson=numbers-colours");
    const preview = page.getByRole("region", { name: "Student view preview", exact: true });
    const language = preview.getByRole("group", { name: "Preview language" });
    await language.getByRole("button", { name: "বাংলা", exact: true }).click();
    await preview.getByRole("navigation", { name: "পাঠের অংশ" }).getByRole("button", { name: /যাচাই$/ }).click();
    const canonical = lessons.find(({ id }) => id === "numbers-colours")!;
    const answer = canonical.quiz[0].answer;
    await preview.locator(".lesson-quiz-question").first().getByRole("button").nth(answer).click();
    await language.getByRole("button", { name: "English", exact: true }).click();
    await expect(preview.locator(".lesson-quiz-question").first().getByRole("button").nth(answer)).toHaveAttribute("aria-pressed", "true");
    await expect(preview.locator(".lesson-quiz-question legend").first()).toContainText(canonical.quiz[0].question);

    await page.goto("/studio?lesson=language-movement");
    await page.getByRole("region", { name: "Student view preview", exact: true }).getByRole("group", { name: "Preview language" }).getByRole("button", { name: "বাংলা", exact: true }).click();
    const advanced = page.getByRole("region", { name: "Student view preview", exact: true });
    await advanced.getByRole("navigation", { name: "পাঠের অংশ" }).getByRole("button", { name: /দেখি$/ }).click();
    await expect(advanced.getByText(getLessonBanglaCopy("language-movement")!.extension.watch.segment, { exact: true })).toBeVisible();
    await expect(advanced.locator(".media-review-note")).toContainText("প্রশাসকেরা ভিডিও প্রকাশের সিদ্ধান্ত নেন");
    await page.screenshot({ path: testInfo.outputPath("bangla-advanced-media-guidance.jpg"), fullPage: true });
  } finally { await context.close(); }
});
