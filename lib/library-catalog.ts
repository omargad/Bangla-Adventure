import { eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { adults, knowledgeSources, userAuditEvents } from "../db/schema";
import { libraryBooks } from "../app/library-content";
import type { Bilingual } from "../app/topics-content";
import {
  editionsOf, isNctbLink, linkProblem, mergeCatalog, NOT_NCTB_WARNING, resolveBookLink,
  type CatalogBook, type SourceOverride,
} from "./library-links";
import type { Staff } from "./class-access";

/**
 * The textbook catalogue as everyone sees it: the shipped NCTB records merged with
 * the administrator's changes in knowledge_sources (see lib/library-links.ts for
 * the link rule). Only administrators change it, and each change is audited.
 */

type Db = Awaited<ReturnType<typeof getDb>>;
type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Reader = Db | Transaction;

export class LibraryError extends Error {
  constructor(message: string, readonly messageBn: string, readonly status = 400) { super(message); }
}
const refuse = (text: Bilingual, status = 400) => new LibraryError(text.en, text.bn, status);

function readOverrides(db: Reader) {
  const rows = db.select().from(knowledgeSources).where(eq(knowledgeSources.active, true)).all();
  const overrides = new Map<string, SourceOverride>();
  for (const row of rows) {
    try { overrides.set(row.id, JSON.parse(row.dataJson) as SourceOverride); } catch { /* a malformed row must not break the library */ }
  }
  return { rows, overrides };
}

/** The stored changes by book id; empty while the database is unavailable, so links fall back to NCTB. */
export async function libraryOverrides(): Promise<Map<string, SourceOverride>> {
  try { return readOverrides(await getDb()).overrides; } catch { return new Map(); }
}

/** The books readers see (hidden ones left out), with each book's resolved links. */
export async function getLibraryCatalog(): Promise<CatalogBook[]> {
  return mergeCatalog(await libraryOverrides());
}

export type AdminCatalogBook = CatalogBook & { updatedBy: string | null; updatedAt: string | null };

/** Every book, hidden ones included, with who changed it last, for the administrator's Sources page. */
export async function adminLibraryCatalog(): Promise<AdminCatalogBook[]> {
  const db = await getDb();
  const { rows, overrides } = readOverrides(db);
  const emails = [...new Set(rows.map((row) => row.updatedBy).filter(Boolean))];
  const names = new Map(emails.length ? db.select({ email: adults.email, name: adults.displayName }).from(adults).where(inArray(adults.email, emails)).all().map((row) => [row.email, row.name]) : []);
  const meta = new Map(rows.map((row) => [row.id, row]));
  return mergeCatalog(overrides, { includeHidden: true }).map((book) => {
    const row = meta.get(book.id);
    return { ...book, updatedBy: row ? names.get(row.updatedBy) ?? (row.updatedBy || null) : null, updatedAt: row?.updatedAt ?? null };
  });
}

const text = (value: unknown, limit: number) => (typeof value === "string" ? value.trim().slice(0, limit) : "");
const pairOf = (value: unknown, limit: number): Bilingual | null => {
  if (typeof value !== "object" || value === null) return null;
  const en = text((value as Bilingual).en, limit), bn = text((value as Bilingual).bn, limit);
  return en && bn ? { en, bn } : null;
};

/** A link from the request: "" or null clears it; anything else must be a usable HTTPS link. */
function linkValue(value: unknown): string | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string") throw refuse({ en: "Enter the link as text.", bn: "লিংকটি লেখা হিসেবে দিন।" });
  const url = value.trim();
  if (!url) return null;
  const problem = linkProblem(url);
  if (problem) throw refuse(problem);
  return url;
}

/** The descriptive fields an administrator may set; unknown or incomplete values are ignored. */
function describedFields(raw: Record<string, unknown>): SourceOverride {
  const out: SourceOverride = {};
  const titleEn = text(raw.titleEn, 160), titleBn = text(raw.titleBn, 160);
  if (titleEn) out.titleEn = titleEn;
  if (titleBn) out.titleBn = titleBn;
  if (raw.level === "primary" || raw.level === "secondary" || raw.level === "higher-secondary") out.level = raw.level;
  if (raw.status === "listed" || raw.status === "confirm") out.status = raw.status;
  if (typeof raw.hasEnglishVersion === "boolean") out.hasEnglishVersion = raw.hasEnglishVersion;
  for (const key of ["classes", "subjectArea", "covers", "whyItMatters"] as const) {
    const pair = pairOf(raw[key], 400);
    if (pair) out[key] = pair;
  }
  return out;
}

function audit(tx: Transaction, actorId: string, bookId: string, action: string, details: Record<string, unknown>) {
  tx.insert(userAuditEvents).values({ id: crypto.randomUUID(), actorId, targetId: bookId, targetType: "library-source", action, detailsJson: JSON.stringify(details) }).run();
}

function store(tx: Transaction, actor: Staff & { email: string }, id: string, data: SourceOverride) {
  const now = new Date().toISOString();
  const values = { updatedBy: actor.email, dataJson: JSON.stringify(data), active: true, updatedAt: now };
  tx.insert(knowledgeSources).values({ id, ...values }).onConflictDoUpdate({ target: knowledgeSources.id, set: values }).run();
}

const isEmpty = (override: SourceOverride) => Object.keys(override).length === 0;
const warningsFor = (urls: Array<string | null>) => (urls.some((url) => url && !isNctbLink(url)) ? [NOT_NCTB_WARNING] : []);

/**
 * Apply an administrator's change to one book, keeping every field the change does
 * not mention: this year's link for the whole book (downloadUrl) or for one class
 * (classLinks), hiding or showing it, and descriptive fields. An empty link clears
 * it. Each changed link is audited with the link readers saw before and after.
 */
export async function updateLibrarySource(actor: Staff & { email: string }, id: string, raw: Record<string, unknown>) {
  const db = await getDb();
  return db.transaction((tx) => {
    const isBaseline = libraryBooks.some((book) => book.id === id);
    const row = tx.select().from(knowledgeSources).where(eq(knowledgeSources.id, id)).get();
    if (!isBaseline && !row) throw refuse({ en: "Source not found.", bn: "উৎসটি পাওয়া যায়নি।" }, 404);
    let before: SourceOverride = {};
    if (row) { try { before = JSON.parse(row.dataJson) as SourceOverride; } catch { before = {}; } }
    const next: SourceOverride = { ...before, ...describedFields(raw) };
    const savedLinks: Array<string | null> = [];

    if ("downloadUrl" in raw) {
      const url = linkValue(raw.downloadUrl);
      if (url) next.downloadUrl = url; else delete next.downloadUrl;
      savedLinks.push(url);
    }
    if (raw.classLinks !== undefined) {
      if (typeof raw.classLinks !== "object" || raw.classLinks === null) throw refuse({ en: "Give the class links by class.", bn: "ক্লাস অনুযায়ী লিংক দিন।" });
      const editions = editionsOf(id);
      const links = { ...(next.classLinks ?? {}) };
      for (const [key, value] of Object.entries(raw.classLinks as Record<string, unknown>)) {
        if (editions.length < 2 || !editions.some((item) => item.key === key)) {
          throw refuse({ en: "This book does not have a separate link for that class.", bn: "এই বইয়ের ওই ক্লাসের জন্য আলাদা লিংক নেই।" });
        }
        const url = linkValue(value);
        if (url) links[key] = url; else delete links[key];
        savedLinks.push(url);
      }
      if (Object.keys(links).length) next.classLinks = links; else delete next.classLinks;
    }
    if (raw.hidden === true) next.hidden = true;
    if (raw.hidden === false) delete next.hidden;

    if (!isBaseline && !(next.titleEn && next.titleBn && next.classes)) {
      throw refuse({ en: "A source needs both titles and its classes in English and Bangla.", bn: "উৎসের দুই ভাষার নাম এবং ইংরেজি ও বাংলায় শ্রেণি লাগবে।" });
    }

    // One event per link the administrator changed: the whole book's, then each class's.
    const changedSlots: Array<string | undefined> = [
      ...(before.downloadUrl !== next.downloadUrl ? [undefined] : []),
      ...editionsOf(id).map((item) => item.key).filter((key) => before.classLinks?.[key] !== next.classLinks?.[key]),
    ];
    for (const key of changedSlots) {
      const oldUrl = resolveBookLink(id, before, key).url, newUrl = resolveBookLink(id, next, key).url;
      audit(tx, actor.id, id, "library-link-updated", { bookId: id, classKey: key ?? null, oldUrl, newUrl, ...(isNctbLink(newUrl) ? {} : { notNctb: true }) });
    }
    if (Boolean(before.hidden) !== Boolean(next.hidden)) audit(tx, actor.id, id, next.hidden ? "library-source-hidden" : "library-source-shown", { bookId: id });
    const described = Object.keys(describedFields(raw)).filter((key) => JSON.stringify(before[key as keyof SourceOverride]) !== JSON.stringify(next[key as keyof SourceOverride]));
    if (described.length) audit(tx, actor.id, id, "library-source-updated", { bookId: id, fields: described });

    if (isBaseline && isEmpty(next)) tx.delete(knowledgeSources).where(eq(knowledgeSources.id, id)).run();
    else store(tx, actor, id, next);
    return { book: mergeCatalog(new Map([[id, next]]), { includeHidden: true }).find((book) => book.id === id) ?? null, warnings: warningsFor(savedLinks) };
  });
}

const slug = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "source";

/** An administrator adds a source that is not in the shipped catalogue; it needs both titles, its classes and a link. */
export async function addLibrarySource(actor: Staff & { email: string }, raw: Record<string, unknown>) {
  const fields = describedFields(raw);
  if (!fields.titleEn || !fields.titleBn) throw refuse({ en: "Give the source's title in English and Bangla.", bn: "উৎসের নাম ইংরেজি ও বাংলায় দিন।" });
  if (!fields.classes) throw refuse({ en: "Say which classes use it, in English and Bangla.", bn: "কোন শ্রেণিতে ব্যবহার হয়, ইংরেজি ও বাংলায় লিখুন।" });
  const url = linkValue(raw.downloadUrl);
  if (!url) throw refuse({ en: "Add the link to the source.", bn: "উৎসের লিংক দিন।" });
  const id = `${slug(fields.titleEn)}-${crypto.randomUUID().slice(0, 6)}`;
  const data: SourceOverride = { level: "secondary", status: "confirm", ...fields, downloadUrl: url };
  const db = await getDb();
  db.transaction((tx) => {
    store(tx, actor, id, data);
    audit(tx, actor.id, id, "library-source-added", { bookId: id, title: fields.titleEn, url });
  });
  return { id, book: mergeCatalog(new Map([[id, data]])).find((book) => book.id === id) ?? null, warnings: warningsFor([url]) };
}

/** Undo every change to a book (an added source disappears), with the old record kept in the audit. */
export async function resetLibrarySource(actor: Staff, id: string) {
  const db = await getDb();
  return db.transaction((tx) => {
    const removed = tx.delete(knowledgeSources).where(eq(knowledgeSources.id, id)).returning().get();
    if (!removed) throw refuse({ en: "This source has no changes to undo.", bn: "এই উৎসে ফেরানোর মতো কোনো পরিবর্তন নেই।" }, 404);
    audit(tx, actor.id, id, "library-source-reset", { bookId: id, previous: removed.dataJson });
    return { ok: true };
  });
}

/** The API answer for a refusal (in both languages) or an unexpected failure. */
export function libraryErrorResponse(error: unknown): Response {
  if (error instanceof LibraryError) return Response.json({ error: error.message, errorBn: error.messageBn }, { status: error.status });
  return Response.json({ error: "The textbook sources are temporarily unavailable. Please retry.", errorBn: "পাঠ্যবইয়ের উৎস এখন পাওয়া যাচ্ছে না। আবার চেষ্টা করুন।" }, { status: 503 });
}
