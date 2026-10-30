import { test, expect, type Page } from "@playwright/test";

const publicPages = ["/welcome", "/grown-ups", "/safety", "/student"];

// WCAG contrast of an element's text against the background it actually sits on (nearest painted ancestor).
function contrast(page: Page, selector: string) {
  return page.locator(selector).first().evaluate((element) => {
    const parse = (value: string) => {
      const [r, g, b, a = 1] = (value.match(/[\d.]+/g) ?? []).map(Number);
      return { r, g, b, a };
    };
    const over = (top: ReturnType<typeof parse>, bottom: ReturnType<typeof parse>) => ({
      r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1,
    });
    const layers = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      const color = parse(getComputedStyle(node).backgroundColor);
      if (color.a > 0) layers.push(color);
      if (color.a >= 1) break;
    }
    const background = layers.reduceRight((below, layer) => over(layer, below), parse(getComputedStyle(document.body).backgroundColor));
    const text = over(parse(getComputedStyle(element).color), background);
    const luminance = ({ r, g, b }: { r: number; g: number; b: number }) => {
      const channel = (value: number) => { const v = value / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const [light, dark] = [luminance(text), luminance(background)].sort((a, b) => b - a);
    return (light + 0.05) / (dark + 0.05);
  });
}

test("signed-out visitors are not told they are offline, and the banner follows the real connection", async ({ page, context }) => {
  for (const path of ["/welcome", "/grown-ups"]) {
    // The server sends no banner: Node's navigator has no onLine, which used to render "You are offline".
    expect(await (await page.request.get(path)).text()).not.toContain("pwa-status");
    await page.goto(path, { waitUntil: "networkidle" });
    await expect(page.getByRole("status").filter({ hasText: "You are offline" })).toHaveCount(0);
    await expect(page.locator(".pwa-status")).toHaveCount(0);
  }
  await context.setOffline(true);
  await expect(page.locator(".pwa-status.offline")).toContainText("You are offline");
  await context.setOffline(false);
  await expect(page.locator(".pwa-status")).toHaveCount(0);
});

for (const width of [1920, 1280, 1024, 820, 768, 390]) {
  test(`the safety page fits a ${width}px screen without sideways scrolling`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/safety");
    await expect(page.getByRole("heading", { name: "A teacher approves every lesson" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const sections = await page.locator(".safety-section").evaluateAll((elements) => elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, overflow: element.scrollWidth - element.clientWidth };
    }));
    expect(sections.length).toBeGreaterThan(0);
    for (const section of sections) {
      expect(section.left).toBeGreaterThanOrEqual(0);
      expect(section.right).toBeLessThanOrEqual(width);
      expect(section.overflow).toBeLessThanOrEqual(0);
    }
  });
}

for (const path of ["/grown-ups", "/safety"]) {
  test(`the language button on ${path} is usable on a phone`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path, { waitUntil: "networkidle" });
    const button = page.getByRole("button", { name: "বাংলায় দেখুন" });
    await expect(button).toBeVisible();
    await button.click();
    await expect(page.locator("main")).toHaveAttribute("lang", "bn");
    await expect(page.locator("html")).toHaveAttribute("lang", "bn");
    await expect(page.getByRole("navigation", { name: "প্ল্যাটফর্মের তথ্য" })).toBeVisible();
    await expect(page.getByRole("button", { name: "View in English" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
}

for (const path of ["/grown-ups", "/safety"]) {
  test(`the header on ${path} keeps the language button without covering a sideways phone or tablet`, async ({ page }) => {
    for (const [width, height] of [[1000, 600], [915, 412], [844, 390], [768, 500]]) {
      await page.setViewportSize({ width, height });
      await page.goto(path, { waitUntil: "networkidle" });
      await expect(page.getByRole("button", { name: "বাংলায় দেখুন" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      // Once the page is scrolled, a header that stays on screen may keep one row (76px), not two.
      const covered = await page.evaluate(async () => {
        document.documentElement.style.scrollBehavior = "auto";
        window.scrollTo(0, 600);
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return Math.max(0, document.querySelector(".adult-header")!.getBoundingClientRect().bottom);
      });
      expect(covered, `${width}x${height}`).toBeLessThanOrEqual(80);
    }
  });
}

for (const width of [1280, 390]) {
  test(`public pages have no text under 12px and readable small text at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const path of publicPages) {
      await page.goto(path, { waitUntil: "networkidle" });
      const tiny = await page.evaluate(() => Array.from(document.querySelectorAll("body *")).flatMap((element) => {
        const text = Array.from(element.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent?.trim()).join(" ").trim();
        const box = element.getBoundingClientRect();
        if (!text || box.width <= 1 || box.height <= 1 || !element.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return [];
        const size = parseFloat(getComputedStyle(element).fontSize);
        return size < 12 ? [`${element.tagName.toLowerCase()} ${size}px "${text.slice(0, 40)}"`] : [];
      }));
      expect(tiny, path).toEqual([]);
      for (const selector of [".adult-eyebrow", ".adult-brand small", ".adult-header nav a"]) {
        if (await page.locator(selector).count()) expect(await contrast(page, selector), `${path} ${selector}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
}

test("the welcome footer text and privacy link are readable", async ({ page }) => {
  await page.goto("/welcome");
  for (const selector of [".welcome-footer strong", ".welcome-footer span", ".welcome-footer a"]) {
    expect(await contrast(page, selector), selector).toBeGreaterThanOrEqual(4.5);
  }
});

test("pages use the Geist stack with the Bengali fonts after it", async ({ page }) => {
  await page.goto("/welcome");
  const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(family).toMatch(/^Geist/);
  expect(family).toContain("Noto Sans Bengali");
  // Only Geist is preloaded; Geist Mono loads on the pages whose code text uses it.
  expect(await page.locator('link[rel="preload"][as="font"]').count()).toBe(1);
  await page.goto("/safety", { waitUntil: "networkidle" });
  expect(await page.evaluate(async () => {
    await document.fonts.ready;
    return Array.from(document.fonts).some((font) => font.family.includes("Geist Mono") && font.status === "loaded");
  })).toBe(true);
});

test("Bangla mode sets the page language and translates labels and the offline banner", async ({ page, context }) => {
  await page.goto("/welcome", { waitUntil: "networkidle" });
  await expect(page.getByRole("navigation", { name: "Welcome navigation" })).toBeVisible();
  await expect(page).toHaveTitle("Welcome | Bangla Adventures");
  await page.getByRole("button", { name: "বাংলা", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "bn");
  await expect(page).toHaveTitle("স্বাগতম | Bangla Adventures");
  await expect(page.getByRole("navigation", { name: "স্বাগতম পাতার মেনু" })).toBeVisible();
  await context.setOffline(true);
  await expect(page.locator(".pwa-status.offline")).toContainText("ইন্টারনেট সংযোগ নেই");
  await expect(page.locator(".pwa-status.offline")).toHaveAttribute("lang", "bn");
  await context.setOffline(false);

  // The choice is kept between pages, opened directly or through a link, and the tab title follows it.
  await page.getByRole("navigation", { name: "স্বাগতম পাতার মেনু" }).getByRole("link").click();
  await expect(page).toHaveURL(/\/safety$/);
  await expect(page).toHaveTitle("নিরাপত্তা, গোপনীয়তা ও প্রবেশগম্যতা | Bangla Adventures");
  await page.goto("/student", { waitUntil: "networkidle" });
  await expect(page.locator("html")).toHaveAttribute("lang", "bn");
  await expect(page).toHaveTitle("শিক্ষার্থীর সাইন ইন | Bangla Adventures");
  await expect(page.getByRole("tablist", { name: "শিক্ষার্থীর অ্যাকাউন্ট" })).toBeVisible();
  await expect(page.getByLabel("ব্যবহারকারীর নাম")).toHaveAttribute("title", /ইংরেজি অক্ষর/);
  await page.goto("/safety", { waitUntil: "networkidle" });
  await expect(page).toHaveTitle("নিরাপত্তা, গোপনীয়তা ও প্রবেশগম্যতা | Bangla Adventures");
  await expect(page.getByRole("link", { name: /ইউটিউব এমবেড/ })).toBeVisible();
  await expect(page.getByRole("table", { name: "তথ্য সংগ্রহের মানচিত্র" })).toBeVisible();
  await page.goto("/grown-ups", { waitUntil: "networkidle" });
  await expect(page).toHaveTitle("বড়দের সাইন ইন | Bangla Adventures");
  await expect(page.getByRole("tablist", { name: "সাইন ইন বা অ্যাকাউন্ট তৈরি" })).toBeVisible();
  await page.getByRole("button", { name: "View in English" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveTitle("Grown-up sign in | Bangla Adventures");
});
