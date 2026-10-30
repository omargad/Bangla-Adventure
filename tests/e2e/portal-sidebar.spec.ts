import { test, expect, request as apiRequest, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

const password = "Sidebar-portal-password-2026";
const sections = ["Students", "Activities & quizzes", "Results", "Attendance", "Announcements", "Class sources"];
const adminLinks = [
  ["Users", "/admin"], ["Class allocation", "/admin/classes"], ["Grades & results", "/admin/results"], ["Lessons", "/studio"],
  ["Topics", "/teach/topics"], ["Textbook links", "/admin/sources"], ["All classes", "/teach"], ["Home learners", "/family"], ["Sources & references", "/references"],
  ["Account & recovery", "/account"],
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

/** Visible headings in the main area, which should never repeat the name of an administration page. */
function mainHeadings(page: Page) {
  return page.locator("#portal-main").evaluate((main) => [...main.querySelectorAll("h1,h2,h3,h4")].filter((heading) => (heading as HTMLElement).offsetParent).map((heading) => heading.textContent!.trim()));
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
  let classId = "";
  try {
    const rina = await staff(api, `sidebar-rina-${suffix}@example.com`, "Rina Sidebar", "teacher");
    const kamal = await staff(api, `sidebar-kamal-${suffix}@example.com`, "Kamal Sidebar", "teacher");
    const created = await api.post("/api/classes", { headers: rina, data: { name: first } });
    expect(created.status()).toBe(201);
    classId = (await created.json()).class.id;
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
    "Students": async () => {
      await expect(page.getByRole("region", { name: "Allocate students" })).toContainText(student);
      // The section's panels sit under its h2.
      await expect(page.getByRole("heading", { name: "Allocate students", level: 3 })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Students in this class (1)", level: 4 })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Add students from a CSV file", level: 3 })).toBeVisible();
      await expect(page.locator("#portal-main h2:visible")).toHaveCount(1);
    },
    "Activities & quizzes": () => expect(page.getByRole("region", { name: "Activities and submissions" })).toContainText(`Festivals quiz ${suffix}`),
    "Results": async () => {
      const gradebook = page.getByRole("region", { name: "Gradebook and attendance" });
      await expect(gradebook.getByRole("heading", { name: "Gradebook and attendance", level: 3 })).toBeVisible();
      await expect(gradebook.getByRole("region", { name: "Gradebook", exact: true }).getByRole("row", { name: new RegExp(student) })).toBeVisible();
    },
    "Attendance": () => expect(page.getByRole("region", { name: "Attendance", exact: true }).getByLabel("Class date")).toBeVisible(),
    "Announcements": () => expect(page.getByRole("region", { name: "Announcements" })).toContainText(notice),
    "Class sources": async () => {
      await expect(page.getByRole("region", { name: "Class sources" })).toContainText("No sources for this class yet.");
      await expect(page.locator(".teach-section-head p").first()).toHaveText("Add links just for this class's students and their parents.");
    },
  };
  const administration = await nav.getByRole("group", { name: "Administration" }).getByRole("link").allInnerTexts();
  const texts = new Set<string>();
  for (const section of [...sections].reverse()) {
    await open.getByRole("button", { name: section, exact: true }).click();
    const heading = page.getByRole("heading", { name: section, level: 2, exact: true });
    await expect(heading).toBeFocused();
    await expect(open.getByRole("button", { name: section, exact: true })).toHaveAttribute("aria-current", "page");
    await expect(nav.locator("[aria-current=page]")).toHaveCount(1);
    await content[section]();
    // No panel takes the name of an administration page, such as "Grades & results".
    expect((await mainHeadings(page)).filter((text) => administration.includes(text))).toEqual([]);
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
  await openBn.getByRole("button", { name: "ফলাফল", exact: true }).click();
  await expect(page.getByRole("region", { name: "গ্রেডবুক ও উপস্থিতি" })).toBeVisible();
  expect(await mainHeadings(page)).not.toContain("গ্রেড ও ফলাফল");
  await page.getByRole("button", { name: "English", exact: true }).click();

  // On Class allocation the same panels stand on their own, beside the h2 "Class teacher".
  await page.goto("/admin/classes");
  await page.getByLabel("Choose a class").selectOption(classId);
  await expect(page.getByRole("heading", { name: "Allocate students", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Students in this class (1)", level: 3 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Add students from a CSV file", level: 2 })).toBeVisible();
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
  const expected = [["My classes", "/teach"], ["Home learners", "/family"], ["Lessons", "/studio"], ["Topics", "/teach/topics"], ["Topics as students see them", "/topics"], ["Sources & references", "/references"], ["Account & recovery", "/account"]];
  for (const path of ["/studio", "/teach/topics", "/references", "/account", "/family", "/teach"]) {
    await page.goto(path);
    const shown = await sidebar(page);
    expect(shown.groups).toEqual(["Teacher workspace", "Lessons & topics"]);
    expect(shown.items).toEqual(expected.map(([name, href]) => [name, path === "/teach" && href === "/teach" ? "(button)" : href]));
    expect(shown.current).toEqual([expected.find(([, href]) => href === path)![0]]);
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
    // Older classes below this one make the class list longer than the phone screen. Class times are kept to the
    // second, so waiting a second puts this class first in the list.
    for (const extra of [1, 2, 3]) expect((await api.post("/api/classes", { headers: admin, data: { name: `Phone extra ${extra} ${suffix}` } })).status()).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect((await api.post("/api/classes", { headers: admin, data: { name: className } })).status()).toBe(201);
  } finally { await api.dispose(); }
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await signIn(page, email);
    const seen = problems(page);
    const nav = page.getByRole("navigation", { name: "Portal navigation" });
    const menu = page.getByRole("button", { name: "Menu", exact: true });
    const main = page.locator("#portal-main");
    await page.goto("/admin");
    await expect(nav).toBeHidden();
    // From the keyboard, Menu takes focus into the menu, to the current page, and the page behind it is inert.
    await menu.focus();
    await page.keyboard.press("Enter");
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("link", { name: "Users", exact: true })).toBeFocused();
    await expect(main).toHaveAttribute("inert", "");
    expect((await sidebar(page)).groups).toEqual(["Administration", "Teacher workspace"]);
    // Tab walks the menu, Sign out, Menu and the language button, never into the covered page.
    const walked: string[] = [];
    for (let step = 0; step < 20 && walked.at(-1) !== "বাংলা"; step += 1) {
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement;
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return { name: element.textContent!.trim(), inMain: !!element.closest("#portal-main"), covered: !(hit && (element === hit || element.contains(hit))) };
      });
      expect(focused.inMain, focused.name).toBe(false);
      expect(focused.covered, focused.name).toBe(false);
      walked.push(focused.name);
    }
    expect(walked.slice(-3)).toEqual(["Sign out", "Menu", "বাংলা"]);
    expect(walked).toContain("Account & recovery");
    // Escape closes the menu and returns to the Menu button.
    await page.keyboard.press("Escape");
    await expect(nav).toBeHidden();
    await expect(menu).toBeFocused();
    await expect(main).not.toHaveAttribute("inert");
    // Widening the window past the phone layout closes the menu, so the page is never left inert.
    await menu.click();
    await expect(main).toHaveAttribute("inert", "");
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(main).not.toHaveAttribute("inert");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(nav).toBeHidden();

    await menu.click();
    await nav.getByRole("link", { name: "All classes", exact: true }).click();
    await expect(page).toHaveURL(/\/teach$/);
    await expect(nav).toBeHidden();
    await page.getByLabel("Find a class").fill(suffix);
    // A class opened from further down the page opens at the top, its bar clear of the sticky top bar.
    await expect(page.locator(".teach-class-card")).toHaveCount(4);
    await page.evaluate(() => window.scrollTo({ top: 120, behavior: "instant" }));
    expect(await page.evaluate(() => window.scrollY)).toBe(120);
    await page.getByRole("button", { name: new RegExp(className) }).click();
    const back = page.getByRole("button", { name: "← All classes" });
    await expect(page.getByRole("heading", { name: "Students", level: 2, exact: true })).toBeFocused();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    expect((await back.boundingBox())!.y).toBeGreaterThanOrEqual((await page.locator(".portal-topbar").boundingBox())!.height);
    await menu.click();
    await expect(nav.getByRole("button", { name: "Students", exact: true })).toBeFocused();
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

test("at phone width a notice at the foot of the screen leaves the Menu's last items clear to tap", async ({ browser, baseURL }) => {
  test.setTimeout(120000);
  const suffix = randomUUID().slice(0, 8), email = `sidebar-notice-${suffix}@example.com`;
  const api = await apiRequest.newContext({ baseURL });
  try { await staff(api, email, "Sidebar Notice Admin", "admin"); } finally { await api.dispose(); }
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await signIn(page, email);
    const seen = problems(page);
    // A new release has gone live since the page loaded, so the "new version" notice shows at the foot of the screen.
    await page.route("**/api/auth/session", async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...(await response.json()), release: "next-release" } });
    });
    const menu = page.locator(".portal-menu"), aside = page.locator(".portal-sidebar"), notice = page.locator(".pwa-status");
    const last = [page.locator("#portal-navigation a[href='/account']"), page.locator(".portal-signout")];
    /** Whether a tap at the centre of the item reaches it, rather than something drawn over it. */
    const tappable = (item: Locator) => item.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return !!hit && (element === hit || element.contains(hit));
    });
    const openToTheEnd = async (shown: string) => {
      await expect(notice).toContainText(shown);
      await menu.click();
      await expect(aside).toHaveClass(/is-open/);
      await expect(notice).toBeVisible();
      // The menu scrolls when it is taller than the screen; at its end Account & recovery and Sign out sit above the notice.
      await aside.evaluate((element) => element.scrollTo(0, element.scrollHeight));
      for (const item of last) await expect.poll(() => tappable(item), { message: `${shown}: ${await item.innerText()}` }).toBe(true);
      await page.keyboard.press("Escape");
      await expect(aside).not.toHaveClass(/is-open/);
    };

    await page.goto("/admin");
    await openToTheEnd("A new version is ready");
    // The notice is tallest on the narrowest phones.
    await page.setViewportSize({ width: 320, height: 568 });
    await openToTheEnd("A new version is ready");
    // From the keyboard, each item that takes focus is scrolled clear of the notice, so its focus ring shows.
    await menu.focus();
    await page.keyboard.press("Enter");
    await expect(aside).toHaveClass(/is-open/);
    const walked: string[] = [];
    for (let step = 0; step < 20 && walked.at(-1) !== "Sign out"; step += 1) {
      await page.keyboard.press("Tab");
      const focused = page.locator(":focus");
      walked.push((await focused.innerText()).trim());
      await expect.poll(() => tappable(focused), { message: `focus on ${walked.at(-1)}` }).toBe(true);
    }
    expect(walked.slice(-2)).toEqual(["Account & recovery", "Sign out"]);
    await page.keyboard.press("Escape");
    await expect(aside).not.toHaveClass(/is-open/);
    await context.setOffline(true);
    await openToTheEnd("You are offline");
    await context.setOffline(false);
    await page.getByRole("button", { name: "বাংলা", exact: true }).click();
    await openToTheEnd("নতুন সংস্করণ এসেছে");
    expect(seen).toEqual([]);
  } finally {
    await context.close();
  }
});

test("the sidebar stays readable: legible labels, a long class name kept to two lines, a dark focus ring and a steady current item", async ({ page, baseURL }) => {
  test.setTimeout(120000);
  const suffix = randomUUID().slice(0, 8), email = `sidebar-read-${suffix}@example.com`;
  const className = `Saturday Level 2 — advanced reading and writing ${suffix}`;
  const api = await apiRequest.newContext({ baseURL });
  try {
    const admin = await staff(api, email, "Sidebar Reading Admin", "admin");
    expect((await api.post("/api/classes", { headers: admin, data: { name: className } })).status()).toBe(201);
  } finally { await api.dispose(); }
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, email);
  const seen = problems(page);
  const nav = page.getByRole("navigation", { name: "Portal navigation" });
  const style = (selector: string) => page.locator(selector).evaluateAll((elements) => elements.map((element) => {
    const css = getComputedStyle(element);
    return { size: parseFloat(css.fontSize), spacing: css.letterSpacing, color: css.color };
  }));
  await page.goto("/teach");
  // The class list's eyebrow is readable and dark enough (about 5:1 on the page background).
  expect(await style("#portal-main .adult-eyebrow")).toEqual([{ size: 12, spacing: expect.any(String), color: "rgb(185, 61, 43)" }]);
  for (const heading of await style(".portal-nav-heading")) expect(heading.size).toBeGreaterThanOrEqual(12);

  await page.getByLabel("Find a class").fill(suffix);
  await page.getByRole("button", { name: new RegExp(suffix) }).click();
  const open = nav.getByRole("group", { name: className, exact: true });
  await expect(open.getByRole("button")).toHaveText(sections);
  await expect(page.locator(".portal-nav-class-name small")).toHaveText("Current class");
  for (const caption of await style(".portal-nav-class-name small")) expect(caption.size).toBeGreaterThanOrEqual(12);
  // The long name would take three lines; it shows two, and its full text stays in the title and the group's name.
  const name = page.locator("#portal-nav-open-class");
  await expect(name).toHaveAttribute("title", className);
  const lines = await name.evaluate((element) => {
    const line = parseFloat(getComputedStyle(element).lineHeight);
    return { shown: element.getBoundingClientRect().height / line, full: element.scrollHeight / line };
  });
  expect(lines.full).toBeGreaterThan(2.5);
  expect(lines.shown).toBeLessThanOrEqual(2.05);

  // A clicked item keeps the current colour while the pointer is still on it.
  const results = open.getByRole("button", { name: "Results", exact: true });
  await results.click();
  await results.hover();
  await expect(results).toHaveAttribute("aria-current", "page");
  await expect(results).toHaveCSS("background-color", "rgb(7, 91, 76)");
  await expect(results).toHaveCSS("color", "rgb(255, 255, 255)");
  // Keyboard focus in the sidebar shows a dark ring, not the pale yellow one.
  await results.focus();
  await page.keyboard.press("Tab");
  const attendance = open.getByRole("button", { name: "Attendance", exact: true });
  await expect(attendance).toBeFocused();
  await expect(attendance).toHaveCSS("outline-color", "rgb(23, 50, 77)");
  await expect(attendance).toHaveCSS("outline-width", "3px");

  // In Bangla the small labels drop the letter-spacing and grow a little.
  await page.getByRole("button", { name: "বাংলা", exact: true }).click();
  await expect(page.locator(".portal-nav-class-name small")).toHaveText("বর্তমান ক্লাস");
  for (const label of await style(".portal-nav-heading, .portal-nav-class-name small, .portal-role")) {
    expect(label.size).toBeGreaterThanOrEqual(13);
    expect(["0px", "normal"]).toContain(label.spacing);
  }
  await page.getByRole("button", { name: "English", exact: true }).click();
  expect(seen).toEqual([]);
});
