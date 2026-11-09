import { test, expect, type Browser, type Page, type Locator } from "@playwright/test";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { splitNarration } from "../../lib/narration-model";

// The app runs with no ELEVENLABS_API_KEY (see playwright.config.ts), like the
// public demo: /api/narration is not mocked unless a test says so, so a Listen
// really asks the server, which has no saved audio for this new text and cannot
// make any.
const password = "Narration-fallback-e2e-password-2026";
const recording = readFileSync(new URL("../../public/audio/lesson-hello-me-dialogue.ogg", import.meta.url));
const calmNote = "Audio isn't available for this text on this device yet. Read it on the screen instead.";
const deviceFailed = "This device could not read the text aloud. Read it on the screen instead.";
const elevenLabs = "Neural computer voice (ElevenLabs, elevenlabs.io)";
const deviceVoice = "This device's voice";
type Spoken = { text: string; lang: string; voice: string | null };
type SpeechState = { spoken: Spoken[]; cancels: number; log: string[]; waits: number[]; speakAt: number[] };
type Voice = { lang: string; name: string };

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
 * (none until a test sets some), records what it is asked to say, and, in the
 * "normal" mode, starts at once and ends after `window.__speechMs`. In the
 * "silent" mode it drops the speech without any event (as iPhone and iPad do
 * for speech that did not start from a tap); "error:<code>" fails with that
 * speech error. Nothing is really spoken.
 *
 * It also records, in order, the silent unlock utterance each Listen speaks and
 * the Listen's POST, and every 1.5-second wait for voices to load. With
 * `window.__voicesOnWait` set, those voices "load" 300 ms into that wait.
 */
async function stubSpeech(page: Page) {
  await page.addInitScript(() => {
    type Win = { __speech: SpeechState; __voices: Voice[]; __speechMs: number; __speechMode: string; __voicesOnWait: Voice[] | null };
    const win = window as unknown as Win;
    win.__speech = { spoken: [], cancels: 0, log: [], waits: [], speakAt: [] };
    win.__voices = [];
    win.__speechMs = 300;
    win.__speechMode = "normal";
    win.__voicesOnWait = null;
    const later = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...rest: unknown[]) => {
      if (timeout === 1500) {
        win.__speech.waits.push(performance.now());
        const arriving = win.__voicesOnWait;
        if (arriving) {
          win.__voicesOnWait = null;
          later(() => { win.__voices = arriving; window.speechSynthesis.dispatchEvent(new Event("voiceschanged")); }, 300);
        }
      }
      return later(handler, timeout, ...rest);
    }) as typeof window.setTimeout;
    const realFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (new URL(url, location.href).pathname === "/api/narration" && init?.method === "POST") win.__speech.log.push("post");
      return realFetch(input, init);
    };
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
      if (utterance.text === "") {
        win.__speech.log.push(utterance.volume === 0 ? "unlock" : "empty");
        return;
      }
      win.__speech.log.push("speak");
      win.__speech.speakAt.push(performance.now());
      win.__speech.spoken.push({ text: utterance.text, lang: utterance.lang, voice: utterance.voice?.lang ?? null });
      current = utterance;
      const mode = win.__speechMode;
      if (mode === "silent") return;
      later(() => {
        if (current !== utterance) return;
        if (mode.startsWith("error:")) {
          current = null;
          utterance.onerror?.({ error: mode.slice("error:".length) } as SpeechSynthesisErrorEvent);
          return;
        }
        utterance.onstart?.(new Event("start") as SpeechSynthesisEvent);
        later(() => {
          if (current !== utterance) return;
          current = null;
          utterance.onend?.(new Event("end") as SpeechSynthesisEvent);
        }, win.__speechMs);
      }, 20);
    };
  });
}

const speech = (page: Page) => page.evaluate(() => (window as unknown as { __speech: SpeechState }).__speech);
const setVoices = (page: Page, voices: Voice[], speechMs = 300, mode = "normal") =>
  page.evaluate(({ voices, speechMs, mode }) => {
    const win = window as unknown as { __voices: Voice[]; __speechMs: number; __speechMode: string };
    win.__voices = voices;
    win.__speechMs = speechMs;
    win.__speechMode = mode;
  }, { voices, speechMs, mode });
const english = { lang: "en-US", name: "English (US)" };
const bangla = { lang: "bn-BD", name: "Bangla (Bangladesh)" };

/** Clicks a Listen button and returns the server's reply to the narration request it made. */
async function listen(page: Page, button: Locator) {
  const reply = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/narration" && response.request().method() === "POST");
  await button.click({ timeout: 15000 });
  const response = await reply;
  return { status: response.status(), body: await response.json() as Record<string, unknown> };
}

const pair = (en: string, bn: string) => ({ en, bn });

/** An administrator, an approved student in a class with one approved English activity, and a published topic. */
async function setUp(browser: Browser, baseURL: string | undefined, page: Page, prefix: string, sectionBody = pair("Boats carry people across the river.", "নৌকা মানুষকে নদী পার করে।")) {
  const suffix = randomUUID().slice(0, 8);
  const adminEmail = `${prefix}-admin-${suffix}@example.com`, username = `${prefix}.${suffix}`;
  const adminContext = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": `${prefix}-admin-${suffix}` } });
  const admin = await adminContext.newPage();
  expect((await admin.request.post("/api/auth/sign-up", { data: { email: adminEmail, displayName: "Fallback Administrator", password } })).status()).toBe(201);
  fixture((db) => { db.prepare("UPDATE adults SET role='admin', approval_status='approved' WHERE email=?").run(adminEmail); });
  expect((await admin.request.post("/api/auth/sign-in", { data: { email: adminEmail, password } })).status()).toBe(200);
  await admin.goto("/admin");
  const content = {
    theme: "our-country", emoji: "🌊", title: pair(`Fallback rivers ${suffix}`, `নদীর গল্প ${suffix}`), tagline: pair("Read about our rivers.", "আমাদের নদীর কথা পড়ো।"), minutes: 3,
    sections: [{ heading: pair("Boats", "নৌকা"), body: sectionBody }],
    funFacts: [pair("The Padma is a river.", "পদ্মা একটি নদী।")], quiz: [],
  };
  const createdTopic = await api(admin, "POST", "/api/topics", content);
  expect(createdTopic.status).toBe(201);
  expect(createdTopic.body.status).toBe("approved");
  const topicId = createdTopic.body.topicId as string;
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `${prefix}-student-${suffix}` });
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
  return { suffix, adminContext, content, topicId, activity };
}

const controlOn = (page: Page) => (kind: string, slot: string) => page.locator(`[data-narration-kind="${kind}"][data-narration-slot="${slot}"]`);

test("with no narration key, Listen reads text with the device's voice for its language, or says calmly that it cannot", async ({ page, browser, baseURL }, testInfo) => {
  test.setTimeout(120000);
  const visitor = await browser.newContext({ baseURL });
  const { adminContext, content, topicId, activity } = await setUp(browser, baseURL, page, "fallback");
  try {
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

    const control = controlOn(page);
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
    // The silent unlock is spoken inside the tap itself, before the request is even sent.
    expect((await speech(page)).log).toEqual(["unlock", "post"]);

    // No voices at all: the same calm note, and the button still works.
    await setVoices(page, []);
    await listen(page, introButton);
    await expect(intro.getByRole("status")).toHaveText(calmNote);
    await expect(intro.getByRole("alert")).toHaveCount(0);
    await expect(intro.getByRole("button", { name: /Try again/ })).toHaveCount(0);
    await expect(introButton).toBeEnabled();
    expect((await speech(page)).spoken).toEqual([]);
    // That Listen waited once for voices to load; the next one does not wait again for voices that are not coming.
    expect((await speech(page)).waits).toHaveLength(1);
    await listen(page, introButton);
    await expect(intro.getByRole("status")).toHaveText(calmNote);
    expect((await speech(page)).waits).toHaveLength(1);
    await intro.screenshot({ path: testInfo.outputPath("no-device-voice-note.png") });

    // A Bangla voice on the device reads the Bangla text, and the label says whose voice it is.
    await setVoices(page, [english, bangla], 1400);
    await page.evaluate(() => window.speechSynthesis.dispatchEvent(new Event("voiceschanged")));
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

    // If a later Listen ends in the note, the line no longer claims the device's voice.
    await setVoices(page, []);
    await listen(page, introButton);
    await expect(intro.getByRole("status")).toHaveText(calmNote);
    await expect(intro).not.toContainText(deviceVoice);

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

test("the device voice waits for voices that load late, gives up calmly when speech never starts or fails, and stops when its control goes away", async ({ page, browser, baseURL }) => {
  test.setTimeout(120000);
  const { adminContext, activity } = await setUp(browser, baseURL, page, "devicevoice");
  try {
    await stubSpeech(page);
    await page.goto("/student");
    await page.getByRole("navigation", { name: "Portal navigation" }).getByRole("button", { name: "My activities", exact: true }).click();
    await page.getByRole("button", { name: new RegExp(`^${activity.title}`) }).click();
    const instructions = controlOn(page)("activity", "instructions");
    const button = instructions.getByRole("button", { name: "Listen to instructions", exact: true });
    const text = `${activity.title}. ${activity.instructions}`;

    // No voices yet (Chrome loads them after the page): the voice that arrives 300 ms into the wait reads the text,
    // without waiting out the whole 1.5 seconds.
    await setVoices(page, [], 2000);
    await page.evaluate((voices) => { (window as unknown as { __voicesOnWait: Voice[] }).__voicesOnWait = voices; }, [english]);
    await listen(page, button);
    await expect(instructions.getByRole("status")).toHaveText("Playing");
    await expect(instructions).toContainText(deviceVoice);
    let state = await speech(page);
    expect(state.spoken).toEqual([{ text, lang: "en-AU", voice: "en-US" }]);
    expect(state.waits).toHaveLength(1);
    expect(state.speakAt[0] - state.waits[0]).toBeLessThan(1200);
    await expect(instructions.getByRole("status")).toBeEmpty();

    // Speech the browser drops without a sound or an event (iPhone and iPad can): after a few seconds the control
    // gives up with a calm note, not "Preparing voice…" for ever, and the line no longer claims the device's voice.
    await setVoices(page, [english], 300, "silent");
    const cancelsBefore = (await speech(page)).cancels;
    await listen(page, button);
    await expect(instructions.getByRole("status")).toHaveText("Preparing voice…");
    await expect(instructions.getByRole("status")).toHaveText(deviceFailed, { timeout: 10000 });
    await expect(instructions.getByRole("alert")).toHaveCount(0);
    await expect(instructions.getByRole("button", { name: /Try again/ })).toHaveCount(0);
    await expect(button).toBeEnabled();
    await expect(instructions).not.toContainText(deviceVoice);
    expect((await speech(page)).cancels).toBeGreaterThan(cancelsBefore);

    // A device speech error is a calm note too, never "Could not play this recording".
    await setVoices(page, [english], 300, "error:synthesis-failed");
    await listen(page, button);
    await expect(instructions.getByRole("status")).toHaveText(deviceFailed);
    await expect(instructions.getByRole("alert")).toHaveCount(0);
    await expect(instructions).not.toContainText("recording");
    // A voice or language the device reports as unavailable gives the same note as having no voice.
    await setVoices(page, [english], 300, "error:language-unavailable");
    await listen(page, button);
    await expect(instructions.getByRole("status")).toHaveText(calmNote);
    await expect(instructions.getByRole("alert")).toHaveCount(0);

    // Leaving the activity while the device is reading stops the voice.
    await setVoices(page, [english], 60000);
    await listen(page, button);
    await expect(instructions.getByRole("status")).toHaveText("Playing");
    state = await speech(page);
    await page.getByRole("button", { name: "Back to activities", exact: true }).click();
    await expect(instructions).toHaveCount(0);
    await expect.poll(async () => (await speech(page)).cancels).toBeGreaterThan(state.cancels);
  } finally {
    await adminContext.close();
  }
});

test("with a key, the ElevenLabs line shows before playing; saved audio plays first and the device reads only the rest", async ({ page, browser, baseURL }) => {
  test.setTimeout(120000);
  const sentence = "পদ্মা বাংলাদেশের একটি বড় নদী, এর পাশে অনেক গ্রাম আছে আর নৌকা চলে।";
  const body = pair("Boats carry people across the river.", Array.from({ length: 40 }, () => sentence).join(" "));
  const { adminContext, content, topicId } = await setUp(browser, baseURL, page, "midtext", body);
  try {
    const sectionText = `${content.sections[0].heading.bn}. ${body.bn}`;
    const chunks = splitNarration(sectionText);
    expect(chunks.length).toBeGreaterThan(1);
    await stubSpeech(page);
    // As if a key were set: the page asks, and is told new narration is configured.
    await page.route("**/api/narration", async (route) => {
      if (route.request().method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", headers: { "Cache-Control": "private, no-store" }, body: '{"configured":true}' });
      // Only the first part has saved audio; the rest goes to the real server, which has no key and no audio for it.
      const request = route.request().postDataJSON() as { part: number };
      if (request.part === 0) return route.fulfill({ status: 200, contentType: "audio/ogg", headers: { "X-Narration-Provider": "ElevenLabs", "Cache-Control": "private, no-store" }, body: recording });
      return route.fallback();
    });
    await page.goto(`/topics?topic=${topicId}`);
    await expect(page.getByRole("heading", { level: 1, name: content.title.en, exact: true })).toBeVisible();
    const section = controlOn(page)("topic", "section:0");
    const intro = controlOn(page)("topic", "intro");
    // Before anything plays, every control credits the ElevenLabs voice, as it did before the device fallback.
    await expect(section).toContainText(elevenLabs);
    await expect(intro).toContainText(elevenLabs);
    await expect(section).not.toContainText(deviceVoice);

    await setVoices(page, [bangla], 300);
    const replies: number[] = [];
    page.on("response", (response) => {
      if (new URL(response.url()).pathname === "/api/narration" && response.request().method() === "POST") replies.push(response.status());
    });
    await section.getByRole("button", { name: "Listen in Bangla", exact: true }).click();
    await expect(section.getByRole("status")).toHaveText("Playing");
    await expect(section).toContainText(elevenLabs);
    // After the saved part, the server cannot make the next one: the device reads exactly what is left.
    await expect.poll(async () => (await speech(page)).spoken.length, { timeout: 30000 }).toBeGreaterThan(0);
    await expect(section).toContainText(deviceVoice);
    await expect(section.getByRole("status")).toBeEmpty({ timeout: 30000 });
    const rest = chunks.slice(1).join("");
    const spoken = (await speech(page)).spoken;
    // In whole sentences of at most 220 characters (lib/narration-fallback.ts speechParts), nothing lost or reordered.
    expect(spoken.length).toBeGreaterThan(1);
    for (const entry of spoken) expect(Array.from(entry.text).length).toBeLessThanOrEqual(220);
    expect(spoken.map((entry) => entry.text).join(" ")).toBe(rest.trim());
    expect(spoken.every((entry) => entry.voice === "bn-BD")).toBe(true);
    expect(replies).toEqual([200, 503]);
    await expect(section.getByRole("alert")).toHaveCount(0);
  } finally {
    await adminContext.close();
  }
});

test("a teacher's preview of an activity waiting for approval is read by the device, politely, with no error", async ({ browser, baseURL }) => {
  test.setTimeout(120000);
  const suffix = randomUUID().slice(0, 8);
  const email = `preview-teacher-${suffix}@example.com`;
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": `preview-teacher-${suffix}` } });
  try {
    const page = await context.newPage();
    expect((await page.request.post("/api/auth/sign-up", { data: { email, displayName: "Preview Teacher", password } })).status()).toBe(201);
    fixture((db) => { db.prepare("UPDATE adults SET role='teacher', teacher_status='approved', approval_status='approved' WHERE email=?").run(email); });
    expect((await page.request.post("/api/auth/sign-in", { data: { email, password } })).status()).toBe(200);
    await page.goto("/teach");
    const className = `Preview class ${suffix}`;
    const createdClass = await api(page, "POST", "/api/classes", { name: className });
    expect(createdClass.status).toBe(201);
    const classId = createdClass.body.class.id as string;
    const activity = { title: `Waiting check ${suffix}`, instructions: "Read the question and choose one answer.", questions: [{ prompt: "Which one is a river?", options: ["Padma", "A mountain"], answer: 0 }] };
    const created = await api(page, "POST", `/api/classes/${classId}/activities`, activity);
    expect(created.status).toBe(201);
    // Teachers' activities wait for approval by default; it is open, so the preview has a Listen button.
    expect(created.body.activity.approvalStatus).toBe("pending");
    expect(created.body.activity.status).toBe("open");

    await stubSpeech(page);
    await page.goto("/teach");
    await page.getByLabel("Find a class").fill(suffix);
    await page.getByRole("button", { name: new RegExp(className) }).click();
    await page.getByRole("navigation", { name: "Portal navigation" }).getByRole("button", { name: "Activities & quizzes", exact: true }).click();
    // Found by its title, which stays the same in both languages.
    const article = page.getByRole("article").filter({ hasText: activity.title });
    const instructions = article.locator('[data-narration-kind="activity"][data-narration-slot="instructions"]');
    const button = instructions.getByRole("button", { name: "Listen to instructions", exact: true });

    // The server still makes no audio for it, and says so in a form the page can act on.
    await setVoices(page, [english]);
    const reply = await listen(page, button);
    expect(reply).toEqual({ status: 409, body: {
      error: "New narration is made only for approved, open activities. Saved audio still plays.",
      errorBn: "নতুন কণ্ঠ শুধু অনুমোদিত ও খোলা কার্যক্রমের জন্য তৈরি হয়। সংরক্ষিত অডিও এখনো শোনা যাবে।",
      code: "narration-saved-only",
    } });
    // The device reads the text already on the teacher's screen: no red alert, no Try again that cannot succeed.
    await expect(instructions).toContainText(deviceVoice);
    await expect(instructions.getByRole("alert")).toHaveCount(0);
    await expect(instructions.getByRole("button", { name: /Try again/ })).toHaveCount(0);
    expect((await speech(page)).spoken).toEqual([{ text: `${activity.title}. ${activity.instructions}`, lang: "en-AU", voice: "en-US" }]);
    await expect(instructions.getByRole("status")).toBeEmpty();

    // In Bangla, a teacher is addressed politely, in the label and in the note.
    await page.locator(".portal-topbar").getByRole("button", { name: "বাংলা" }).click();
    await setVoices(page, []);
    const banglaButton = instructions.getByRole("button", { name: "নির্দেশনা শুনুন", exact: true });
    await listen(page, banglaButton);
    await expect(instructions.getByRole("status")).toHaveText("এই লেখার অডিও এই ডিভাইসে এখনো নেই। লেখাটি স্ক্রিনে পড়ে নিন।");
    await expect(instructions.getByRole("alert")).toHaveCount(0);
    await expect(instructions).not.toContainText("এই ডিভাইসের কণ্ঠ");

    // Only the boolean answer is ever kept by the browser: a refused GET (here, too many) is never cached.
    const answers = await page.evaluate(async () => {
      const seen: Array<{ status: number; cache: string | null }> = [];
      for (let index = 0; index < 65; index += 1) {
        const response = await fetch("/api/narration", { cache: "no-store" });
        seen.push({ status: response.status, cache: response.headers.get("cache-control") });
        if (response.status === 429) break;
      }
      return seen;
    });
    expect(answers[0]).toEqual({ status: 200, cache: "private, max-age=60" });
    const refused = answers.at(-1)!;
    expect(refused.status).toBe(429);
    expect(refused.cache).toMatch(/no-store/);
    expect(refused.cache).not.toMatch(/max-age=60/);
  } finally {
    await context.close();
  }
});
