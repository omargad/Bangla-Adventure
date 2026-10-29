import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "bangla-library-catalog-"));
process.env.DATABASE_PATH = path.join(dir, "test.db");
const links = await import("../lib/library-links.ts");
const catalog = await import("../lib/library-catalog.ts");
const { libraryBooks, NCTB_PORTAL_URL } = await import("../app/library-content.ts");
const { nctbCoreBooks } = await import("../app/nctb-books.ts");
const { getDb } = await import("../db/index.ts");
const { migrateContent } = await import("../db/content-migration.ts");
const { adults, knowledgeSources, userAuditEvents } = await import("../db/schema.ts");
const { eq } = await import("drizzle-orm");
const { default: Database } = await import("better-sqlite3");
const db = await getDb();
db.insert(adults).values([
  { id: "admin", email: "admin@example.com", displayName: "Admin Ayesha", role: "admin", passwordHash: "fixture" },
  { id: "teacher", email: "teacher@example.com", displayName: "Teacher Tania", role: "teacher", teacherStatus: "approved", passwordHash: "fixture" },
]).run();
const admin = { id: "admin", email: "admin@example.com", role: "admin", status: "active", teacherStatus: "none" };
after(() => rmSync(dir, { recursive: true, force: true }));

const classPage = (grade, subject = "bangla") => nctbCoreBooks.find((book) => book.grade === grade && book.subject === subject).officialPage;
const events = (action) => db.select().from(userAuditEvents).where(eq(userAuditEvents.action, action)).all().map((row) => ({ ...row, details: JSON.parse(row.detailsJson) }));
const stored = (id) => { const row = db.select().from(knowledgeSources).where(eq(knowledgeSources.id, id)).get(); return row ? JSON.parse(row.dataJson) : null; };

test("a link resolves to the administrator's link, else the book's official NCTB page, else the NCTB website", () => {
  // No change stored: the official page for the class, or for a book's only edition.
  assert.deepEqual(links.resolveBookLink("amar-bangla-boi", null, "class-3"), { url: classPage(3), kind: "official" });
  assert.deepEqual(links.resolveBookLink("geography-9-10"), { url: links.bookEditions["geography-9-10"][0].officialPage, kind: "official" });
  // A book with several classes has no single page, and a book with no audited record goes to the website.
  assert.deepEqual(links.resolveBookLink("amar-bangla-boi"), { url: NCTB_PORTAL_URL, kind: "portal" });
  assert.deepEqual(links.resolveBookLink("hsc-sahityapath"), { url: NCTB_PORTAL_URL, kind: "portal" });
  assert.deepEqual(links.resolveBookLink("not-a-book", null, "class-3"), { url: NCTB_PORTAL_URL, kind: "portal" });

  // This year's link for the whole book wins over every class page...
  const yearly = { downloadUrl: "https://nctb.gov.bd/pages/static-pages/2027-bangla" };
  assert.deepEqual(links.resolveBookLink("amar-bangla-boi", yearly, "class-3"), { url: yearly.downloadUrl, kind: "override" });
  assert.deepEqual(links.resolveBookLink("amar-bangla-boi", yearly), { url: yearly.downloadUrl, kind: "override" });
  // ...and a class's own link wins over the whole book's, for that class only.
  const perClass = { ...yearly, classLinks: { "class-3": "https://nctb.gov.bd/pages/static-pages/2027-class-3" } };
  assert.equal(links.resolveBookLink("amar-bangla-boi", perClass, "class-3").url, perClass.classLinks["class-3"]);
  assert.equal(links.resolveBookLink("amar-bangla-boi", perClass, "class-4").url, yearly.downloadUrl);
  assert.deepEqual(links.resolveBookLink("amar-bangla-boi", { classLinks: perClass.classLinks }, "class-4"), { url: classPage(4), kind: "official" });
  // A single-edition book's link is its edition's link.
  assert.equal(links.resolveBookLink("geography-9-10", { classLinks: { "class-9-10": "https://nctb.gov.bd/x" } }).url, "https://nctb.gov.bd/x");
});

test("a book that covers several classes links each class to its own page", () => {
  const bangla = links.bookLinks("amar-bangla-boi");
  assert.deepEqual(bangla.map((link) => link.label.en), ["Class 1", "Class 2", "Class 3", "Class 4", "Class 5"]);
  assert.deepEqual(bangla.map((link) => link.url), [1, 2, 3, 4, 5].map((grade) => classPage(grade)));
  assert.deepEqual(links.bookLinks("bgs-primary").map((link) => link.url), [3, 4, 5].map((grade) => classPage(grade, "bangladesh-and-global-studies")));
  const single = links.bookLinks("history-9-10");
  assert.equal(single.length, 1);
  assert.equal(single[0].label, null);
  assert.equal(single[0].kind, "official");

  // This year's link for the whole book and no class link of its own: one link, not five identical ones.
  const yearly = { downloadUrl: "https://nctb.gov.bd/pages/static-pages/bangla-2027" };
  assert.deepEqual(links.bookLinks("amar-bangla-boi", yearly), [{ url: yearly.downloadUrl, kind: "override", label: null }]);
  // A class with its own link keeps it; the other classes use the whole book's link.
  const mixed = links.bookLinks("amar-bangla-boi", { ...yearly, classLinks: { "class-2": "https://nctb.gov.bd/pages/static-pages/bangla-2027-class-2" } });
  assert.deepEqual(mixed.map((link) => link.label.en), ["Class 1", "Class 2", "Class 3", "Class 4", "Class 5"]);
  assert.deepEqual(mixed.map((link) => link.url), [yearly.downloadUrl, "https://nctb.gov.bd/pages/static-pages/bangla-2027-class-2", yearly.downloadUrl, yearly.downloadUrl, yearly.downloadUrl]);
});

test("every class page is an audited NCTB page, labelled in both languages, for a real catalogue book", () => {
  const ids = new Set(libraryBooks.map((book) => book.id));
  for (const [bookId, editions] of Object.entries(links.bookEditions)) {
    assert.ok(ids.has(bookId), `${bookId} is not in the catalogue`);
    assert.equal(new Set(editions.map((item) => item.key)).size, editions.length, `${bookId}: duplicate class`);
    for (const item of editions) {
      assert.match(item.key, /^[a-z0-9-]+$/);
      assert.ok(item.label.en && item.label.bn, `${bookId} ${item.key}: needs both labels`);
      assert.match(item.officialPage, /^https:\/\/nctb\.gov\.bd\/pages\/static-pages\/[0-9a-f]{24}$/, `${bookId} ${item.key}`);
    }
  }
  // Arts and crafts (Classes 6–9) links each class to the same class page as the other secondary books.
  const secondary = Object.fromEntries(links.bookEditions["bgs-secondary"].map((item) => [item.key, item.officialPage]));
  assert.deepEqual(links.bookEditions["arts-crafts"].map((item) => [item.key, item.label.en, item.officialPage]), [
    ["class-6", "Class 6", secondary["class-6"]], ["class-7", "Class 7", secondary["class-7"]],
    ["class-8", "Class 8", secondary["class-8"]], ["class-9", "Class 9", secondary["class-9-10"]],
  ]);
  assert.ok(links.bookLinks("arts-crafts").every((link) => link.kind === "official"));
});

test("the catalogue keeps the administrator's descriptive changes, leaves out hidden books and shows complete added sources", () => {
  const overrides = new Map([
    ["bgs-primary", { titleEn: "Bangladesh and Global Studies (2027)", downloadUrl: "https://nctb.gov.bd/bgs-2027" }],
    ["arts-crafts", { hidden: true }],
    ["new-reader-abc123", { titleEn: "New reader", titleBn: "নতুন পাঠ", classes: { en: "Class 7", bn: "৭ম শ্রেণি" }, downloadUrl: "https://nctb.gov.bd/new-reader" }],
    ["broken-entry", { titleEn: "Only English" }],
  ]);
  const books = links.mergeCatalog(overrides);
  const bgs = books.find((book) => book.id === "bgs-primary");
  assert.equal(bgs.titleEn, "Bangladesh and Global Studies (2027)");
  assert.equal(bgs.titleBn, "বাংলাদেশ ও বিশ্বপরিচয়");
  assert.ok(bgs.chapterMaps.length > 0, "chapter maps stay with the book");
  assert.equal(bgs.customised, true);
  assert.equal(bgs.downloadUrl, "https://nctb.gov.bd/bgs-2027");
  assert.deepEqual(bgs.links, [{ url: "https://nctb.gov.bd/bgs-2027", kind: "override", label: null }]);
  assert.equal(books.some((book) => book.id === "arts-crafts"), false);
  assert.equal(links.mergeCatalog(overrides, { includeHidden: true }).find((book) => book.id === "arts-crafts").hidden, true);
  const added = books.find((book) => book.id === "new-reader-abc123");
  assert.equal(added.added, true);
  assert.equal(added.link.url, "https://nctb.gov.bd/new-reader");
  assert.equal(books.some((book) => book.id === "broken-entry"), false);
  assert.equal(books.find((book) => book.id === "history-9-10").customised, false);
});

test("a topic's sources carry their links, and a hidden book stays cited", () => {
  const refs = links.topicSourceLinks([
    { bookId: "bgs-primary", note: { en: "Festivals", bn: "উৎসব" } },
    { bookId: "history-9-10", note: { en: "History", bn: "ইতিহাস" } },
    { bookId: "unknown-book", note: { en: "x", bn: "y" } },
  ], new Map([["history-9-10", { hidden: true, downloadUrl: "https://nctb.gov.bd/history-2027" }]]));
  assert.deepEqual(refs.map((ref) => ref.bookId), ["bgs-primary", "history-9-10"]);
  assert.equal(refs[0].links.length, 3);
  assert.equal(refs[0].url, classPage(3, "bangladesh-and-global-studies"));
  assert.equal(refs[1].url, "https://nctb.gov.bd/history-2027");
});

test("links must be public HTTPS addresses; other hosts than NCTB are allowed but flagged", () => {
  assert.equal(links.linkProblem("https://nctb.gov.bd/pages/static-pages/abc"), null);
  assert.equal(links.linkProblem("https://drive.egovcloud.gov.bd/s/abc/download"), null);
  for (const bad of ["http://nctb.gov.bd/", "javascript:alert(1)", "https://user:pass@nctb.gov.bd/", "https://localhost/x", "https://10.0.0.1/x", "https://intranet/x", "nctb.gov.bd", `https://nctb.gov.bd/${"x".repeat(500)}`]) {
    const problem = links.linkProblem(bad);
    assert.ok(problem?.en && problem.bn, bad);
  }
  assert.equal(links.isNctbLink("https://nctb.gov.bd/x"), true);
  assert.equal(links.isNctbLink("https://www.nctb.gov.bd/x"), true);
  assert.equal(links.isNctbLink("https://nctb.gov.bd.example.com/x"), false);
  assert.equal(links.isNctbLink("https://example.com/nctb.gov.bd"), false);
});

test("saving a yearly link keeps the book's other changes and is audited with the old and new link", async () => {
  await catalog.updateLibrarySource(admin, "bgs-primary", { titleEn: "Bangladesh and Global Studies (primary, 2027)" });
  const saved = await catalog.updateLibrarySource(admin, "bgs-primary", { downloadUrl: "https://nctb.gov.bd/pages/static-pages/bgs-2027" });
  assert.deepEqual(saved.warnings, []);
  assert.deepEqual(stored("bgs-primary"), { titleEn: "Bangladesh and Global Studies (primary, 2027)", downloadUrl: "https://nctb.gov.bd/pages/static-pages/bgs-2027", reviewed: true });
  const [event] = events("library-link-updated");
  assert.equal(event.actorId, "admin");
  assert.equal(event.targetId, "bgs-primary");
  // The book covers Classes 3–5: the stored whole-book link, and where each class's readers went before and after.
  const bgsPages = Object.fromEntries([3, 4, 5].map((grade) => [`class-${grade}`, classPage(grade, "bangladesh-and-global-studies")]));
  assert.deepEqual(event.details, {
    bookId: "bgs-primary", classKey: null, oldUrl: null, newUrl: "https://nctb.gov.bd/pages/static-pages/bgs-2027",
    oldLinks: bgsPages, newLinks: Object.fromEntries(Object.keys(bgsPages).map((key) => [key, "https://nctb.gov.bd/pages/static-pages/bgs-2027"])),
  });
  assert.deepEqual(events("library-source-updated")[0].details, { bookId: "bgs-primary", fields: ["titleEn"] });

  // Saving the same link again changes nothing and records nothing.
  await catalog.updateLibrarySource(admin, "bgs-primary", { downloadUrl: "https://nctb.gov.bd/pages/static-pages/bgs-2027" });
  assert.equal(events("library-link-updated").length, 1);

  const reader = (await catalog.getLibraryCatalog()).find((book) => book.id === "bgs-primary");
  assert.equal(reader.titleEn, "Bangladesh and Global Studies (primary, 2027)");
  assert.equal(reader.links[0].url, "https://nctb.gov.bd/pages/static-pages/bgs-2027");
});

test("a class's own link is stored beside the book's, warns when it is not on NCTB, and clears back to the official page", async () => {
  const saved = await catalog.updateLibrarySource(admin, "amar-bangla-boi", { classLinks: { "class-2": "https://example.org/amar-bangla-2.pdf" } });
  assert.equal(saved.warnings.length, 1);
  assert.match(saved.warnings[0].en, /not on the NCTB website/);
  assert.ok(saved.warnings[0].bn);
  const changed = events("library-link-updated").find((row) => row.targetId === "amar-bangla-boi");
  assert.deepEqual(changed.details, { bookId: "amar-bangla-boi", classKey: "class-2", oldUrl: classPage(2), newUrl: "https://example.org/amar-bangla-2.pdf", notNctb: true });
  const book = (await catalog.getLibraryCatalog()).find((item) => item.id === "amar-bangla-boi");
  assert.equal(book.links[1].url, "https://example.org/amar-bangla-2.pdf");
  assert.equal(book.links[2].url, classPage(3));

  await assert.rejects(catalog.updateLibrarySource(admin, "amar-bangla-boi", { classLinks: { "class-9": "https://nctb.gov.bd/x" } }), (error) => error.status === 400 && /separate link/.test(error.message));
  await assert.rejects(catalog.updateLibrarySource(admin, "geography-9-10", { classLinks: { "class-9-10": "https://nctb.gov.bd/x" } }), (error) => error.status === 400);
  await assert.rejects(catalog.updateLibrarySource(admin, "amar-bangla-boi", { downloadUrl: "http://nctb.gov.bd/" }), (error) => error.status === 400 && Boolean(error.messageBn));

  // Clearing the only change returns the book to the shipped record.
  await catalog.updateLibrarySource(admin, "amar-bangla-boi", { classLinks: { "class-2": "" } });
  assert.equal(stored("amar-bangla-boi"), null);
  assert.equal(events("library-link-updated").filter((row) => row.targetId === "amar-bangla-boi").at(-1).details.newUrl, classPage(2));
});

test("administrators hide and show books, add new sources and undo changes, all audited", async () => {
  await catalog.updateLibrarySource(admin, "arts-crafts", { hidden: true });
  assert.equal((await catalog.getLibraryCatalog()).some((book) => book.id === "arts-crafts"), false);
  assert.equal((await catalog.adminLibraryCatalog()).find((book) => book.id === "arts-crafts").hidden, true);
  await catalog.updateLibrarySource(admin, "arts-crafts", { hidden: false });
  assert.ok((await catalog.getLibraryCatalog()).some((book) => book.id === "arts-crafts"));
  assert.deepEqual([events("library-source-hidden").length, events("library-source-shown").length], [1, 1]);

  await assert.rejects(catalog.addLibrarySource(admin, { titleEn: "Only English", classes: { en: "Class 7", bn: "৭ম শ্রেণি" }, downloadUrl: "https://nctb.gov.bd/x" }), (error) => error.status === 400);
  await assert.rejects(catalog.addLibrarySource(admin, { titleEn: "Reader", titleBn: "পাঠ", classes: { en: "Class 7", bn: "৭ম শ্রেণি" } }), (error) => /link/.test(error.message));
  const added = await catalog.addLibrarySource(admin, { titleEn: "Class 7 Bangla reader", titleBn: "সপ্তম শ্রেণির বাংলা পাঠ", classes: { en: "Class 7", bn: "৭ম শ্রেণি" }, level: "secondary", downloadUrl: "https://nctb.gov.bd/pages/static-pages/class-7" });
  assert.match(added.id, /^class-7-bangla-reader-[0-9a-f]{6}$/);
  assert.deepEqual(added.warnings, []);
  assert.equal(events("library-source-added")[0].details.bookId, added.id);
  const admins = await catalog.adminLibraryCatalog();
  const row = admins.find((book) => book.id === added.id);
  assert.equal(row.updatedBy, "Admin Ayesha");
  assert.ok(row.updatedAt);
  assert.equal(row.link.url, "https://nctb.gov.bd/pages/static-pages/class-7");

  await assert.rejects(catalog.updateLibrarySource(admin, "never-added", { downloadUrl: "https://nctb.gov.bd/x" }), (error) => error.status === 404);
  await catalog.resetLibrarySource(admin, added.id);
  assert.equal((await catalog.getLibraryCatalog()).some((book) => book.id === added.id), false);
  assert.equal(events("library-source-reset")[0].targetId, added.id);
  await assert.rejects(catalog.resetLibrarySource(admin, added.id), (error) => error.status === 404);
});

test("a stored record is checked once: links not saved by an administrator, or not on NCTB, are held back", () => {
  const now = "2026-10-29T00:00:00.000Z";
  const teacherLink = { downloadUrl: "https://random.example.com/bangla.pdf", titleEn: "Kept title" };
  assert.deepEqual(links.checkStoredLinks(teacherLink, { email: "teacher@example.com", admin: false }, now), {
    titleEn: "Kept title", reviewed: true,
    heldLinks: { downloadUrl: teacherLink.downloadUrl, setBy: "teacher@example.com", heldAt: now, reasons: ["not-admin", "not-nctb"] },
  });
  const classLinks = { "class-3": "https://nctb.gov.bd/pages/static-pages/class-3" };
  assert.deepEqual(links.checkStoredLinks({ classLinks }, { email: "teacher@example.com", admin: false }, now).heldLinks, { classLinks, setBy: "teacher@example.com", heldAt: now, reasons: ["not-admin"] });
  assert.deepEqual(links.checkStoredLinks({ downloadUrl: "https://drive.example.com/x" }, { email: "admin@example.com", admin: true }, now).heldLinks.reasons, ["not-nctb"]);
  // An administrator's NCTB link stays and is marked checked; a checked record or one without links is left alone.
  assert.deepEqual(links.checkStoredLinks({ downloadUrl: "https://nctb.gov.bd/x" }, { email: "admin@example.com", admin: true }, now), { downloadUrl: "https://nctb.gov.bd/x", reviewed: true });
  assert.equal(links.checkStoredLinks({ downloadUrl: "https://random.example.com/x", reviewed: true }, { email: "", admin: false }, now), null);
  assert.equal(links.checkStoredLinks({ hidden: true }, { email: "teacher@example.com", admin: false }, now), null);
  // Held links never reach readers, and the check's fields stay out of the reader's record.
  const held = links.mergeCatalog(new Map([["amar-bangla-boi", { reviewed: true, heldLinks: { downloadUrl: "https://random.example.com/x", setBy: null, heldAt: now, reasons: ["not-nctb"] } }]]));
  const book = held.find((item) => item.id === "amar-bangla-boi");
  assert.ok(book.links.every((link) => link.kind === "official"));
  assert.equal("heldLinks" in book || "reviewed" in book, false);
});

test("on start, older links are held until an administrator restores or discards them, all audited", async () => {
  const legacy = [
    ["amar-bangla-boi", "teacher@example.com", { downloadUrl: "https://random.example.com/bangla.pdf" }],
    ["history-9-10", "admin@example.com", { titleEn: "History (2027)", downloadUrl: "https://nctb.gov.bd/pages/static-pages/history-2027" }],
    ["geography-9-10", "admin@example.com", { downloadUrl: "https://drive.example.com/geography.pdf" }],
    ["teacher-reader", "teacher@example.com", { titleEn: "Teacher's reader", titleBn: "শিক্ষকের পাঠ", classes: { en: "Class 7", bn: "৭ম শ্রেণি" }, downloadUrl: "https://nctb.gov.bd/reader" }],
    ["ethnic-culture", "teacher@example.com", { hidden: true }],
  ];
  db.insert(knowledgeSources).values(legacy.map(([id, updatedBy, data]) => ({ id, updatedBy, dataJson: JSON.stringify(data) }))).run();
  const migrate = () => { const sqlite = new Database(process.env.DATABASE_PATH); try { migrateContent(sqlite); } finally { sqlite.close(); } };
  migrate();

  assert.deepEqual(stored("amar-bangla-boi").heldLinks.reasons, ["not-admin", "not-nctb"]);
  assert.equal(stored("amar-bangla-boi").downloadUrl, undefined);
  assert.deepEqual(stored("history-9-10"), { titleEn: "History (2027)", downloadUrl: "https://nctb.gov.bd/pages/static-pages/history-2027", reviewed: true });
  assert.deepEqual(stored("geography-9-10").heldLinks.reasons, ["not-nctb"]);
  assert.deepEqual(stored("teacher-reader").heldLinks.reasons, ["not-admin"]);
  assert.deepEqual(stored("ethnic-culture"), { hidden: true });
  const heldEvents = events("library-link-held");
  assert.deepEqual(heldEvents.map((row) => row.targetId).sort(), ["amar-bangla-boi", "geography-9-10", "teacher-reader"]);
  assert.ok(heldEvents.every((row) => row.actorId === null));
  assert.deepEqual(heldEvents.find((row) => row.targetId === "amar-bangla-boi").details, { bookId: "amar-bangla-boi", downloadUrl: "https://random.example.com/bangla.pdf", setBy: "teacher@example.com", reasons: ["not-admin", "not-nctb"] });

  // Readers keep the official pages; the administrator's NCTB link still reaches them.
  const readers = await catalog.getLibraryCatalog();
  assert.deepEqual(readers.find((book) => book.id === "amar-bangla-boi").links.map((link) => link.url), [1, 2, 3, 4, 5].map((grade) => classPage(grade)));
  assert.equal(readers.find((book) => book.id === "history-9-10").links[0].url, "https://nctb.gov.bd/pages/static-pages/history-2027");
  const reader = readers.find((book) => book.id === "teacher-reader");
  assert.equal(reader.link.kind, "portal");
  assert.deepEqual(reader.subjectArea, { en: "Added source", bn: "যোগ করা উৎস" });
  assert.equal(JSON.stringify(readers).includes("random.example.com"), false);
  assert.equal(links.topicSourceLinks([{ bookId: "amar-bangla-boi", note: { en: "", bn: "" } }], await catalog.libraryOverrides())[0].links.some((link) => link.url.includes("random.example.com")), false);

  // Running again changes nothing.
  migrate();
  assert.equal(events("library-link-held").length, 3);

  const listed = (await catalog.adminLibraryCatalog()).find((book) => book.id === "amar-bangla-boi");
  assert.deepEqual({ ...listed.held, heldAt: undefined }, { downloadUrl: "https://random.example.com/bangla.pdf", setBy: "Teacher Tania", heldAt: undefined, reasons: ["not-admin", "not-nctb"] });

  // Restoring saves the held link as this year's link, with the usual warning and audit.
  const restored = await catalog.updateLibrarySource(admin, "amar-bangla-boi", { heldLinks: "restore" });
  assert.match(restored.warnings[0].en, /not on the NCTB website/);
  assert.deepEqual(stored("amar-bangla-boi"), { downloadUrl: "https://random.example.com/bangla.pdf", reviewed: true });
  assert.deepEqual(restored.book.links, [{ url: "https://random.example.com/bangla.pdf", kind: "override", label: null }]);
  assert.equal(events("library-link-restored")[0].targetId, "amar-bangla-boi");
  const update = events("library-link-updated").filter((row) => row.targetId === "amar-bangla-boi").at(-1).details;
  assert.equal(update.oldUrl, null);
  assert.equal(update.newUrl, "https://random.example.com/bangla.pdf");
  assert.equal(update.notNctb, true);
  assert.deepEqual(Object.values(update.oldLinks), [1, 2, 3, 4, 5].map((grade) => classPage(grade)));
  await assert.rejects(catalog.updateLibrarySource(admin, "amar-bangla-boi", { heldLinks: "restore" }), (error) => error.status === 409 && Boolean(error.messageBn));
  await assert.rejects(catalog.updateLibrarySource(admin, "geography-9-10", { heldLinks: "maybe" }), (error) => error.status === 400);

  // Discarding drops it: a record left with nothing else returns the book to the shipped record.
  await catalog.updateLibrarySource(admin, "geography-9-10", { heldLinks: "discard" });
  assert.equal(stored("geography-9-10"), null);
  assert.deepEqual(events("library-link-discarded")[0].details, { bookId: "geography-9-10", downloadUrl: "https://drive.example.com/geography.pdf", setBy: "admin@example.com" });
  assert.equal((await catalog.adminLibraryCatalog()).filter((book) => book.held).map((book) => book.id).join(), "teacher-reader");
});
