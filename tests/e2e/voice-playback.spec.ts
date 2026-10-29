import { test, expect, type Browser, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";

const password = "Voice-playback-password-2026";
const dialogue = "হ্যালো! তোমার নাম কী? আমার নাম রাফি। তোমার নাম কী? আমার নাম মায়া। তুমি কেমন আছ? আমি ভালো আছি, ধন্যবাদ।";

/** Self sign-up may wait for an administrator; approve the account directly when it does. */
function approveStudent(username: string) {
  if (!process.env.BANGLA_E2E_DB?.includes("bangla-e2e-")) throw new Error("Isolated test database required.");
  const db = new Database(process.env.BANGLA_E2E_DB);
  try {
    const columns = db.prepare("PRAGMA table_info(students)").all() as Array<{ name: string }>;
    if (columns.some((item) => item.name === "approval_status")) db.prepare("UPDATE students SET approval_status = 'approved' WHERE username = ?").run(username);
  } finally { db.close(); }
}

/**
 * A teacher's recording of one lesson part, approved straight in the database
 * (as if a teacher approved it in the Studio while the learner's page was open).
 * The bundled clip stands in for the recorded sound.
 */
function approveRecordingNow(lessonId: string, slot: string) {
  if (!process.env.BANGLA_E2E_DB?.includes("bangla-e2e-")) throw new Error("Isolated test database required.");
  const id = randomUUID();
  const objectKey = `human-audio/${lessonId}/${slot}/${id}.ogg`;
  const file = path.join(path.dirname(process.env.BANGLA_E2E_DB), "media", objectKey);
  mkdirSync(path.dirname(file), { recursive: true });
  copyFileSync(path.join(process.cwd(), "public", "audio", `lesson-${lessonId}-${slot}.ogg`), file);
  const db = new Database(process.env.BANGLA_E2E_DB);
  try {
    db.prepare(`INSERT INTO media_assets (id, owner_email, lesson_id, slot, object_key, original_name, content_type, byte_size, speaker_name, dialect, consent_confirmed, review_status)
      VALUES (?, 'voice-teacher@example.com', ?, ?, ?, 'recording.ogg', 'audio/ogg', ?, 'Nadia', 'Dhaka', 1, 'approved')`).run(id, lessonId, slot, objectKey, statSync(file).size);
  } finally { db.close(); }
  return id;
}

async function signedInStudent(browser: Browser, baseURL: string | undefined) {
  const suffix = randomUUID().slice(0, 8);
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": `voice-student-${suffix}` } });
  const username = `voice-${suffix}`;
  expect((await context.request.post("/api/student/sign-up", { data: { username, displayName: "Voice learner", password } })).status()).toBe(201);
  approveStudent(username);
  expect((await context.request.post("/api/student/sign-in", { data: { username, password } })).status()).toBe(200);
  return context;
}

/**
 * Stubs the device's speech voices before the page loads: `voices` are the only
 * voices it reports. Speech is recorded instead of spoken (with the voice it
 * was given), and every sound file the page plays is recorded.
 */
async function stubVoices(page: Page, voices: Array<{ lang: string; name: string }>) {
  await page.addInitScript((list) => {
    const win = window as unknown as { __spoken: Array<{ text: string; voice: string | null }>; __played: string[] };
    win.__spoken = [];
    win.__played = [];
    const fakeVoices = list.map((voice) => ({ ...voice, voiceURI: voice.name, localService: true, default: false }));
    window.speechSynthesis.getVoices = () => fakeVoices as unknown as SpeechSynthesisVoice[];
    // Real utterances only accept real voices; let them carry the stand-ins.
    const RealUtterance = window.SpeechSynthesisUtterance;
    window.SpeechSynthesisUtterance = class extends RealUtterance {
      constructor(text?: string) {
        super(text);
        let chosen: SpeechSynthesisVoice | null = null;
        Object.defineProperty(this, "voice", { configurable: true, get: () => chosen, set: (value) => { chosen = value; } });
      }
    } as typeof SpeechSynthesisUtterance;
    window.speechSynthesis.speak = (utterance) => {
      win.__spoken.push({ text: utterance.text, voice: utterance.voice?.lang ?? null });
      window.setTimeout(() => {
        utterance.onstart?.(new Event("start") as SpeechSynthesisEvent);
        window.setTimeout(() => utterance.onend?.(new Event("end") as SpeechSynthesisEvent), 1500);
      }, 20);
    };
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      const url = new URL(this.src);
      win.__played.push(url.pathname + url.search);
      return play.call(this);
    };
  }, voices);
}

/** Browsers fetch media in ranges, so a served clip answers 200 or 206. */
const served = (status: number) => status === 200 || status === 206;
const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __spoken: Array<{ text: string; voice: string | null }> }).__spoken);
const played = (page: Page) => page.evaluate(() => (window as unknown as { __played: string[] }).__played);

/** Opening a lesson asks which of its parts have an approved recording now. */
const lessonRecordingsAsked = (page: Page, lessonId: string) => page.waitForResponse((response) => new URL(response.url()).pathname === `/api/audio/${lessonId}` && response.status() === 200);

async function openListen(page: Page) {
  const asked = lessonRecordingsAsked(page, "hello-me");
  await page.goto("/adventure?module=hello-me");
  await asked;
  const lesson = page.getByRole("dialog", { name: "Full curriculum lesson" });
  await lesson.getByRole("navigation", { name: "Lesson sections" }).getByRole("button", { name: /Listen$/ }).click();
  return lesson;
}

test("with no Bangla voice on the device, lessons play the bundled clip and Bangla is never read by an English voice", async ({ browser, baseURL }) => {
  test.setTimeout(90000);
  const context = await signedInStudent(browser, baseURL);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await stubVoices(page, [{ lang: "en-US", name: "English (US)" }, { lang: "en-GB", name: "English (UK)" }]);
    const lesson = await openListen(page);

    const bundled = page.waitForResponse((response) => response.url().endsWith("/audio/lesson-hello-me-dialogue.ogg") && served(response.status()));
    await lesson.getByRole("button", { name: /Play complete dialogue/ }).click();
    await bundled;
    await expect(lesson.locator(".audio-source-note")).toContainText("Computer voice: may mispronounce names");
    await expect(page.locator(".voice-note")).toHaveAttribute("data-voice-source", "computer");
    // The computer voice step plays the bundled clip itself, so its label is always true.
    expect(await played(page)).toContain("/audio/lesson-hello-me-dialogue.ogg");

    // A single line has no bundled clip: nothing plays, and the page says why.
    await lesson.getByRole("button", { name: "Reveal transcript after listening" }).click();
    await lesson.getByRole("button", { name: "Play line 1" }).click();
    await expect(page.locator(".voice-note")).toHaveText(/No Bangla voice on this device/);

    // Words in the Read word bank have a bundled clip too (an approved recording would come first: see below).
    await lesson.getByRole("navigation", { name: "Lesson sections" }).getByRole("button", { name: /Read$/ }).click();
    const word = page.waitForResponse((response) => response.url().endsWith("/audio/lesson-hello-me-word-1.ogg") && served(response.status()));
    await lesson.getByRole("button", { name: /^Listen: হ্যালো/ }).click();
    await word;
    expect(await played(page)).toContain("/audio/lesson-hello-me-word-1.ogg");

    expect(await spoken(page), "no text was handed to an English voice").toEqual([]);

    // Hub pages have no bundled clips: they say there is no Bangla voice instead of speaking.
    await page.goto("/alphabet");
    await page.locator(".letter-card").first().click();
    await expect(page.getByRole("status").filter({ hasText: "No Bangla voice on this device" })).toBeVisible();
    expect(await spoken(page)).toEqual([]);
  } finally {
    await context.close().catch(() => undefined);
  }
});

test("with a Bangla device voice, the dialogue is spoken without the speakers' names and labelled as the device voice", async ({ browser, baseURL }) => {
  test.setTimeout(90000);
  const context = await signedInStudent(browser, baseURL);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await stubVoices(page, [{ lang: "en-US", name: "English (US)" }, { lang: "bn-IN", name: "Bangla (India)" }, { lang: "bn-BD", name: "Bangla (Bangladesh)" }]);
    const lesson = await openListen(page);
    await lesson.getByRole("button", { name: /Play complete dialogue/ }).click();
    await expect(lesson.locator(".audio-source-note")).toContainText("Device voice");
    expect(await spoken(page)).toEqual([{ text: dialogue, voice: "bn-BD" }]);
    expect(await played(page)).toEqual([]);

    await page.goto("/phrasebook");
    await page.locator(".phrase-card").first().click();
    await expect(page.getByRole("status").filter({ hasText: "Device voice" })).toBeVisible();
    expect((await spoken(page)).every((item) => item.voice === "bn-BD")).toBe(true);
  } finally {
    await context.close().catch(() => undefined);
  }
});

test("a recording a teacher approves while a learner's page is open plays, labelled as a recording, once the lesson opens again", async ({ browser, baseURL }) => {
  test.setTimeout(90000);
  const context = await signedInStudent(browser, baseURL);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await stubVoices(page, [{ lang: "en-US", name: "English (US)" }]);
    const asked = lessonRecordingsAsked(page, "food-please");
    await page.goto("/adventure?module=food-please");
    await asked;
    const lesson = page.getByRole("dialog", { name: "Full curriculum lesson" });
    const readSection = () => lesson.getByRole("navigation", { name: "Lesson sections" }).getByRole("button", { name: /Read$/ }).click();
    const word = lesson.getByRole("button", { name: /^Listen: ভাত/ });
    await readSection();

    const recordingId = approveRecordingNow("food-please", "word-1");
    // The page does not know of it yet: it plays the bundled clip and says so, never "Computer voice" over a person.
    await word.click();
    await expect(page.locator(".voice-note")).toHaveAttribute("data-voice-source", "computer");
    expect(await played(page)).toEqual(["/audio/lesson-food-please-word-1.ogg"]);

    await page.locator(".modal-close").click();
    const askedAgain = lessonRecordingsAsked(page, "food-please");
    await page.locator(".lesson-card").filter({ has: page.getByRole("heading", { name: "Food, please!" }) }).locator(".lesson-open-button").click();
    await askedAgain;
    await readSection();
    await word.click();
    await expect(page.locator(".voice-note")).toHaveAttribute("data-voice-source", "human");
    await expect(page.locator(".voice-note")).toContainText("Recorded voice");
    expect(await played(page)).toContain(`/api/audio/food-please/word-1?v=${recordingId}`);
    expect(await spoken(page)).toEqual([]);
  } finally {
    await context.close().catch(() => undefined);
  }
});
