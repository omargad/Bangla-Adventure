import { test, expect, type Page, type Locator } from "@playwright/test";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

// The app runs with no ELEVENLABS_API_KEY (see playwright.config.ts), like the
// public demo: /api/narration is not mocked, so every Listen below really asks
// the server, which has no saved audio for this new text and cannot make any.
const password = "Narration-fallback-e2e-password-2026";
const calmNote = "Audio isn't available for this text on this device yet. Read it on the screen instead.";
const elevenLabs = "Neural computer voice (ElevenLabs, elevenlabs.io)";
const deviceVoice = "This device's voice";
type Spoken = { text: string; lang: string; voice: string | null };
type SpeechState = { spoken: Spoken[]; cancels: number };

function fixture(callback: (db: Database.Database) => void) {
  if (!process.env.BANGLA_E2E_DB?.includes("bangla-e2e-")) throw new Error("An isolated E2E database is required.");
  const db = new Database(process.env.BANGLA_E2E_DB);
  try { callback(db); } finally { db.close(); }
}

async function api(page: Page, method: string, url: string, body?: unknown) {
  return page.evaluate(async ({ method, url, body }) => {
    const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }, { method, url, body });
}

/**
 * Stands in for the device's speech: it reports the voices in `window.__voices`
 * (none until a test sets some), records what it is asked to say, starts at
 * once and ends after `window.__speechMs`. Nothing is really spoken.
 */
async function stubSpeech(page: Page) {
  await page.addInitScript(() => {
    const win = window as unknown as { __speech: SpeechState; __voices: Array<{ lang: string; name: string }>; __speechMs: number };
    win.__speech = { spoken: [], cancels: 0 };
    win.__voices = [];
    win.__speechMs = 300;
    window.speechSynthesis.getVoices = () => win.__voices.map((voice) => ({ ...voice, voiceURI: voice.name, localService: true, default: false })) as unknown as SpeechSynthesisVoice[];
    // Real utterances only accept real voices; let them carry the stand-ins.
    const RealUtterance = window.SpeechSynthesisUtterance;
    window.SpeechSynthesisUtterance = class extends RealUtterance {
      constructor(text?: string) {
        super(text);
        let chosen: SpeechSynthesisVoice | null = null;
        Object.defineProperty(this, "voice", { configurable: true, get: () => chosen, set: (value) => { chosen = value; } });
      }
    } as typeof SpeechSynthesisUtterance;
    let current: SpeechSynthesisUtterance | null = null;
    window.speechSynthesis.cancel = () => {
      win.__speech.cancels += 1;
      const cancelled = current;
      current = null;
      cancelled?.onerror?.({ error: "interrupted" } as SpeechSynthesisErrorEvent);
    };
    window.speechSynthesis.speak = (utterance) => {
      win.__speech.spoken.push({ text: utterance.text, lang: utterance.lang, voice: utterance.voice?.lang ?? null });
      current = utterance;
      window.setTimeout(() => {
        if (current !== utterance) return;
        utterance.onstart?.(new Event("start") as SpeechSynthesisEvent);
        window.setTimeout(() => {
          if (current !== utterance) return;
          current = null;
          utterance.onend?.(new Event("end") as SpeechSynthesisEvent);
        }, win.__speechMs);
      }, 20);
    };
  });
}

const speech = (page: Page) => page.evaluate(() => (window as unknown as { __speech: SpeechState }).__speech);
const setVoices = (page: Page, voices: Array<{ lang: string; name: string }>, speechMs = 300) =>
  page.evaluate(({ voices, speechMs }) => {
    const win = window as unknown as { __voices: typeof voices; __speechMs: number };
    win.__voices = voices;
    win.__speechMs = speechMs;
  }, { voices, speechMs });
const english = { lang: "en-US", name: "English (US)" };
const bangla = { lang: "bn-BD", name: "Bangla (Bangladesh)" };

/** Clicks a Listen button and returns the server's reply to the narration request it made. */
async function listen(page: Page, button: Locator) {
  const reply = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/narration" && response.request().method() === "POST");
  await button.click();
  const response = await reply;
  return { status: response.status(), body: await response.json() as Record<string, unknown> };
}

test("with no narration key, Listen reads text with the device's voice for its language, or says calmly that it cannot", async ({ page, browser, baseURL }, testInfo) => {
  test.setTimeout(120000);
  const suffix = randomUUID().slice(0, 8);
  const adminEmail = `fallback-admin-${suffix}@example.com`, username = `fallback.${suffix}`;
  const adminContext = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": `fallback-admin-${suffix}` } });
  const visitor = await browser.newContext({ baseURL });
  try {
    const admin = await adminContext.newPage();
    expect((await admin.request.post("/api/auth/sign-up", { data: { email: adminEmail, displayName: "Fallback Administrator", password } })).status()).toBe(201);
    fixture((db) => { db.prepare("UPDATE adults SET role='admin', approval_status='approved' WHERE email=?").run(adminEmail); });
    expect((await admin.request.post("/api/auth/sign-in", { data: { email: adminEmail, password } })).status()).toBe(200);
    await admin.goto("/admin");
    const pair = (en: string, bn: string) => ({ en, bn });
    const content = {
      theme: "our-country", emoji: "🌊", title: pair(`Fallback rivers ${suffix}`, `নদীর গল্প ${suffix}`), tagline: pair("Read about our rivers.", "আমাদের নদীর কথা পড়ো।"), minutes: 3,
      sections: [{ heading: pair("Boats", "নৌকা"), body: pair("Boats carry people across the river.", "নৌকা মানুষকে নদী পার করে।") }],
      funFacts: [pair("The Padma is a river.", "পদ্মা একটি নদী।")], quiz: [],
    };
    const createdTopic = await api(admin, "POST", "/api/topics", content);
    expect(createdTopic.status).toBe(201);
    expect(createdTopic.body.status).toBe("approved");
    const topicId = createdTopic.body.topicId as string;
    await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `fallback-student-${suffix}` });
    const registered = await page.request.post("/api/student/sign-up", { data: { username, displayName: "Fallback learner", password } });
    expect(registered.status()).toBe(201);
    const studentId = (await registered.json()).student.id as string;
    fixture((db) => { db.prepare("UPDATE students SET approval_status='approved' WHERE id=?").run(studentId); });
    const createdClass = await api(admin, "POST", "/api/classes", { name: `Fallback class ${suffix}` });
    expect(createdClass.status).toBe(201);
    const classId = createdClass.body.class.id as string;
    expect((await api(admin, "POST", `/api/classes/${classId}/students`, { studentIds: [studentId] })).status).toBe(200);
    const activity = { title: `River check ${suffix}`, instructions: "Read the question and choose one answer.", questions: [{ prompt: "কোনটি নদী?", options: ["Padma", "A mountain"], answer: 0 }] };
    expect((await api(admin, "POST", `/api/classes/${classId}/activities`, activity)).status).toBe(201);
    expect((await page.request.post("/api/student/sign-in", { data: { username, password } })).status()).toBe(200);

    // Whether new narration is configured: a boolean for signed-in readers only.
    expect((await visitor.request.get("/api/narration")).status()).toBe(401);
    await stubSpeech(page);
    await page.goto(`/topics?topic=${topicId}`);
    await expect(page.getByRole("heading", { level: 1, name: content.title.en, exact: true })).toBeVisible();
    expect(await api(page, "GET", "/api/narration")).toEqual({ status: 200, body: { configured: false } });
    // Only a boolean, kept privately for a minute.
    expect(await page.evaluate(async () => {
      const response = await fetch("/api/narration", { cache: "no-store" });
      return { cache: response.headers.get("cache-control"), body: await response.text() };
    })).toEqual({ cache: "private, max-age=60", body: '{"configured":false}' });

    const control = (kind: string, slot: string) => page.locator(`[data-narration-kind="${kind}"][data-narration-slot="${slot}"]`);
    const intro = control("topic", "intro");
    const introButton = intro.getByRole("button", { name: "Listen in Bangla", exact: true });
    // Nothing has played yet, and no ElevenLabs voice can be made: no voice is claimed.
    await expect(introButton).toBeEnabled();
    await expect(intro).not.toContainText(elevenLabs);
    await expect(intro).not.toContainText(deviceVoice);

    // The server says, in a form the page can act on, that new narration is not configured.
    await setVoices(page, [english]);
    const reply = await listen(page, introButton);
    expect(reply).toEqual({ status: 503, body: {
      error: "New narration is not configured. Saved audio is still available.",
      errorBn: "নতুন কণ্ঠ তৈরি চালু করা হয়নি। সংরক্ষিত অডিও এখনো শোনা যাবে।",
      code: "narration-not-configured",
    } });
    // Bangla text and only an English voice: the English voice never reads it. A calm note, not an error.
    await expect(intro.getByRole("status")).toHaveText(calmNote);
    await expect(intro.getByRole("alert")).toHaveCount(0);
    await expect(introButton).toBeEnabled();
    expect((await speech(page)).spoken).toEqual([]);

    // No voices at all: the same calm note, and the button still works.
    await setVoices(page, []);
    await listen(page, introButton);
    await expect(intro.getByRole("status")).toHaveText(calmNote);
    await expect(intro.getByRole("alert")).toHaveCount(0);
    await expect(intro.getByRole("button", { name: /Try again/ })).toHaveCount(0);
    await expect(introButton).toBeEnabled();
    expect((await speech(page)).spoken).toEqual([]);
    await intro.screenshot({ path: testInfo.outputPath("no-device-voice-note.png") });

    // A Bangla voice on the device reads the Bangla text, and the label says whose voice it is.
    await setVoices(page, [english, bangla], 1500);
    await listen(page, introButton);
    await expect(intro.getByRole("status")).toHaveText("Playing");
    await expect(intro).toContainText(deviceVoice);
    await expect(intro).not.toContainText(elevenLabs);
    await expect(intro.getByRole("alert")).toHaveCount(0);
    expect((await speech(page)).spoken).toEqual([{ text: `${content.title.bn}. ${content.tagline.bn}`, lang: "bn-BD", voice: "bn-BD" }]);
    await intro.screenshot({ path: testInfo.outputPath("device-voice-playing.png") });
    // When it finishes the status clears and the label stays true.
    await expect(intro.getByRole("status")).toBeEmpty();
    await expect(intro).toContainText(deviceVoice);
    await expect(introButton).toBeEnabled();

    // Stop cancels the device voice, and only one text is read at a time.
    await setVoices(page, [bangla], 60000);
    const section = control("topic", "section:0");
    await listen(page, section.getByRole("button", { name: "Listen in Bangla", exact: true }));
    await expect(section.getByRole("status")).toHaveText("Playing");
    let cancels = (await speech(page)).cancels;
    await section.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(section.getByRole("status")).toBeEmpty();
    expect((await speech(page)).cancels).toBeGreaterThan(cancels);
    await listen(page, section.getByRole("button", { name: "Listen in Bangla", exact: true }));
    await expect(section.getByRole("status")).toHaveText("Playing");
    cancels = (await speech(page)).cancels;
    const fact = control("topic", "fact:0");
    await listen(page, fact.getByRole("button", { name: "Listen in Bangla", exact: true }));
    await expect(fact.getByRole("status")).toHaveText("Playing");
    await expect(section.getByRole("status")).toBeEmpty();
    expect((await speech(page)).cancels).toBeGreaterThan(cancels);
    expect((await speech(page)).spoken.slice(-3).map((entry) => entry.text)).toEqual([
      `${content.sections[0].heading.bn}. ${content.sections[0].body.bn}`, `${content.sections[0].heading.bn}. ${content.sections[0].body.bn}`, content.funFacts[0].bn,
    ]);
    await fact.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(fact.getByRole("status")).toBeEmpty();
    for (const each of [intro, section, fact]) await expect(each.getByRole("alert")).toHaveCount(0);

    // English activity text is read by an English device voice; a Bangla question is not.
    await page.goto("/student");
    await setVoices(page, [english]);
    await page.getByRole("navigation", { name: "Portal navigation" }).getByRole("button", { name: "My activities", exact: true }).click();
    await page.getByRole("button", { name: new RegExp(`^${activity.title}`) }).click();
    const instructions = control("activity", "instructions");
    expect((await listen(page, instructions.getByRole("button", { name: "Listen to instructions", exact: true }))).body.code).toBe("narration-not-configured");
    await expect(instructions).toContainText(deviceVoice);
    await expect(instructions.getByRole("alert")).toHaveCount(0);
    expect((await speech(page)).spoken).toEqual([{ text: `${activity.title}. ${activity.instructions}`, lang: "en-AU", voice: "en-US" }]);
    const question = control("activity", "question:0");
    await listen(page, question.getByRole("button", { name: "Listen to question", exact: true }));
    await expect(question.getByRole("status")).toHaveText(calmNote);
    await expect(question.getByRole("alert")).toHaveCount(0);
    await expect(question).not.toContainText(deviceVoice);
    expect((await speech(page)).spoken).toHaveLength(1);

    // In Bangla the note addresses the learner informally.
    await page.locator(".portal-topbar").getByRole("button", { name: "বাংলা" }).click();
    await listen(page, question.getByRole("button", { name: "প্রশ্ন শুনি", exact: true }));
    await expect(question.getByRole("status")).toHaveText("এই লেখার অডিও এই ডিভাইসে এখনো নেই। লেখাটি স্ক্রিনে পড়ে নাও।");
    await expect(question.getByRole("alert")).toHaveCount(0);
  } finally {
    await visitor.close();
    await adminContext.close();
  }
});
