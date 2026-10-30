import { test, expect, request as apiRequest, type APIRequestContext, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

const password = "Sidebar-portal-password-2026";
const sections = ["Students", "Activities & quizzes", "Results", "Attendance", "Announcements", "Class sources"];
const adminLinks = [
  ["Users", "/admin"], ["Class allocation", "/admin/classes"], ["Grades & results", "/admin/results"], ["Lessons", "/studio"],
  ["Topics", "/teach/topics"], ["Textbook links", "/admin/sources"], ["All classes", "/teach"], ["Sources & references", "/references"], ["Account & recovery", "/account"],
];

function fixture<T>(callback: (db: Database.Database) => T): T {
  if (!process.env.BANGLA_E2E_DB?.includes("bangla-e2e-")) throw new Error("An isolated E2E database is required.");
  const db = new Database(process.env.BANGLA_E2E_DB);
  try { return callback(db); } finally { db.close(); }
}

// API setup sends the session cookie itself: the request context does not resend Secure cookies over http.
async function staff(api: APIRequestContext, email: string, displayName: string, role: "teacher" | "admin") {
  expect((await api.post("/api/auth/sign-up", { data: { email, displayName, password }, headers: { "x-forwarded-for": email } })).status()).toBe(201);
  fixture((db) => db.prepare(role === "admin" ? "UPDATE adults SET role = 'admin', approval_status = 'approved' WHERE email = ?" : "UPDATE adults SET role = 'teacher', teacher_status = 'approved', approval_status = 'approved' WHERE email = ?").run(email));
  const response = await api.post("/api/auth/sign-in", { data: { email, password }, headers: { "x-forwarded-for": email } });
  expect(response.status()).toBe(200);
  return { cookie: response.headersArray().find((header) => header.name.toLowerCase() === "set-cookie" && header.value.startsWith("ba_adult_session="))!.value.split(";")[0] };
}

async function signIn(page: Page, email: string) {
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `ui-${email}` });
  expect((await page.request.post("/api/auth/sign-in", { data: { email, password } })).status()).toBe(200);
}

/** Console errors and failed requests seen by the page, which every test expects to stay empty. */
function problems(page: Page) {
  const seen: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") seen.push(`console: ${message.text()}`); });
  page.on("pageerror", (error) => seen.push(`page error: ${error.message}`));
  page.on("response", (response) => { if (response.status() >= 400) seen.push(`${response.status()} ${response.url()}`); });
  return seen;
}

/** The sidebar as group headings and items, in order. */
function sidebar(page: Page) {
  return page.locator("#portal-navigation").evaluate((nav) => ({
    groups: [...nav.querySelectorAll(":scope > [role=group]")].map((group) => group.querySelector(".portal-nav-heading")?.textContent ?? ""),
    items: [...nav.querySelectorAll("a,button")].map((item) => [item.textContent!.trim(), item.getAttribute("href") ?? "(button)"]),
    current: [...nav.querySelectorAll("[aria-current=page]")].map((item) => item.textContent!.trim()),
  }));
}

test("an administrator's sidebar has the same two groups on every admin page, each item leads somewhere different, and there are no class sections", async ({ page, baseURL }) => {
  test.setTimeout(120000);
  const suffix = randomUUID().slice(0, 8), email = `sidebar-admin-${suffix}@example.com`;
  const api = await apiRequest.newContext({ baseURL });
  try { await staff(api, email, "Sidebar Admin", "admin"); } finally { await api.dispose(); }
  await signIn(page, email);
  const seen = problems(page);
  const nav = page.getByRole("navigation", { name: "Portal navigation" });
  const pages = adminLinks.map(([, href]) => href);

  for (const [index, path] of pages.entries()) {
    await page.goto(path);
    const shown = await sidebar(page);
    expect(shown.groups).toEqual(["Administration", "Teacher workspace"]);
    // On the workspace itself "All classes" returns to the class list in place; everywhere else it is a link.
    expect(shown.items).toEqual(adminLinks.map(([name, href]) => [name, path === "/teach" && href === "/teach" ? "(button)" : href]));
    expect(shown.current).toEqual([adminLinks[index][0]]);
    await expect(nav.getByRole("group", { name: "Administration" }).getByRole("link")).toHaveCount(6);
    for (const section of sections) await expect(nav.getByRole("button", { name: section, exact: true })).toHaveCount(0);
    // One language button per page: the one in the top bar.
    await expect(page.getByRole("button", { name: "বাংলা", exact: true })).toHaveCount(1);
    await expect(page.locator("#portal-main header.adult-header")).toHaveCount(0);
  }

  // Each item, clicked from a different page, opens its own page with its own main heading.
  const headings = new Set<string>();
  for (const [index, [name, href]] of adminLinks.entries()) {
    await page.goto(pages[(index + 1) % pages.length]);
    await nav.getByRole("link", { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${href.replace(/\//g, "\\/")}$`));
    await expect(nav.locator("[aria-current=page]")).toHaveText(name);
    const heading = page.locator("#portal-main h1").first();
    await expect(heading).toBeVisible();
    headings.add(await heading.innerText());
  }
  expect(headings.size).toBe(adminLinks.length);
  expect(seen).toEqual([]);
});

test("an administrator opens classes owned by two teachers: each section shows its own heading and content, and closing the class removes the sections", async ({ page, baseURL }) => {
  test.setTimeout(150000);
  const suffix = randomUUID().slice(0, 8);
  const first = `Sidebar Sunday ${suffix}`, second = `Sidebar Friday ${suffix}`, student = `Sidebar Maya ${suffix}`, notice = `Bring the reading book ${suffix}.`;
  const adminEmail = `sidebar-classes-admin-${suffix}@example.com`;
  const api = await apiRequest.newContext({ baseURL });
  try {
    const rina = await staff(api, `sidebar-rina-${suffix}@example.com`, "Rina Sidebar", "teacher");
    const kamal = await staff(api, `sidebar-kamal-${suffix}@example.com`, "Kamal Sidebar", "teacher");
    const created = await api.post("/api/classes", { headers: rina, data: { name: first } });
    expect(created.status()).toBe(201);
    const classId = (await created.json()).class.id;
    expect((await api.post("/api/classes", { headers: kamal, data: { name: second } })).status()).toBe(201);
    expect((await api.post(`/api/classes/${classId}/activities`, { headers: rina, data: { title: `Festivals quiz ${suffix}`, questions: [{ prompt: "Which month starts the Bengali year?", options: ["Boishakh", "Poush"], answer: 0 }] } })).status()).toBe(201);
    expect((await api.post(`/api/classes/${classId}/announcements`, { headers: rina, data: { body: notice } })).status()).toBe(201);
    expect((await api.post("/api/student/sign-up", { data: { username: `sidebar.${suffix}`, displayName: student, password }, headers: { "x-forwarded-for": `sidebar-student-${suffix}` } })).status()).toBe(201);
    fixture((db) => db.prepare("UPDATE students SET approval_status = 'approved' WHERE username = ?").run(`sidebar.${suffix}`));
    expect((await api.post(`/api/classes/${classId}/students`, { headers: rina, data: { username: `sidebar.${suffix}` } })).status()).toBe(200);
    await staff(api, adminEmail, "Sidebar Classes Admin", "admin");
  } finally {
    await api.dispose();
  }
  await signIn(page, adminEmail);
  const seen = problems(page);
  const nav = page.getByRole("navigation", { name: "Portal navigation" });
  await page.goto("/teach");
  await page.getByLabel("Find a class").fill(suffix);
  await expect(page.locator(".teach-class-card")).toHaveCount(2);
  await expect(page.locator(".workspace-stats")).toBeVisible();
  for (const section of sections) await expect(nav.getByRole("button", { name: section, exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: new RegExp(first) }).click();
  await expect(page.getByRole("region", { name: first }).getByRole("heading", { name: first, level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: first })).toContainText("Teacher: Rina Sidebar");
  const open = nav.getByRole("group", { name: first, exact: true });
  await expect(open.getByRole("button")).toHaveText(sections);
  await expect(nav.getByRole("group", { name: "Teacher workspace" }).getByRole("button", { name: "All classes", exact: true })).not.toHaveAttribute("aria-current", "page");
  // The overview belongs to the class list, not to every section.
  await expect(page.locator(".workspace-stats")).toHaveCount(0);
  await expect(page.locator(".adult-hero")).toHaveCount(0);

  const content: Record<string, () => Promise<void>> = {
    "Students": () => expect(page.getByRole("region", { name: "Allocate students" })).toContainText(student),
    "Activities & quizzes": () => expect(page.getByRole("region", { name: "Activities and submissions" })).toContainText(`Festivals quiz ${suffix}`),
    "Results": () => expect(page.getByRole("region", { name: "Gradebook" }).getByRole("row", { name: new RegExp(student) })).toBeVisible(),
    "Attendance": () => expect(page.getByRole("region", { name: "Attendance", exact: true }).getByLabel("Class date")).toBeVisible(),
    "Announcements": () => expect(page.getByRole("region", { name: "Announcements" })).toContainText(notice),
    "Class sources": () => expect(page.getByRole("region", { name: "Class sources" })).toContainText("No sources for this class yet."),
  };
  const texts = new Set<string>();
  for (const section of [...sections].reverse()) {
    await open.getByRole("button", { name: section, exact: true }).click();
    const heading = page.getByRole("heading", { name: section, level: 2, exact: true });
    await expect(heading).toBeFocused();
    await expect(open.getByRole("button", { name: section, exact: true })).toHaveAttribute("aria-current", "page");
    await expect(nav.locator("[aria-current=page]")).toHaveCount(1);
    await content[section]();
    texts.add(await page.locator("#portal-main").innerText());
  }
  expect(texts.size).toBe(sections.length);

  await page.getByRole("region", { name: first }).getByRole("button", { name: "← All classes" }).click();
  await expect(page.getByRole("heading", { name: "All classes", level: 1 })).toBeFocused();
  await expect(nav.getByRole("group", { name: first, exact: true })).toHaveCount(0);
  for (const section of sections) await expect(nav.getByRole("button", { name: section, exact: true })).toHaveCount(0);

  // The other teacher's class: its own name heads the sections.
  await page.getByLabel("Find a class").fill(suffix);
  await page.getByRole("button", { name: new RegExp(second) }).click();
  await expect(nav.getByRole("group", { name: second, exact: true }).getByRole("button")).toHaveText(sections);
  await expect(page.getByRole("heading", { name: "Students", level: 2, exact: true })).toBeFocused();

  // In Bangla the groups, the class and its sections are named in Bangla; still one language button.
  await page.getByRole("button", { name: "বাংলা", exact: true }).click();
  const bangla = page.getByRole("navigation", { name: "পোর্টালের মেনু" });
  await expect(bangla.locator(".portal-nav-heading")).toHaveText(["প্রশাসন", "শিক্ষকের কর্মক্ষেত্র"]);
  const openBn = bangla.getByRole("group", { name: second, exact: true });
  await openBn.getByRole("button", { name: "উপস্থিতি", exact: true }).click();
  await expect(page.getByRole("heading", { name: "উপস্থিতি", level: 2, exact: true })).toBeFocused();
  await expect(page.getByRole("button", { name: "English", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "English", exact: true }).click();
  expect(seen).toEqual([]);
});

test("a teacher has no class sections until a class is open, and keeps the same groups on every page", async ({ page, baseURL }) => {
  test.setTimeout(120000);
  const suffix = randomUUID().slice(0, 8), email = `sidebar-teacher-${suffix}@example.com`, className = `Sidebar Level ${suffix}`;
  const api = await apiRequest.newContext({ baseURL });
  try { await staff(api, email, "Sidebar Teacher", "teacher"); } finally { await api.dispose(); }
  await signIn(page, email);
  const seen = problems(page);
  const nav = page.getByRole("navigation", { name: "Portal navigation" });
  const expected = [["My classes", "/teach"], ["Lessons", "/studio"], ["Topics", "/teach/topics"], ["Topics as students see them", "/topics"], ["Sources & references", "/references"], ["Account & recovery", "/account"]];
  for (const path of ["/studio", "/teach/topics", "/references", "/account", "/teach"]) {
    await page.goto(path);
    const shown = await sidebar(page);
    expect(shown.groups).toEqual(["Teacher workspace", "Lessons & topics"]);
    expect(shown.items).toEqual(expected.map(([name, href]) => [name, path === "/teach" && href === "/teach" ? "(button)" : href]));
  }
  await expect(page.getByRole("heading", { name: "My classes", level: 1 })).toBeVisible();
  await expect(page.getByText("No classes yet — create your first one above.", { exact: true })).toBeVisible();
  for (const section of sections) await expect(nav.getByRole("button", { name: section, exact: true })).toHaveCount(0);

  await page.getByLabel("New class name").fill(className);
  await page.getByRole("button", { name: "Create class", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(className) }).click();
  const open = nav.getByRole("group", { name: className, exact: true });
  await expect(open.getByRole("button")).toHaveText(sections);
  await expect(page.getByRole("heading", { name: "Students", level: 2, exact: true })).toBeFocused();
  for (const section of sections) {
    await open.getByRole("button", { name: section, exact: true }).click();
    await expect(page.getByRole("heading", { name: section, level: 2, exact: true })).toBeFocused();
  }
  await nav.getByRole("button", { name: "My classes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My classes", level: 1 })).toBeFocused();
  await expect(open).toHaveCount(0);
  expect(seen).toEqual([]);
});

test("at phone width the Menu shows the same groups, and the open class's sections once a class is open", async ({ browser, baseURL }) => {
  test.setTimeout(120000);
  const suffix = randomUUID().slice(0, 8), email = `sidebar-phone-${suffix}@example.com`, className = `Sidebar Phone ${suffix}`;
  const api = await apiRequest.newContext({ baseURL });
  try {
    const admin = await staff(api, email, "Sidebar Phone Admin", "admin");
    expect((await api.post("/api/classes", { headers: admin, data: { name: className } })).status()).toBe(201);
  } finally { await api.dispose(); }
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await signIn(page, email);
    const seen = problems(page);
    const nav = page.getByRole("navigation", { name: "Portal navigation" });
    const menu = page.getByRole("button", { name: "Menu", exact: true });
    await page.goto("/admin");
    await expect(nav).toBeHidden();
    await menu.click();
    await expect(nav).toBeVisible();
    expect((await sidebar(page)).groups).toEqual(["Administration", "Teacher workspace"]);
    // Escape closes the menu and returns to the Menu button.
    await page.keyboard.press("Escape");
    await expect(nav).toBeHidden();
    await expect(menu).toBeFocused();

    await menu.click();
    await nav.getByRole("link", { name: "All classes", exact: true }).click();
    await expect(page).toHaveURL(/\/teach$/);
    await expect(nav).toBeHidden();
    await page.getByLabel("Find a class").fill(suffix);
    await page.getByRole("button", { name: new RegExp(className) }).click();
    await menu.click();
    const open = nav.getByRole("group", { name: className, exact: true });
    await expect(open.getByRole("button")).toHaveText(sections);
    await open.getByRole("button", { name: "Results", exact: true }).click();
    await expect(nav).toBeHidden();
    await expect(page.getByRole("heading", { name: "Results", level: 2, exact: true })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await menu.click();
    await nav.getByRole("button", { name: "All classes", exact: true }).click();
    await menu.click();
    await expect(open).toHaveCount(0);
    expect(seen).toEqual([]);
  } finally {
    await context.close();
  }
});
