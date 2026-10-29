import { eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { adults, knowledgeSources, userAuditEvents } from "../db/schema";
import { libraryBooks } from "../app/library-content";
import type { Bilingual } from "../app/topics-content";
import {
  editionsOf, isNctbLink, linkProblem, mergeCatalog, NOT_NCTB_WARNING, resolveBookLink,
  type CatalogBook, type HeldLinks, type SourceOverride,
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

/** A stored change, or null when the row is malformed or not a plain object (a hand-edited `null`, say). */
function parseOverride(dataJson: string): SourceOverride | null {
  try {
    const parsed: unknown = JSON.parse(dataJson);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as SourceOverride : null;
  } catch { return null; }
}

function readOverrides(db: Reader) {
  const rows = db.select().from(knowledgeSources).where(eq(knowledgeSources.active, true)).all();
  const overrides = new Map<string, SourceOverride>();
  for (const row of rows) {
    // A malformed row must not break the library: it is left out, as the start-up migration leaves it alone.
    const override = parseOverride(row.dataJson);
    if (override) overrides.set(row.id, override);
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

export type AdminCatalogBook = CatalogBook & {
  updatedBy: string | null;
  updatedAt: string | null;
  /** Links saved before only administrators could change them, waiting for a check (setBy is a name when the account still exists). */
  held: HeldLinks | null;
};

/** Every book, hidden ones included, with who changed it last and any held links, for the administrator's Sources page. */
export async function adminLibraryCatalog(): Promise<AdminCatalogBook[]> {
  const db = await getDb();
  const { rows, overrides } = readOverrides(db);
  const emails = [...new Set([...rows.map((row) => row.updatedBy), ...[...overrides.values()].map((item) => item.heldLinks?.setBy ?? "")].filter(Boolean))];
  const names = new Map(emails.length ? db.select({ email: adults.email, name: adults.displayName }).from(adults).where(inArray(adults.email, emails)).all().map((row) => [row.email, row.name]) : []);
  const meta = new Map(rows.map((row) => [row.id, row]));
  return mergeCatalog(overrides, { includeHidden: true }).map((book) => {
    const row = meta.get(book.id);
    const held = overrides.get(book.id)?.heldLinks;
    return {
      ...book,
      updatedBy: row ? names.get(row.updatedBy) ?? (row.updatedBy || null) : null,
      updatedAt: row?.updatedAt ?? null,
      held: held ? { ...held, setBy: held.setBy ? names.get(held.setBy) ?? held.setBy : null } : null,
    };
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

/** Saves a record an administrator changed; it is marked checked so the start-up check leaves it alone. */
function store(tx: Transaction, actor: Staff & { email: string }, id: string, data: SourceOverride) {
  const now = new Date().toISOString();
  const values = { updatedBy: actor.email, dataJson: JSON.stringify({ ...data, reviewed: true }), active: true, updatedAt: now };
  tx.insert(knowledgeSources).values({ id, ...values }).onConflictDoUpdate({ target: knowledgeSources.id, set: values }).run();
}

const isEmpty = (override: SourceOverride) => Object.keys(override).every((key) => key === "reviewed");
const heldUrls = (held: HeldLinks) => ({ ...(held.downloadUrl ? { downloadUrl: held.downloadUrl } : {}), ...(held.classLinks ? { classLinks: held.classLinks } : {}) });
const warningsFor = (urls: Array<string | null>) => (urls.some((url) => url && !isNctbLink(url)) ? [NOT_NCTB_WARNING] : []);

/**
 * Apply an administrator's change to one book, keeping every field the change does
 * not mention: this year's link for the whole book (downloadUrl) or for one class
 * (classLinks), hiding or showing it, descriptive fields, and restoring or
 * discarding held links (heldLinks: "restore" | "discard"). An empty link clears
 * it. Each changed link is audited with where readers went before and after.
 */
export async function updateLibrarySource(actor: Staff & { email: string }, id: string, raw: Record<string, unknown>) {
  const db = await getDb();
  return db.transaction((tx) => {
    const isBaseline = libraryBooks.some((book) => book.id === id);
    const row = tx.select().from(knowledgeSources).where(eq(knowledgeSources.id, id)).get();
    if (!isBaseline && !row) throw refuse({ en: "Source not found.", bn: "উৎসটি পাওয়া যায়নি।" }, 404);
    let before: SourceOverride = {};
    if (row) before = parseOverride(row.dataJson) ?? {};
    const decision = raw.heldLinks;
    if (decision !== undefined && decision !== "restore" && decision !== "discard") {
      throw refuse({ en: "Choose to restore or discard the held link.", bn: "আটকে রাখা লিংকটি ফিরিয়ে আনবেন না বাদ দেবেন, বেছে নিন।" });
    }
    const held = before.heldLinks;
    if (decision && !held) throw refuse({ en: "This source has no links waiting to be checked.", bn: "এই উৎসে যাচাইয়ের অপেক্ষায় কোনো লিংক নেই।" }, 409);
    // Restoring saves the held links as this year's links, with the same checks and audit as a new link.
    const input: Record<string, unknown> = decision === "restore" && held ? { ...raw, ...heldUrls(held) } : raw;
    const next: SourceOverride = { ...before, ...describedFields(input) };
    if (decision) delete next.heldLinks;
    const savedLinks: Array<string | null> = [];

    if ("downloadUrl" in input) {
      const url = linkValue(input.downloadUrl);
      if (url) next.downloadUrl = url; else delete next.downloadUrl;
      savedLinks.push(url);
    }
    if (input.classLinks !== undefined) {
      if (typeof input.classLinks !== "object" || input.classLinks === null) throw refuse({ en: "Give the class links by class.", bn: "ক্লাস অনুযায়ী লিংক দিন।" });
      const editions = editionsOf(id);
      const links = { ...(next.classLinks ?? {}) };
      for (const [key, value] of Object.entries(input.classLinks as Record<string, unknown>)) {
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
    const editions = editionsOf(id);
    const changedSlots: Array<string | undefined> = [
      ...(before.downloadUrl !== next.downloadUrl ? [undefined] : []),
      ...editions.map((item) => item.key).filter((key) => before.classLinks?.[key] !== next.classLinks?.[key]),
    ];
    const perClass = (override: SourceOverride) => Object.fromEntries(editions.map((item) => [item.key, resolveBookLink(id, override, item.key).url]));
    for (const key of changedSlots) {
      // A book that covers several classes has no single link: record the stored whole-book
      // link and where each class's readers went before and after.
      const change = key === undefined && editions.length > 1
        ? { oldUrl: before.downloadUrl ?? null, newUrl: next.downloadUrl ?? null, oldLinks: perClass(before), newLinks: perClass(next) }
        : { oldUrl: resolveBookLink(id, before, key).url, newUrl: resolveBookLink(id, next, key).url };
      audit(tx, actor.id, id, "library-link-updated", { bookId: id, classKey: key ?? null, ...change, ...(change.newUrl && !isNctbLink(change.newUrl) ? { notNctb: true } : {}) });
    }
    if (decision && held) audit(tx, actor.id, id, decision === "restore" ? "library-link-restored" : "library-link-discarded", { bookId: id, ...heldUrls(held), setBy: held.setBy });
    if (Boolean(before.hidden) !== Boolean(next.hidden)) audit(tx, actor.id, id, next.hidden ? "library-source-hidden" : "library-source-shown", { bookId: id });
    const described = Object.keys(describedFields(input)).filter((key) => JSON.stringify(before[key as keyof SourceOverride]) !== JSON.stringify(next[key as keyof SourceOverride]));
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
  const data: SourceOverride = { level: "secondary", status: "confirm", subjectArea: { en: "Added by an administrator", bn: "প্রশাসকের যোগ করা" }, ...fields, downloadUrl: url };
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
