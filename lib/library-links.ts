import { libraryBooks, NCTB_PORTAL_URL, type LibraryBook } from "../app/library-content";
import { nctbCommunityDiscovery, nctbConditionalTeenResources, nctbCoreBooks, nctbPrePrimaryResources, nctbTeenCatalogPages } from "../app/nctb-books";
import type { Bilingual } from "../app/topics-content";

/**
 * Where each textbook link goes. The static catalogue (app/library-content.ts) and
 * the audited NCTB records (app/nctb-books.ts) are the baseline; an administrator's
 * yearly link, stored in knowledge_sources, wins over both. This module has no
 * database access so pages, the topic reader and unit tests share one rule:
 * administrator's link, else the official NCTB page for the book (per class when
 * the book covers several classes), else the NCTB website.
 */

export type LinkKind = "override" | "official" | "portal";
export type ResolvedLink = { url: string; kind: LinkKind };
/** One class's volume of a book that covers several classes, with its official NCTB page. */
export type BookEdition = { key: string; label: Bilingual; officialPage: string };
/** A book's link as shown to readers: per class (label set) or for the whole book. */
export type SourceLink = ResolvedLink & { label: Bilingual | null };

/** What an administrator has changed about a book; stored as JSON in knowledge_sources. */
export type SourceOverride = Partial<Omit<LibraryBook, "id" | "chapterMaps">> & {
  hidden?: boolean;
  /** This year's link for the whole book. */
  downloadUrl?: string;
  /** This year's link for one class of a book that covers several classes, by edition key. */
  classLinks?: Record<string, string>;
};

export type CatalogBook = LibraryBook & {
  /** Added by an administrator rather than part of the shipped catalogue. */
  added: boolean;
  customised: boolean;
  hidden: boolean;
  /** The whole book's link (kept for older callers: equals link.url when set by an administrator). */
  downloadUrl?: string;
  link: ResolvedLink;
  editions: Array<BookEdition & { link: ResolvedLink; overridden: boolean }>;
  links: SourceLink[];
};

const classLabel: Record<string, Bilingual> = {
  "pre-primary": { en: "Pre-primary", bn: "প্রাক-প্রাথমিক" },
  primary: { en: "Primary", bn: "প্রাথমিক" },
  "class-1": { en: "Class 1", bn: "১ম শ্রেণি" },
  "class-2": { en: "Class 2", bn: "২য় শ্রেণি" },
  "class-3": { en: "Class 3", bn: "৩য় শ্রেণি" },
  "class-4": { en: "Class 4", bn: "৪র্থ শ্রেণি" },
  "class-5": { en: "Class 5", bn: "৫ম শ্রেণি" },
  "class-6": { en: "Class 6", bn: "৬ষ্ঠ শ্রেণি" },
  "class-7": { en: "Class 7", bn: "৭ম শ্রেণি" },
  "class-8": { en: "Class 8", bn: "৮ম শ্রেণি" },
  "class-9-10": { en: "Classes 9–10", bn: "৯ম–১০ম শ্রেণি" },
};

function edition(key: string, officialPage: string | undefined): BookEdition {
  if (!officialPage) throw new Error(`No NCTB record for the ${key} edition.`);
  return { key, label: classLabel[key], officialPage };
}
const core = (id: string) => nctbCoreBooks.find((book) => book.id === id)?.officialPage;
const teen = (id: string) => nctbConditionalTeenResources.find((book) => book.id === id)?.officialPage;
const prePrimary = (id: string) => nctbPrePrimaryResources.find((book) => book.id === id)?.officialPage;
const catalogue = (grade: (typeof nctbTeenCatalogPages)[number]["grade"]) => nctbTeenCatalogPages.find((page) => page.grade === grade)?.url;

/**
 * The official NCTB page for each class a catalogue book covers, taken from the
 * audited records in app/nctb-books.ts. NCTB lists the textbooks of each class on
 * one page, so a class's page is the closest link to the book itself. Books with
 * no audited record (arts and crafts, ethnic culture, HSC readers) fall back to the
 * NCTB website until a record or an administrator's link exists.
 */
export const bookEditions: Record<string, BookEdition[]> = {
  "amar-boi-pre-primary": [edition("pre-primary", prePrimary("preprimary-my-book"))],
  "amar-bangla-boi": [1, 2, 3, 4, 5].map((grade) => edition(`class-${grade}`, core(`amar-bangla-class-${grade}`))),
  "bgs-primary": [3, 4, 5].map((grade) => edition(`class-${grade}`, core(`bangladesh-global-studies-class-${grade}`))),
  "bgs-secondary": [
    edition("class-6", teen("class-6-bgs")), edition("class-7", catalogue("Class 7")),
    edition("class-8", teen("class-8-bgs")), edition("class-9-10", catalogue("Classes 9–10")),
  ],
  "history-9-10": [edition("class-9-10", catalogue("Classes 9–10"))],
  "literature-secondary": [edition("class-6", teen("class-6-charupath")), edition("class-7", catalogue("Class 7")), edition("class-8", teen("class-8-literature"))],
  "geography-9-10": [edition("class-9-10", catalogue("Classes 9–10"))],
  "mother-tongue-books": [edition("pre-primary", nctbCommunityDiscovery[0]?.prePrimaryPage), edition("primary", nctbCommunityDiscovery[0]?.primaryPage)],
};

export const editionsOf = (bookId: string): BookEdition[] => bookEditions[bookId] ?? [];

/**
 * A book's link: the administrator's link for the class, else for the whole book,
 * else the official NCTB page (for the class, or the book's only edition), else the
 * NCTB website. Without classKey a book with several editions has no single page.
 * A whole-book link wins over the class pages because it is this year's edition.
 */
export function resolveBookLink(bookId: string, override?: SourceOverride | null, classKey?: string): ResolvedLink {
  const editions = editionsOf(bookId);
  const key = classKey ?? (editions.length === 1 ? editions[0].key : undefined);
  const classOverride = key ? override?.classLinks?.[key] : undefined;
  if (classOverride) return { url: classOverride, kind: "override" };
  if (override?.downloadUrl) return { url: override.downloadUrl, kind: "override" };
  const official = key ? editions.find((item) => item.key === key) : undefined;
  if (official) return { url: official.officialPage, kind: "official" };
  return { url: NCTB_PORTAL_URL, kind: "portal" };
}

/** The links a reader sees for a book: one per class when it covers several, else one. */
export function bookLinks(bookId: string, override?: SourceOverride | null): SourceLink[] {
  const editions = editionsOf(bookId);
  if (editions.length > 1) return editions.map((item) => ({ ...resolveBookLink(bookId, override, item.key), label: item.label }));
  return [{ ...resolveBookLink(bookId, override), label: null }];
}

const isPair = (value: unknown): value is Bilingual =>
  Boolean(value) && typeof (value as Bilingual).en === "string" && typeof (value as Bilingual).bn === "string";

/** A source added by an administrator, when its stored record is complete enough to show. */
function addedBook(id: string, override: SourceOverride): LibraryBook | null {
  if (!override.titleBn || !override.titleEn || !isPair(override.classes)) return null;
  return {
    id,
    titleBn: override.titleBn,
    titleEn: override.titleEn,
    classes: override.classes,
    level: override.level ?? "secondary",
    subjectArea: override.subjectArea ?? { en: "Added by an administrator", bn: "প্রশাসকের যোগ করা" },
    covers: override.covers ?? { en: "", bn: "" },
    whyItMatters: override.whyItMatters ?? { en: "", bn: "" },
    hasEnglishVersion: override.hasEnglishVersion ?? false,
    status: override.status ?? "confirm",
  };
}

function catalogEntry(book: LibraryBook, override: SourceOverride | undefined, added: boolean): CatalogBook {
  const merged: LibraryBook = override && !added ? { ...book, ...stripLinks(override), id: book.id, chapterMaps: book.chapterMaps } : book;
  return {
    ...merged,
    added,
    customised: Boolean(override),
    hidden: Boolean(override?.hidden),
    ...(override?.downloadUrl ? { downloadUrl: override.downloadUrl } : {}),
    link: resolveBookLink(book.id, override),
    editions: editionsOf(book.id).map((item) => ({ ...item, link: resolveBookLink(book.id, override, item.key), overridden: Boolean(override?.classLinks?.[item.key]) })),
    links: bookLinks(book.id, override),
  };
}

function stripLinks(override: SourceOverride): Partial<LibraryBook> {
  const fields: SourceOverride = { ...override };
  delete fields.hidden; delete fields.downloadUrl; delete fields.classLinks;
  return fields as Partial<LibraryBook>;
}

/**
 * The shipped catalogue merged with the stored overrides, then any sources an
 * administrator added. Hidden books are left out unless includeHidden is set.
 */
export function mergeCatalog(overrides: Map<string, SourceOverride>, { includeHidden = false } = {}): CatalogBook[] {
  const books: CatalogBook[] = [];
  for (const book of libraryBooks) books.push(catalogEntry(book, overrides.get(book.id), false));
  for (const [id, override] of overrides) {
    if (libraryBooks.some((book) => book.id === id)) continue;
    const book = addedBook(id, override);
    if (book) books.push(catalogEntry(book, override, true));
  }
  return includeHidden ? books : books.filter((book) => !book.hidden);
}

/** A topic's cited textbooks with their links (hidden books stay cited: the topic was written from them). */
export function topicSourceLinks(sources: Array<{ bookId: string; note: Bilingual }>, overrides: Map<string, SourceOverride> = new Map()) {
  return sources.flatMap((source) => {
    const book = libraryBooks.find((item) => item.id === source.bookId);
    if (!book) return [];
    const override = overrides.get(book.id);
    const links = bookLinks(book.id, override);
    return [{ bookId: book.id, title: override?.titleEn ?? book.titleEn, titleBn: override?.titleBn ?? book.titleBn, classes: override?.classes ?? book.classes, note: source.note, url: links[0].url, links }];
  });
}
export type TopicReference = ReturnType<typeof topicSourceLinks>[number];

export const LINK_LIMIT = 500;

/** Why a link cannot be stored, in both languages, or null when it is a usable HTTPS link. */
export function linkProblem(value: string): Bilingual | null {
  if (value.length > LINK_LIMIT) return { en: `Links can be at most ${LINK_LIMIT} characters.`, bn: `লিংক সর্বোচ্চ ${LINK_LIMIT.toLocaleString("bn-BD")} অক্ষরের হতে পারে।` };
  let url: URL;
  try { url = new URL(value); } catch { return { en: "Enter a full link that starts with https://", bn: "https:// দিয়ে শুরু হওয়া পুরো লিংক দিন।" }; }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || host === "localhost" || !host.includes(".") || /^[\d.]+$/.test(host) || host.startsWith("[")) {
    return { en: "Enter a public HTTPS link (https://…) without a password in it.", bn: "পাসওয়ার্ড ছাড়া একটি সাধারণ HTTPS লিংক (https://…) দিন।" };
  }
  return null;
}

/** NCTB's own website; other hosts are allowed but get a warning. */
export function isNctbLink(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "nctb.gov.bd" || host.endsWith(".nctb.gov.bd");
  } catch { return false; }
}

export const NOT_NCTB_WARNING: Bilingual = {
  en: "This link is not on the NCTB website (nctb.gov.bd). It was saved, but check that it is the official textbook before students use it.",
  bn: "এই লিংকটি এনসিটিবির ওয়েবসাইটে (nctb.gov.bd) নয়। এটি সংরক্ষিত হয়েছে, তবে শিক্ষার্থীরা ব্যবহারের আগে দেখে নিন এটি সরকারি পাঠ্যবই কি না।",
};
