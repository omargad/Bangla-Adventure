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
 * reader), a link saved before that rule is held back until an administrator
 * checks it, and a teacher's per-class sources reach the students allocated to
 * that class and their linked parents, nobody else.
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

// Self sign-ups wait for an administrator: each helper approves the account directly, then signs in.
async function adult(email, role) {
  const headers = { "x-forwarded-for": email };
  const signUp = await send("/api/auth/sign-up", "POST", { email, displayName: email.split("@")[0], password }, undefined, headers);
  assert.equal(signUp.status, 201);
  fixture((db) => db.prepare({
    admin: "UPDATE adults SET role = 'admin', approval_status = 'approved' WHERE email = ?",
    teacher: "UPDATE adults SET role = 'teacher', teacher_status = 'approved', approval_status = 'approved' WHERE email = ?",
    parent: "UPDATE adults SET approval_status = 'approved' WHERE email = ?",
  }[role]).run(email));
  const signIn = await send("/api/auth/sign-in", "POST", { email, password }, undefined, headers);
  assert.equal(signIn.status, 200);
  return cookieFrom(signIn);
}
async function student(username) {
  const headers = { "x-forwarded-for": username };
  const signUp = await send("/api/student/sign-up", "POST", { username, displayName: username, password }, undefined, headers);
  assert.equal(signUp.status, 201);
  fixture((db) => db.prepare("UPDATE students SET approval_status = 'approved' WHERE username = ?").run(username));
  const signIn = await send("/api/student/sign-in", "POST", { username, password }, undefined, headers);
  assert.equal(signIn.status, 200);
  return cookieFrom(signIn, "ba_student_session");
}

// A link a teacher saved before only administrators could change textbook links (as in the client's demo).
const OLD_LINK = "https://random.example.com/amar-bangla-boi.pdf";

before(async () => {
  // The database exists before this version starts, with a record written under the old rules.
  fixture((db) => {
    db.exec("CREATE TABLE IF NOT EXISTS knowledge_sources (id text PRIMARY KEY NOT NULL, updated_by text DEFAULT '' NOT NULL, data_json text DEFAULT '{}' NOT NULL, active integer DEFAULT true NOT NULL, updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)");
    db.prepare("INSERT INTO knowledge_sources (id, updated_by, data_json) VALUES ('amar-bangla-boi', 'old-teacher@example.com', ?)").run(JSON.stringify({ downloadUrl: OLD_LINK }));
  });
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
  assert.deepEqual(stored, { titleEn: "Bangladesh and Global Studies (primary, 2027)", downloadUrl: link.data.downloadUrl, reviewed: true }, "saving the link keeps the title change");
  const audit = fixture((db) => db.prepare("SELECT actor_id, details_json FROM user_audit_events WHERE action = 'library-link-updated' AND target_id = 'bgs-primary'").all());
  assert.equal(audit.length, 1);
  // The book covers Classes 3–5: the stored whole-book link, and where each class's readers went before and after.
  const { oldLinks, newLinks, ...change } = JSON.parse(audit[0].details_json);
  assert.deepEqual(change, { bookId: "bgs-primary", classKey: null, oldUrl: null, newUrl: link.data.downloadUrl });
  assert.deepEqual(Object.keys(oldLinks), ["class-3", "class-4", "class-5"]);
  assert.ok(Object.values(oldLinks).every((url) => /^https:\/\/nctb\.gov\.bd\/pages\/static-pages\//.test(url)), "readers went to each class's official page");
  assert.deepEqual(newLinks, { "class-3": link.data.downloadUrl, "class-4": link.data.downloadUrl, "class-5": link.data.downloadUrl });
  assert.equal(audit[0].actor_id, fixture((db) => db.prepare("SELECT id FROM adults WHERE email = 'sources-admin@example.com'").get().id));

  // Readers see the link everywhere: the library API, Sources & references, and each topic's sources.
  const books = (await (await send("/api/library", "GET", undefined, mayaCookie)).json()).books;
  const bgs = books.find((book) => book.id === "bgs-primary");
  assert.equal(bgs.titleEn, "Bangladesh and Global Studies (primary, 2027)");
  assert.deepEqual(bgs.links, [{ url: link.data.downloadUrl, kind: "override", label: null }], "one link for the whole book, not one per class");
  assert.ok((await page("/references", mayaCookie)).includes(link.data.downloadUrl));
  assert.ok((await page("/library", parentCookie)).includes(link.data.downloadUrl));
  const topics = (await (await send("/api/curriculum", "GET", undefined, mayaCookie)).json()).topics;
  const festival = topics.find((topic) => topic.id === "pohela-boishakh").references.find((ref) => ref.bookId === "bgs-primary");
  assert.equal(festival.url, link.data.downloadUrl);
  // A teacher's preview of the topic shows the same links students follow.
  const { topic: history } = await (await send("/api/topics/pohela-boishakh", "GET", undefined, teacherCookie)).json();
  const preview = await (await send(`/api/topics/pohela-boishakh/versions/${history.head.version}`, "GET", undefined, teacherCookie)).json();
  assert.deepEqual(preview.references.find((ref) => ref.bookId === "bgs-primary").links, [{ url: link.data.downloadUrl, kind: "override", label: null }]);

  // Without a yearly link, a book goes to its own official NCTB page, per class where it covers several.
  // (Amar Bangla Boi's old link from a teacher is held back: see the next test.)
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

test("a link saved before only administrators could change links is held back until an administrator checks it", async () => {
  // Readers never follow it: not on Sources & references, the library or any topic's sources.
  assert.equal((await page("/references", mayaCookie)).includes(OLD_LINK), false);
  assert.equal((await page("/library", parentCookie)).includes(OLD_LINK), false);
  assert.equal(JSON.stringify((await (await send("/api/library", "GET", undefined, mayaCookie)).json()).books).includes(OLD_LINK), false);
  const topics = (await (await send("/api/curriculum", "GET", undefined, mayaCookie)).json()).topics;
  assert.ok(topics.some((topic) => topic.references.some((ref) => ref.bookId === "amar-bangla-boi")));
  assert.equal(JSON.stringify(topics).includes(OLD_LINK), false);
  const [held] = fixture((db) => db.prepare("SELECT actor_id, details_json FROM user_audit_events WHERE action = 'library-link-held' AND target_id = 'amar-bangla-boi'").all());
  assert.equal(held.actor_id, null);
  assert.deepEqual(JSON.parse(held.details_json), { bookId: "amar-bangla-boi", downloadUrl: OLD_LINK, setBy: "old-teacher@example.com", reasons: ["not-admin", "not-nctb"] });

  // The administrator sees it under Links to check, and only an administrator decides.
  const listed = (await (await send("/api/library?scope=admin", "GET", undefined, adminCookie)).json()).books.find((book) => book.id === "amar-bangla-boi");
  assert.equal(listed.held.downloadUrl, OLD_LINK);
  assert.deepEqual(listed.held.reasons, ["not-admin", "not-nctb"]);
  await page("/admin/sources", adminCookie);
  assert.equal((await send("/api/library", "PUT", { id: "amar-bangla-boi", data: { heldLinks: "restore" } }, teacherCookie)).status, 403);
  assert.equal((await send("/api/library", "PUT", { id: "amar-bangla-boi", data: { heldLinks: "discard" } }, adminCookie)).status, 200);
  const after = (await (await send("/api/library?scope=admin", "GET", undefined, adminCookie)).json()).books.find((book) => book.id === "amar-bangla-boi");
  assert.equal(after.held, null);
  // The administrator's own class link from the previous test is kept.
  assert.equal(after.editions.find((item) => item.key === "class-3").link.url, "https://example.org/bangla-3.pdf");
  const discarded = fixture((db) => db.prepare("SELECT details_json FROM user_audit_events WHERE action = 'library-link-discarded' AND target_id = 'amar-bangla-boi'").all());
  assert.deepEqual(discarded.map((row) => JSON.parse(row.details_json).downloadUrl), [OLD_LINK]);
  assert.equal((await send("/api/library", "PUT", { id: "amar-bangla-boi", data: { heldLinks: "discard" } }, adminCookie)).status, 409);
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
  // My Learning shows the same sources with each class the student is in.
  const mayaFeed = await (await send("/api/student/feed", "GET", undefined, mayaCookie)).json();
  assert.deepEqual(mayaFeed.classes.find((item) => item.id === classId).sources.map((item) => item.url), [url]);
  assert.deepEqual((await (await send("/api/student/feed", "GET", undefined, raviCookie)).json()).classes, []);

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
  assert.deepEqual((await (await send("/api/student/feed", "GET", undefined, mayaCookie)).json()).classes.find((item) => item.id === classId).sources, []);
  assert.deepEqual((await (await send("/api/family/sources", "GET", undefined, parentCookie)).json()).classes[classId], []);
});
