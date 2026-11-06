import { test, expect, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { browserApi } from "./helpers/content-fixtures";

function fixture<T>(callback: (db: Database.Database) => T): T {
  if (!process.env.BANGLA_E2E_DB?.includes("bangla-e2e-")) throw new Error("An isolated E2E database is required.");
  const db = new Database(process.env.BANGLA_E2E_DB);
  try { return callback(db); } finally { db.close(); }
}

/** A signed-in, approved student in a class with an open activity and a closed one already done. */
async function studentInClass(page: Page, suffix: string) {
  const username = `integrity-${suffix}`, password = "Learner-integrity-password";
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `integrity-${suffix}` });
  expect((await page.request.post("/api/student/sign-up", { data: { username, displayName: `Integrity ${suffix}`, password } })).status()).toBe(201);
  const questions = [
    { prompt: "Which month starts the Bengali year?", options: ["Poush", "Boishakh"], answer: 1 },
    { prompt: "What do shops open on Pohela Boishakh?", options: ["Halkhata", "Umbrellas"], answer: 0 },
  ];
  const ids = fixture((db) => {
    const studentId = (db.prepare("UPDATE students SET approval_status='approved' WHERE username=? RETURNING id").get(username) as { id: string }).id;
    const teacherId = `teacher-${suffix}`, classId = `class-${suffix}`, rosterId = `roster-${suffix}`;
    db.prepare("INSERT INTO adults (id, email, display_name, password_hash, role, teacher_status, approval_status) VALUES (?, ?, 'Integrity Teacher', 'fixture', 'teacher', 'approved', 'approved')").run(teacherId, `${teacherId}@example.com`);
    db.prepare("INSERT INTO classes (id, teacher_id, name, join_code) VALUES (?, ?, ?, ?)").run(classId, teacherId, `Integrity class ${suffix}`, suffix.slice(0, 6).toUpperCase());
    db.prepare("INSERT INTO class_students (id, class_id, display_name, token_hash) VALUES (?, ?, 'Integrity', ?)").run(rosterId, classId, `token-${suffix}`);
    db.prepare("INSERT INTO student_class_enrollments (id, student_id, class_id, class_student_id) VALUES (?, ?, ?, ?)").run(`enrol-${suffix}`, studentId, classId, rosterId);
    const insert = db.prepare("INSERT INTO class_activities (id, class_id, title, questions_json, status, approval_status, created_at) VALUES (?, ?, ?, ?, ?, 'approved', ?)");
    insert.run(`open-${suffix}`, classId, `Open festival quiz ${suffix}`, JSON.stringify(questions), "open", "2026-11-02 10:00:00");
    insert.run(`closed-${suffix}`, classId, `Closed river quiz ${suffix}`, JSON.stringify(questions), "closed", "2026-11-01 10:00:00");
    db.prepare("INSERT INTO activity_submissions (id, activity_id, student_id, answers_json, score, total) VALUES (?, ?, ?, '[1,1]', 1, 2)").run(`done-${suffix}`, `closed-${suffix}`, rosterId);
    return { openId: `open-${suffix}` };
  });
  expect((await page.request.post("/api/student/sign-in", { data: { username, password } })).status()).toBe(200);
  return ids;
}

test("a class activity is handed in once, shows its answers then, and closed work says it is closed", async ({ page }) => {
  const suffix = randomUUID().slice(0, 8);
  const { openId } = await studentInClass(page, suffix);
  await page.goto("/student?section=activities");
  const closed = page.getByRole("button", { name: new RegExp(`Closed river quiz ${suffix}`) });
  await expect(closed).toBeDisabled();
  await expect(closed).toContainText("Closed · Your result: 1/2");

  const open = page.getByRole("button", { name: new RegExp(`Open festival quiz ${suffix}`) });
  await expect(open).toContainText("Start activity");
  await open.click();
  await page.getByRole("radio", { name: "Poush", exact: true }).check();
  await page.getByRole("radio", { name: "Halkhata", exact: true }).check();
  await page.getByRole("button", { name: "Submit answers", exact: true }).click();
  await expect(page.getByRole("heading", { name: "You got 1 out of 2.", exact: true })).toBeVisible();
  const review = page.getByRole("list", { name: "Your answers" });
  await expect(review).toContainText("Your answer: Poush · Correct answer: Boishakh");
  await expect(review).toContainText("Right: Halkhata");

  // A second hand-in is refused and the saved score stays.
  const again = await browserApi(page, "POST", "/api/student/submit", { activityId: openId, answers: [1, 0] });
  expect(again.status).toBe(409);
  expect(again.body.alreadySubmitted).toBe(true);
  expect(again.body.review).toBeUndefined();
  expect(fixture((db) => db.prepare("SELECT score FROM activity_submissions WHERE activity_id = ?").get(openId))).toEqual({ score: 1 });

  await page.getByRole("button", { name: "Back to activities", exact: true }).click();
  await expect(open).toContainText("Submitted · Result: 1/2");
  await open.click();
  await expect(page.getByRole("button", { name: "Submit answers", exact: true })).toHaveCount(0);
  await expect(page.getByText(/You handed this in on .+\. Your first answers are kept/)).toBeVisible();
  await expect(page.getByText("Each activity is handed in once. Ask your teacher if you need another try.", { exact: true })).toBeVisible();
});

test("learner pages show a signed-in student their own way home and the right wording", async ({ page }) => {
  const suffix = randomUUID().slice(0, 8);
  await studentInClass(page, suffix);
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.goto("/learn");
  await expect(page.locator(".learn-card").filter({ hasText: "The 18 lessons" })).toHaveAttribute("href", "/adventure");
  const classroom = page.locator(".learn-card").filter({ hasText: "My classroom" });
  await expect(classroom).toHaveAttribute("href", "/student?section=activities");
  await expect(classroom).not.toContainText("code");
  await page.getByRole("link", { name: "Guided language practice", exact: true }).click();
  await page.waitForURL("**/adventure");
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => scrollY)).toBeLessThan(100);

  const header = page.locator(".site-header");
  await expect(header.getByRole("link", { name: "My Learning", exact: true })).toHaveAttribute("href", "/student");
  for (const name of ["Student login", "Teacher sign in", "Grown-up sign in"]) await expect(header.getByRole("link", { name, exact: true })).toHaveCount(0);
  await expect(page.locator(".path-class")).toContainText("Do your class activities and see your results.");
  await expect(page.locator(".path-class")).toHaveAttribute("href", "/student?section=activities");

  await page.goto("/practice");
  await expect(page.getByText(/kept on this device only\. Topics you read, your topic quiz scores and your class activity results are saved to your account/)).toBeVisible();

  // The page's own header (hidden inside the portal frame, which has its own navigation) links home by role too.
  for (const path of ["/worksheets", "/worksheets/hello-me"]) {
    await page.goto(path);
    const nav = page.locator(".adult-header nav");
    await expect(nav.locator('a[href="/student"]'), path).toHaveText("My Learning");
    await expect(nav.locator('a[href="/family"]'), path).toHaveCount(0);
  }

  await page.goto("/books");
  await expect(page.getByText("Curriculum documents", { exact: true })).toBeVisible();
  await expect(page.getByText(/educator evidence room|educator-review gate/i)).toHaveCount(0);
});

test("topic quiz answers stay on the server for every reader", async ({ page }) => {
  const suffix = randomUUID().slice(0, 8);
  await studentInClass(page, suffix);
  await page.goto("/topics");
  const catalog = await browserApi(page, "GET", "/api/curriculum");
  expect(catalog.status).toBe(200);
  const topic = (catalog.body.topics as Array<{ id: string; quiz: unknown[] }>).find((item) => item.quiz.length > 0)!;
  expect(JSON.stringify(catalog.body)).not.toContain('"answer"');
  await page.goto(`/topics?topic=${topic.id}`);
  const questions = page.locator(".topic-question");
  await expect(questions).toHaveCount(topic.quiz.length);
  for (let index = 0; index < topic.quiz.length; index += 1) await questions.nth(index).locator(".topic-option").first().click();
  const marked = page.waitForResponse((response) => response.url().endsWith("/api/student/topic-progress"));
  await page.getByRole("button", { name: "Check my answers", exact: true }).click();
  const { quiz } = await (await marked).json();
  expect(quiz.correct).toHaveLength(topic.quiz.length);
  await expect(page.getByRole("status").filter({ hasText: `You got ${quiz.score} out of ${quiz.total}!` })).toBeVisible();
  await expect(page.locator(".topic-question-mark")).toHaveCount(topic.quiz.length);
  // A wrong pick is marked wrong, but the right option is not revealed.
  await expect(page.locator(".topic-option.is-right")).toHaveCount(quiz.score);
});
