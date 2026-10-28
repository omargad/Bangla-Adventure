"use client";
import { useEffect, useState } from "react";
import PortalShell from "@/app/components/PortalShell";
import { useLanguage } from "@/lib/use-language";
import type { CatalogTopic } from "@/lib/curriculum-catalog";
export default function CurriculumEditor({ name }: { name: string }) {
  const [language, toggleLanguage] = useLanguage();
  const [topics, setTopics] = useState<CatalogTopic[]>([]);
  const [draft, setDraft] = useState<CatalogTopic | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/curriculum", { signal: controller.signal, cache: "no-store" }).then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error); setTopics(data.topics); }).catch((error) => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, []);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/curriculum", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setDraft(data.topic); setTopics((current) => current.map((topic) => topic.id === data.topic.id ? data.topic : topic));
      setMessage("Topic saved. The updated reading is available in the signed-in learning view; educator-review status is unchanged.");
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save. Please retry."); }
    finally { setBusy(false); }
  }
  return <PortalShell role="admin" name={name} active="curriculum" language={language} toggleLanguage={toggleLanguage}>
    <h1>Curriculum updates</h1><p>Edit the reading content and its English/Bangla presentation. Saving updates the learning preview, not its educational approval. Existing references, quiz questions and review gates are retained.</p>
    <label className="portal-field">Choose a topic<select value={draft?.id ?? ""} disabled={busy} onChange={(e) => { setDraft(topics.find((t) => t.id === e.target.value) ?? null); setMessage(""); setError(""); }}><option value="">Select a topic</option>{topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.title.en}</option>)}</select></label>
    {error && <p className="auth-error" role="alert">{error}</p>}{message && <p className="teach-message" role="status">{message}</p>}
    {draft && <form className="teach-panel portal-editor" onSubmit={save}>
      {(["en", "bn"] as const).map((lang) => <div key={lang}><label>Title ({lang === "en" ? "English" : "Bangla"})<input required maxLength={160} value={draft.title[lang]} onChange={(e) => setDraft({ ...draft, title: { ...draft.title, [lang]: e.target.value } })} /></label><label>Introduction ({lang === "en" ? "English" : "Bangla"})<textarea required maxLength={500} value={draft.tagline[lang]} onChange={(e) => setDraft({ ...draft, tagline: { ...draft.tagline, [lang]: e.target.value } })} /></label></div>)}
      <label>Reading time (minutes)<input required type="number" min={1} max={60} value={draft.minutes} onChange={(e) => setDraft({ ...draft, minutes: Number(e.target.value) })} /></label>
      {draft.sections.map((section, index) => <fieldset key={index}><legend>Reading section {index + 1}</legend>{(["en", "bn"] as const).map((lang) => <div key={lang}>
        <label>Section {index + 1} heading ({lang})<input required maxLength={160} value={section.heading[lang]} onChange={(e) => setDraft({ ...draft, sections: draft.sections.map((part, i) => i === index ? { ...part, heading: { ...part.heading, [lang]: e.target.value } } : part) })} /></label>
        <label>Section {index + 1} text ({lang})<textarea required rows={5} maxLength={8000} value={section.body[lang]} onChange={(e) => setDraft({ ...draft, sections: draft.sections.map((part, i) => i === index ? { ...part, body: { ...part.body, [lang]: e.target.value } } : part) })} /></label>
      </div>)}</fieldset>)}
      <div className="access-actions"><button className="primary-button" disabled={busy}>{busy ? "Saving…" : "Save topic update"}</button><a className="outline-button" href={`/topics?topic=${draft.id}`}>Preview learning topic</a><span>Version {draft.version}</span></div>
    </form>}
  </PortalShell>;
}
