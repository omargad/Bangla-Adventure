import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import Database from "better-sqlite3";

/**
 * Sources and references against the production server: only an administrator
 * changes the yearly NCTB links (audited, other fields kept, reaching every
 * reader), and a teacher's per-class sources reach the students allocated to that
 * class and their linked parents, nobody else.
 */

const PORT = 3262;
const BASE = `http://127.0.0.1:${PORT}`;
const stateDir = mkdtempSync(path.join(tmpdir(), "bangla-sources-"));
const password = "integration-sources-password";
let server, adminCookie, teacherCookie, otherTeacherCookie, parentCookie, otherParentCookie, mayaCookie, raviCookie, classId;

const cookieFrom = (response, name = "ba_adult_session") => response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`))?.split(";")[0];
const send = (route, method = "GET", body, cookie, headers = {}) => fetch(`${BASE}${route}`, { method, redirect: "manual", headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const fixture = (callback) => { const db = new Database(path.join(stateDir, "test.db")); try { return callback(db); } finally { db.close(); } };
const page = async (route, cookie) => { const response = await send(route, "GET", undefined, cookie); assert.equal(response.status, 200, route); return response.text(); };

async function adult(email, role) {
  const signUp = await send("/api/auth/sign-up", "POST", { email, displayName: email.split("@")[0], password }, undefined, { "x-forwarded-for": email });
  assert.equal(signUp.status, 201);
  if (role === "admin") fixture((db) => db.prepare("UPDATE adults SET role = 'admin' WHERE email = ?").run(email));
  if (role === "teacher") fixture((db) => db.prepare("UPDATE adults SET role = 'teacher', teacher_status = 'approved' WHERE email = ?").run(email));
  return cookieFrom(signUp);
}
async function student(username) {
  const signUp = await send("/api/student/sign-up", "POST", { username, displayName: username, password }, undefined, { "x-forwarded-for": username });
  assert.equal(signUp.status, 201);
  return cookieFrom(signUp, "ba_student_session");
}

before(async () => {
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(PORT)], {
    cwd: new URL("../..", import.meta.url).pathname,
    env: { ...process.env, NODE_ENV: "production", PLATFORM_MODE: "legacy", DATABASE_PATH: path.join(stateDir, "test.db"), MEDIA_ROOT: path.join(stateDir, "media") }, stdio: "ignore",
  });
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch (error) { if (server.exitCode !== null) throw error; }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  adminCookie = await adult("sources-admin@example.com", "admin");
  teacherCookie = await adult("sources-teacher@example.com", "teacher");
  otherTeacherCookie = await adult("sources-other@example.com", "teacher");
  parentCookie = await adult("sources-parent@example.com", "parent");
  otherParentCookie = await adult("sources-other-parent@example.com", "parent");
  mayaCookie = await student("sources-maya");
  raviCookie = await student("sources-ravi");
  const created = await send("/api/classes", "POST", { name: "Sunday 11:30" }, teacherCookie);
  assert.equal(created.status, 201);
  classId = (await created.json()).class.id;
  assert.equal((await send(`/api/classes/${classId}/students`, "POST", { username: "sources-maya" }, teacherCookie)).status, 200);
  const mayaId = fixture((db) => db.prepare("SELECT id FROM students WHERE username = ?").get("sources-maya").id);
  assert.equal((await send("/api/admin/family-links", "POST", { studentId: mayaId, parentEmail: "sources-parent@example.com", confirmed: true }, adminCookie)).status, 200);
});
after(async () => {
  if (server && server.exitCode === null) { const closed = once(server, "exit"); server.kill("SIGTERM"); await closed; }
  rmSync(stateDir, { recursive: true, force: true });
});

test("only an administrator changes a yearly textbook link; the change is audited, keeps other fields and reaches every reader", async () => {
  const link = { id: "bgs-primary", data: { downloadUrl: "https://nctb.gov.bd/pages/static-pages/bgs-primary-2027" } };
  // Teachers manage their own classes' sources, not the shared NCTB links.
  assert.equal((await send("/api/library", "PUT", link, teacherCookie)).status, 403);
  assert.equal((await send("/api/library", "DELETE", { id: "bgs-primary" }, teacherCookie)).status, 403);
  assert.equal((await send("/api/library", "POST", { titleEn: "x" }, teacherCookie)).status, 403);
  assert.equal((await send("/api/library?scope=admin", "GET", undefined, teacherCookie)).status, 403);
  assert.equal((await send("/api/library", "PUT", link, parentCookie)).status, 403);
  assert.equal((await send("/api/library", "PUT", link, mayaCookie)).status, 401);
  assert.equal((await send("/api/library", "PUT", link)).status, 401);
  const teacherPage = await send("/admin/sources", "GET", undefined, teacherCookie);
  assert.equal(teacherPage.status, 307);
  assert.equal(new URL(teacherPage.headers.get("location"), BASE).pathname, "/teach");

  assert.equal((await send("/api/library", "PUT", { id: "bgs-primary", data: { titleEn: "Bangladesh and Global Studies (primary, 2027)" } }, adminCookie)).status, 200);
  const saved = await send("/api/library", "PUT", link, adminCookie);
  assert.equal(saved.status, 200);
  assert.deepEqual((await saved.json()).warnings, []);
  const stored = fixture((db) => JSON.parse(db.prepare("SELECT data_json FROM knowledge_sources WHERE id = 'bgs-primary'").get().data_json));
  assert.deepEqual(stored, { titleEn: "Bangladesh and Global Studies (primary, 2027)", downloadUrl: link.data.downloadUrl }, "saving the link keeps the title change");
  const audit = fixture((db) => db.prepare("SELECT actor_id, details_json FROM user_audit_events WHERE action = 'library-link-updated' AND target_id = 'bgs-primary'").all());
  assert.equal(audit.length, 1);
  assert.deepEqual(JSON.parse(audit[0].details_json), { bookId: "bgs-primary", classKey: null, oldUrl: "https://nctb.gov.bd/", newUrl: link.data.downloadUrl });
  assert.equal(audit[0].actor_id, fixture((db) => db.prepare("SELECT id FROM adults WHERE email = 'sources-admin@example.com'").get().id));

  // Readers see the link everywhere: the library API, Sources & references, and each topic's sources.
  const books = (await (await send("/api/library", "GET", undefined, mayaCookie)).json()).books;
  const bgs = books.find((book) => book.id === "bgs-primary");
  assert.equal(bgs.titleEn, "Bangladesh and Global Studies (primary, 2027)");
  assert.ok(bgs.links.every((item) => item.url === link.data.downloadUrl && item.kind === "override"));
  assert.ok((await page("/references", mayaCookie)).includes(link.data.downloadUrl));
  assert.ok((await page("/library", parentCookie)).includes(link.data.downloadUrl));
  const topics = (await (await send("/api/curriculum", "GET", undefined, mayaCookie)).json()).topics;
  const festival = topics.find((topic) => topic.id === "pohela-boishakh").references.find((ref) => ref.bookId === "bgs-primary");
  assert.equal(festival.url, link.data.downloadUrl);

  // Without a yearly link, a book goes to its own official NCTB page, per class where it covers several.
  const bangla = books.find((book) => book.id === "amar-bangla-boi");
  assert.deepEqual(bangla.links.map((item) => item.label.en), ["Class 1", "Class 2", "Class 3", "Class 4", "Class 5"]);
  assert.ok(bangla.links.every((item) => item.kind === "official" && /^https:\/\/nctb\.gov\.bd\/pages\/static-pages\//.test(item.url)));

  // A link to another website is saved with a warning; a broken one is refused in both languages.
  const elsewhere = await send("/api/library", "PUT", { id: "amar-bangla-boi", data: { classLinks: { "class-3": "https://example.org/bangla-3.pdf" } } }, adminCookie);
  assert.equal(elsewhere.status, 200);
  const warned = await elsewhere.json();
  assert.match(warned.warnings[0].en, /not on the NCTB website/);
  assert.ok(warned.warnings[0].bn);
  const refused = await send("/api/library", "PUT", { id: "amar-bangla-boi", data: { downloadUrl: "http://nctb.gov.bd/" } }, adminCookie);
  assert.equal(refused.status, 400);
  assert.ok((await refused.json()).errorBn);

  // Hiding an outdated book removes it from readers' lists; the administrator still sees it.
  assert.equal((await send("/api/library", "PUT", { id: "hsc-sahityapath", data: { hidden: true } }, adminCookie)).status, 200);
  assert.equal((await (await send("/api/library", "GET", undefined, mayaCookie)).json()).books.some((book) => book.id === "hsc-sahityapath"), false);
  const adminBooks = (await (await send("/api/library?scope=admin", "GET", undefined, adminCookie)).json()).books;
  assert.equal(adminBooks.find((book) => book.id === "hsc-sahityapath").hidden, true);
  assert.equal(adminBooks.find((book) => book.id === "bgs-primary").updatedBy, "sources-admin");

  const added = await send("/api/library", "POST", { titleEn: "Class 7 reader", titleBn: "৭ম শ্রেণির পাঠ", classes: { en: "Class 7", bn: "৭ম শ্রেণি" }, downloadUrl: "https://nctb.gov.bd/pages/static-pages/class-7-reader" }, adminCookie);
  assert.equal(added.status, 201);
  assert.ok((await page("/references", raviCookie)).includes("https://nctb.gov.bd/pages/static-pages/class-7-reader"));
});

test("a teacher manages sources for their own class only", async () => {
  const source = { titleEn: "Boishakh songs", titleBn: "বৈশাখের গান", url: "https://example.org/boishakh-songs", note: "Listen before class." };
  assert.equal((await send(`/api/classes/${classId}/sources`, "POST", { ...source, url: "http://example.org/x" }, teacherCookie)).status, 400);
  const created = await send(`/api/classes/${classId}/sources`, "POST", source, teacherCookie);
  assert.equal(created.status, 201);
  const { source: saved } = await created.json();
  assert.equal(saved.host, "example.org");

  for (const [method, body] of [["GET"], ["POST", source], ["PATCH", { ...source, sourceId: saved.id, url: "https://evil.example/x" }], ["DELETE", { sourceId: saved.id }]]) {
    assert.equal((await send(`/api/classes/${classId}/sources`, method, body, otherTeacherCookie)).status, 404, `another teacher: ${method}`);
  }
  assert.equal((await send(`/api/classes/${classId}/sources`, "POST", source, parentCookie)).status, 403);
  assert.equal((await send(`/api/classes/${classId}/sources`, "GET", undefined, mayaCookie)).status, 401);
  const listed = await (await send(`/api/classes/${classId}/sources`, "GET", undefined, teacherCookie)).json();
  assert.deepEqual(listed.sources.map((item) => item.url), [source.url]);
  // An administrator may manage any class.
  assert.equal((await send(`/api/classes/${classId}/sources`, "GET", undefined, adminCookie)).status, 200);
  const audit = fixture((db) => db.prepare("SELECT action FROM user_audit_events WHERE target_id = ? AND action LIKE 'class-source-%'").all(classId));
  assert.deepEqual(audit.map((row) => row.action), ["class-source-added"]);
});

test("a class source reaches the allocated student and linked parent, not other students or parents", async () => {
  const url = "https://example.org/boishakh-songs";
  const mayaPage = await page("/references", mayaCookie);
  assert.ok(mayaPage.includes("My class sources"));
  assert.ok(mayaPage.includes(url), "the allocated student sees the class source");
  assert.ok(mayaPage.includes("Boishakh songs"));
  const raviPage = await page("/references", raviCookie);
  assert.ok(raviPage.includes("My class sources"));
  assert.equal(raviPage.includes(url), false, "an unallocated student does not");

  const family = await (await send("/api/family/sources", "GET", undefined, parentCookie)).json();
  assert.deepEqual(family.classes[classId].map((item) => item.url), [url]);
  assert.deepEqual((await (await send("/api/family/sources", "GET", undefined, otherParentCookie)).json()).classes, {});
  assert.equal((await send("/api/family/sources", "GET", undefined, teacherCookie)).status, 403);
  assert.equal((await send("/api/family/sources")).status, 401);

  const [{ id }] = (await (await send(`/api/classes/${classId}/sources`, "GET", undefined, teacherCookie)).json()).sources;
  assert.equal((await send(`/api/classes/${classId}/sources`, "PATCH", { sourceId: id, titleEn: "Boishakh songs (new)", url: "https://example.org/boishakh-songs-2" }, teacherCookie)).status, 200);
  assert.ok((await page("/references", mayaCookie)).includes("https://example.org/boishakh-songs-2"));
  assert.equal((await send(`/api/classes/${classId}/sources`, "DELETE", { sourceId: id }, teacherCookie)).status, 200);
  assert.equal((await page("/references", mayaCookie)).includes("https://example.org/boishakh-songs-2"), false);
  assert.deepEqual((await (await send("/api/family/sources", "GET", undefined, parentCookie)).json()).classes[classId], []);
});
