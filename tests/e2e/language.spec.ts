import { test, expect, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

// The reader's English/Bangla choice is kept in a cookie as well as localStorage, so the server renders every page
// in it: the first paint is already in the chosen language, and the page does not switch (and move) once it loads.

async function signInStudent(page: Page) {
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `language-${randomUUID()}` });
  const username = `language-${randomUUID().slice(0, 12)}`, password = "Language-test-password";
  expect((await page.request.post("/api/student/sign-up", { data: { username, displayName: "Language test", password } })).status()).toBe(201);
  if (!process.env.BANGLA_E2E_DB?.includes("bangla-e2e-")) throw new Error("An isolated E2E database is required.");
  const db = new Database(process.env.BANGLA_E2E_DB);
  try { db.prepare("UPDATE students SET approval_status = 'approved' WHERE username = ?").run(username); } finally { db.close(); }
  expect((await page.request.post("/api/student/sign-in", { data: { username, password } })).status()).toBe(200);
}

type Seen = { lang: string[]; h1: string[] };

/** Records every <html lang> and main heading the tab shows, from the server's HTML on, without missing a switch. */
async function recordLanguage(page: Page) {
  await page.addInitScript(() => {
    const seen: Seen = { lang: [], h1: [] };
    (window as unknown as { seen: Seen }).seen = seen;
    const record = () => {
      const lang = document.documentElement?.lang;
      if (lang && seen.lang.at(-1) !== lang) seen.lang.push(lang);
      const h1 = document.querySelector("h1")?.textContent?.trim();
      if (h1 && seen.h1.at(-1) !== h1) seen.h1.push(h1);
    };
    new MutationObserver(record).observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["lang"] });
  });
}
const seen = (page: Page) => page.evaluate(() => (window as unknown as { seen: Seen }).seen);
const bangla = (text: string) => /[ঀ-৿]/.test(text) && !/[A-Za-z]/.test(text);
const languageCookie = async (page: Page) => (await page.context().cookies()).find((cookie) => cookie.name === "ba_language")?.value;

/** The page as the server sent it: its scripts are blocked, so nothing has switched its language yet. */
async function serverPage(page: Page, path: string) {
  const scripts = /\/_next\/static\/chunks\/.*\.js(\?.*)?$/;
  await page.route(scripts, (route) => route.abort());
  try {
    await page.goto(path, { waitUntil: "load" });
    return { lang: await page.locator("html").getAttribute("lang"), heading: (await page.locator("h1").first().textContent())?.trim() ?? "" };
  } finally {
    await page.unroute(scripts);
  }
}

/** Opens a page chosen in Bangla: the server's HTML is Bangla, and once it has loaded it has never been anything else. */
async function opensInBangla(page: Page, path: string, heading: string) {
  expect(await serverPage(page, path), `${path} from the server`).toEqual({ lang: "bn", heading });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(path, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  const { lang, h1 } = await seen(page);
  expect(lang, `${path}: <html lang> while loading`).toEqual(["bn"]);
  expect(h1.filter((text) => !bangla(text)), `${path}: headings shown while loading`).toEqual([]);
  expect(errors, `${path}: no hydration or other errors`).toEqual([]);
}

test("signed-out pages open in the chosen Bangla from the first paint", async ({ page }) => {
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `language-public-${randomUUID()}` });
  await recordLanguage(page);
  await page.goto("/welcome", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "বাংলা", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "bn");
  await opensInBangla(page, "/safety", "সামান্য তথ্য সংগ্রহ। স্পষ্ট সীমা। মানুষের পর্যালোচনা এখনও প্রয়োজন।");
  await opensInBangla(page, "/student", "নতুন কিছু জানার জন্য প্রস্তুত?");
});

test("a student's portal and adventure open in the chosen language, and a switch back to English is kept the same way", async ({ page }) => {
  await signInStudent(page);
  await recordLanguage(page);
  await page.goto("/student", { waitUntil: "networkidle" });
  await page.locator(".portal-topbar").getByRole("button", { name: "বাংলা", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "bn");
  await opensInBangla(page, "/student", "আমার শেখা");
  await opensInBangla(page, "/adventure", "গল্পে গল্পে বাংলাদেশকে জানো।");
  await opensInBangla(page, "/topics", "বাংলা স্কুল থেকে বিষয় পেয়েছ? শুরু এখানেই।");

  // Back to English: the next page the server renders is English, and so is a page opened by a link in this tab.
  await page.goto("/student", { waitUntil: "networkidle" });
  await page.locator(".portal-topbar").getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "My Learning" })).toBeVisible();
  expect(await languageCookie(page)).toBe("en");
  await page.evaluate(() => { const record = (window as unknown as { seen: Seen }).seen; record.lang.length = 0; record.h1.length = 0; });
  await page.getByRole("navigation", { name: "Portal navigation" }).getByRole("link", { name: "Learning topics", exact: true }).click();
  await expect(page).toHaveURL(/\/topics$/);
  await expect(page.getByRole("heading", { level: 1, name: "Got a topic from Bangla school? Start here." })).toBeVisible();
  const { lang, h1 } = await seen(page);
  expect(lang).not.toContain("bn");
  expect(h1.filter((text) => /[ঀ-৿]/.test(text))).toEqual([]);
  expect(await serverPage(page, "/adventure")).toEqual({ lang: "en", heading: "Discover Bangladesh — story by story." });
});

test("a choice saved only in this browser before the cookie existed is copied to it, and the browser's copy wins", async ({ page }) => {
  await signInStudent(page);
  await page.addInitScript(() => { if (!window.localStorage.getItem("bangla-adventures-language")) window.localStorage.setItem("bangla-adventures-language", "bn"); });
  // The first page is rendered in English (the server has no cookie yet) and switches once it loads.
  await page.goto("/student");
  await expect(page.getByRole("heading", { level: 1, name: "আমার শেখা" })).toBeVisible();
  // From the next page on the server renders the choice.
  expect(await serverPage(page, "/adventure")).toEqual({ lang: "bn", heading: "গল্পে গল্পে বাংলাদেশকে জানো।" });
  // When the two disagree (another tab of an older version changed only localStorage), localStorage is the choice.
  await page.evaluate(() => window.localStorage.setItem("bangla-adventures-language", "en"));
  await page.goto("/student");
  await expect(page.getByRole("heading", { level: 1, name: "My Learning" })).toBeVisible();
  expect(await serverPage(page, "/adventure")).toEqual({ lang: "en", heading: "Discover Bangladesh — story by story." });
});

test("a page that does not follow the choice, such as the missing-page notice, keeps an English <html lang>", async ({ page, baseURL }) => {
  await signInStudent(page);
  await page.context().addCookies([{ name: "ba_language", value: "bn", url: baseURL! }]);
  await page.goto("/no-such-page", { waitUntil: "networkidle" });
  await expect(page.getByText("This page could not be found.")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("each page load renews the language cookie from the server, so Safari's 7-day limit on cookies a page writes never ends it", async ({ page, baseURL }) => {
  // Added without an expiry: a cookie the browser then keeps for about a year can only have come from the server.
  await page.context().addCookies([{ name: "ba_language", value: "bn", url: baseURL! }]);
  const renews = (headers: { name: string; value: string }[]) => headers.some(({ name, value }) => name.toLowerCase() === "set-cookie"
    && /^ba_language=bn;/.test(value) && /Max-Age=31536000/i.test(value) && /SameSite=Lax/i.test(value));
  const response = (await page.goto("/welcome"))!;
  expect(renews(await response.headersArray())).toBe(true);
  const kept = (await page.context().cookies()).find((cookie) => cookie.name === "ba_language")!;
  expect(kept.expires).toBeGreaterThan(Date.now() / 1000 + 300 * 86400);
  // Files are not pages, and a shared cache may keep them: nothing is renewed on a script or a picture, even opened on its own.
  const src = await page.locator("script[src]").first().getAttribute("src");
  expect(src).not.toBeNull();
  for (const file of [await page.request.get(new URL(src!, baseURL).href), (await page.goto("/favicon.svg"))!]) {
    expect((await file.headersArray()).some(({ name, value }) => name.toLowerCase() === "set-cookie" && value.startsWith("ba_language="))).toBe(false);
  }
});

test("the page writes the language cookie only when it differs from the one the server used, so the server's renewal stands", async ({ page, baseURL }) => {
  // Every write the page itself makes to the language cookie.
  await page.addInitScript(() => {
    const writes: string[] = [];
    Object.assign(window, { cookieWrites: writes });
    const property = Object.getOwnPropertyDescriptor(Document.prototype, "cookie")!;
    Object.defineProperty(Document.prototype, "cookie", { ...property, set(this: Document, value: string) {
      if (value.startsWith("ba_language=")) writes.push(value.split(";")[0]);
      property.set!.call(this, value);
    } });
  });
  const writes = () => page.evaluate(() => (window as unknown as { cookieWrites: string[] }).cookieWrites);
  await page.context().addCookies([{ name: "ba_language", value: "bn", url: baseURL! }]);
  await page.goto("/welcome");
  await page.evaluate(() => window.localStorage.setItem("bangla-adventures-language", "bn"));
  await page.reload();
  await page.waitForLoadState("networkidle");
  expect(await writes()).toEqual([]);
  // A choice in this browser that differs from the cookie wins, and is written once.
  await page.evaluate(() => window.localStorage.setItem("bangla-adventures-language", "en"));
  await page.reload();
  await page.waitForLoadState("networkidle");
  expect(await writes()).toEqual(["ba_language=en"]);
});
