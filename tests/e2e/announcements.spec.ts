import { test, expect, request as apiRequest, type APIRequestContext } from "@playwright/test";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

const password = "Announcements-password-2026";

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

test("a teacher posts a parents-only announcement: the linked parent sees it, the student does not, and the heading follows the number of children", async ({ page, browser, baseURL }) => {
  test.setTimeout(120000);
  const suffix = randomUUID().slice(0, 8);
  const className = `Notice class ${suffix}`;
  const emails = { teacher: `notice-teacher-${suffix}@example.com`, admin: `notice-admin-${suffix}@example.com`, parent: `notice-parent-${suffix}@example.com` };
  const maya = `Maya ${suffix}`, arif = `Arif ${suffix}`;
  const studentsNote = `Students: read the Pohela Boishakh topic ${suffix}.`;
  const parentsNote = `Parents' evening is on Friday ${suffix}.`;
  const ids: Record<string, string> = {};
  let adminCookie = "";

  const api = await apiRequest.newContext({ baseURL });
  try {
    for (const [role, address] of Object.entries(emails)) {
      expect((await api.post("/api/auth/sign-up", { data: { email: address, displayName: `Notice ${role[0].toUpperCase()}${role.slice(1)}`, password }, headers: { "x-forwarded-for": `notice-${role}-${suffix}` } })).status()).toBe(201);
    }
    fixture((db) => {
      db.prepare("UPDATE adults SET role = 'teacher', teacher_status = 'approved', approval_status = 'approved' WHERE email = ?").run(emails.teacher);
      db.prepare("UPDATE adults SET role = 'admin', approval_status = 'approved' WHERE email = ?").run(emails.admin);
      db.prepare("UPDATE adults SET approval_status = 'approved' WHERE email = ?").run(emails.parent);
    });
    const teacher = await signIn(api, "auth", { email: emails.teacher, password }, `notice-teacher-${suffix}`);
    adminCookie = (await signIn(api, "auth", { email: emails.admin, password }, `notice-admin-${suffix}`)).cookie;
    const created = await api.post("/api/classes", { headers: teacher, data: { name: className } });
    expect(created.status()).toBe(201);
    const classId = (await created.json()).class.id;
    for (const [key, displayName] of [["maya", maya], ["arif", arif]]) {
      const response = await api.post("/api/student/sign-up", { data: { username: `${key}.notice.${suffix}`, displayName, password }, headers: { "x-forwarded-for": `notice-${key}-${suffix}` } });
      expect(response.status()).toBe(201);
      ids[key] = (await response.json()).student.id;
    }
    fixture((db) => db.prepare("UPDATE students SET approval_status = 'approved' WHERE username LIKE ?").run(`%.notice.${suffix}`));
    expect((await api.post(`/api/classes/${classId}/students`, { headers: teacher, data: { studentIds: [ids.maya, ids.arif] } })).status()).toBe(200);
    expect((await api.post("/api/admin/family-links", { headers: { cookie: adminCookie }, data: { studentId: ids.maya, parentEmail: emails.parent, confirmed: true } })).status()).toBe(200);
    expect((await api.post(`/api/classes/${classId}/announcements`, { headers: teacher, data: { body: studentsNote, audience: "students" } })).status()).toBe(201);
  } finally {
    await api.dispose();
  }

  // The teacher writes a two-line notice for parents only.
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `notice-teacher-ui-${suffix}` });
  expect((await page.request.post("/api/auth/sign-in", { data: { email: emails.teacher, password } })).status()).toBe(200);
  await page.goto("/teach");
  await page.getByLabel("Find a class").fill(suffix);
  await page.getByRole("button", { name: new RegExp(className) }).click();
  await expect(page.getByRole("heading", { name: className, level: 2 })).toBeVisible();
  await page.getByRole("navigation", { name: "Portal navigation" }).getByRole("button", { name: "Announcements", exact: true }).click();
  const panel = page.getByRole("region", { name: "Announcements" });
  await expect(panel.getByLabel("Who can see it")).toHaveValue("all");
  await panel.getByLabel("New announcement").fill(`${parentsNote}\nPlease bring your child's reading book.`);
  await panel.getByLabel("Who can see it").selectOption("parents");
  await panel.getByRole("button", { name: "Post", exact: true }).click();
  await expect(page.getByText("Announcement posted to the parents.", { exact: true })).toBeVisible();
  // The choice stays for the next post, so a second parents-only note is not sent to students too.
  await expect(panel.getByLabel("Who can see it")).toHaveValue("parents");
  await expect(panel.getByLabel("New announcement")).toHaveValue("");
  const posted = panel.getByRole("listitem").filter({ hasText: parentsNote });
  await expect(posted).toContainText("Parents only");
  await expect(posted).toContainText("Posted by Notice Teacher");
  await expect(panel.getByRole("listitem").filter({ hasText: studentsNote })).toContainText("Students only");

  const parentContext = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": `notice-parent-ui-${suffix}` } });
  const studentContext = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": `notice-maya-ui-${suffix}` } });
  try {
    // The parent of one child: singular heading, and the parents-only post (never the students-only one).
    const parent = await parentContext.newPage();
    expect((await parent.request.post("/api/auth/sign-in", { data: { email: emails.parent, password } })).status()).toBe(200);
    await parent.goto("/family");
    await expect(parent.getByRole("heading", { level: 1, name: "Your child's learning" })).toBeVisible();
    const notices = parent.getByRole("region", { name: "Announcements" });
    const notice = notices.getByRole("listitem").filter({ hasText: parentsNote });
    await expect(notice).toContainText(`${maya} · ${className}`);
    await expect(notice).toContainText("From Notice Teacher");
    await expect(notice).toContainText("Parents only");
    await expect(notice).toContainText("Please bring your child's reading book.");
    await expect(notices).not.toContainText(studentsNote);

    // The student sees the students-only post and not the parents-only one.
    const student = await studentContext.newPage();
    expect((await student.request.post("/api/student/sign-in", { data: { username: `maya.notice.${suffix}`, password } })).status()).toBe(200);
    await student.goto("/student");
    const studentNotices = student.getByRole("region", { name: "Class announcements" });
    await expect(studentNotices).toContainText(studentsNote);
    await expect(studentNotices).toContainText("Notice Teacher");
    await expect(studentNotices).not.toContainText(parentsNote);

    // A second linked child makes the heading plural, in English and in Bangla.
    const admin = await apiRequest.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": `notice-admin-${suffix}` } });
    try {
      expect((await admin.post("/api/admin/family-links", { headers: { cookie: adminCookie }, data: { studentId: ids.arif, parentEmail: emails.parent, confirmed: true } })).status()).toBe(200);
    } finally { await admin.dispose(); }
    await parent.getByRole("button", { name: "Refresh progress", exact: true }).click();
    await expect(parent.getByRole("heading", { level: 1, name: "Your children's learning" })).toBeVisible();
    await expect(notice).toContainText(`${arif}, ${maya} · ${className}`);
    await parent.locator(".portal-topbar").getByRole("button", { name: "বাংলা" }).click();
    await expect(parent.getByRole("heading", { level: 1, name: "আপনার সন্তানদের শেখার অগ্রগতি" })).toBeVisible();
    await expect(parent.getByRole("region", { name: "ঘোষণা" }).getByRole("listitem").filter({ hasText: parentsNote })).toContainText("শুধু অভিভাবক");
  } finally {
    await parentContext.close();
    await studentContext.close();
  }

  // Remove asks first: cancelling keeps the post, confirming removes it.
  page.once("dialog", (dialog) => void dialog.dismiss());
  await posted.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(posted).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept());
  await posted.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(posted).toHaveCount(0);
});
