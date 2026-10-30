import { test, expect, type Locator, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

test.beforeEach(async ({ page, context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": `learner-test-${randomUUID()}` });
  const username = `learner-${randomUUID().slice(0, 12)}`, password = "Learning-test-password";
  const response = await page.request.post("/api/student/sign-up", { data: { username, displayName: "Learning test", password } });
  expect(response.status()).toBe(201);
  // Self sign-ups wait for an administrator: approve directly, then sign in.
  if (!process.env.BANGLA_E2E_DB?.includes("bangla-e2e-")) throw new Error("An isolated E2E database is required.");
  const db = new Database(process.env.BANGLA_E2E_DB);
  db.prepare("UPDATE students SET approval_status = 'approved' WHERE username = ?").run(username);
  db.close();
  expect((await page.request.post("/api/student/sign-in", { data: { username, password } })).status()).toBe(200);
});

for (const width of [1366, 390]) {
  test(`student sidebar exposes learning topics directly at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/student");
    const openMenu = async () => {
      if (width < 650) {
        await page.getByRole("button", { name: "Menu", exact: true }).click();
        await expect(page.locator(".portal-sidebar")).toHaveCSS("left", "0px");
      }
    };
    await openMenu();
    const navigation = page.getByRole("navigation", { name: "Portal navigation" });
    await expect(navigation.getByRole("link", { name: "Learning topics", exact: true })).toHaveCount(1);
    await navigation.getByRole("link", { name: "Learning topics", exact: true }).click();
    await expect(page).toHaveURL(/\/topics$/);
    await openMenu();
    await expect(navigation.getByRole("link", { name: "Learning topics", exact: true })).toHaveAttribute("aria-current", "page");
    await navigation.getByRole("link", { name: "Sources & references", exact: true }).click();
    await expect(page).toHaveURL(/\/references$/);
    await openMenu();
    await expect(navigation.getByRole("link", { name: "Learning topics", exact: true })).toHaveCount(1);
    await navigation.getByRole("link", { name: "My Learning", exact: true }).click();
    await expect(page).toHaveURL(/\/student$/);
    await page.reload();
    await openMenu();
    await expect(navigation.getByRole("link", { name: "Learning topics", exact: true })).toBeVisible();
  });
}

test("student home refresh stays in My Learning and guided practice remains available", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/student$/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "My Learning", exact: true })).toBeVisible();
  await page.goto("/adventure");
  await expect(page.getByRole("button", { name: /Start|শুরু/ }).first()).toBeVisible();
});

test("the learn hub lists the activity cards and they navigate", async ({ page }) => {
  await page.goto("/learn");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("link", { name: /Bornomala|alphabet/i }).first().click();
  await expect(page).toHaveURL(/\/alphabet/);
  await expect(page.getByText("স্বরবর্ণ").first()).toBeVisible();
});

test("alphabet shows vowels, consonants and conjuncts", async ({ page }) => {
  await page.goto("/alphabet");
  await expect(page.getByRole("heading", { name: /যুক্তবর্ণ/ })).toBeVisible();
  await expect(page.getByText("অজগর").first()).toBeVisible();
});

test("the counting game reveals the answer after a pick", async ({ page }) => {
  await page.goto("/numbers");
  const options = page.locator(".counting-option");
  await expect(options.first()).toBeVisible();
  await options.first().click();
  await expect(page.locator(".counting-result")).toBeVisible();
});

test("a story can be opened and paged to its question", async ({ page }) => {
  await page.goto("/stories");
  await page.locator(".story-card").first().click();
  await expect(page.locator(".story-page")).toBeVisible();
  // Page through to the comprehension question.
  for (let i = 0; i < 5; i += 1) {
    const next = page.getByRole("button", { name: /Next page|Question time|পরের পাতা|প্রশ্নের পালা/ });
    if (await next.isVisible().catch(() => false)) {
      await next.click();
    } else {
      break;
    }
  }
  await expect(page.locator(".counting-question")).toBeVisible();
});

test("language toggle switches an activity page to Bangla", async ({ page }) => {
  await page.goto("/phrasebook");
  await page.locator(".portal-topbar").getByRole("button", { name: "বাংলা", exact: true }).click();
  await expect(page.locator(".portal-topbar").getByRole("button", { name: "English", exact: true })).toBeVisible();
});

test("Bangla mode reaches the tab title and labels on signed-in pages, including the worksheet, book and adventure pages", async ({ page }) => {
  await page.goto("/alphabet");
  await expect(page).toHaveTitle("Bornomala — the Bangla alphabet | Bangla Adventures");
  await page.locator(".portal-topbar").getByRole("button", { name: "বাংলা", exact: true }).click();
  await expect(page).toHaveTitle("বর্ণমালা — বাংলা বর্ণ | Bangla Adventures");
  // The hub's own header is hidden inside the portal, but its label still follows the language.
  await expect(page.locator(".explore-header nav")).toHaveAttribute("aria-label", "বিভাগ");
  await expect(page.getByRole("button", { name: /^স আর ক মিলে স্ক।/ })).toBeVisible();

  // The language button is marked with the language its own label is in.
  await expect(page.locator(".portal-topbar").getByRole("button", { name: "English", exact: true })).toHaveAttribute("lang", "en");

  // Server-rendered pages take the language from the portal around them; their English-only content stays marked English.
  const nearestLang = (selector: string) => page.locator(selector).first().evaluate((element) => element.closest("[lang]")?.getAttribute("lang"));
  await page.goto("/worksheets");
  await expect(page).toHaveTitle("প্রিন্ট করার ওয়ার্কশিট | Bangla Adventures");
  await expect(page.locator(".adult-header nav")).toHaveAttribute("aria-label", "প্ল্যাটফর্মের তথ্য");
  await expect(page.getByRole("heading", { level: 1, name: "প্রতিটি পাঠের জন্য একটি প্রিন্ট করার ওয়ার্কশিট।" })).toBeVisible();
  expect(await nearestLang(".worksheet-band > p")).toBe("en");
  await page.goto("/worksheets/hello-me");
  expect(await nearestLang(".worksheet-cando")).toBe("en");
  await expect(page.locator(".worksheet-trace").first()).toHaveAttribute("aria-label", "লেখা অনুশীলনের জায়গা");
  await expect(page.locator(".worksheet-trace").first()).toHaveAttribute("lang", "bn");
  await page.goto("/books");
  await expect(page).toHaveTitle("এনসিটিবি Book Bridge | Bangla Adventures");
  await expect(page.getByRole("region", { name: "এনসিটিবি যাচাইয়ের সারাংশ" })).toHaveAttribute("lang", "bn");
  expect(await nearestLang("#book-bridge-title")).toBe("en");
  expect(await nearestLang("[class*=auditStrip] span")).toBe("en");
  await page.locator(".portal-topbar").getByRole("button", { name: "English", exact: true }).click();
  await expect(page).toHaveTitle("NCTB Book Bridge | Bangla Adventures");
  await expect(page.getByRole("navigation", { name: "Book Bridge navigation" })).toBeVisible();
  await expect(page.getByRole("region", { name: "NCTB audit summary" })).toBeVisible();

  // The adventure page has its own switch, but it shares the saved choice, the page language and the tab title.
  await page.goto("/adventure");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.locator(".language-switch").getByRole("button", { name: "বাংলা", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "মূল মেনু" })).toBeVisible();
  await expect(page.locator(".language-switch")).toHaveAttribute("aria-label", "ভাষা");
  await expect(page.getByRole("img", { name: "হাসিখুশি বাঘ আর বাংলাদেশের চেনা জায়গাসহ নদীর রঙিন ছবির মানচিত্র" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "bn");
  await expect(page).toHaveTitle("Bangla Adventures | শিশুদের জন্য বাংলাদেশের সংস্কৃতি, ইতিহাস ও সাহিত্য");
  await page.reload();
  await expect(page.getByRole("navigation", { name: "মূল মেনু" })).toBeVisible();

  // The placement guide and the lessons have Bangla buttons, and their small labels are readable.
  await page.getByRole("button", { name: "আমার শুরুর ধাপ খুঁজি" }).click();
  const guide = page.getByRole("dialog", { name: "শুরুর ধাপের নির্দেশিকা" });
  await expect(guide.getByRole("button", { name: "পরের দক্ষতা →" })).toBeVisible();
  await expect(guide.getByRole("button", { name: "← বন্ধ করি" })).toBeVisible();
  await expect(guide.getByText("৪টির মধ্যে ১ নম্বর অংশ")).toHaveCSS("font-size", "12px");
  await page.keyboard.press("Escape");
  await page.goto("/adventure?module=hello-me");
  const lesson = page.getByRole("dialog", { name: "পুরো পাঠ" });
  await expect(lesson.getByRole("button", { name: "পরের", exact: true })).toBeVisible();
  await expect(lesson.getByRole("button", { name: "← আগের" })).toBeDisabled();
  await expect(lesson.locator(".module-session-seal small")).toHaveCSS("font-size", "12px");
  await page.keyboard.press("Escape");
  await page.locator(".language-switch").getByRole("button", { name: "EN", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveTitle("Bangla Adventures | Bangladesh's culture, history & literature for kids");
});

for (const width of [390, 768]) {
  test(`the book bridge fits a ${width}px screen and its wide tables scroll inside their own box`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/books");
    await expect(page.locator("#book-bridge-title")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect(await page.locator("section[aria-labelledby=book-bridge-title]").evaluate((element) => element.getBoundingClientRect().right)).toBeLessThanOrEqual(width);
  });
}

test("a new release offers a reload instead of throwing away the draft a learner is writing", async ({ page }) => {
  await page.goto("/adventure?module=hello-me");
  const lesson = page.getByRole("dialog", { name: "Full curriculum lesson" });
  await lesson.getByRole("navigation", { name: "Lesson sections" }).getByRole("button", { name: /Write$/ }).click();
  const draft = lesson.locator(".writing-pad textarea");
  await draft.fill("আমার নাম মায়া।");
  await page.evaluate(() => { (window as unknown as { sameLoad: boolean }).sameLoad = true; });

  // A new build goes live: the session check now reports another release.
  await page.route("**/api/auth/session", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), release: "next-release" } });
  });
  const checked = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/auth/session");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await checked;
  // The open lesson has the learner's attention: the live region stays empty, so nothing is announced over it.
  const region = page.locator(".pwa-announcer[role=status][aria-live=polite]");
  const notice = region.locator(".pwa-status");
  await page.waitForTimeout(500);
  await expect(region).toBeEmpty();
  await expect(draft).toHaveValue("আমার নাম মায়া।");
  expect(await page.evaluate(() => (window as unknown as { sameLoad?: boolean }).sameLoad)).toBe(true);

  // Closing the lesson puts the notice into the live region, so screen readers announce it; the learner reloads when ready.
  await page.keyboard.press("Escape");
  await expect(lesson).toHaveCount(0);
  await expect(region).toContainText("A new version is ready");
  await expect(notice).toBeVisible();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as { sameLoad?: boolean }).sameLoad)).toBe(true);
  await page.unroute("**/api/auth/session");
  await Promise.all([page.waitForEvent("load"), notice.getByRole("button", { name: "Reload" }).click()]);
  expect(await page.evaluate(() => (window as unknown as { sameLoad?: boolean }).sameLoad)).toBeUndefined();
  await expect(page.locator(".pwa-status")).toHaveCount(0);
});

test("the offline banner waits for an open lesson to close, then goes into the live region", async ({ page, context }) => {
  await page.goto("/adventure?module=hello-me");
  const lesson = page.getByRole("dialog", { name: "Full curriculum lesson" });
  await expect(lesson).toBeVisible();
  const region = page.locator(".pwa-announcer[role=status][aria-live=polite]");
  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await page.waitForTimeout(500);
  await expect(region).toBeEmpty();
  await page.keyboard.press("Escape");
  await expect(lesson).toHaveCount(0);
  await expect(region.locator(".pwa-status.offline")).toContainText("You are offline");
  // Opening another lesson takes the banner out again; back online, it is gone.
  await page.getByRole("button", { name: /Open six-session lesson|Continue lesson/ }).first().click();
  await expect(page.getByRole("dialog", { name: "Full curriculum lesson" })).toBeVisible();
  await expect(region).toBeEmpty();
  await context.setOffline(false);
  await page.keyboard.press("Escape");
  await expect(region).toBeEmpty();
});

const lessonSteps = ["overview", "listening", "reading", "speaking", "writing", "culture", "mastery"];

/** Opens each step of the open lesson in turn and shows what it can show: transcripts, scaffolds, models and answer feedback. */
async function walkLesson(lesson: Locator, check: (step: string) => Promise<void>) {
  for (const [index, step] of lessonSteps.entries()) {
    await lesson.locator(".lesson-step-tabs button").nth(index).click();
    await expect(lesson.locator(".lesson-step-tabs button").nth(index)).toHaveAttribute("aria-current", "step");
    if (step === "listening" || step === "reading") {
      await lesson.locator(".lesson-pane .text-button").first().click();
      await lesson.locator(".session-check-options button").first().click();
      await lesson.locator(".session-check .compact-button").click();
      await expect(lesson.locator(".session-feedback")).toBeVisible();
    }
    if (step === "speaking") await lesson.locator(".success-checklist input").first().check();
    if (step === "writing") {
      await lesson.locator(".writing-pad textarea").fill("আমার নাম মায়া।");
      await lesson.locator(".model-answer-card .text-button").click();
    }
    if (step === "culture") for (const box of await lesson.locator(".video-learning-cycle input").all()) await box.check();
    if (step === "mastery") {
      await lesson.locator(".lesson-check-button").click();
      await expect(lesson.locator(".mastery-result")).toBeVisible();
      for (const question of await lesson.locator(".lesson-quiz-question").all()) await question.locator(".lesson-quiz-options button").first().click();
      await lesson.locator(".lesson-check-button").click();
    }
    await check(step);
  }
}

/**
 * Visible text written in the other script than the page language and not marked with its own language: Latin
 * letters in Bangla mode (outside lang="en" and transliterated bn-Latn), Bangla letters in English mode (outside lang="bn").
 */
function unmarkedText(root: Locator, language: "en" | "bn") {
  return root.evaluate((element, language) => {
    const found: string[] = [];
    for (const node of element.querySelectorAll("*")) {
      const text = Array.from(node.childNodes).filter((child) => child.nodeType === Node.TEXT_NODE).map((child) => child.textContent).join("").trim();
      // A text box holds the learner's own words, in either language.
      if (!text || node.matches("textarea") || !(node as HTMLElement).checkVisibility()) continue;
      const lang = node.closest("[lang]")?.getAttribute("lang") ?? "";
      // Product names stay as they are in both languages.
      if (language === "bn" && /[A-Za-z]/.test(text.replace(/\bYouTube\b/g, "")) && !/^(en|bn-Latn)$/.test(lang)) found.push(`${text} (lang=${lang})`);
      if (language === "en" && /[\u0980-\u09ff]/.test(text) && lang !== "bn") found.push(`${text} (lang=${lang})`);
    }
    return found;
  }, language);
}

for (const language of ["bn", "en"] as const) {
  test(`every step of a lesson in ${language === "bn" ? "Bangla" : "English"} has its interface in that language and marks the other`, async ({ page }) => {
    await page.addInitScript((choice) => window.localStorage.setItem("bangla-adventures-language", choice), language);
    await page.goto("/adventure?module=hello-me");
    const lesson = page.getByRole("dialog", { name: language === "bn" ? "পুরো পাঠ" : "Full curriculum lesson" });
    await expect(lesson).toBeVisible();
    await walkLesson(lesson, async (step) => {
      expect(await unmarkedText(lesson, language), step).toEqual([]);
    });
    if (language === "bn") {
      await expect(lesson.getByRole("button", { name: "আমার উত্তর যাচাই করি" })).toBeVisible();
      await expect(lesson.getByText("Check my answers")).toHaveCount(0);
      await lesson.locator(".lesson-step-tabs button").nth(3).click();
      await expect(lesson.getByRole("button", { name: "● মাইক চালু করে রেকর্ড করি" })).toBeVisible();
      await lesson.locator(".lesson-step-tabs button").nth(5).click();
      await expect(lesson.getByRole("button", { name: "গোপনীয়তা-সুরক্ষিত ভিডিও খুলি ▶" })).toBeVisible();
    }
  });
}

/** Visible text under 12px, and small text under 4.5:1 against a plain background behind it. */
function smallOrFaintText(root: Locator) {
  return root.evaluate((element) => {
    const rgba = (value: string) => { const parts = value.match(/[\d.]+/g)!.map(Number); return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 }; };
    const over = (top: ReturnType<typeof rgba>, bottom: ReturnType<typeof rgba>) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
    const luminance = ({ r, g, b }: ReturnType<typeof rgba>) => [r, g, b].map((value) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((sum, c, index) => sum + c * [0.2126, 0.7152, 0.0722][index], 0);
    /** The plain colour behind an element, or null when a picture or gradient is behind it. */
    const background = (node: Element) => {
      const layers = [];
      for (let current: Element | null = node; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (style.backgroundImage !== "none" && current !== document.body) return null;
        const color = rgba(style.backgroundColor);
        if (color.a > 0) layers.push(color);
        if (color.a === 1) return layers.reduceRight((below, layer) => over(layer, below));
      }
      return null;
    };
    const found: string[] = [];
    for (const node of element.querySelectorAll("*")) {
      const text = Array.from(node.childNodes).filter((child) => child.nodeType === Node.TEXT_NODE).map((child) => child.textContent).join("").trim();
      if (!text || !(node as HTMLElement).checkVisibility()) continue;
      const style = getComputedStyle(node);
      const size = parseFloat(style.fontSize);
      if (size < 12) found.push(`${size}px: ${text.slice(0, 40)}`);
      // Contrast is for words: decorative marks are hidden from screen readers, and disabled buttons are exempt.
      if (node.closest("[aria-hidden=true], :disabled") || size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700)) continue;
      const behind = background(node);
      if (!behind) continue;
      const [light, dark] = [luminance(over(rgba(style.color), behind)), luminance(behind)].sort((a, b) => b - a);
      const ratio = (light + 0.05) / (dark + 0.05);
      if (ratio < 4.5) found.push(`${ratio.toFixed(2)}:1: ${text.slice(0, 40)}`);
    }
    return found;
  });
}

async function fitsWidth(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

for (const width of [390, 1280]) {
  for (const language of ["en", "bn"] as const) {
    test(`the adventure page and every lesson step keep text at 12px or more with clear contrast at ${width}px in ${language === "bn" ? "Bangla" : "English"}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 800 });
      await page.addInitScript((choice) => window.localStorage.setItem("bangla-adventures-language", choice), language);
      await page.goto("/adventure");
      await expect(page.locator(".lesson-card").first()).toBeVisible();
      expect(await smallOrFaintText(page.locator("body"))).toEqual([]);
      await fitsWidth(page);
      await page.goto("/adventure?module=hello-me");
      const lesson = page.getByRole("dialog");
      await expect(lesson).toBeVisible();
      await walkLesson(lesson, async (step) => {
        expect(await smallOrFaintText(lesson), step).toEqual([]);
        await fitsWidth(page);
      });
    });
  }
}

test("on a tall tablet screen the lesson's close button stays in its corner, clear of the session seal, while the lesson scrolls", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto("/adventure?module=hello-me");
  const lesson = page.getByRole("dialog");
  const close = lesson.getByRole("button", { name: "Close", exact: true });
  await expect(close).toBeVisible();
  const box = async (locator: Locator) => (await locator.boundingBox())!;
  const [closeBox, sealBox] = [await box(close), await box(lesson.locator(".module-session-seal"))];
  const apart = closeBox.y + closeBox.height <= sealBox.y || sealBox.y + sealBox.height <= closeBox.y || closeBox.x + closeBox.width <= sealBox.x || sealBox.x + sealBox.width <= closeBox.x;
  expect(apart).toBe(true);
  for (const scrollTop of [0, 700]) {
    await lesson.evaluate((element, top) => { element.scrollTop = top; }, scrollTop);
    const [now, dialog] = [await box(close), await box(lesson)];
    expect(now.y - dialog.y).toBeLessThan(30);
    expect(dialog.x + dialog.width - (now.x + now.width)).toBeLessThan(30);
  }
});

// Students now see only approved topics, so the draft notices are gone; the textbook sources stay.
test("approved topics appear by category without draft notices", async ({ page }) => {
  await page.goto("/topics");
  await expect(page.getByRole("region", { name: "Our country — symbols, rivers & nature" }).getByRole("button", { name: /Symbols of Bangladesh/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "History & the national story" }).getByRole("button", { name: /Symbols of Bangladesh/ })).toHaveCount(0);
  await expect(page.getByText(/Candidate content — review mode/i)).toHaveCount(0);
  await page.getByRole("button", { name: /Ekushey — the day a language was defended/i }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Ekushey/ })).toBeVisible();
  await expect(page.getByText(/Draft for educator review/i)).toHaveCount(0);
  await expect(page.getByText(/This topic is linked to these NCTB government textbooks/i)).toBeVisible();
});
