import { test, expect, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

async function api(page: Page, url: string, body?: unknown, method = "POST") {
  return page.evaluate(async ({ url, body, method }) => {
    const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() };
  }, { url, body, method });
}

test("complete approved-teacher, allocated-student, curriculum and recovery workflow", async ({ page, browser, baseURL }, testInfo) => {
  test.setTimeout(120000);
  const suffix = randomUUID().slice(0, 8);
  const adminEmail = `admin-${suffix}@example.com`, teacherEmail = `teacher-${suffix}@example.com`;
  const username = `student-${suffix}`, password = "Workflow-password-2026", newPassword = "Recovered-password-2026";
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `admin-${suffix}` });
  expect((await page.request.post("/api/auth/sign-up", { data: { email: adminEmail, displayName: "Workflow Administrator", password } })).status()).toBe(201);
  if (!process.env.BANGLA_E2E_DB?.includes("bangla-e2e-")) throw new Error("Isolated test database required.");
  // Self sign-ups wait for an administrator: the first one is approved directly, as the server-side grant does.
  const fixture = new Database(process.env.BANGLA_E2E_DB);
  fixture.prepare("UPDATE adults SET role = 'admin', approval_status = 'approved' WHERE email = ?").run(adminEmail);
  fixture.close();
  expect((await page.request.post("/api/auth/sign-in", { data: { email: adminEmail, password } })).status()).toBe(200);
  const teacherContext = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": `teacher-${suffix}` } });
  const studentContext = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": `student-${suffix}` } });
  try {
    const teacher = await teacherContext.newPage(), student = await studentContext.newPage();
    page.setDefaultTimeout(15000); teacher.setDefaultTimeout(15000); student.setDefaultTimeout(15000);
    await teacher.goto("/grown-ups?returnTo=%2Fteach&mode=sign-up");
    await teacher.getByLabel(/Your name/).fill("Workflow Teacher");
    await teacher.getByLabel("Email", { exact: true }).fill(teacherEmail);
    await teacher.getByLabel(/Password/).fill(password);
    await teacher.getByRole("button", { name: "Create account", exact: true }).click();
    const codes = teacher.getByRole("list", { name: "One-time recovery codes" }).locator("code");
    await expect(codes).toHaveCount(8);
    const recoveryCode = await codes.first().innerText();
    await teacher.getByRole("button", { name: /saved them/ }).click();
    await expect(teacher.getByRole("status").filter({ hasText: "waiting for an administrator to approve it" })).toBeVisible();
    expect((await api(teacher, "/api/classes", { name: "Not approved" })).status).toBe(401);

    await page.goto("/admin");
    await page.getByLabel("Search users").fill(teacherEmail);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    page.on("dialog", (dialog) => dialog.accept());
    await page.getByRole("row").filter({ hasText: teacherEmail }).getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByRole("row").filter({ hasText: teacherEmail }).getByText("teacher", { exact: true })).toBeVisible();
    await teacher.goto("/grown-ups?returnTo=%2Fteach");
    await teacher.getByLabel("Email", { exact: true }).fill(teacherEmail);
    await teacher.getByLabel("Password", { exact: true }).fill(password);
    await teacher.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(teacher.getByRole("navigation", { name: "Portal navigation" })).toBeVisible();
    await teacher.getByRole("button", { name: "Create class", exact: true }).click();
    expect(await teacher.getByLabel("New class name").evaluate((el) => (el as HTMLInputElement).validity.valueMissing)).toBe(true);
    expect((await api(teacher, "/api/classes", { name: "   " })).status).toBe(400);
    expect((await api(teacher, "/api/classes", null)).status).toBe(400);
    await teacher.getByLabel("New class name").fill(`Learning Class ${suffix}`);
    await teacher.getByRole("button", { name: "Create class", exact: true }).click();
    await teacher.getByRole("button", { name: new RegExp(`Learning Class ${suffix}`) }).click();
    const classes = await api(teacher, "/api/classes", undefined, "GET");
    const classId = classes.data.classes.find((c: { name: string }) => c.name === `Learning Class ${suffix}`).id;

    expect((await student.request.post("/api/student/sign-up", { data: { username, displayName: "Workflow Student", password } })).status()).toBe(201);
    await studentContext.clearCookies();
    const approvals = new Database(process.env.BANGLA_E2E_DB);
    approvals.prepare("UPDATE students SET approval_status = 'approved' WHERE username = ?").run(username);
    approvals.close();
    // Teachers find students by name or username and tick them; nobody types an exact username.
    await teacher.getByLabel("Find students", { exact: true }).fill("does-not-exist");
    await expect(teacher.getByText(/^No student who can be added matches this search/)).toBeVisible();
    await teacher.getByLabel("Find students", { exact: true }).fill(username);
    await teacher.getByRole("checkbox", { name: new RegExp(username) }).check();
    await teacher.getByRole("button", { name: "Add selected (1)", exact: true }).click();
    await expect(teacher.getByText("1 student added to this class.", { exact: true })).toBeVisible();
    await page.goto("/admin/classes");
    await page.getByRole("combobox", { name: "Choose a class", exact: true }).selectOption(classId);
    await expect(page.locator(".family-link-list")).toContainText(username);
    await page.getByLabel("Find students", { exact: true }).fill(username);
    await expect(page.getByText(/^No student who can be added matches this search/)).toBeVisible();
    await teacher.getByRole("navigation", { name: "Portal navigation" }).getByRole("button", { name: "Activities & quizzes", exact: true }).click();
    expect((await api(teacher, `/api/classes/${classId}/activities`, { title: "Bad", questions: [{ prompt: "Question", options: ["", "Valid"], answer: 0 }] })).status).toBe(400);
    await teacher.getByLabel("Activity title", { exact: true }).fill("A festival and a boat");
    await teacher.getByLabel("Question 1", { exact: true }).fill("Which month starts the Bengali year?");
    await teacher.getByLabel("Question 1 option 1", { exact: true }).fill("Boishakh");
    await teacher.getByLabel("Question 1 option 2", { exact: true }).fill("Poush");
    await teacher.getByRole("button", { name: /Add question/ }).click();
    await teacher.getByLabel("Question 2", { exact: true }).fill("What can travel on a river?");
    await teacher.getByLabel("Question 2 option 1", { exact: true }).fill("Boat");
    await teacher.getByLabel("Question 2 option 2", { exact: true }).fill("Train");
    await teacher.getByRole("button", { name: "Publish to the class", exact: true }).click();
    await expect(teacher.getByText("Activity published to the class.", { exact: true })).toBeVisible();
    await teacher.getByRole("navigation", { name: "Portal navigation" }).getByRole("button", { name: "Announcements", exact: true }).click();
    const announcement = `Bring your reading worksheet ${suffix}.`;
    await teacher.getByLabel("New announcement", { exact: true }).fill(announcement);
    await teacher.getByRole("button", { name: "Post", exact: true }).click();
    await expect(teacher.getByText(announcement, { exact: true })).toBeVisible();

    await student.goto("/student");
    await student.getByLabel("Username", { exact: true }).fill(username);
    await student.getByLabel("Password", { exact: true }).fill(password);
    await student.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(student.getByRole("heading", { name: "My Learning", exact: true })).toBeVisible();
    await expect(student.getByRole("region", { name: "Class announcements" })).toContainText(announcement);
    await expect(student.getByLabel("Class code", { exact: true })).toHaveCount(0);
    await expect(student.locator(".portal-topic-card").first()).toBeVisible();
    await student.getByRole("navigation", { name: "Portal navigation" }).getByRole("button", { name: "My activities", exact: true }).click();
    await expect(student.getByRole("region", { name: "Class announcements" })).toContainText(announcement);
    await student.getByRole("button", { name: /A festival and a boat/ }).click();
    const feed = await api(student, "/api/student/feed", undefined, "GET");
    const activityId = feed.data.classes[0].activities[0].id;
    expect((await api(student, "/api/student/submit", { activityId, answers: [] })).status).toBe(400);
    await student.getByRole("radio", { name: "Boishakh", exact: true }).check();
    await student.getByRole("radio", { name: "Boat", exact: true }).check();
    await student.getByRole("button", { name: "Submit answers", exact: true }).click();
    await expect(student.getByText("You got 2 out of 2.", { exact: true })).toBeVisible();
    await teacher.getByRole("navigation", { name: "Portal navigation" }).getByRole("button", { name: "Results", exact: true }).click();
    await teacher.getByRole("button", { name: /1 submissions/ }).click();
    await expect(teacher.getByRole("cell", { name: "Workflow Student", exact: true })).toBeVisible();
    await expect(teacher.getByRole("cell", { name: "2/2", exact: true })).toBeVisible();

    await page.goto("/admin/curriculum");
    await page.getByLabel("Choose a topic").selectOption("pohela-boishakh");
    const title = `Learning update ${suffix}`;
    await page.getByLabel("Title (English)", { exact: true }).fill(title);
    await page.getByRole("textbox", { name: "Section 1 text (en)", exact: true }).fill("Read this updated section with your teacher and check the original NCTB source.");
    await page.getByRole("button", { name: "Save topic update", exact: true }).click();
    // The connection banner is also a status region; target the save result.
    await expect(page.getByRole("status").filter({ hasText: "Topic saved" })).toBeVisible();
    await student.goto("/student");
    await student.getByRole("link").filter({ has: student.getByRole("heading", { name: title, exact: true }) }).click();
    await expect(student.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(student.getByText("Read this updated section with your teacher and check the original NCTB source.", { exact: true })).toBeVisible();
    await expect(student.getByText("Draft for educator review", { exact: true })).toBeVisible();
    await expect(student.getByRole("link", { name: "Official NCTB source portal" }).first()).toHaveAttribute("href", "https://nctb.gov.bd/");
    await student.getByRole("button", { name: "Mark reading complete", exact: true }).click();
    await expect(student.getByRole("button", { name: "Reading complete", exact: true })).toBeDisabled();
    expect((await api(student, "/api/admin/curriculum", {}, "PUT")).status).toBe(401);

    await teacher.goto("/api/auth/sign-out?returnTo=%2Fgrown-ups%3FreturnTo%3D%252Fteach");
    await teacher.getByRole("button", { name: /Forgot your password/ }).click();
    await teacher.getByLabel("Email", { exact: true }).fill(teacherEmail);
    await teacher.getByLabel("Recovery code", { exact: true }).fill(recoveryCode);
    await teacher.getByLabel(/New password/).fill(newPassword);
    await teacher.getByRole("button", { name: "Reset password", exact: true }).click();
    await expect(teacher.getByRole("button", { name: new RegExp(`Learning Class ${suffix}`) })).toBeVisible();
    expect((await api(teacher, "/api/auth/recover", { email: teacherEmail, recoveryCode, newPassword })).status).toBe(401);
    expect((await api(teacher, "/api/auth/sign-in", { email: teacherEmail, password })).status).toBe(401);

    for (const [role, portal, url] of [["student", student, "/student"], ["teacher", teacher, "/teach"], ["admin", page, "/admin"]] as const) {
      await portal.goto(url);
      for (const width of [1366, 768, 390]) {
        await portal.setViewportSize({ width, height: 900 });
        await expect(portal.locator(".portal-topbar")).toBeVisible();
        expect(await portal.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
        if (width === 390) {
          await portal.getByRole("button", { name: "Menu", exact: true }).click();
          await expect(portal.locator(".portal-sidebar")).toHaveCSS("left", "0px");
        }
        await expect(portal.getByRole("navigation", { name: "Portal navigation" })).toBeVisible();
        await portal.screenshot({ path: testInfo.outputPath(`${role}-${width}.png`), animations: "disabled" });
        if (width === 390) {
          await portal.getByRole("button", { name: "Menu", exact: true }).click();
          await expect(portal.locator(".portal-sidebar")).toHaveCSS("visibility", "hidden");
          await portal.screenshot({ path: testInfo.outputPath(`${role}-${width}-content.png`), animations: "disabled" });
        }
      }
    }
  } finally { await teacherContext.close().catch(() => undefined); await studentContext.close().catch(() => undefined); }
});

test("learning pages, media and content bundles require a real session", async ({ page, baseURL }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "How will you join us?" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Start my quest/ })).toHaveCount(0);
  for (const url of ["/learn", "/topics", "/stories", "/references", "/worksheets/hello-me"]) {
    const response = await page.request.get(url, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(new URL(response.headers().location, baseURL).pathname).toBe("/welcome");
    expect(new URL(response.headers().location, baseURL).origin).toBe(new URL(baseURL!).origin);
  }
  for (const url of ["/api/curriculum", "/api/library", "/audio/hello-bn.ogg", "/river-story.png"]) expect((await page.request.get(url)).status()).toBe(401);
  const html = await (await page.request.get("/")).text();
  expect(html).not.toContain("Maya and the moonlit boat");
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `gate-${randomUUID()}` });
  const username = `gate-${randomUUID().slice(0, 8)}`;
  expect((await page.request.post("/api/student/sign-up", { data: { username, displayName: "Gate learner", password: "Gate-test-password" } })).status()).toBe(201);
  // Self sign-ups wait for an administrator: approve directly, then sign in.
  if (!process.env.BANGLA_E2E_DB?.includes("bangla-e2e-")) throw new Error("Isolated test database required.");
  const fixture = new Database(process.env.BANGLA_E2E_DB);
  fixture.prepare("UPDATE students SET approval_status = 'approved' WHERE username = ?").run(username);
  fixture.close();
  expect((await page.request.post("/api/student/sign-in", { data: { username, password: "Gate-test-password" } })).status()).toBe(200);
  await page.goto("/student");
  const privateScript = await page.evaluate(async () => {
    const text = await (await fetch("/adventure")).text();
    const doc = new DOMParser().parseFromString(text, "text/html");
    return [...doc.querySelectorAll("script[src]")].map((script) => script.getAttribute("src")).find((src) => src?.includes("/app/adventure/page-"));
  });
  expect(privateScript).toBeTruthy();
  expect((await page.request.get(privateScript!, { headers: { cookie: "" } })).status()).toBe(401);
  const cache = await page.evaluate(async (src) => (await fetch(src!)).headers.get("cache-control"), privateScript);
  expect(cache).toContain("no-store");
  await page.goto("/api/student/sign-out?returnTo=%2Fstudent");
  expect((await page.request.get("/stories", { maxRedirects: 0 })).status()).toBe(307);
});
