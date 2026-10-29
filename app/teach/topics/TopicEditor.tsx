"use client";

import { useEffect, useState } from "react";
import { topicThemes, type Bilingual, type TopicQuizQuestion, type TopicSection } from "@/app/topics-content";
import type { VersionSummary } from "@/lib/curriculum-catalog";
import { formatNumber, TOPIC_LIMITS, type Language, type TopicContent, type TopicVersionStatus } from "@/lib/topic-model";
import { call, failure, statusLabel, versionLabel } from "./shared";

type EditableTopic = {
  theme: string; emoji: string; title: Bilingual; tagline: Bilingual; minutes: number;
  sections: TopicSection[]; funFacts: Bilingual[]; quiz: TopicQuizQuestion[]; sourceNote: Bilingual;
};
type StaffTopic = {
  id: string; head: { version: number; status: TopicVersionStatus; content: TopicContent };
  approved: { version: number; content: TopicContent } | null; canStartFromApproved: boolean; versions: VersionSummary[];
};
type Base = "newest" | "approved";

const blank = (): Bilingual => ({ en: "", bn: "" });
const emptyTopic = (): EditableTopic => ({
  theme: "", emoji: "📘", title: blank(), tagline: blank(), minutes: 5,
  sections: [{ heading: blank(), body: blank() }], funFacts: [], quiz: [], sourceNote: blank(),
});
const emptyQuestion = (): TopicQuizQuestion => ({ question: blank(), options: [blank(), blank()], answer: 0 });
const editable = (content: TopicContent): EditableTopic => ({
  theme: content.theme, emoji: content.emoji, title: content.title, tagline: content.tagline, minutes: content.minutes,
  sections: content.sections, funFacts: content.funFacts ?? [], quiz: content.quiz ?? [], sourceNote: content.sourceNote ?? blank(),
});
/** The version an edit starts from: the newest one, or the approved one when allowed. */
const baseOf = (topic: StaffTopic, which: Base) => (which === "approved" && topic.approved ? topic.approved : topic.head);

/**
 * Write a new topic or edit one. Saving always creates a version that waits for
 * approval; what students see changes only when someone approves it. When every
 * change since the approved version was sent back, editing starts again from the
 * approved version (what students see), with the sent-back version one click away.
 */
export default function TopicEditor({ topicId, language, onSaved, onCancel }: {
  topicId: string | null; language: Language; onSaved: (topicId: string, version: number) => void; onCancel: () => void;
}) {
  const s = (en: string, bn: string) => (language === "bn" ? bn : en);
  const n = (value: number) => formatNumber(value, language);
  const [draft, setDraft] = useState<EditableTopic | null>(topicId ? null : emptyTopic());
  const [existing, setExisting] = useState<StaffTopic | null>(null);
  const [base, setBase] = useState<Base>("newest");
  const [error, setError] = useState<Bilingual | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!topicId) return;
    const controller = new AbortController();
    call<{ topic: StaffTopic }>(`/api/topics/${encodeURIComponent(topicId)}`, { signal: controller.signal })
      .then(({ topic }) => {
        const start: Base = topic.canStartFromApproved && topic.approved ? "approved" : "newest";
        setExisting(topic); setBase(start); setDraft(editable(baseOf(topic, start).content));
      })
      .catch((caught) => { if (!controller.signal.aborted) setError(failure(caught)); });
    return () => controller.abort();
  }, [topicId]);

  const switchBase = (next: Base) => {
    if (!existing || !draft) return;
    const unsaved = JSON.stringify(draft) !== JSON.stringify(editable(baseOf(existing, base).content));
    if (unsaved && !window.confirm(s("Replace your unsaved changes with that version?", "আপনার সংরক্ষণ না করা পরিবর্তনগুলোর বদলে ওই সংস্করণটি খুলবেন?"))) return;
    setBase(next); setDraft(editable(baseOf(existing, next).content)); setError(null);
  };
  const update = (change: Partial<EditableTopic>) => setDraft((current) => (current ? { ...current, ...change } : current));
  const updateQuestion = (index: number, change: (question: TopicQuizQuestion) => TopicQuizQuestion) =>
    update({ quiz: draft!.quiz.map((question, i) => (i === index ? change(question) : question)) });

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft || busy) return;
    setBusy(true); setError(null);
    const hasNote = Boolean(draft.sourceNote.en.trim() || draft.sourceNote.bn.trim());
    const body = { ...draft, sourceNote: hasNote ? draft.sourceNote : undefined, ...(existing ? { baseVersion: baseOf(existing, base).version } : {}) };
    try {
      const saved = await call<{ topicId: string; version: number }>(topicId ? `/api/topics/${encodeURIComponent(topicId)}` : "/api/topics", { method: topicId ? "PUT" : "POST", body: JSON.stringify(body) });
      onSaved(saved.topicId, saved.version);
    } catch (caught) { setError(failure(caught)); }
    finally { setBusy(false); }
  }

  const languageName = (lang: "en" | "bn") => (lang === "en" ? s("English", "ইংরেজি") : s("Bangla", "বাংলা"));
  const pair = (label: string, value: Bilingual, onChange: (value: Bilingual) => void, max: number, options: { rows?: number; required?: boolean } = {}) => (
    <div className="topic-editor-pair">
      {(["en", "bn"] as const).map((lang) => (
        <label key={lang}>
          {label} ({languageName(lang)})
          {options.rows
            ? <textarea lang={lang} rows={options.rows} maxLength={max} required={options.required !== false} value={value[lang]} onChange={(event) => onChange({ ...value, [lang]: event.target.value })} />
            : <input lang={lang} maxLength={max} required={options.required !== false} value={value[lang]} onChange={(event) => onChange({ ...value, [lang]: event.target.value })} />}
        </label>
      ))}
    </div>
  );

  const head = existing?.head;
  const headSummary = existing?.versions.find((version) => version.version === head?.version);
  const approvedBase = existing?.canStartFromApproved ? existing.approved : null;
  const reviewer = (lang: Language) => headSummary?.reviewerName ?? (lang === "bn" ? "একজন পর্যালোচক" : "a reviewer");
  return (
    <section className="teach-panel topic-editor" aria-label={topicId ? s("Edit topic", "বিষয় সম্পাদনা") : s("New topic", "নতুন বিষয়")}>
      <h2>{topicId ? s("Edit topic", "বিষয় সম্পাদনা") : s("Write a new topic", "নতুন বিষয় লিখুন")}</h2>
      <p className="teach-note">
        {s(
          "Fill in every part in English and Bangla. Saving sends the topic for approval: students see it only after a teacher or administrator previews and approves it.",
          "প্রতিটি অংশ ইংরেজি ও বাংলায় লিখুন। সংরক্ষণ করলে বিষয়টি অনুমোদনের জন্য যাবে: একজন শিক্ষক বা প্রশাসক দেখে অনুমোদন দিলে তবেই শিক্ষার্থীরা দেখবে।",
        )}
      </p>
      {head && headSummary && <p className="topic-editor-base" role="note">
        {approvedBase && base === "approved" ? <>
          {s(`${versionLabel(head.version, "en")} was sent back by ${reviewer("en")}`, `${reviewer("bn")} ${versionLabel(head.version, "bn")} ফেরত পাঠিয়েছেন`)}{headSummary.reviewNote && <>: <q>{headSummary.reviewNote}</q></>}.{" "}
          {s(
            `You are starting again from the approved version students see now (${versionLabel(approvedBase.version, "en").toLowerCase()}), so the sent-back changes are not included.`,
            `শিক্ষার্থীরা এখন যে অনুমোদিত সংস্করণ দেখে (${versionLabel(approvedBase.version, "bn")}), আপনি সেখান থেকে নতুন করে শুরু করছেন, তাই ফেরত পাঠানো পরিবর্তনগুলো এতে নেই।`,
          )}{" "}
          <button type="button" className="text-button" onClick={() => switchBase("newest")}>{s("Continue from the sent-back version instead", "বরং ফেরত পাঠানো সংস্করণ থেকে চালিয়ে যান")}</button>
        </> : <>
          {s("You are editing", "আপনি সম্পাদনা করছেন")}: {versionLabel(head.version, language)} · {statusLabel(headSummary, language)}.{" "}
          {head.status === "pending" && s("Your changes build on this waiting version.", "আপনার পরিবর্তন এই অপেক্ষমাণ সংস্করণের ওপর হবে।")}
          {head.status === "rejected" && headSummary.reviewNote && <>{s(`Sent back by ${reviewer("en")}: `, `${reviewer("bn")} ফেরত পাঠিয়েছেন: `)}<q>{headSummary.reviewNote}</q></>}
          {approvedBase && <>{" "}<button type="button" className="text-button" onClick={() => switchBase("approved")}>{s("Start again from the approved version", "অনুমোদিত সংস্করণ থেকে নতুন করে শুরু করুন")}</button></>}
        </>}
      </p>}
      {error && <p className="auth-error" role="alert">{error[language]}</p>}
      {!draft ? (!error && <p role="status">{s("Loading the topic…", "বিষয় লোড হচ্ছে…")}</p>) : (
        <form className="portal-editor" onSubmit={save}>
          <div className="topic-editor-row">
            <label>{s("Category", "বিভাগ")}
              <select required value={draft.theme} onChange={(event) => update({ theme: event.target.value })}>
                <option value="">{s("Choose a category", "বিভাগ বেছে নিন")}</option>
                {topicThemes.map((theme) => <option key={theme.id} value={theme.id}>{theme.icon} {theme.title[language]}</option>)}
              </select>
            </label>
            <label>{s("Card emoji", "কার্ডের ইমোজি")}<input required maxLength={16} value={draft.emoji} onChange={(event) => update({ emoji: event.target.value })} /></label>
            <label>{s("Reading time (minutes)", "পড়ার সময় (মিনিট)")}<input required type="number" min={1} max={TOPIC_LIMITS.maxMinutes} value={draft.minutes} onChange={(event) => update({ minutes: Number(event.target.value) })} /></label>
          </div>
          {pair(s("Title", "শিরোনাম"), draft.title, (title) => update({ title }), TOPIC_LIMITS.title)}
          {pair(s("Short introduction", "ছোট পরিচিতি"), draft.tagline, (tagline) => update({ tagline }), TOPIC_LIMITS.tagline, { rows: 2 })}

          <h3>{s("Reading sections", "পড়ার অংশ")}</h3>
          {draft.sections.map((section, index) => (
            <fieldset key={index}>
              <legend>{s(`Section ${index + 1}`, `অংশ ${n(index + 1)}`)}</legend>
              {pair(s(`Section ${index + 1} heading`, `অংশ ${n(index + 1)}-এর শিরোনাম`), section.heading, (heading) => update({ sections: draft.sections.map((part, i) => (i === index ? { ...part, heading } : part)) }), TOPIC_LIMITS.heading)}
              {pair(s(`Section ${index + 1} text`, `অংশ ${n(index + 1)}-এর লেখা`), section.body, (body) => update({ sections: draft.sections.map((part, i) => (i === index ? { ...part, body } : part)) }), TOPIC_LIMITS.body, { rows: 6 })}
              {draft.sections.length > 1 && <button type="button" className="text-button danger" onClick={() => update({ sections: draft.sections.filter((_, i) => i !== index) })}>{s(`Remove section ${index + 1}`, `অংশ ${n(index + 1)} বাদ দিন`)}</button>}
            </fieldset>
          ))}
          {draft.sections.length < TOPIC_LIMITS.maxSections && <button type="button" className="outline-button" onClick={() => update({ sections: [...draft.sections, { heading: blank(), body: blank() }] })}>+ {s("Add a section", "অংশ যোগ করুন")}</button>}

          <h3>{s("“Did you know?” facts (optional)", "“জানো কি?” তথ্য (ঐচ্ছিক)")}</h3>
          {draft.funFacts.map((fact, index) => (
            <fieldset key={index}>
              <legend>{s(`Fact ${index + 1}`, `তথ্য ${n(index + 1)}`)}</legend>
              {pair(s(`Fact ${index + 1}`, `তথ্য ${n(index + 1)}`), fact, (value) => update({ funFacts: draft.funFacts.map((item, i) => (i === index ? value : item)) }), TOPIC_LIMITS.fact, { rows: 2 })}
              <button type="button" className="text-button danger" onClick={() => update({ funFacts: draft.funFacts.filter((_, i) => i !== index) })}>{s(`Remove fact ${index + 1}`, `তথ্য ${n(index + 1)} বাদ দিন`)}</button>
            </fieldset>
          ))}
          {draft.funFacts.length < TOPIC_LIMITS.maxFacts && <button type="button" className="outline-button" onClick={() => update({ funFacts: [...draft.funFacts, blank()] })}>+ {s("Add a fact", "তথ্য যোগ করুন")}</button>}

          <h3>{s("Quiz (optional, up to 10 questions)", "কুইজ (ঐচ্ছিক, সর্বোচ্চ ১০টি প্রশ্ন)")}</h3>
          {draft.quiz.map((question, index) => (
            <fieldset key={index} className="topic-editor-question">
              <legend>{s(`Quiz question ${index + 1}`, `কুইজের প্রশ্ন ${n(index + 1)}`)}</legend>
              {pair(s(`Question ${index + 1}`, `প্রশ্ন ${n(index + 1)}`), question.question, (value) => updateQuestion(index, (item) => ({ ...item, question: value })), TOPIC_LIMITS.question)}
              {question.options.map((option, optionIndex) => (
                <div className="topic-editor-option" key={optionIndex}>
                  {pair(s(`Question ${index + 1} answer ${optionIndex + 1}`, `প্রশ্ন ${n(index + 1)}-এর উত্তর ${n(optionIndex + 1)}`), option, (value) => updateQuestion(index, (item) => ({ ...item, options: item.options.map((entry, i) => (i === optionIndex ? value : entry)) })), TOPIC_LIMITS.option)}
                  <div className="topic-editor-option-actions">
                    <label className="topic-editor-correct">
                      <input type="radio" name={`correct-${index}`} checked={question.answer === optionIndex} onChange={() => updateQuestion(index, (item) => ({ ...item, answer: optionIndex }))} aria-label={s(`Question ${index + 1}: answer ${optionIndex + 1} is correct`, `প্রশ্ন ${n(index + 1)}: উত্তর ${n(optionIndex + 1)} সঠিক`)} />
                      {s("Correct answer", "সঠিক উত্তর")}
                    </label>
                    {question.options.length > TOPIC_LIMITS.minOptions && <button type="button" className="text-button danger" onClick={() => updateQuestion(index, (item) => ({
                      ...item, options: item.options.filter((_, i) => i !== optionIndex),
                      answer: item.answer === optionIndex ? 0 : item.answer > optionIndex ? item.answer - 1 : item.answer,
                    }))}>{s(`Remove answer ${optionIndex + 1}`, `উত্তর ${n(optionIndex + 1)} বাদ দিন`)}</button>}
                  </div>
                </div>
              ))}
              {question.options.length < TOPIC_LIMITS.maxOptions && <button type="button" className="outline-button" onClick={() => updateQuestion(index, (item) => ({ ...item, options: [...item.options, blank()] }))}>+ {s("Add an answer", "উত্তর যোগ করুন")}</button>}
              <button type="button" className="text-button danger" onClick={() => update({ quiz: draft.quiz.filter((_, i) => i !== index) })}>{s(`Remove question ${index + 1}`, `প্রশ্ন ${n(index + 1)} বাদ দিন`)}</button>
            </fieldset>
          ))}
          {draft.quiz.length < TOPIC_LIMITS.maxQuestions && <button type="button" className="outline-button" onClick={() => update({ quiz: [...draft.quiz, emptyQuestion()] })}>+ {s("Add a quiz question", "কুইজের প্রশ্ন যোগ করুন")}</button>}

          <h3>{s("Source note (optional)", "উৎসের নোট (ঐচ্ছিক)")}</h3>
          <p className="teach-note">{s("Where does this content come from? For example a textbook chapter or a trusted website. Write it in both languages or leave both empty.", "এই লেখা কোথা থেকে এসেছে? যেমন পাঠ্যবইয়ের অধ্যায় বা বিশ্বস্ত ওয়েবসাইট। দুই ভাষাতেই লিখুন, অথবা দুটোই খালি রাখুন।")}</p>
          {pair(s("Source note", "উৎসের নোট"), draft.sourceNote, (sourceNote) => update({ sourceNote }), TOPIC_LIMITS.sourceNote, { rows: 2, required: Boolean(draft.sourceNote.en.trim() || draft.sourceNote.bn.trim()) })}

          <div className="access-actions">
            <button className="primary-button" disabled={busy}>{busy ? s("Saving…", "সংরক্ষণ হচ্ছে…") : s("Save and send for approval", "সংরক্ষণ করে অনুমোদনে পাঠান")}</button>
            <button type="button" className="outline-button" onClick={onCancel} disabled={busy}>{s("Cancel", "বাতিল")}</button>
          </div>
        </form>
      )}
    </section>
  );
}
