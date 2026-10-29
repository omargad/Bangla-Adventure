"use client";

import { useCallback, useEffect, useState } from "react";
import PortalShell from "@/app/components/PortalShell";
import { useLanguage, type Language } from "@/lib/use-language";
import { formatWhen } from "@/lib/topic-model";
import { isNctbLink, linkProblem, type HeldLinks, type HoldReason, type ResolvedLink } from "@/lib/library-links";
import type { AdminCatalogBook } from "@/lib/library-catalog";
import type { Bilingual } from "@/app/topics-content";

type Notice = Bilingual & { tone: "ok" | "warn" | "error" };
type SaveLink = (book: AdminCatalogBook, classKey: string | null, url: string) => Promise<void>;
type Decision = "restore" | "discard";
const levels = [
  { id: "primary", en: "Pre-primary & primary", bn: "প্রাক-প্রাথমিক ও প্রাথমিক" },
  { id: "secondary", en: "Secondary", bn: "মাধ্যমিক" },
  { id: "higher-secondary", en: "Higher secondary", bn: "উচ্চ মাধ্যমিক" },
] as const;
// Shown while typing; the server answers with its own warning once a link is saved.
const notNctbYet: Bilingual = {
  en: "This link is not on the NCTB website (nctb.gov.bd). You can still save it, but check that it is the official textbook before students use it.",
  bn: "এই লিংকটি এনসিটিবির ওয়েবসাইটে (nctb.gov.bd) নয়। তবু সংরক্ষণ করা যাবে, কিন্তু শিক্ষার্থীরা ব্যবহারের আগে দেখে নিন এটি সরকারি পাঠ্যবই কি না।",
};
const holdReason: Record<HoldReason, Bilingual> = {
  "not-admin": { en: "Not saved by an administrator", bn: "প্রশাসক সংরক্ষণ করেননি" },
  "not-nctb": { en: "Not on the NCTB website", bn: "এনসিটিবির ওয়েবসাইটে নয়" },
};
const decided: Record<Decision, Bilingual> = {
  restore: { en: "Link restored. Readers follow it again.", bn: "লিংক ফিরিয়ে আনা হয়েছে। পাঠকেরা আবার এটি ব্যবহার করবেন।" },
  discard: { en: "Link discarded. Readers keep the NCTB link.", bn: "লিংক বাদ দেওয়া হয়েছে। পাঠকেরা এনসিটিবির লিংকটিই পাবেন।" },
};
const emptySource = { titleEn: "", titleBn: "", classesEn: "", classesBn: "", level: "secondary", coversEn: "", coversBn: "", url: "" };

class RequestError extends Error {
  constructor(readonly notice: Notice) { super(notice.en); }
}
async function send<T>(method: string, body?: unknown): Promise<T> {
  const response = await fetch(method === "GET" ? "/api/library?scope=admin" : "/api/library", {
    method, cache: "no-store", ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new RequestError({ en: data.error ?? "The change could not be saved. Please try again.", bn: data.errorBn ?? "পরিবর্তনটি সংরক্ষণ করা যায়নি। আবার চেষ্টা করুন।", tone: "error" });
  return data as T;
}
const failed = (failure: unknown): Notice => failure instanceof RequestError ? failure.notice
  : { en: "Could not reach the server. Your changes have not been saved.", bn: "সার্ভারে পৌঁছানো যায়নি। আপনার পরিবর্তন সংরক্ষিত হয়নি।", tone: "error" };

/**
 * The administrator's Sources page: this year's NCTB link for each book (and for
 * each class where a book covers several), hiding outdated books and adding new
 * ones. Every change is audited and reaches Sources & references, the textbook
 * library and each topic's sources at once.
 */
export default function AdminSources({ name }: { name: string }) {
  const [language, toggleLanguage] = useLanguage();
  const s = (en: string, bn: string) => (language === "bn" ? bn : en);
  const [books, setBooks] = useState<AdminCatalogBook[] | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [source, setSource] = useState(emptySource);

  const load = useCallback(async () => {
    try { setBooks((await send<{ books: AdminCatalogBook[] }>("GET")).books); }
    catch (failure) { setNotice(failed(failure)); }
  }, []);
  useEffect(() => {
    // Data fetch: the state updates land after the response.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function change(body: unknown, success: Bilingual) {
    if (busy) return;
    setBusy(true); setNotice(null);
    try {
      const result = await send<{ warnings?: Bilingual[] }>("PUT", body);
      const warning = result.warnings?.[0];
      setNotice(warning ? { ...warning, tone: "warn" } : { ...success, tone: "ok" });
      await load();
    } catch (failure) { setNotice(failed(failure)); }
    finally { setBusy(false); }
  }

  const saveLink: SaveLink = (book, classKey, url) => change(
    { id: book.id, data: classKey ? { classLinks: { [classKey]: url } } : { downloadUrl: url } },
    url
      ? { en: "Link saved. Sources & references, the textbook library and topic sources now use it.", bn: "লিংক সংরক্ষিত। ‘উৎস ও তথ্যসূত্র’, পাঠ্যবই লাইব্রেরি ও বিষয়ের উৎস এখন এটি ব্যবহার করছে।" }
      : { en: "Your link was removed. Readers see the official NCTB page again.", bn: "আপনার লিংক সরানো হয়েছে। পাঠকেরা আবার এনসিটিবির সরকারি পাতা দেখবেন।" },
  );

  async function addSource(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setNotice(null);
    try {
      const result = await send<{ warnings?: Bilingual[] }>("POST", {
        titleEn: source.titleEn, titleBn: source.titleBn, classes: { en: source.classesEn, bn: source.classesBn }, level: source.level,
        ...(source.coversEn || source.coversBn ? { covers: { en: source.coversEn, bn: source.coversBn } } : {}), downloadUrl: source.url,
      });
      const warning = result.warnings?.[0];
      setNotice(warning ? { ...warning, tone: "warn" } : { en: "Source added. Readers see it in Sources & references and the textbook library.", bn: "উৎস যোগ হয়েছে। পাঠকেরা এটি ‘উৎস ও তথ্যসূত্র’ ও পাঠ্যবই লাইব্রেরিতে দেখবেন।", tone: "ok" });
      setSource(emptySource);
      await load();
    } catch (failure) { setNotice(failed(failure)); }
    finally { setBusy(false); }
  }

  const sourceField = (key: keyof typeof emptySource) => ({ value: source[key], onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setSource((current) => ({ ...current, [key]: event.target.value })) });
  const visible = (books ?? []).filter((book) => !book.hidden), hidden = (books ?? []).filter((book) => book.hidden);
  const toCheck = (books ?? []).flatMap((book) => (book.held ? [{ book, held: book.held }] : []));

  return <PortalShell role="admin" name={name} active="admin-sources" language={language} toggleLanguage={toggleLanguage}>
    <h1>{s("Textbook links", "পাঠ্যবইয়ের লিংক")}</h1>
    <p>{s(
      "NCTB publishes new textbook editions every academic year. Paste this year's link for each book, and for each class where a book covers several classes. Students, parents and teachers then see the new link in Sources & references, the textbook library and each topic's sources. Every change is listed under Recent changes on the Users page.",
      "এনসিটিবি প্রতি শিক্ষাবর্ষে নতুন পাঠ্যবই প্রকাশ করে। প্রতিটি বইয়ের এ বছরের লিংক দিন, আর একাধিক শ্রেণির বইয়ে প্রতিটি শ্রেণির জন্য আলাদা লিংক দিন। তখন শিক্ষার্থী, অভিভাবক ও শিক্ষকেরা ‘উৎস ও তথ্যসূত্র’, পাঠ্যবই লাইব্রেরি ও প্রতিটি বিষয়ের উৎসে নতুন লিংকটি দেখবেন। প্রতিটি পরিবর্তন ব্যবহারকারী পাতার ‘সাম্প্রতিক পরিবর্তন’ অংশে দেখা যায়।",
    )}</p>
    <p className="teach-note">{s("Teachers add links for their own classes in the teacher workspace (Class sources).", "শিক্ষকেরা নিজের ক্লাসের লিংক শিক্ষকের কর্মক্ষেত্রে (ক্লাসের উৎস) যোগ করেন।")}</p>
    {notice && <p className={notice.tone === "error" ? "auth-error" : notice.tone === "warn" ? "source-warning" : "teach-message"} role={notice.tone === "ok" ? "status" : "alert"}>{notice[language]}</p>}

    {books === null ? (notice?.tone !== "error" && <p role="status">{s("Loading the sources…", "উৎস লোড হচ্ছে…")}</p>) : <>
      {toCheck.length > 0 && <section className="teach-panel admin-source-check" aria-label={s("Links to check", "যাচাই করার লিংক")}>
        <h2>{s("Links to check", "যাচাই করার লিংক")}</h2>
        <p>{s(
          "These links were saved before only administrators could change textbook links, by an account that is not an administrator or to a website other than NCTB. Readers do not see them for now and go to the NCTB page instead. Open each link, then restore it if it is this year's official textbook, or discard it.",
          "শুধু প্রশাসকেরা পাঠ্যবইয়ের লিংক বদলাতে পারার আগে এই লিংকগুলো সংরক্ষণ করা হয়েছিল, প্রশাসক নন এমন কারও অ্যাকাউন্ট থেকে বা এনসিটিবি ছাড়া অন্য ওয়েবসাইটের। পাঠকেরা এখন এগুলো দেখেন না, তার বদলে এনসিটিবির পাতায় যান। প্রতিটি লিংক খুলে দেখুন: এটি এ বছরের সরকারি পাঠ্যবই হলে ফিরিয়ে আনুন, না হলে বাদ দিন।",
        )}</p>
        <div className="admin-source-list">
          {toCheck.map(({ book, held }) => <HeldCard key={book.id} book={book} held={held} language={language} busy={busy} onDecide={(decision) => change({ id: book.id, data: { heldLinks: decision } }, decided[decision])} />)}
        </div>
      </section>}
      <div className="admin-source-list">
        {visible.map((book) => <BookCard key={book.id} book={book} language={language} busy={busy} onSave={saveLink} onHidden={(value) => change({ id: book.id, data: { hidden: value } }, { en: "Hidden from readers. You can show it again below.", bn: "পাঠকদের কাছ থেকে লুকানো হয়েছে। নিচে থেকে আবার দেখাতে পারবেন।" })} />)}
      </div>
      {hidden.length > 0 && <section className="teach-panel" aria-label={s("Hidden sources", "লুকানো উৎস")}>
        <h2>{s("Hidden sources", "লুকানো উৎস")}</h2>
        <p className="teach-note">{s("Readers do not see these books in Sources & references or the textbook library. Topics that cite them still name them.", "পাঠকেরা ‘উৎস ও তথ্যসূত্র’ বা পাঠ্যবই লাইব্রেরিতে এই বইগুলো দেখেন না। যে বিষয়গুলো এগুলো থেকে নেওয়া, সেখানে নাম থেকে যায়।")}</p>
        <div className="admin-source-list">
          {hidden.map((book) => <BookCard key={book.id} book={book} language={language} busy={busy} onSave={saveLink} onHidden={(value) => change({ id: book.id, data: { hidden: value } }, { en: "Shown to readers again.", bn: "পাঠকেরা আবার এটি দেখবেন।" })} />)}
        </div>
      </section>}
    </>}

    <section className="teach-panel" aria-label={s("Add a source", "উৎস যোগ করুন")}>
      <h2>{s("Add a source", "উৎস যোগ করুন")}</h2>
      <p className="teach-note">{s("For a book that is not in the list yet, such as a new NCTB title. Give both languages so every reader can find it.", "তালিকায় নেই এমন বইয়ের জন্য, যেমন এনসিটিবির নতুন কোনো বই। দুই ভাষাতেই লিখুন, যেন সব পাঠক খুঁজে পান।")}</p>
      <form className="admin-source-form" onSubmit={addSource}>
        <label>{s("Title (English)", "নাম (ইংরেজি)")}<input required maxLength={160} {...sourceField("titleEn")} /></label>
        <label>{s("Title (Bangla)", "নাম (বাংলা)")}<input required lang="bn" maxLength={160} {...sourceField("titleBn")} /></label>
        <label>{s("Classes (English)", "শ্রেণি (ইংরেজি)")}<input required maxLength={120} placeholder={s("e.g. Class 7", "যেমন Class 7")} {...sourceField("classesEn")} /></label>
        <label>{s("Classes (Bangla)", "শ্রেণি (বাংলা)")}<input required lang="bn" maxLength={120} placeholder={s("e.g. ৭ম শ্রেণি", "যেমন ৭ম শ্রেণি")} {...sourceField("classesBn")} /></label>
        <label>{s("Level", "স্তর")}<select {...sourceField("level")}>{levels.map((level) => <option key={level.id} value={level.id}>{level[language]}</option>)}</select></label>
        <label>{s("What it covers (English, optional)", "কী আছে (ইংরেজি, ঐচ্ছিক)")}<input maxLength={400} {...sourceField("coversEn")} /></label>
        <label>{s("What it covers (Bangla, optional)", "কী আছে (বাংলা, ঐচ্ছিক)")}<input lang="bn" maxLength={400} {...sourceField("coversBn")} /></label>
        <label>{s("Link", "লিংক")}<input required type="url" maxLength={500} placeholder="https://nctb.gov.bd/…" {...sourceField("url")} /></label>
        <LinkWarning url={source.url} language={language} />
        <button type="submit" className="primary-button" disabled={busy}>{s("Add source", "উৎস যোগ করুন")}</button>
      </form>
    </section>
  </PortalShell>;
}

/**
 * A book whose links were saved under the old rules and are held back from readers:
 * each link, who saved it and why it is held, with Restore and Discard.
 */
function HeldCard({ book, held, language, busy, onDecide }: { book: AdminCatalogBook; held: HeldLinks; language: Language; busy: boolean; onDecide: (decision: Decision) => void }) {
  const s = (en: string, bn: string) => (language === "bn" ? bn : en);
  const title = language === "bn" ? book.titleBn : book.titleEn;
  const slots = [
    ...(held.downloadUrl ? [{ key: "book", label: book.editions.length > 1 ? s("Whole book (all classes)", "পুরো বই (সব শ্রেণি)") : s("Whole book", "পুরো বই"), url: held.downloadUrl }] : []),
    ...Object.entries(held.classLinks ?? {}).map(([key, url]) => ({ key, label: book.editions.find((item) => item.key === key)?.label[language] ?? key, url })),
  ];
  return (
    <article className="admin-source admin-source-held" aria-label={title}>
      <h3>{title}</h3>
      <ul>
        {slots.map((slot) => <li key={slot.key}><strong>{slot.label}</strong>: <a href={slot.url} target="_blank" rel="noreferrer noopener">{slot.url}</a></li>)}
      </ul>
      <p className="library-chips">{held.reasons.map((reason) => <span key={reason} className="library-chip-confirm">{holdReason[reason][language]}</span>)}</p>
      <small>{s(
        `Saved by ${held.setBy ?? "an unknown account"}. Held back from readers since ${formatWhen(held.heldAt, "en")}.`,
        `সংরক্ষণ করেছেন ${held.setBy ?? "অজানা একটি অ্যাকাউন্ট"}। ${formatWhen(held.heldAt, "bn")} থেকে পাঠকদের কাছ থেকে আটকে রাখা।`,
      )}</small>
      <div className="access-actions">
        <button type="button" className="outline-button" disabled={busy} aria-label={`${s("Restore", "ফিরিয়ে আনুন")}: ${title}`} onClick={() => onDecide("restore")}>{s("Restore", "ফিরিয়ে আনুন")}</button>
        <button type="button" className="text-button danger" disabled={busy} aria-label={`${s("Discard", "বাদ দিন")}: ${title}`} onClick={() => onDecide("discard")}>{s("Discard", "বাদ দিন")}</button>
      </div>
    </article>
  );
}

/** Warns, before saving, that a link is not on the NCTB website; it can still be saved. */
function LinkWarning({ url, language }: { url: string; language: Language }) {
  const value = url.trim();
  if (!value || linkProblem(value) || isNctbLink(value)) return null;
  return <p className="source-warning" role="note">{notNctbYet[language]}</p>;
}

function BookCard({ book, language, busy, onSave, onHidden }: { book: AdminCatalogBook; language: Language; busy: boolean; onSave: SaveLink; onHidden: (hidden: boolean) => void }) {
  const s = (en: string, bn: string) => (language === "bn" ? bn : en);
  const title = language === "bn" ? book.titleBn : book.titleEn;
  const perClass = book.editions.length > 1;
  return (
    <article className="teach-panel admin-source" aria-label={title}>
      <header>
        <h2>{title}</h2>
        <p lang={language === "bn" ? "en" : "bn"}>{language === "bn" ? book.titleEn : book.titleBn}</p>
        <p className="library-chips">
          <span>{book.classes[language]}</span>
          {book.added && <span>{s("Added source", "যোগ করা উৎস")}</span>}
          {book.hidden && <span className="library-chip-confirm">{s("Hidden from readers", "পাঠকদের কাছে লুকানো")}</span>}
          {book.held && <span className="library-chip-confirm">{s("Link to check (see the top of this page)", "লিংক যাচাই বাকি (পাতার ওপরে দেখুন)")}</span>}
        </p>
      </header>
      <LinkRow key={`book:${book.downloadUrl ?? ""}`} book={book} classKey={null} label={perClass ? s("Whole book (all classes)", "পুরো বই (সব শ্রেণি)") : s("Whole book", "পুরো বই")} current={book.link} stored={book.downloadUrl} perClass={perClass} language={language} busy={busy} onSave={onSave} />
      {perClass && book.editions.map((item) => (
        <LinkRow key={`${item.key}:${item.overridden ? item.link.url : ""}`} book={book} classKey={item.key} label={item.label[language]} current={item.link} stored={item.overridden ? item.link.url : undefined} language={language} busy={busy} onSave={onSave} />
      ))}
      <div className="admin-source-footer">
        <small>{book.updatedAt
          ? s(`Last changed by ${book.updatedBy ?? "a former administrator"} on ${formatWhen(book.updatedAt, "en")}.`, `সর্বশেষ বদলেছেন ${book.updatedBy ?? "একজন সাবেক প্রশাসক"}, ${formatWhen(book.updatedAt, "bn")}।`)
          : s("Not changed yet: links come from the audited NCTB records.", "এখনো বদলানো হয়নি: লিংকগুলো যাচাই করা এনসিটিবি নথি থেকে নেওয়া।")}</small>
        <button type="button" className="text-button" disabled={busy} aria-label={`${book.hidden ? s("Show to readers", "পাঠকদের দেখান") : s("Hide from readers", "পাঠকদের কাছে লুকান")}: ${title}`} onClick={() => onHidden(!book.hidden)}>
          {book.hidden ? s("Show to readers", "পাঠকদের দেখান") : s("Hide from readers", "পাঠকদের কাছে লুকান")}
        </button>
      </div>
    </article>
  );
}

function LinkRow({ book, classKey, label, current, stored, perClass = false, language, busy, onSave }: {
  book: AdminCatalogBook; classKey: string | null; label: string; current: ResolvedLink; stored?: string; perClass?: boolean; language: Language; busy: boolean; onSave: SaveLink;
}) {
  const s = (en: string, bn: string) => (language === "bn" ? bn : en);
  // BookCard keys each row by its stored link, so a saved link starts the row afresh.
  const [url, setUrl] = useState(stored ?? "");
  const value = url.trim();
  const problem = value ? linkProblem(value) : null;
  const title = language === "bn" ? book.titleBn : book.titleEn;
  const now = current.kind === "override" ? s("Your link", "আপনার লিংক") : current.kind === "official" ? s("Official NCTB page", "এনসিটিবির সরকারি পাতা") : s("NCTB website (no page for this book yet)", "এনসিটিবির ওয়েবসাইট (এই বইয়ের পাতা এখনো নেই)");
  return (
    <div className="admin-source-link">
      <div className="admin-source-now">
        <strong>{label}</strong>
        {perClass
          // A class's own link below wins over the whole book's, so this link is only for the classes without one.
          ? <small>{stored
            ? <>{s("Readers in every class without its own link below go to", "নিচে নিজস্ব লিংক নেই এমন প্রতিটি শ্রেণির পাঠকেরা যান")}: <a href={stored} target="_blank" rel="noreferrer">{stored}</a></>
            : s("Readers now go to each class's own page below. A link here is used for every class that has no link of its own below.", "পাঠকেরা এখন নিচে প্রতিটি শ্রেণির নিজস্ব পাতায় যান। এখানে লিংক দিলে নিচে যে শ্রেণির নিজস্ব লিংক নেই, সেগুলোর জন্য এটি ব্যবহার হবে।")}</small>
          : <small>{s("Readers now go to", "পাঠকেরা এখন যান")}: {now} · <a href={current.url} target="_blank" rel="noreferrer">{current.url}</a></small>}
      </div>
      <form onSubmit={(event) => { event.preventDefault(); if (value && !problem) void onSave(book, classKey, value); }}>
        <input type="url" maxLength={500} value={url} placeholder="https://nctb.gov.bd/…" aria-label={`${title} — ${label}: ${s("this year's link", "এ বছরের লিংক")}`} onChange={(event) => setUrl(event.target.value)} />
        <button type="submit" className="outline-button" disabled={busy || !value || Boolean(problem) || value === stored}>{s("Save link", "লিংক সংরক্ষণ")}</button>
        {stored && <button type="button" className="text-button danger" disabled={busy} onClick={() => void onSave(book, classKey, "")}>{s("Remove my link", "আমার লিংক সরান")}</button>}
      </form>
      {problem && <p className="auth-error">{problem[language]}</p>}
      <LinkWarning url={url} language={language} />
    </div>
  );
}
