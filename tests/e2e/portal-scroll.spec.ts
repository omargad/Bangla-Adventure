import { test, expect, request as apiRequest, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

// iPhone and iPad browsers misplace pinned boxes while their toolbar shrinks and grows, so there the portal's main column
// scrolls inside a screen-high shell and the page never scrolls (app/portal.css). Chromium cannot show that toolbar, but the
// same rules can be switched on here to check the layout they make and that Back, Forward and reload still find the reader's
// place; every other browser keeps the ordinary page scroll.

/** The rules app/portal.css keeps for iPhones and iPads, which Chromium skips because it has no -webkit-touch-callout. */
const appleRules = (() => {
  const css = readFileSync("app/portal.css", "utf8");
  const start = css.indexOf("{", css.indexOf("@supports (-webkit-touch-callout:none)"));
  let depth = 0;
  for (let end = start; end < css.length; end += 1) {
    if (css[end] === "{") depth += 1;
    else if (css[end] === "}" && --depth === 0) return css.slice(start + 1, end);
  }
  throw new Error("app/portal.css has no iPhone and iPad rules.");
})();

/** Applies the iPhone and iPad rules from the first paint of every page the tab opens, reloads included, as on the device. */
async function asAppleDevice(page: Page) {
  await page.addInitScript((rules) => {
    const style = document.createElement("style");
    style.textContent = rules;
    // Kept after every stylesheet, including those a client-side navigation adds, so these rules win as they do on the device.
    const last = () => { if (document.head && document.head.lastElementChild !== style) document.head.append(style); };
    new MutationObserver(last).observe(document, { childList: true, subtree: true });
    last();
  }, appleRules);
}

function withDatabase(change: (db: Database.Database) => void) {
  if (!process.env.BANGLA_E2E_DB?.includes("bangla-e2e-")) throw new Error("An isolated E2E database is required.");
  const db = new Database(process.env.BANGLA_E2E_DB);
  try { change(db); } finally { db.close(); }
}

async function signInStudent(page: Page) {
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `portal-scroll-${randomUUID()}` });
  const username = `scroll-${randomUUID().slice(0, 12)}`, password = "Portal-scroll-password";
  expect((await page.request.post("/api/student/sign-up", { data: { username, displayName: "Scroll test", password } })).status()).toBe(201);
  withDatabase((db) => db.prepare("UPDATE students SET approval_status = 'approved' WHERE username = ?").run(username));
  expect((await page.request.post("/api/student/sign-in", { data: { username, password } })).status()).toBe(200);
}

async function signInAdmin(page: Page, baseURL: string) {
  const email = `scroll-admin-${randomUUID().slice(0, 8)}@example.com`, password = "Portal-scroll-admin-password";
  const api = await apiRequest.newContext({ baseURL });
  try {
    expect((await api.post("/api/auth/sign-up", { data: { email, displayName: "Scroll Admin", password }, headers: { "x-forwarded-for": email } })).status()).toBe(201);
  } finally { await api.dispose(); }
  withDatabase((db) => db.prepare("UPDATE adults SET role = 'admin', approval_status = 'approved' WHERE email = ?").run(email));
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `ui-${email}` });
  expect((await page.request.post("/api/auth/sign-in", { data: { email, password } })).status()).toBe(200);
}

/** Where the page, the main column, the sidebar, the top bar and Sign out sit right now. */
function layout(page: Page) {
  return page.evaluate(() => {
    // In whole pixels; adding 0 turns the -0 that rounding gives for half a pixel or less above the top into 0.
    const px = (value: number) => Math.round(value) + 0;
    const box = (selector: string) => { const rect = document.querySelector(selector)!.getBoundingClientRect(); return { top: px(rect.top), bottom: px(rect.bottom), height: px(rect.height) }; };
    const main = document.querySelector<HTMLElement>(".portal-workspace")!;
    return {
      pageScroll: window.scrollY, pageOverflow: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      mainScroll: Math.round(main.scrollTop), mainOverflow: main.scrollHeight - main.clientHeight, viewport: window.innerHeight,
      sidebar: box(".portal-sidebar"), topbar: box(".portal-topbar"), signOut: box(".portal-signout"),
    };
  });
}

const column = (page: Page) => page.locator(".portal-workspace");
const columnTop = (page: Page) => column(page).evaluate((main) => Math.round(main.scrollTop));
/** Scrolls the main column and waits for its scroll event, on which the page keeps the offset (none comes if it was there already). */
const scrollColumn = (page: Page, top: number) => column(page).evaluate((main, top) => new Promise<void>((done) => {
  const from = main.scrollTop;
  main.addEventListener("scroll", () => done(), { once: true });
  main.scrollTo({ top, behavior: "instant" });
  if (main.scrollTop === from) done();
}), top);
const nav = (page: Page) => page.getByRole("navigation", { name: "Portal navigation" });
/** The column's offset once two more frames have been drawn, so a scroll the page was still to make has been made. */
const settledTop = (page: Page) => column(page).evaluate((main) => new Promise<number>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(Math.round(main.scrollTop))))));
/** The column's offset once it has stopped moving (a link to a part of the page scrolls it smoothly). */
const restingTop = (page: Page) => column(page).evaluate((main) => new Promise<number>((done) => {
  let last = NaN, still = 0;
  const frame = () => { const top = Math.round(main.scrollTop); still = top === last ? still + 1 : 0; last = top; if (still >= 10) done(top); else requestAnimationFrame(frame); };
  requestAnimationFrame(frame);
}));

/** Wheels down over the main column to its end, checking the layout after every step. */
async function wheelToEnd(page: Page, check: (now: Awaited<ReturnType<typeof layout>>) => void) {
  const size = page.viewportSize()!;
  await page.mouse.move(size.width - 60, size.height / 2);
  for (let step = 0; step < 60; step += 1) {
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(40);
    const now = await layout(page);
    check(now);
    if (now.mainScroll >= now.mainOverflow - 1) return now;
  }
  throw new Error("The main column never reached its end.");
}

test("on a computer the page itself scrolls, as before, and the sidebar stays at the top to the end of every section", async ({ page }) => {
  await signInStudent(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/student");
  await expect(page.getByRole("heading", { name: "Choose a topic" })).toBeVisible();
  await expect(page.locator(".portal-topic-card").first()).toBeVisible();
  // The served stylesheet carries the iPhone and iPad rules, which this browser does not apply.
  expect(await page.evaluate(() => [...document.styleSheets].some((sheet) => {
    try { return [...sheet.cssRules].some((rule) => rule instanceof CSSSupportsRule && rule.conditionText.includes("-webkit-touch-callout")); } catch { return false; }
  }))).toBe(true);
  // The toolbar margin is nothing where the screen has no toolbar, so the sidebar keeps its size and place.
  expect(await page.locator(".portal-sidebar").evaluate((sidebar) => getComputedStyle(sidebar).marginBottom)).toBe("0px");
  for (const section of ["My Learning", "My activities", "My results"]) {
    await nav(page).getByRole("button", { name: section, exact: true }).click();
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
    const end = await layout(page);
    expect(end.mainOverflow).toBeLessThanOrEqual(0);
    expect(end.pageScroll).toBe(Math.max(0, end.pageOverflow));
    expect(end.sidebar.top).toBe(0);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  }
});

test("on a computer Back, Forward and reload are left to the browser, and the portal never reads or moves the main column", async ({ page }) => {
  await signInStudent(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  // Even reading the column's offset or size makes the browser lay the page out at once, which can change where its own Back and
  // Forward land, so every such read, every move of the column's scroll, and every offset kept for it, is listed here.
  await page.addInitScript(() => {
    const touched: string[] = [];
    Object.assign(window, { columnTouched: touched });
    const isColumn = (node: unknown) => node instanceof Element && node.classList.contains("portal-workspace");
    for (const name of ["scrollTo", "scroll", "scrollBy", "getBoundingClientRect", "getClientRects"] as const) {
      const kept = Element.prototype[name] as (this: Element, ...args: unknown[]) => unknown;
      Element.prototype[name] = function (this: Element, ...args: unknown[]) {
        if (isColumn(this)) touched.push(name);
        return kept.apply(this, args);
      } as never;
    }
    for (const [proto, names] of [[Element.prototype, ["scrollTop", "scrollHeight", "clientHeight"]], [HTMLElement.prototype, ["offsetTop", "offsetHeight"]]] as const) {
      for (const name of names) {
        const kept = Object.getOwnPropertyDescriptor(proto, name)!;
        Object.defineProperty(proto, name, { ...kept,
          get(this: Element) { if (isColumn(this)) touched.push(name); return kept.get!.call(this); },
          ...(kept.set && { set(this: Element, value: unknown) { if (isColumn(this)) touched.push(`${name} =`); kept.set!.call(this, value); } }) });
      }
    }
    for (const name of ["setItem", "removeItem"] as const) {
      const kept = Storage.prototype[name] as (this: Storage, ...args: string[]) => void;
      Storage.prototype[name] = function (this: Storage, ...args: string[]) {
        if (args[0]?.startsWith("portal-scroll:")) touched.push(`${name} ${args[0]}`);
        kept.apply(this, args);
      } as never;
    }
  });
  const touched = () => page.evaluate(() => (window as unknown as { columnTouched: string[] }).columnTouched);
  await page.goto("/books");
  await page.evaluate(() => window.scrollTo({ top: 400, behavior: "instant" }));
  await page.locator('.portal-content a[href="#current-books"]').click();
  await expect(page).toHaveURL(/\/books#current-books$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/books$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/books#current-books$/);
  await nav(page).getByRole("link", { name: "Sources & references" }).click();
  await expect(page).toHaveURL(/\/references$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/books#current-books$/);
  expect(await touched()).toEqual([]);
  await page.reload();
  await page.waitForLoadState("networkidle");
  expect(await touched()).toEqual([]);
});

test("on an iPad the sidebar never moves while My Learning and My activities scroll, and Sign out stays on screen", async ({ page }) => {
  await signInStudent(page);
  await page.setViewportSize({ width: 1180, height: 820 });
  await asAppleDevice(page);
  await page.goto("/student");
  await expect(page.locator(".portal-topic-card").first()).toBeVisible();
  for (const section of ["My Learning", "My activities"]) {
    await nav(page).getByRole("button", { name: section, exact: true }).click();
    const start = await layout(page);
    // The page fits the screen exactly, so the browser has nothing to scroll and its toolbar stays as it is.
    expect(start.pageOverflow).toBeLessThanOrEqual(0);
    expect(start.sidebar).toEqual({ top: 0, bottom: start.viewport, height: start.viewport });
    expect(start.signOut.bottom).toBeLessThanOrEqual(start.viewport);
    if (section === "My Learning") expect(start.mainOverflow).toBeGreaterThan(400);
    const end = await wheelToEnd(page, (now) => {
      expect(now.pageScroll).toBe(0);
      expect(now.sidebar).toEqual(start.sidebar);
      expect(Math.abs(now.topbar.top + now.mainScroll)).toBeLessThanOrEqual(1);
    });
    expect(Math.abs(end.mainScroll - Math.max(0, end.mainOverflow))).toBeLessThanOrEqual(1);
    await scrollColumn(page, 0);
  }
});

test("on an iPhone the top bar stays at the top while the page scrolls, and the open menu fits the screen", async ({ page }) => {
  await signInStudent(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await asAppleDevice(page);
  await page.goto("/student");
  await expect(page.locator(".portal-topic-card").first()).toBeVisible();
  const end = await wheelToEnd(page, (now) => {
    expect(now.pageScroll).toBe(0);
    expect(now.topbar.top).toBe(0);
  });
  expect(end.pageOverflow).toBeLessThanOrEqual(0);
  expect(end.mainScroll).toBeGreaterThan(1000);
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByRole("link", { name: "Sign out" })).toBeInViewport({ ratio: 1 });
  const open = await layout(page);
  expect(open.sidebar.height).toBe(open.viewport);
});

test("on an iPad, opening a topic from further down the list starts the topic at its top", async ({ page }) => {
  await signInStudent(page);
  await page.setViewportSize({ width: 1180, height: 820 });
  await asAppleDevice(page);
  await page.goto("/topics");
  const cards = page.locator(".topic-card");
  await expect(cards.first()).toBeVisible();
  await column(page).evaluate((main) => main.scrollTo({ top: main.scrollHeight, behavior: "instant" }));
  expect((await layout(page)).mainScroll).toBeGreaterThan(200);
  await cards.last().click();
  await expect.poll(() => columnTop(page)).toBe(0);
  expect((await layout(page)).pageScroll).toBe(0);
});

test("on an iPad, hidden helper text in the main column never makes the page itself scroll, even when it takes focus", async ({ page }) => {
  await signInStudent(page);
  await page.setViewportSize({ width: 1180, height: 820 });
  await asAppleDevice(page);
  await page.goto("/student");
  await expect(page.locator(".portal-topic-card").first()).toBeVisible();
  // Lesson previews focus a hidden step heading like this one on every step; the admin search has a hidden label.
  await page.evaluate(() => {
    const heading = document.createElement("h3");
    heading.className = "sr-only"; heading.tabIndex = -1; heading.textContent = "Step";
    document.querySelector(".portal-content")!.append(heading);
    heading.focus();
  });
  await page.waitForTimeout(300);
  const now = await layout(page);
  expect(now.pageOverflow).toBeLessThanOrEqual(0);
  expect(now.pageScroll).toBe(0);
  expect(now.sidebar.top).toBe(0);
  expect(now.mainScroll).toBeGreaterThan(0);
});

test("on an iPad, Back returns to the same place in the main column, and a new visit starts at the top and is returned to there", async ({ page }) => {
  await signInStudent(page);
  await page.setViewportSize({ width: 1180, height: 820 });
  await asAppleDevice(page);
  await page.goto("/references");
  expect((await layout(page)).mainOverflow).toBeGreaterThan(300);
  await scrollColumn(page, 300);
  await nav(page).getByRole("link", { name: "My Learning" }).click();
  await expect(page).toHaveURL(/\/student$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/references$/);
  await expect.poll(() => columnTop(page)).toBe(300);
  expect((await layout(page)).pageScroll).toBe(0);
  await nav(page).getByRole("link", { name: "My Learning" }).click();
  await expect(page).toHaveURL(/\/student$/);
  await nav(page).getByRole("link", { name: "Sources & references" }).click();
  await expect(page).toHaveURL(/\/references$/);
  await expect(column(page)).toHaveJSProperty("scrollTop", 0);
  // Left at the top this time, so Back to this visit finds the top, not where the first visit was left.
  await nav(page).getByRole("link", { name: "My Learning" }).click();
  await expect(page.locator(".portal-topic-card").first()).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/references$/);
  await expect(page.locator(".portal-content h1")).toBeVisible();
  // Read two frames on, so an offset put back late would show too.
  expect(await column(page).evaluate((main) => new Promise<number>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(Math.round(main.scrollTop))))))).toBe(0);
});

test("on an iPad, Back and Forward between a topic and the topic list put each back, and the list link then goes to the top", async ({ page }) => {
  await signInStudent(page);
  await page.setViewportSize({ width: 1180, height: 820 });
  await asAppleDevice(page);
  await page.goto("/student");
  await page.locator(".portal-topic-card").first().click();
  await expect(page.locator(".topic-reader")).toBeVisible();
  await scrollColumn(page, 300);
  await nav(page).getByRole("link", { name: "Learning topics" }).click();
  await expect(page).toHaveURL(/\/topics$/);
  await expect.poll(() => columnTop(page)).toBe(0);
  await scrollColumn(page, 200);
  await page.goBack();
  await expect(page).toHaveURL(/\/topics\?topic=/);
  await expect.poll(() => columnTop(page)).toBe(300);
  await page.goForward();
  await expect(page).toHaveURL(/\/topics$/);
  await expect.poll(() => columnTop(page)).toBe(200);
  await page.goBack();
  await expect(page).toHaveURL(/\/topics\?topic=/);
  await expect.poll(() => columnTop(page)).toBe(300);
  await nav(page).getByRole("link", { name: "Learning topics" }).click();
  await expect(page).toHaveURL(/\/topics$/);
  await expect.poll(() => columnTop(page)).toBe(0);
});

test("on an iPad, the sidebar link to the open topic's list goes to the top, as the page does on a computer", async ({ page }) => {
  await signInStudent(page);
  await page.setViewportSize({ width: 1180, height: 820 });
  await asAppleDevice(page);
  await page.goto("/student");
  await page.locator(".portal-topic-card").first().click();
  await expect(page).toHaveURL(/\/topics\?topic=/);
  await expect(page.locator(".topic-reader")).toBeVisible();
  const learningTopics = nav(page).getByRole("link", { name: "Learning topics" });
  for (const expected of [0, 250]) {
    await scrollColumn(page, 250);
    await learningTopics.click();
    await expect(page).toHaveURL(/\/topics$/);
    // The first click leaves the address the page opened at; clicking again changes nothing, so it stays put.
    await expect.poll(() => columnTop(page)).toBe(expected);
    await page.waitForLoadState("networkidle");
    expect(await settledTop(page)).toBe(expected);
  }
});

test("on an iPad, the Bangla Adventures link from a page opened at My activities goes to the top, as the page does on a computer", async ({ page }) => {
  await signInStudent(page);
  await page.setViewportSize({ width: 1180, height: 820 });
  await asAppleDevice(page);
  await page.goto("/student?section=activities");
  await nav(page).getByRole("button", { name: "My Learning", exact: true }).click();
  await expect(page.locator(".portal-topic-card").first()).toBeVisible();
  await scrollColumn(page, 400);
  await page.locator("a.portal-brand").click();
  await expect(page).toHaveURL(/\/student$/);
  await expect.poll(() => columnTop(page)).toBe(0);
});

test("on an iPad, Back puts the column back even when the visit began outside the portal", async ({ page }) => {
  await signInStudent(page);
  await page.setViewportSize({ width: 1180, height: 820 });
  await asAppleDevice(page);
  await page.goto("/adventure");
  await page.locator('a[href="/topics"]').first().click();
  await expect(page).toHaveURL(/\/topics$/);
  await nav(page).getByRole("link", { name: "Sources & references" }).click();
  await expect(page).toHaveURL(/\/references$/);
  await scrollColumn(page, 300);
  await nav(page).getByRole("link", { name: "My Learning" }).click();
  await expect(page).toHaveURL(/\/student$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/references$/);
  await expect.poll(() => columnTop(page)).toBe(300);
});

test("on an iPad, a reload keeps the column where it was", async ({ page }) => {
  await signInStudent(page);
  await page.setViewportSize({ width: 1180, height: 820 });
  await asAppleDevice(page);
  await page.goto("/references");
  await scrollColumn(page, 300);
  await page.reload();
  await expect.poll(() => columnTop(page)).toBe(300);
});

test("on an iPad, a scroll made while the page is still loading is kept for a reload, as on a computer", async ({ page }) => {
  await signInStudent(page);
  await page.setViewportSize({ width: 1180, height: 820 });
  await asAppleDevice(page);
  // The page's scripts are held back, as on a slow connection, so the reader scrolls before the page is ready.
  let ready!: () => void;
  const held = new Promise<void>((done) => { ready = done; });
  await page.route("**/_next/static/chunks/**", async (route) => { await held; await route.continue(); });
  await page.goto("/references", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLLinkElement>("link[rel=stylesheet]")].every((link) => link.sheet));
  await scrollColumn(page, 300);
  ready();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("portal-scroll:/references"))).toBe("300");
  await page.reload();
  await expect.poll(() => columnTop(page)).toBe(300);
});

test("on an iPad, a scroll made while a reloaded page is still loading is not undone once it is ready, as on a computer", async ({ page }) => {
  await signInStudent(page);
  await page.setViewportSize({ width: 1180, height: 820 });
  await asAppleDevice(page);
  await page.goto("/references");
  await scrollColumn(page, 300);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("portal-scroll:/references"))).toBe("300");
  // The reloaded page's scripts are held back, and the reader scrolls on from the top before the page is ready.
  let ready!: () => void;
  const held = new Promise<void>((done) => { ready = done; });
  await page.route("**/_next/static/chunks/**", async (route) => { await held; await route.continue(); });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLLinkElement>("link[rel=stylesheet]")].every((link) => link.sheet));
  await scrollColumn(page, 150);
  ready();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("portal-scroll:/references"))).toBe("150");
  expect(await settledTop(page)).toBe(150);
});

test("on an iPad, a scroll made while a reloaded page is still loading is not undone at a part of the page either", async ({ page }) => {
  await signInStudent(page);
  await page.setViewportSize({ width: 1180, height: 820 });
  await asAppleDevice(page);
  await page.goto("/books");
  await scrollColumn(page, 400);
  await page.locator('.portal-content a[href="#current-books"]').click();
  await expect(page).toHaveURL(/\/books#current-books$/);
  const there = (await restingTop(page)) + 150;
  await scrollColumn(page, there);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("portal-scroll:/books#current-books"))).toBe(String(there));
  // The reloaded page's scripts are held back, and the reader scrolls on from wherever the reload put the column.
  let ready!: () => void;
  const held = new Promise<void>((done) => { ready = done; });
  await page.route("**/_next/static/chunks/**", async (route) => { await held; await route.continue(); });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLLinkElement>("link[rel=stylesheet]")].every((link) => link.sheet));
  const scrolled = (await columnTop(page)) + 200;
  await scrollColumn(page, scrolled);
  ready();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("portal-scroll:/books#current-books"))).toBe(String(scrolled));
  expect(await settledTop(page)).toBe(scrolled);
});

test("on an iPad, after Skip to content and then the page's own link, Back from another page finds the column where it was left", async ({ page }) => {
  await signInStudent(page);
  await page.setViewportSize({ width: 1180, height: 820 });
  await asAppleDevice(page);
  await page.goto("/references");
  await scrollColumn(page, 600);
  await page.locator(".skip-link").focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/references#portal-main$/);
  // Skip to content scrolls the column smoothly; the reader scrolls on once it has come to rest.
  await restingTop(page);
  // The router takes the #part off for this link without popstate or hashchange.
  await nav(page).getByRole("link", { name: "Sources & references" }).click();
  await expect(page).toHaveURL(/\/references$/);
  await scrollColumn(page, 900);
  await nav(page).getByRole("link", { name: "My Learning" }).click();
  await expect(page).toHaveURL(/\/student$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/references$/);
  await expect.poll(() => columnTop(page)).toBe(900);
});

test("on an iPad, after Skip to content and then the page's own link, Back and reload find the column where it was left, scrolled there or not", async ({ page }) => {
  await signInStudent(page);
  await page.setViewportSize({ width: 1180, height: 820 });
  await asAppleDevice(page);
  await page.goto("/references");
  await scrollColumn(page, 600);
  await page.locator(".skip-link").focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/references#portal-main$/);
  const left = await restingTop(page);
  // The router adds an entry for this same page without the #part; the reader leaves it without scrolling.
  await nav(page).getByRole("link", { name: "Sources & references" }).click();
  await expect(page).toHaveURL(/\/references$/);
  await page.waitForLoadState("networkidle");
  expect(await settledTop(page)).toBe(left);
  await nav(page).getByRole("link", { name: "My Learning" }).click();
  await expect(page).toHaveURL(/\/student$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/references$/);
  await page.waitForLoadState("networkidle");
  expect(await settledTop(page)).toBe(left);
  await page.reload();
  await page.waitForLoadState("networkidle");
  expect(await settledTop(page)).toBe(left);
});

test("on an iPad, Skip to content pressed again and then Back at once puts the column back, as the page does on a computer", async ({ page }) => {
  await signInStudent(page);
  await page.setViewportSize({ width: 1180, height: 820 });
  await asAppleDevice(page);
  await page.goto("/references");
  await scrollColumn(page, 600);
  const skip = async () => { await page.locator(".skip-link").focus(); await page.keyboard.press("Enter"); };
  await skip();
  await expect(page).toHaveURL(/\/references#portal-main$/);
  await restingTop(page);
  await scrollColumn(page, 300);
  // Pressed again, the link adds no history entry, so Back straight after it goes to the entry before Skip to content. Chromium
  // still fires popstate for it, so this checks the link filter and moved() together. The link scrolls the column smoothly back
  // to the part; Back comes once it is there, within the second in which a link just followed is left where the browser puts it.
  await page.evaluate(() => {
    const times = { clicked: 0, moved: 0 };
    Object.assign(window, { skipTimes: times });
    document.addEventListener("click", () => { times.clicked = performance.now(); }, { capture: true, once: true });
    window.addEventListener("popstate", () => { times.moved = performance.now(); });
  });
  await skip();
  await expect.poll(() => columnTop(page), { intervals: [50] }).toBe(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/references$/);
  await expect.poll(() => columnTop(page)).toBe(600);
  expect(await page.evaluate(() => sessionStorage.getItem("portal-scroll:/references"))).toBe("600");
  const { clicked, moved } = await page.evaluate(() => (window as unknown as { skipTimes: { clicked: number; moved: number } }).skipTimes);
  expect(moved - clicked, "Back came too late after Skip to content to check the column").toBeLessThan(1000);
});

test("on an iPad, a link to a part of the page opened in a new tab leaves Forward straight after it to put the column back", async ({ page }) => {
  await signInStudent(page);
  await page.setViewportSize({ width: 1180, height: 820 });
  await asAppleDevice(page);
  await page.goto("/books");
  await scrollColumn(page, 400);
  await page.locator('.portal-content a[href="#current-books"]').click();
  await expect(page).toHaveURL(/\/books#current-books$/);
  const there = (await restingTop(page)) + 150;
  await scrollColumn(page, there);
  await page.goBack();
  await expect(page).toHaveURL(/\/books$/);
  await expect.poll(() => columnTop(page)).toBe(400);
  // A Ctrl-click (Cmd-click on a Mac) opens the part in a new tab; this tab stays where it is. Forward comes before the new tab
  // is closed, within the second in which a link just followed is left where the browser puts it, and the test checks that.
  await page.evaluate(() => {
    const times = { clicked: 0, moved: 0 };
    Object.assign(window, { linkTimes: times });
    document.addEventListener("click", () => { times.clicked = performance.now(); }, { capture: true, once: true });
    window.addEventListener("popstate", () => { times.moved = performance.now(); }, { once: true });
  });
  await page.locator('.portal-content a[href="#review-queue"]').click({ modifiers: ["ControlOrMeta"] });
  await expect(page).toHaveURL(/\/books$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/books#current-books$/);
  await expect.poll(() => columnTop(page)).toBe(there);
  const { clicked, moved } = await page.evaluate(() => (window as unknown as { linkTimes: { clicked: number; moved: number } }).linkTimes);
  expect(moved - clicked, "Forward came too late after the click to check the column").toBeLessThan(1000);
  // Only this tab is checked here; the new tab is closed if the browser has opened it by now.
  for (const other of page.context().pages()) if (other !== page) await other.close();
});

test("on an iPad, Back and Forward after a link to a part of the page put the column back, as the page does on a computer", async ({ page }) => {
  await signInStudent(page);
  await page.setViewportSize({ width: 1180, height: 820 });
  await asAppleDevice(page);
  await page.goto("/books");
  await scrollColumn(page, 400);
  await page.locator('.portal-content a[href="#current-books"]').click();
  await expect(page).toHaveURL(/\/books#current-books$/);
  // The column scrolls smoothly to the part the link names; wait for it to come to rest.
  const there = await restingTop(page);
  expect(there).toBeGreaterThan(400);
  await page.goBack();
  await expect(page).toHaveURL(/\/books$/);
  await expect.poll(() => columnTop(page)).toBe(400);
  await page.goForward();
  await expect(page).toHaveURL(/\/books#current-books$/);
  await expect.poll(() => columnTop(page)).toBe(there);
});

test("on an iPad, Back from a worksheet puts the worksheet list back where it was", async ({ page }) => {
  await signInStudent(page);
  await page.setViewportSize({ width: 1180, height: 820 });
  await asAppleDevice(page);
  await page.goto("/worksheets");
  const last = page.locator('.portal-content a[href^="/worksheets/"]').last();
  await last.scrollIntoViewIfNeeded();
  const before = await columnTop(page);
  expect(before).toBeGreaterThan(300);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("portal-scroll:/worksheets"))).toBe(String(before));
  await last.click();
  await expect(page).toHaveURL(/\/worksheets\/.+/);
  await scrollColumn(page, 100);
  await page.goBack();
  await expect(page).toHaveURL(/\/worksheets$/);
  await expect.poll(() => columnTop(page)).toBe(before);
});

test("on an iPad, Back to a topic the studio opened in place, then the Topics link, leaves the column where it is, as on a computer", async ({ page, baseURL }) => {
  await signInAdmin(page, baseURL!);
  await page.setViewportSize({ width: 1180, height: 820 });
  await asAppleDevice(page);
  await page.goto("/teach/topics");
  // The studio shows the editor in place and changes its own address (history.replaceState); the page was opened at /teach/topics.
  await page.getByRole("button", { name: /^Edit:/ }).first().click();
  await expect(page).toHaveURL(/\/teach\/topics\?edit=/);
  await nav(page).getByRole("link", { name: "All classes" }).click();
  await expect(page).toHaveURL(/\/teach$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/teach\/topics\?edit=/);
  await expect(page.getByRole("button", { name: /^Edit:/ }).first()).toBeVisible();
  await scrollColumn(page, 250);
  await nav(page).getByRole("link", { name: "Topics", exact: true }).click();
  await expect(page).toHaveURL(/\/teach\/topics$/);
  await page.waitForLoadState("networkidle");
  expect(await columnTop(page)).toBe(250);
  // Next keeps the page as it is here, and only the shell renders again, for the new search params; whenever it next does (here
  // the phone menu, opened by script because its button is hidden at this width, and closed), the column must still stay where it is.
  await page.locator(".portal-menu").evaluate((menu) => (menu as HTMLButtonElement).click());
  await page.keyboard.press("Escape");
  await expect(page.locator(".portal-sidebar")).not.toHaveClass(/is-open/);
  expect(await columnTop(page)).toBe(250);
});

test("on an iPad, Back from the Topics link to the topic the studio opened in place puts the column back where it was there", async ({ page, baseURL }) => {
  await signInAdmin(page, baseURL!);
  await page.setViewportSize({ width: 1180, height: 820 });
  await asAppleDevice(page);
  await page.goto("/teach/topics");
  await page.getByRole("button", { name: /^Edit:/ }).first().click();
  await expect(page).toHaveURL(/\/teach\/topics\?edit=/);
  // The editor loads the topic before the column is tall enough to scroll.
  await expect(page.locator("form.portal-editor")).toBeVisible();
  await restingTop(page);
  await scrollColumn(page, 250);
  // The link changes only the search params, and the studio keeps showing the topic; Back returns to the topic's own entry.
  await nav(page).getByRole("link", { name: "Topics", exact: true }).click();
  await expect(page).toHaveURL(/\/teach\/topics$/);
  await page.waitForLoadState("networkidle");
  await scrollColumn(page, 300);
  await page.goBack();
  await expect(page).toHaveURL(/\/teach\/topics\?edit=/);
  await expect.poll(() => columnTop(page)).toBe(250);
  await page.goForward();
  await expect(page).toHaveURL(/\/teach\/topics$/);
  await expect.poll(() => columnTop(page)).toBe(300);
});

test("an administrator's Awaiting approval tile brings the approval queue into view and focuses it, on a computer as before and on an iPad", async ({ page, baseURL }) => {
  await signInAdmin(page, baseURL!);
  const tile = page.getByRole("button", { name: /Awaiting approval/ }), queue = page.locator("#approval-queue-title");
  // Where the heading comes to rest once any smooth scroll is over.
  const restingTop = () => queue.evaluate((heading) => new Promise<number>((done) => {
    let last = NaN, still = 0;
    const frame = () => {
      const top = Math.round(heading.getBoundingClientRect().top) + 0;
      still = top === last ? still + 1 : 0; last = top;
      if (still >= 10) done(top); else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }));
  // On a computer the tile does exactly what it always did, in a window too short to show the heading at first as well: the
  // heading comes to rest where scrolling to it and then focusing it puts it.
  for (const size of [{ width: 1180, height: 820 }, { width: 1024, height: 400 }]) {
    await page.setViewportSize(size);
    await page.goto("/admin");
    await expect(tile).toContainText(/\d/);
    await page.waitForLoadState("networkidle");
    await queue.evaluate((heading) => { heading.scrollIntoView({ block: "start" }); heading.focus(); });
    const before = await restingTop();
    await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo({ top: 0, behavior: "instant" }); });
    await tile.click();
    await expect(queue).toBeFocused();
    expect(await restingTop()).toBe(before);
    expect((await layout(page)).mainScroll).toBe(0);
  }
  // On an iPad the main column scrolls instead, and the heading lands just under the top, where the scroll padding leaves room,
  // unless the column runs out first.
  await page.setViewportSize({ width: 1180, height: 820 });
  await asAppleDevice(page);
  await page.goto("/admin");
  await expect(tile).toContainText(/\d/);
  await tile.click();
  await expect(queue).toBeFocused();
  const top = await restingTop(), now = await layout(page);
  expect(now.pageScroll).toBe(0);
  expect(now.mainScroll).toBeGreaterThan(0);
  expect(top === 90 || (now.mainScroll >= now.mainOverflow - 1 && top > 90 && top < now.viewport)).toBe(true);
});
