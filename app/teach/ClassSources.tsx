"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Language } from "@/lib/use-language";
import type { ManagedClassSource as ClassSource } from "@/lib/class-sources";
import { classSourceTitle } from "../references/ClassSourceList";
import ContentApproval from "./ContentApproval";
import { sentBackEditNote, sourceEditPublication, sourceSaveButton, sourceSavedMessage, sourcesIntro, type ClassPublication } from "./class-publishing";

type Draft = { titleEn: string; titleBn: string; url: string; note: string };
type Notice = { en: string; bn: string; error?: boolean };
const emptyDraft: Draft = { titleEn: "", titleBn: "", url: "", note: "" };

class RequestError extends Error {
  constructor(readonly notice: Notice) { super(notice.en); }
}
/** What to show for a failed request: the server's reason, or that it could not be reached. */
const failed = (failure: unknown): Notice => failure instanceof RequestError ? failure.notice
  : { en: "Could not reach the server. Your changes have not been saved.", bn: "সার্ভারে পৌঁছানো যায়নি। আপনার পরিবর্তন সংরক্ষিত হয়নি।", error: true };

/**
 * The sources a teacher adds for one class: only students allocated to the class
 * and their linked parents see them. The NCTB textbook links for everyone are kept
 * by administrators on the Textbook links page.
 */
export default function ClassSources({ classId, language, isAdmin = false }: { classId: string; language: Language; isAdmin?: boolean }) {
  const s = (en: string, bn: string) => (language === "bn" ? bn : en);
  const [sources, setSources] = useState<ClassSource[] | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  // Whether a save is published at once or waits for an administrator, as the server last answered; the save's answer is what counts.
  const [publishing, setPublishing] = useState<{ onSave: ClassPublication; teachersNeedApproval: boolean } | null>(null);
  const onSave: ClassPublication = publishing?.onSave ?? (isAdmin ? "admin" : "review");
  const route = `/api/classes/${encodeURIComponent(classId)}/sources`;
  // A teacher's edit of a source an administrator sent back waits even while approval is off; the server decides the same.
  const editedSource = editing ? sources?.find((source) => source.id === editing) ?? null : null;
  const formSave = sourceEditPublication(onSave, editedSource);

  const send = useCallback(async (method: string, body?: unknown) => {
    const response = await fetch(route, { method, cache: "no-store", ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new RequestError({ en: data.error ?? "The change could not be saved. Please try again.", bn: data.errorBn ?? "পরিবর্তনটি সংরক্ষণ করা যায়নি। আবার চেষ্টা করুন।", error: true });
    return data;
  }, [route]);

  const load = useCallback(async () => {
    try {
      const data = await send("GET");
      setSources(data.sources);
      if (data.onSave) setPublishing({ onSave: data.onSave, teachersNeedApproval: data.teachersNeedApproval !== false });
    }
    catch (failure) { setNotice(failed(failure)); }
  }, [send]);

  useEffect(() => {
    // Data fetch: the state updates land after the response.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const field = (key: keyof Draft) => ({ value: draft[key], onChange: (event: React.ChangeEvent<HTMLInputElement>) => setDraft((current) => ({ ...current, [key]: event.target.value })) });

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setNotice(null);
    try {
      const data = editing ? await send("PATCH", { sourceId: editing, ...draft }) : await send("POST", draft);
      setNotice(sourceSavedMessage(data.source?.publishedDirectly ?? null, Boolean(editing)));
      setDraft(emptyDraft); setEditing(null);
      await load();
    } catch (failure) { setNotice(failed(failure)); }
    finally { setBusy(false); }
  }

  async function remove(source: ClassSource) {
    if (!window.confirm(s(`Remove “${classSourceTitle(source, "en")}” from this class?`, `এই ক্লাস থেকে “${classSourceTitle(source, "bn")}” সরাবেন?`))) return;
    setBusy(true); setNotice(null);
    try {
      await send("DELETE", { sourceId: source.id });
      if (editing === source.id) { setEditing(null); setDraft(emptyDraft); }
      setNotice({ en: "Source removed.", bn: "উৎস সরানো হয়েছে।" });
      await load();
    } catch (failure) { setNotice(failed(failure)); }
    finally { setBusy(false); }
  }

  async function review(source: ClassSource, approvalStatus: "approved" | "rejected", reviewNote: string) {
    try {
      await send("PATCH", { sourceId: source.id, approvalStatus, revision: source.revision, reviewNote });
      await load();
    } catch (failure) { throw new Error(failed(failure)[language]); }
  }

  return (
    <section className="teach-panel class-sources-editor" aria-label={s("Class sources", "ক্লাসের উৎস")}>
      <p className="teach-note">
        {sourcesIntro(onSave, publishing?.teachersNeedApproval ?? true)[language]}{" "}
        {isAdmin
          ? <Link href="/admin/sources">{s("The NCTB textbook links for everyone are on the Textbook links page.", "সবার জন্য এনসিটিবি পাঠ্যবইয়ের লিংক ‘পাঠ্যবইয়ের লিংক’ পাতায় আছে।")}</Link>
          : s("The NCTB textbook links for everyone are kept by the administrator.", "সবার জন্য এনসিটিবি পাঠ্যবইয়ের লিংক প্রশাসক দেখাশোনা করেন।")}
      </p>
      {notice && <p className={notice.error ? "auth-error" : "teach-message"} role={notice.error ? "alert" : "status"}>{notice[language]}</p>}

      {sources === null ? (!notice?.error && <p role="status">{s("Loading class sources…", "ক্লাসের উৎস লোড হচ্ছে…")}</p>) : sources.length === 0 ? (
        <p className="teach-empty">{s("No sources for this class yet.", "এই ক্লাসের জন্য এখনো কোনো উৎস নেই।")}</p>
      ) : (
        <ul className="class-source-list class-source-manage">
          {sources.map((source) => {
            const title = classSourceTitle(source, language);
            return (
              <li key={source.id}>
                <a href={source.url} target="_blank" rel="noreferrer">{title}<span aria-hidden="true"> ↗</span></a>
                <small>{source.host}</small>
                {source.titleEn && source.titleBn && <small lang={language === "bn" ? "en" : "bn"}>{language === "bn" ? source.titleEn : source.titleBn}</small>}
                {source.note && <p>{source.note}</p>}
                <ContentApproval key={`${source.id}:${source.revision}:${source.approvalStatus}`} language={language} status={source.approvalStatus} reviewNote={source.reviewNote} reviewedBy={source.reviewedBy} isAdmin={isAdmin}
                  onDecision={(status, note) => review(source, status, note)} />
                <div className="teach-activity-buttons">
                  <button type="button" className="text-button" disabled={busy} aria-label={s(`Edit ${title}`, `${title} সম্পাদনা`)} onClick={() => { setEditing(source.id); setDraft({ titleEn: source.titleEn, titleBn: source.titleBn, url: source.url, note: source.note }); setNotice(null); }}>{s("Edit", "সম্পাদনা")}</button>
                  <button type="button" className="text-button danger" disabled={busy} aria-label={s(`Remove ${title}`, `${title} সরান`)} onClick={() => void remove(source)}>{s("Remove", "সরান")}</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <form className="class-source-form" onSubmit={save} aria-label={editing ? s("Edit source", "উৎস সম্পাদনা") : s("Add a source", "উৎস যোগ করুন")}>
        <h3>{editing ? s("Edit source", "উৎস সম্পাদনা") : s("Add a source", "উৎস যোগ করুন")}</h3>
        <label>{s("Title (English)", "নাম (ইংরেজি)")}<input maxLength={120} {...field("titleEn")} /></label>
        <label>{s("Title (Bangla)", "নাম (বাংলা)")}<input lang="bn" maxLength={120} {...field("titleBn")} /></label>
        <label>{s("Link", "লিংক")}<input type="url" required maxLength={500} placeholder="https://" {...field("url")} /></label>
        <label>{s("Note for students (optional)", "শিক্ষার্থীদের জন্য নোট (ঐচ্ছিক)")}<input maxLength={300} {...field("note")} /></label>
        <small>{s("Give a title in at least one language. Links must start with https://", "অন্তত এক ভাষায় নাম দিন। লিংক https:// দিয়ে শুরু হতে হবে।")}</small>
        {formSave !== onSave && <p className="teach-note" data-testid="source-sent-back-note">{sentBackEditNote()[language]}</p>}
        <div className="teach-form-actions">
          {editing && <button type="button" className="text-button" onClick={() => { setEditing(null); setDraft(emptyDraft); }}>{s("Cancel", "বাতিল")}</button>}
          <button type="submit" className="primary-button" disabled={busy}>{sourceSaveButton(formSave)[language]}</button>
        </div>
      </form>
    </section>
  );
}
