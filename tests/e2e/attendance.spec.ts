import { test, expect, request as apiRequest, type APIRequestContext } from "@playwright/test";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

const password = "Attendance-teacher-password-2026";

function fixture<T>(callback: (db: Database.Database) => T): T {
  if (!process.env.BANGLA_E2E_DB?.includes("bangla-e2e-")) throw new Error("An isolated E2E database is required.");
  const db = new Database(process.env.BANGLA_E2E_DB);
  try { return callback(db); } finally { db.close(); }
}

// API setup sends the session cookie itself: the request context does not resend Secure cookies over http.
async function signIn(api: APIRequestContext, kind: "auth" | "student", data: Record<string, string>, device: string) {
  const response = await api.post(`/api/${kind}/sign-in`, { data, headers: { "x-forwarded-for": device } });
  expect(response.status()).toBe(200);
  const cookie = response.headersArray().find((header) => header.name.toLowerCase() === "set-cookie" && /^ba_(adult|student)_session=/.test(header.value));
  return { cookie: cookie!.value.split(";")[0] };
}

test("a teacher takes attendance with one student absent, and the gradebook shows missing work as —", async ({ page, baseURL }) => {
  test.setTimeout(120000);
  const suffix = randomUUID().slice(0, 8);
  const className = `Attendance class ${suffix}`, teacherEmail = `attendance-teacher-${suffix}@example.com`;
  const names = { maya: `Maya ${suffix}`, arif: `Arif ${suffix}`, zara: `Zara ${suffix}` };
  // Nadia joins the class after the first session is saved.
  const nadia = `Nadia ${suffix}`;
  let classId = "", nadiaId = "", teacherCookie = "";

  const api = await apiRequest.newContext({ baseURL });
  try {
    expect((await api.post("/api/auth/sign-up", { data: { email: teacherEmail, displayName: "Attendance Teacher", password }, headers: { "x-forwarded-for": `attendance-teacher-${suffix}` } })).status()).toBe(201);
    fixture((db) => db.prepare("UPDATE adults SET role = 'teacher', teacher_status = 'approved', approval_status = 'approved' WHERE email = ?").run(teacherEmail));
    const teacher = await signIn(api, "auth", { email: teacherEmail, password }, `attendance-teacher-${suffix}`);
    teacherCookie = teacher.cookie;
    const created = await api.post("/api/classes", { headers: teacher, data: { name: className } });
    expect(created.status()).toBe(201);
    classId = (await created.json()).class.id;
    const activityIds: string[] = [];
    // Three activities, so at phone width the table is wider than the screen.
    for (const title of ["Festivals check-in", "Numbers quiz", "Weather words"]) {
      const activity = await api.post(`/api/classes/${classId}/activities`, { headers: teacher, data: { title, questions: [
        { prompt: "Which month starts the Bengali year?", options: ["Boishakh", "Poush"], answer: 0 },
        { prompt: "What do shops open on Pohela Boishakh?", options: ["Halkhata", "Umbrellas"], answer: 0 },
      ] } });
      expect(activity.status()).toBe(201);
      activityIds.push((await activity.json()).activity.id);
    }
    for (const [key, displayName] of Object.entries(names)) {
      expect((await api.post("/api/student/sign-up", { data: { username: `${key}.${suffix}`, displayName, password }, headers: { "x-forwarded-for": `attendance-${key}-${suffix}` } })).status()).toBe(201);
    }
    fixture((db) => db.prepare("UPDATE students SET approval_status = 'approved' WHERE username LIKE ?").run(`%.${suffix}`));
    const studentIds = fixture((db) => db.prepare("SELECT id FROM students WHERE username LIKE ?").all(`%.${suffix}`).map((row) => (row as { id: string }).id));
    expect((await api.post(`/api/classes/${classId}/students`, { headers: teacher, data: { studentIds } })).status()).toBe(200);
    expect((await api.post("/api/student/sign-up", { data: { username: `nadia.late.${suffix}`, displayName: nadia, password }, headers: { "x-forwarded-for": `attendance-nadia-${suffix}` } })).status()).toBe(201);
    nadiaId = fixture((db) => {
      db.prepare("UPDATE students SET approval_status = 'approved' WHERE username = ?").run(`nadia.late.${suffix}`);
      return (db.prepare("SELECT id FROM students WHERE username = ?").get(`nadia.late.${suffix}`) as { id: string }).id;
    });
    // Maya submits the first activity with full marks; Zara scores zero on it; Arif submits nothing.
    for (const [key, answers] of [["maya", [0, 0]], ["zara", [1, 1]]] as const) {
      const student = await signIn(api, "student", { username: `${key}.${suffix}`, password }, `attendance-${key}-${suffix}`);
      expect((await api.post("/api/student/submit", { headers: { ...student, "x-forwarded-for": `attendance-${key}-${suffix}` }, data: { activityId: activityIds[0], answers } })).status()).toBe(200);
    }
  } finally {
    await api.dispose();
  }

  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `attendance-teacher-ui-${suffix}` });
  expect((await page.request.post("/api/auth/sign-in", { data: { email: teacherEmail, password } })).status()).toBe(200);
  const openClass = async () => {
    await page.goto("/teach");
    await page.getByLabel("Find a class").fill(suffix);
    await page.getByRole("button", { name: new RegExp(className) }).click();
    await expect(page.getByRole("heading", { name: className, level: 1 })).toBeVisible();
  };
  await openClass();
  const nav = page.getByRole("navigation", { name: "Portal navigation" });

  // The gradebook: one row per student, missing work shown as — (unlike Zara's real zero).
  await nav.getByRole("button", { name: "Results", exact: true }).click();
  const gradebook = page.getByRole("region", { name: "Gradebook" });
  await expect(gradebook.getByRole("columnheader")).toHaveCount(7);
  const rows = gradebook.getByRole("row");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(1).getByRole("rowheader")).toContainText(names.arif);
  await expect(rows.nth(2).getByRole("rowheader")).toContainText(names.maya);
  await expect(rows.nth(3).getByRole("rowheader")).toContainText(names.zara);
  const arif = rows.nth(1).getByRole("cell");
  for (const index of [0, 1, 2]) {
    await expect(arif.nth(index)).toContainText("—");
    await expect(arif.nth(index)).toHaveClass(/gradebook-missing/);
  }
  await expect(arif.nth(3)).toHaveText("0/3");
  await expect(arif.nth(4)).toHaveText("—");
  await expect(rows.nth(2)).toContainText("2/2");
  await expect(rows.nth(2).getByRole("cell").nth(3)).toHaveText("1/3");
  await expect(rows.nth(2).getByRole("cell").nth(4)).toHaveText("100%");
  await expect(rows.nth(3)).toContainText("0/2");
  await expect(rows.nth(3).getByRole("cell").nth(4)).toHaveText("0%");
  await page.getByLabel("Find a student").fill("maya");
  await expect(rows).toHaveCount(2);
  await page.getByLabel("Find a student").fill("");
  await expect(rows).toHaveCount(4);
  // Each activity's submissions list every student, including those who have not submitted.
  await page.getByRole("button", { name: "2 of 3 submitted", exact: true }).click();
  const festival = page.getByRole("table", { name: "Festivals check-in" });
  await expect(festival.getByRole("row")).toHaveCount(4);
  await expect(festival.getByRole("row").nth(1)).toContainText(`${names.arif}—Not submitted`);
  await expect(festival.getByRole("row").nth(1).getByRole("button", { name: "Reset" })).toHaveCount(0);
  await expect(festival.getByRole("row").nth(2).getByRole("button", { name: "Reset" })).toBeVisible();

  // Attendance: everyone starts ticked present; untick Arif and save.
  await nav.getByRole("button", { name: "Attendance", exact: true }).click();
  const attendance = page.getByRole("region", { name: "Attendance", exact: true });
  const today = await page.evaluate(() => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; });
  await expect(attendance.getByLabel("Class date")).toHaveValue(today);
  await expect(attendance).toContainText("Not saved yet");
  const boxes = attendance.getByRole("checkbox");
  await expect(boxes).toHaveCount(3);
  for (const box of await boxes.all()) await expect(box).toBeChecked();
  await attendance.getByRole("checkbox", { name: new RegExp(names.arif) }).uncheck();
  await expect(attendance).toContainText("2 of 3 present");
  await attendance.getByRole("button", { name: /^Save attendance for / }).click();
  await expect(attendance.getByRole("status")).toContainText("Attendance saved for");
  await expect(attendance.getByRole("status")).toContainText("2 of 3 present.");
  await expect(attendance).toContainText("Last saved by Attendance Teacher at");
  await expect(attendance.getByRole("listitem").filter({ hasText: names.arif })).toContainText("Attended 0 of 1 session");
  await expect(attendance.getByRole("listitem").filter({ hasText: names.maya })).toContainText("Attended 1 of 1 session");
  await expect(attendance.getByRole("table", { name: "Attendance by session" }).getByRole("row")).toHaveCount(2);
  fixture((db) => {
    const marks = db.prepare("SELECT s.display_name AS name, a.present FROM class_attendance a JOIN students s ON s.id = a.student_id JOIN classes c ON c.id = a.class_id WHERE c.name = ? AND a.session_date = ? ORDER BY s.display_name").all(className, today);
    expect(marks).toEqual([{ name: names.arif, present: 0 }, { name: names.maya, present: 1 }, { name: names.zara, present: 1 }]);
  });

  // Reopening the date shows what was saved. Nadia, added since, is not recorded for it and has no tick.
  const later = await apiRequest.newContext({ baseURL });
  try {
    expect((await later.post(`/api/classes/${classId}/students`, { headers: { cookie: teacherCookie }, data: { studentIds: [nadiaId] } })).status()).toBe(200);
  } finally {
    await later.dispose();
  }
  await openClass();
  await nav.getByRole("button", { name: "Attendance", exact: true }).click();
  await expect(attendance.getByRole("checkbox", { name: new RegExp(names.arif) })).not.toBeChecked();
  await expect(attendance.getByRole("checkbox", { name: new RegExp(names.maya) })).toBeChecked();
  await expect(attendance).toContainText("Last saved by Attendance Teacher");
  const late = attendance.getByRole("listitem").filter({ hasText: nadia });
  await expect(late).toContainText("Not recorded for this date");
  await expect(late.getByRole("checkbox")).toHaveCount(0);
  await expect(boxes).toHaveCount(3);
  await expect(attendance).toContainText("2 of 3 present · 1 not recorded");
  // She can be added to the date and left out again.
  await late.getByRole("button", { name: /^Record for this date/ }).click();
  await expect(late.getByRole("checkbox")).toBeChecked();
  await expect(attendance).toContainText("Changes not saved yet");
  await late.getByRole("button", { name: /^Leave out/ }).click();
  await expect(late.getByRole("checkbox")).toHaveCount(0);
  await expect(attendance).not.toContainText("Changes not saved yet");

  // Correct the date: Zara was absent. Moving to another date first asks, and staying keeps the change.
  await attendance.getByRole("checkbox", { name: new RegExp(names.zara) }).uncheck();
  const yesterday = await page.evaluate(() => { const now = new Date(); now.setDate(now.getDate() - 1); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; });
  let asked = "";
  page.once("dialog", (dialog) => { asked = dialog.message(); void dialog.dismiss(); });
  await attendance.getByLabel("Class date").fill(yesterday);
  await expect.poll(() => asked).toContain("not saved yet");
  await expect(attendance.getByLabel("Class date")).toHaveValue(today);
  await expect(attendance.getByRole("checkbox", { name: new RegExp(names.zara) })).not.toBeChecked();
  await attendance.getByRole("button", { name: /^Save attendance for / }).click();
  await expect(attendance.getByRole("status")).toContainText("1 of 3 present.");
  await expect(attendance).not.toContainText("Changes not saved yet");
  fixture((db) => {
    const marks = db.prepare("SELECT s.display_name AS name, a.present FROM class_attendance a JOIN students s ON s.id = a.student_id JOIN classes c ON c.id = a.class_id WHERE c.name = ? AND a.session_date = ? ORDER BY s.display_name").all(className, today);
    expect(marks).toEqual([{ name: names.arif, present: 0 }, { name: names.maya, present: 1 }, { name: names.zara, present: 0 }]);
  });

  // The gradebook's attendance column, and a phone-width screen scrolls the table, not the page.
  await nav.getByRole("button", { name: "Results", exact: true }).click();
  await expect(rows.nth(1).getByRole("cell").nth(5)).toHaveText("0 of 1");
  await expect(rows.nth(2).getByRole("cell").nth(5)).toHaveText("1 of 1");
  await expect(rows.nth(3).getByRole("rowheader")).toContainText(nadia);
  await expect(rows.nth(3).getByRole("cell").nth(5)).toHaveText("—");
  await page.setViewportSize({ width: 375, height: 800 });
  await expect(gradebook).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(await gradebook.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);

  // Scrolled across, the student names stay at the left edge; scrolled down, the header row stays on top
  // (within a few pixels: without sticky cells they would move by the whole scroll).
  const score = rows.nth(1).getByRole("cell").first();
  const scoreLeft = await score.evaluate((cell) => cell.getBoundingClientRect().left);
  const edge = await gradebook.evaluate((region) => {
    region.scrollLeft = 200;
    const box = region.getBoundingClientRect();
    return { left: box.left + region.clientLeft, top: box.top + region.clientTop, scrolled: region.scrollLeft };
  });
  expect(edge.scrolled).toBeGreaterThan(0);
  await expect.poll(() => score.evaluate((cell) => cell.getBoundingClientRect().left)).toBeCloseTo(scoreLeft - edge.scrolled, -1);
  const name = rows.nth(1).getByRole("rowheader");
  await expect.poll(() => name.evaluate((cell) => cell.getBoundingClientRect().left)).toBeCloseTo(edge.left, -1);
  // A short box (as with a long class list) so the table also scrolls down.
  const down = await gradebook.evaluate((region) => { region.style.maxHeight = "150px"; region.scrollTop = 60; return region.scrollTop; });
  expect(down).toBeGreaterThan(0);
  const header = gradebook.getByRole("columnheader").first();
  // Measured again: a shorter box makes the page shorter, which can move the box when the page is scrolled to its end.
  const top = () => gradebook.evaluate((region) => region.getBoundingClientRect().top + region.clientTop);
  await expect.poll(async () => await header.evaluate((cell) => cell.getBoundingClientRect().top) - await top()).toBeCloseTo(0, -1);
  await expect.poll(() => header.evaluate((cell) => cell.getBoundingClientRect().left)).toBeCloseTo(edge.left, -1);
  expect(await name.evaluate((cell) => cell.getBoundingClientRect().top)).toBeLessThan(await top());
});
