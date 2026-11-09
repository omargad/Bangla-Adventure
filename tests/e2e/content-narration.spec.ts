import { test, expect, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const password = "Content-narration-e2e-password-2026";
const recording = readFileSync(new URL("../../public/audio/lesson-hello-me-dialogue.ogg", import.meta.url));
const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
type NarrationRequest = { kind: "topic" | "activity"; id: string; slot: string; language: "bn" | "en"; hash: string; part: number };

function fixture(callback: (db: Database.Database) => void) {
  if (!process.env.BANGLA_E2E_DB?.includes("bangla-e2e-")) throw new Error("An isolated E2E database is required.");
  const db = new Database(process.env.BANGLA_E2E_DB);
  try { callback(db); } finally { db.close(); }
}

async function api(page: Page, method: string, url: string, body: unknown) {
  return page.evaluate(async ({ method, url, body }) => {
    const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }, { method, url, body });
}

async function observeAudio(page: Page) {
  await page.addInitScript(() => {
    const state = { created: [] as string[], played: [] as string[], revoked: [] as string[], deviceSpeech: 0 };
    (window as unknown as { __narrationAudio: typeof state }).__narrationAudio = state;
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => { const url = create(blob); state.created.push(url); return url; };
    URL.revokeObjectURL = (url) => { state.revoked.push(url); revoke(url); };
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { if (this.src.startsWith("blob:")) state.played.push(this.src); return play.call(this); };
    window.speechSynthesis.speak = () => { state.deviceSpeech += 1; };
  });
}

const audioState = (page: Page) => page.evaluate(() => (window as unknown as { __narrationAudio: { created: string[]; played: string[]; revoked: string[]; deviceSpeech: number } }).__narrationAudio);

test("published text narration prepares, cancels, retries and plays; activity requests include only the canonical prompt identity", async ({ page, browser, baseURL }, testInfo) => {
  test.setTimeout(120000);
  const suffix = randomUUID().slice(0, 8);
  const adminEmail = `narration-admin-${suffix}@example.com`, username = `narration.${suffix}`;
  const adminContext = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": `narration-admin-${suffix}` } });
  let releaseHeld = () => {};
  try {
    const admin = await adminContext.newPage();
    expect((await admin.request.post("/api/auth/sign-up", { data: { email: adminEmail, displayName: "Narration Administrator", password } })).status()).toBe(201);
    fixture((db) => { db.prepare("UPDATE adults SET role='admin', approval_status='approved' WHERE email=?").run(adminEmail); });
    expect((await admin.request.post("/api/auth/sign-in", { data: { email: adminEmail, password } })).status()).toBe(200);
    await admin.goto("/admin");
    const pair = (en: string, bn: string) => ({ en, bn });
    const content = {
      theme: "our-country", emoji: "🌊", title: pair(`Narration rivers ${suffix}`, `নদীর কথা ${suffix}`), tagline: pair("Read about our rivers.", "আমাদের নদীর কথা পড়ো।"), minutes: 3,
      sections: [{ heading: pair("Boats", "নৌকা"), body: pair("Boats carry people across the river.", "নৌকা মানুষকে নদী পার করে।") }],
      funFacts: [pair("The Padma is a river.", "পদ্মা একটি নদী।")], quiz: [],
    };
    const createdTopic = await api(admin, "POST", "/api/topics", content);
    expect(createdTopic.status).toBe(201);
    const topicId = createdTopic.body.topicId as string;
    // An administrator's own topic is published as it is saved.
    expect(createdTopic.body.status).toBe("approved");
    await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `narration-student-${suffix}` });
    const registered = await page.request.post("/api/student/sign-up", { data: { username, displayName: "Narration learner", password } });
    expect(registered.status()).toBe(201);
    const studentId = (await registered.json()).student.id as string;
    fixture((db) => { db.prepare("UPDATE students SET approval_status='approved' WHERE id=?").run(studentId); });
    const createdClass = await api(admin, "POST", "/api/classes", { name: `Narration class ${suffix}` });
    expect(createdClass.status).toBe(201);
    const classId = createdClass.body.class.id as string;
    expect((await api(admin, "POST", `/api/classes/${classId}/students`, { studentIds: [studentId] })).status).toBe(200);
    const activity = { title: `River check ${suffix}`, instructions: "Read the question and choose one answer.", questions: [{ prompt: "কোনটি নদী?", options: ["Padma", "A mountain"], answer: 0 }] };
    const createdActivity = await api(admin, "POST", `/api/classes/${classId}/activities`, activity);
    expect(createdActivity.status).toBe(201);
    expect(createdActivity.body.activity.approvalStatus).toBe("approved");
    expect(createdActivity.body.activity.reviewedBy).toEqual(expect.any(String));
    expect(createdActivity.body.activity.reviewedAt).toEqual(expect.any(String));
    const activityId = createdActivity.body.activity.id as string;
    expect((await page.request.post("/api/student/sign-in", { data: { username, password } })).status()).toBe(200);

    // Audio is a real, decodable local Ogg; only the generation endpoint is mocked.
    await observeAudio(page);
    const requests: NarrationRequest[] = [];
    const gate = new Promise<void>((resolve) => { releaseHeld = resolve; });
    let heldFinished = () => {};
    const heldDone = new Promise<void>((resolve) => { heldFinished = resolve; });
    let responseMode: "hold" | "error" | "audio" | "withdrawn" = "hold";
    await page.route("**/api/narration", async (route) => {
      // Asking whether new narration is configured (GET) goes to the real server.
      if (route.request().method() !== "POST") return route.fallback();
      requests.push(route.request().postDataJSON() as NarrationRequest);
      const mode = responseMode;
      if (mode === "hold") await gate;
      try {
        await route.fulfill(mode === "error" || mode === "withdrawn"
          ? { status: mode === "withdrawn" ? 404 : 503, contentType: "application/json", body: JSON.stringify({ error: mode === "withdrawn" ? "This content is no longer available." : "Narration is temporarily unavailable. Please try again." }) }
          : { status: 200, contentType: "audio/ogg", headers: { "X-Narration-Provider": "ElevenLabs", "Cache-Control": "private, no-store" }, body: recording });
      } catch (error) {
        if (mode !== "hold") throw error; // The intentionally cancelled fetch may already be gone.
      } finally { if (mode === "hold") heldFinished(); }
    });
    await page.goto(`/topics?topic=${topicId}`);
    await expect(page.getByRole("heading", { level: 1, name: content.title.en, exact: true })).toBeVisible();
    const control = (kind: string, slot: string) => page.locator(`[data-narration-kind="${kind}"][data-narration-slot="${slot}"]`);
    const intro = control("topic", "intro");
    await intro.getByRole("button", { name: "Listen in Bangla", exact: true }).click();
    await expect(intro.getByRole("status")).toHaveText("Preparing voice…");
    await expect.poll(() => requests.length).toBe(1);
    const introRequest: NarrationRequest = { kind: "topic", id: topicId, slot: "intro", language: "bn", hash: hash(`${content.title.bn}. ${content.tagline.bn}`), part: 0 };
    expect(requests[0]).toEqual(introRequest);
    await intro.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(intro.getByRole("status")).toBeEmpty();
    releaseHeld(); await heldDone;
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect((await audioState(page)).played).toEqual([]);

    responseMode = "error";
    await intro.getByRole("button", { name: "Listen in Bangla", exact: true }).click();
    await expect(intro.getByRole("alert")).toHaveText("Narration is temporarily unavailable. Please try again.");
    responseMode = "audio";
    await intro.getByRole("button", { name: "Try again: Listen in Bangla", exact: true }).click();
    await expect(intro.getByRole("status")).toHaveText("Playing");
    await expect(intro).toContainText("Neural computer voice (ElevenLabs, elevenlabs.io)");
    expect(requests.slice(0, 3)).toEqual([introRequest, introRequest, introRequest]);
    expect((await audioState(page)).played).toHaveLength(1);
    await intro.screenshot({ path: testInfo.outputPath("published-topic-narration.png") });

    // Starting another text stops and releases the previous sound; each control hashes its own Bangla text.
    const section = control("topic", "section:0");
    await section.getByRole("button", { name: "Listen in Bangla", exact: true }).click();
    await expect(section.getByRole("status")).toHaveText("Playing");
    await expect(intro.getByRole("status")).toBeEmpty();
    expect(requests.at(-1)).toEqual({ kind: "topic", id: topicId, slot: "section:0", language: "bn", hash: hash(`${content.sections[0].heading.bn}. ${content.sections[0].body.bn}`), part: 0 });
    const fact = control("topic", "fact:0");
    await fact.getByRole("button", { name: "Listen in Bangla", exact: true }).click();
    await expect(fact.getByRole("status")).toHaveText("Playing");
    await expect(section.getByRole("status")).toBeEmpty();
    expect(requests.at(-1)).toEqual({ kind: "topic", id: topicId, slot: "fact:0", language: "bn", hash: hash(content.funFacts[0].bn), part: 0 });
    await fact.getByRole("button", { name: "Stop", exact: true }).click();
    const stopped = await audioState(page);
    expect(stopped.revoked).toEqual(stopped.created);
    expect(stopped.deviceSpeech).toBe(0);

    await page.goto("/student");
    await page.getByRole("navigation", { name: "Portal navigation" }).getByRole("button", { name: "My activities", exact: true }).click();
    await page.getByRole("button", { name: new RegExp(`^${activity.title}`) }).click();
    const instructions = control("activity", "instructions");
    await instructions.getByRole("button", { name: "Listen to instructions", exact: true }).click();
    await expect(instructions.getByRole("status")).toHaveText("Playing");
    expect(requests.at(-1)).toEqual({ kind: "activity", id: activityId, slot: "instructions", language: "en", hash: hash(`${activity.title}. ${activity.instructions}`), part: 0 });
    const question = control("activity", "question:0");
    await question.getByRole("button", { name: "Listen to question", exact: true }).click();
    await expect(question.getByRole("status")).toHaveText("Playing");
    await expect(instructions.getByRole("status")).toBeEmpty();
    expect(requests.at(-1)).toEqual({ kind: "activity", id: activityId, slot: "question:0", language: "bn", hash: hash(activity.questions[0].prompt), part: 0 });
    await question.getByRole("button", { name: "Stop", exact: true }).click();
    const playedBeforeWithdrawal = (await audioState(page)).played.length;
    const callsBeforeWithdrawal = requests.length;
    expect((await api(admin, "PATCH", `/api/classes/${classId}/activities`, {
      activityId, approvalStatus: "rejected", revision: createdActivity.body.activity.revision,
      reviewNote: "Check the activity wording before it is used again.",
    })).status).toBe(200);
    responseMode = "withdrawn";
    await question.getByRole("button", { name: "Listen to question", exact: true }).click();
    await expect(question.getByRole("alert")).toHaveText("This content is no longer available.");
    expect(requests).toHaveLength(callsBeforeWithdrawal + 1);
    expect((await audioState(page)).played).toHaveLength(playedBeforeWithdrawal);
    await page.getByRole("button", { name: "Back to activities", exact: true }).click();
    await expect(question).toHaveCount(0);
    await expect.poll(async () => { const state = await audioState(page); return state.revoked.length === state.created.length; }).toBe(true);
    const unmounted = await audioState(page);
    expect(unmounted.revoked).toEqual(unmounted.created);
    expect(unmounted.deviceSpeech).toBe(0);
  } finally {
    releaseHeld();
    await adminContext.close();
  }
});
