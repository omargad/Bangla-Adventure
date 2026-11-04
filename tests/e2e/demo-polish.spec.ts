import { test, expect, request as apiRequest, type APIRequestContext } from "@playwright/test";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

const password = "Demo-regression-password-2026";

function fixture<T>(callback: (db: Database.Database) => T): T {
  if (!process.env.BANGLA_E2E_DB?.includes("bangla-e2e-")) throw new Error("An isolated E2E database is required.");
  const db = new Database(process.env.BANGLA_E2E_DB);
  try { return callback(db); } finally { db.close(); }
}

// Setup requests need an explicit Secure session cookie on the local HTTP server.
async function signIn(api: APIRequestContext, kind: "auth" | "student", data: Record<string, string>, device: string) {
  const response = await api.post(`/api/${kind}/sign-in`, { data, headers: { "x-forwarded-for": device } });
  expect(response.status()).toBe(200);
  const cookie = response.headersArray().find((header) => header.name.toLowerCase() === "set-cookie" && /^ba_(adult|student)_session=/.test(header.value));
  expect(cookie).toBeDefined();
  return { cookie: cookie!.value.split(";")[0] };
}

test("connected four-role demo preserves quiz scores and keeps gradebook summaries visible", async ({ page, browser, baseURL }, testInfo) => {
  test.setTimeout(180000);
  const suffix = randomUUID().slice(0, 8);
  const teacherEmail = `demo-polish-${suffix}@example.com`;
  const parentEmail = `demo-parent-${suffix}@example.com`, adminEmail = `demo-admin-${suffix}@example.com`;
  const username = `demo.${suffix}`, displayName = `Demo Learner ${suffix}`;
  const className = `Demo regression ${suffix}`;
  const activityTitle = `Bengali New Year ${suffix}`;
  const previousTitle = `Previous vocabulary ${suffix}`;
  const announcement = `Our Bengali New Year celebration is on Friday. Please practise the festival words together at home. ${suffix}`;
  const pending = {
    teacher: { email: `demo-laila-${suffix}@example.com`, displayName: `Laila Rahman ${suffix}` },
    parent: { email: `demo-nusrat-${suffix}@example.com`, displayName: `Nusrat Khan ${suffix}` },
    student: { username: `demo.samira.${suffix}`, displayName: `Samira Khan ${suffix}` },
  };
  const questions = [
    { prompt: "Which month starts the Bengali year?", options: ["Boishakh", "Poush"], answer: 0 },
    { prompt: "What do shops open on Pohela Boishakh?", options: ["Halkhata", "Umbrellas"], answer: 0 },
  ];
  let classId = "", activityId = "", previousId = "", originalQuestions = "";
  const api = await apiRequest.newContext({ baseURL });
  try {
    expect((await api.post("/api/auth/sign-up", { data: { email: teacherEmail, displayName: "Demo Regression Teacher", password }, headers: { "x-forwarded-for": `demo-teacher-${suffix}` } })).status()).toBe(201);
    fixture((db) => db.prepare("UPDATE adults SET role = 'teacher', teacher_status = 'approved', approval_status = 'approved' WHERE email = ?").run(teacherEmail));
    for (const [role, email, name] of [["parent", parentEmail, "Demo Learner's Parent"], ["admin", adminEmail, "Demo Administrator"]]) {
      expect((await api.post("/api/auth/sign-up", { data: { email, displayName: name, password }, headers: { "x-forwarded-for": `demo-${role}-${suffix}` } })).status()).toBe(201);
      fixture((db) => db.prepare("UPDATE adults SET role = ?, approval_status = 'approved' WHERE email = ?").run(role, email));
    }
    const teacher = await signIn(api, "auth", { email: teacherEmail, password }, `demo-teacher-${suffix}`);
    const createdClass = await api.post("/api/classes", { headers: teacher, data: { name: className } });
    expect(createdClass.status()).toBe(201);
    classId = (await createdClass.json()).class.id;
    const activityIds: string[] = [];
    // Enough activities to overflow the gradebook; summaries must still be visible at its start.
    for (const title of [activityTitle, previousTitle, "Weather vocabulary", "Counting practice"]) {
      const created = await api.post(`/api/classes/${classId}/activities`, { headers: teacher, data: { title, questions } });
      expect(created.status()).toBe(201);
      activityIds.push((await created.json()).activity.id);
    }
    [activityId, previousId] = activityIds;
    originalQuestions = fixture((db) => (db.prepare("SELECT questions_json FROM class_activities WHERE id = ?").get(activityId) as { questions_json: string }).questions_json);
    expect((await api.post("/api/student/sign-up", { data: { username, displayName, password }, headers: { "x-forwarded-for": `demo-student-${suffix}` } })).status()).toBe(201);
    const studentId = fixture((db) => {
      db.prepare("UPDATE students SET approval_status = 'approved' WHERE username = ?").run(username);
      return (db.prepare("SELECT id FROM students WHERE username = ?").get(username) as { id: string }).id;
    });
    expect((await api.post(`/api/classes/${classId}/students`, { headers: teacher, data: { studentIds: [studentId] } })).status()).toBe(200);
    expect((await api.put(`/api/classes/${classId}/attendance`, { headers: teacher, data: { date: new Date().toISOString().slice(0, 10), marks: [{ studentId, present: true }] } })).status()).toBe(200);
    expect((await api.post(`/api/classes/${classId}/announcements`, { headers: teacher, data: { body: announcement, audience: "all" } })).status()).toBe(201);
    const admin = await signIn(api, "auth", { email: adminEmail, password }, `demo-admin-${suffix}`);
    expect((await api.post("/api/admin/family-links", { headers: admin, data: { studentId, parentEmail, confirmed: true } })).status()).toBe(200);
    // Normal registrations stay pending, ready for the administrator's approval demonstration.
    for (const role of ["teacher", "parent"] as const) {
      expect((await api.post("/api/auth/sign-up", { data: { ...pending[role], password, accountType: role }, headers: { "x-forwarded-for": `demo-pending-${role}-${suffix}` } })).status()).toBe(201);
    }
    expect((await api.post("/api/student/sign-up", { data: { ...pending.student, password }, headers: { "x-forwarded-for": `demo-pending-student-${suffix}` } })).status()).toBe(201);
    const student = await signIn(api, "student", { username, password }, `demo-student-${suffix}`);
    expect((await api.post("/api/student/submit", { headers: { ...student, "x-forwarded-for": `demo-student-${suffix}` }, data: { activityId: previousId, answers: [0, 1] } })).status()).toBe(200);
  } finally {
    await api.dispose();
  }

  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `demo-student-ui-${suffix}` });
  await page.goto("/student");
  await expect(page).toHaveTitle("Student login | Bangla Adventures");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My Learning", exact: true })).toBeVisible();
  await expect(page).toHaveTitle("My Learning | Bangla Adventures");
  const nav = page.getByRole("navigation", { name: "Portal navigation" });
  await nav.getByRole("button", { name: "My activities", exact: true }).click();
  await expect(page).toHaveTitle("My activities | Bangla Adventures");
  await expect(page.getByRole("region", { name: "Class announcements", exact: true })).toContainText(announcement);
  const openActivity = () => page.getByRole("button", { name: new RegExp(`^${activityTitle}`) }).click();
  await openActivity();
  const groups = questions.map((question, index) => page.getByRole("group", { name: `${index + 1}. ${question.prompt}`, exact: true }));
  const choiceOrder = async () => Promise.all(groups.map((group) => group.getByRole("radio").evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).labels?.[0]?.textContent?.trim()))));
  await expect(groups[0].getByRole("radio")).toHaveCount(2);
  const firstOrder = await choiceOrder();
  expect(firstOrder[0]).toEqual(expect.arrayContaining(questions[0].options));
  expect(firstOrder[1]).toEqual(expect.arrayContaining(questions[1].options));
  // Correct first-authored answers cannot both occupy the first displayed position.
  expect([firstOrder[0].indexOf("Boishakh"), firstOrder[1].indexOf("Halkhata")].sort()).toEqual([0, 1]);
  await page.getByRole("button", { name: "Back to activities", exact: true }).click();
  await openActivity();
  await expect(groups[0].getByRole("radio")).toHaveCount(2);
  expect(await choiceOrder()).toEqual(firstOrder);
  await page.getByRole("radio", { name: "Boishakh", exact: true }).check();
  await page.getByRole("radio", { name: "Halkhata", exact: true }).check();
  await page.getByRole("button", { name: "Submit answers", exact: true }).click();
  await expect(page.getByRole("heading", { name: "You got 2 out of 2.", exact: true })).toBeVisible();
  fixture((db) => {
    const current = db.prepare("SELECT answers_json, score, total FROM activity_submissions WHERE activity_id = ?").get(activityId) as { answers_json: string; score: number; total: number };
    expect(JSON.parse(current.answers_json)).toEqual([0, 0]);
    expect({ score: current.score, total: current.total }).toEqual({ score: 2, total: 2 });
    expect(db.prepare("SELECT questions_json FROM class_activities WHERE id = ?").get(activityId)).toEqual({ questions_json: originalQuestions });
    expect(db.prepare("SELECT score, total FROM activity_submissions WHERE activity_id = ?").get(previousId)).toEqual({ score: 1, total: 2 });
  });
  await nav.getByRole("button", { name: "My results", exact: true }).click();
  await expect(page).toHaveTitle("My results | Bangla Adventures");
  await expect(page.getByRole("row").filter({ hasText: activityTitle })).toContainText("2/2");
  await expect(page.getByRole("row").filter({ hasText: previousTitle })).toContainText("1/2");
  await page.screenshot({ path: testInfo.outputPath("student-results.png"), fullPage: true });

  const teacherContext = await browser.newContext({ baseURL, viewport: { width: 1366, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": `demo-teacher-ui-${suffix}` } });
  try {
    const teacherPage = await teacherContext.newPage();
    expect((await teacherPage.request.post("/api/auth/sign-in", { data: { email: teacherEmail, password } })).status()).toBe(200);
    await teacherPage.goto("/teach");
    await teacherPage.getByLabel("Find a class").fill(suffix);
    await teacherPage.getByRole("button", { name: new RegExp(className) }).click();
    await teacherPage.getByRole("navigation", { name: "Portal navigation" }).getByRole("button", { name: "Results", exact: true }).click();
    const gradebook = teacherPage.getByRole("region", { name: "Gradebook", exact: true });
    const studentRow = gradebook.getByRole("row").filter({ hasText: displayName });
    await expect(studentRow.getByRole("cell").nth(0)).toHaveText("2/4");
    await expect(studentRow.getByRole("cell").nth(1)).toHaveText("75%");
    await expect(studentRow.getByRole("cell").nth(2)).toHaveText("1 of 1");
    const bounds = await gradebook.evaluate((element) => ({ left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right, scrollLeft: element.scrollLeft }));
    expect(bounds.scrollLeft).toBe(0);
    for (const name of ["Done", "Average", "Attendance"]) {
      const header = gradebook.getByRole("columnheader", { name, exact: true });
      await expect(header).toBeVisible();
      const box = await header.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(bounds.left);
      expect(box!.x + box!.width).toBeLessThanOrEqual(bounds.right);
    }
    await teacherPage.screenshot({ path: testInfo.outputPath("teacher-gradebook-desktop.png"), fullPage: true });
  } finally {
    await teacherContext.close();
  }

  const parentContext = await browser.newContext({ baseURL, viewport: { width: 1366, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": `demo-parent-ui-${suffix}` } });
  try {
    const parentPage = await parentContext.newPage();
    expect((await parentPage.request.post("/api/auth/sign-in", { data: { email: parentEmail, password } })).status()).toBe(200);
    await parentPage.goto("/family");
    await expect(parentPage.getByRole("heading", { name: "Your child's learning", exact: true })).toBeVisible();
    const child = parentPage.getByRole("region", { name: displayName, exact: true });
    await expect(parentPage.locator(".parent-child")).toHaveCount(1);
    await expect(child.getByRole("heading", { name: className, exact: true })).toBeVisible();
    await expect(child).toContainText("Average result: 75%");
    await expect(child).toContainText("Activities submitted: 2 / 4");
    await expect(child).toContainText("Attendance: Attended 1 of 1 class");
    const results = child.getByRole("table", { name: `${className} learning results`, exact: true });
    await expect(results.getByRole("row")).toHaveCount(5);
    await expect(results.getByRole("row").filter({ hasText: activityTitle })).toContainText("2 / 2");
    await expect(results.getByRole("row").filter({ hasText: previousTitle })).toContainText("1 / 2");
    for (const title of ["Weather vocabulary", "Counting practice"]) {
      const unfinished = results.getByRole("row").filter({ hasText: title });
      await expect(unfinished).toContainText("To do");
      await expect(unfinished.getByRole("cell").nth(2)).toHaveText("—");
    }
    await expect(parentPage.getByRole("region", { name: "Announcements", exact: true })).toContainText(announcement);
    await expect(parentPage.locator("input[type=password], .credential-sheet")).toHaveCount(0);
    await parentPage.screenshot({ path: testInfo.outputPath("parent-learning-records.png"), fullPage: true });
    await child.screenshot({ path: testInfo.outputPath("parent-class-results.png") });
  } finally {
    await parentContext.close();
  }

  const adminContext = await browser.newContext({ baseURL, viewport: { width: 1366, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": `demo-admin-ui-${suffix}` } });
  try {
    const adminPage = await adminContext.newPage();
    expect((await adminPage.request.post("/api/auth/sign-in", { data: { email: adminEmail, password } })).status()).toBe(200);
    await adminPage.goto("/admin");
    await expect(adminPage.getByRole("heading", { name: "People make the adventure", exact: true })).toBeVisible();
    const queue = adminPage.getByRole("region", { name: /Waiting for approval/ });
    const teacherApplicant = queue.getByRole("listitem").filter({ hasText: pending.teacher.email });
    await expect(teacherApplicant).toContainText("Teacher request");
    await expect(queue.getByRole("listitem").filter({ hasText: pending.parent.email })).toContainText("Parent");
    await expect(queue.getByRole("listitem").filter({ hasText: pending.student.username })).toContainText("Student");
    await expect(adminPage.locator("input[type=password], .credential-sheet")).toHaveCount(0);
    await queue.screenshot({ path: testInfo.outputPath("admin-pending-applicants.png") });
    await teacherApplicant.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(adminPage.getByRole("status").filter({ hasText: `${pending.teacher.displayName} is approved as a teacher` })).toBeVisible();
    await expect(teacherApplicant).toHaveCount(0);
    fixture((db) => {
      expect(db.prepare("SELECT role, approval_status, teacher_status FROM adults WHERE email = ?").get(pending.teacher.email)).toEqual({ role: "teacher", approval_status: "approved", teacher_status: "approved" });
      expect(db.prepare("SELECT approval_status FROM adults WHERE email = ?").get(pending.parent.email)).toEqual({ approval_status: "pending" });
      expect(db.prepare("SELECT approval_status FROM students WHERE username = ?").get(pending.student.username)).toEqual({ approval_status: "pending" });
    });
  } finally {
    await adminContext.close();
  }
});
