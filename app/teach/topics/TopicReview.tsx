"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Bilingual } from "@/app/topics-content";
import type { TopicDecisionSummary, VersionSummary } from "@/lib/curriculum-catalog";
import { categoryTitle, formatWhen, TOPIC_LIMITS, TOPIC_READ_CONFIRMATION, type Language, type TopicContent } from "@/lib/topic-model";
import TopicReader from "@/app/topics/TopicReader";
import type { TopicReference } from "@/lib/library-links";
import { authorLabel, call, failure, statusLabel, versionLabel } from "./shared";

type VersionDetail = {
  id: string; latestVersion: number;
  version: VersionSummary & { content: TopicContent };
  approved: { version: number; baseline: boolean; content: TopicContent } | null;
  changes: Bilingual[];
  /** The version's source links as students would follow them, the administrator's yearly links included. */
  references: TopicReference[];
};
type History = {
  versions: VersionSummary[]; approvedVersion: number | null; head: { version: number };
  /** Hidden from students by a teacher; who reviewed an approved baseline version; every such decision. */
  withdrawn: boolean; baselineReview: TopicDecisionSummary | null; decisions: TopicDecisionSummary[];
};
type PreviewMode = "en" | "bn" | "both";

/** The topic's history and one version of it (the newest when no version is given). */
async function fetchReview(topicId: string, version: number | null, signal?: AbortSignal) {
  const { topic } = await call<{ topic: History }>(`/api/topics/${encodeURIComponent(topicId)}`, { signal });
  const next = await call<VersionDetail>(`/api/topics/${encodeURIComponent(topicId)}/versions/${version ?? topic.head.version}`, { signal });
  return { topic, next };
}

/**
 * The full preview a reviewer reads before deciding: the version rendered exactly
 * as students see it, in English, in Bangla or side by side, with what changed
 * since the approved version, the decision and the topic's history.
 */
export default function TopicReview({ topicId, version, language, onOpenVersion, onEdit, onDecided }: {
  topicId: string; version: number | null; language: Language;
  onOpenVersion: (version: number) => void; onEdit: () => void; onDecided: () => void;
}) {
  const s = (en: string, bn: string) => (language === "bn" ? bn : en);
  const [detail, setDetail] = useState<VersionDetail | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [mode, setMode] = useState<PreviewMode>(language);
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState("");
  const [withdrawNote, setWithdrawNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Bilingual | null>(null);
  const [message, setMessage] = useState<Bilingual | null>(null);

  const show = ({ topic, next }: { topic: History; next: VersionDetail }) => { setHistory(topic); setDetail(next); };
  const load = () => fetchReview(topicId, version).then(show);
  useEffect(() => {
    const controller = new AbortController();
    fetchReview(topicId, version, controller.signal).then(({ topic, next }) => { setHistory(topic); setDetail(next); })
      .catch((caught) => { if (!controller.signal.aborted) setError(failure(caught)); });
    return () => controller.abort();
  }, [topicId, version]);

  async function decide(decision: "approve" | "reject") {
    if (!detail || busy) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      await call(`/api/topics/${encodeURIComponent(topicId)}/versions/${detail.version.version}`, {
        method: "POST", body: JSON.stringify({ decision, note, ...(decision === "approve" ? { confirmedRead: confirmed } : {}) }),
      });
      setMessage(decision === "approve"
        ? { en: `Approved. Students now see ${versionLabel(detail.version.version, "en").toLowerCase()} of this topic.`, bn: `অনুমোদিত। শিক্ষার্থীরা এখন এই বিষয়ের ${versionLabel(detail.version.version, "bn")} দেখবে।` }
        : { en: "Sent back to the author with your note. Students keep seeing the approved version.", bn: "আপনার নোটসহ লেখকের কাছে ফেরত পাঠানো হয়েছে। শিক্ষার্থীরা অনুমোদিত সংস্করণই দেখবে।" });
      setConfirmed(false); setNote("");
      await load();
      onDecided();
    } catch (caught) { setError(failure(caught)); }
    finally { setBusy(false); }
  }

  /** Withdraw the approved topic, approve a withdrawn one again, or confirm a review of a baseline topic. */
  async function decideTopic(decision: "withdraw" | "approve" | "confirm") {
    if (busy) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      await call(`/api/topics/${encodeURIComponent(topicId)}`, {
        method: "POST", body: JSON.stringify(decision === "withdraw" ? { decision, note: withdrawNote } : { decision, confirmedRead: confirmed }),
      });
      setMessage(decision === "withdraw"
        ? { en: "Withdrawn. Students and parents no longer see this topic. Approve it again once it is fixed.", bn: "সরিয়ে নেওয়া হয়েছে। শিক্ষার্থী ও অভিভাবকেরা আর এই বিষয়টি দেখবে না। ঠিক করার পর আবার অনুমোদন দিন।" }
        : decision === "approve"
          ? { en: "Approved again. Students see this topic once more.", bn: "আবার অনুমোদিত। শিক্ষার্থীরা আবার এই বিষয়টি দেখবে।" }
          : { en: "Your review is recorded. Students keep seeing the topic as it is.", bn: "আপনার পর্যালোচনা নথিভুক্ত হয়েছে। শিক্ষার্থীরা বিষয়টি আগের মতোই দেখবে।" });
      setConfirmed(false); setWithdrawNote("");
      await load();
      onDecided();
    } catch (caught) { setError(failure(caught)); }
    finally { setBusy(false); }
  }

  if (!detail || !history) {
    return <section className="teach-panel">{error ? <p className="auth-error" role="alert">{error[language]}</p> : <p role="status">{s("Loading the preview…", "প্রিভিউ লোড হচ্ছে…")}</p>}</section>;
  }

  const current = detail.version;
  const topic = { ...current.content, id: topicId, references: detail.references };
  const reader = (lang: Language, titleLevel: 1 | 2) => (
    <article className="topic-reader" lang={lang} key={lang}>
      <TopicReader topic={topic} language={lang} titleLevel={titleLevel} />
    </article>
  );
  const who = (name: string | null) => name ?? s("a former staff member", "একজন সাবেক কর্মী");
  const withdrawal = history.withdrawn ? history.decisions.at(-1) ?? null : null;
  const baselineReview = history.baselineReview;
  const decisionLabel = (item: TopicDecisionSummary) => item.kind === "withdrawn" ? s("Withdrawn from students", "শিক্ষার্থীদের কাছ থেকে সরানো হয়েছে")
    : item.kind === "restored" ? s("Approved again", "আবার অনুমোদিত") : s("Review confirmed", "পর্যালোচনা নিশ্চিত");
  const readTick = <label className="topic-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> {TOPIC_READ_CONFIRMATION[language]}</label>;
  return (
    <>
      <section className="teach-panel topic-review-head" aria-label={s("Version details", "সংস্করণের তথ্য")}>
        <p className="adult-eyebrow">{categoryTitle(current.content.theme)[language]}</p>
        <h2>{s("Preview", "প্রিভিউ")}: {current.content.title[language]}</h2>
        <p>
          <strong>{versionLabel(current.version, language)}</strong> · {withdrawal && current.status === "approved"
            ? <span className="topic-status topic-status-rejected">{s("Withdrawn · hidden from students", "সরিয়ে নেওয়া · শিক্ষার্থীরা দেখে না")}</span>
            : <span className={`topic-status topic-status-${current.status}`}>{statusLabel(current, language)}</span>}
          {current.authorName !== null || current.createdAt ? <> · {s("written by", "লিখেছেন")} {authorLabel(current, language)}{current.createdAt && <>, {formatWhen(current.createdAt, language)}</>}</> : null}
        </p>
        {withdrawal && <p className="auth-error">{s(`Withdrawn from students by ${who(withdrawal.changedByName)}, ${formatWhen(withdrawal.changedAt, language)}: `, `${who(withdrawal.changedByName)} শিক্ষার্থীদের কাছ থেকে সরিয়ে নিয়েছেন, ${formatWhen(withdrawal.changedAt, language)}: `)}<q>{withdrawal.note}</q> {s("Students and parents cannot see this topic.", "শিক্ষার্থী ও অভিভাবকেরা এই বিষয়টি দেখতে পায় না।")}</p>}
        {current.baseline && (current.status === "approved" && baselineReview
          ? <p className="teach-note">{s(
            `Pre-existing content, approved as a baseline and reviewed by ${who(baselineReview.changedByName)}, ${formatWhen(baselineReview.changedAt, language)}.`,
            `আগে থেকে থাকা বিষয়বস্তু, ভিত্তি হিসেবে অনুমোদিত; ${who(baselineReview.changedByName)} পর্যালোচনা করেছেন, ${formatWhen(baselineReview.changedAt, language)}।`,
          )}</p>
          : <p className="teach-note">{s(
            "Pre-existing content, approved as a baseline: students could already read it before topic approval existed. It has not been individually reviewed.",
            "আগে থেকে থাকা বিষয়বস্তু, ভিত্তি হিসেবে অনুমোদিত: বিষয় অনুমোদন চালুর আগেই শিক্ষার্থীরা এটি পড়তে পারত। এটি আলাদা করে পর্যালোচনা করা হয়নি।",
          )}</p>)}
        {current.status === "approved" && !current.baseline && <p className="teach-note">{s(`Approved by ${who(current.reviewerName)}, ${formatWhen(current.reviewedAt, language)}.`, `${who(current.reviewerName)} অনুমোদন করেছেন, ${formatWhen(current.reviewedAt, language)}।`)}</p>}
        {current.status === "rejected" && <p className="teach-note">{s(`Sent back by ${who(current.reviewerName)}, ${formatWhen(current.reviewedAt, language)}: `, `${who(current.reviewerName)} ফেরত পাঠিয়েছেন, ${formatWhen(current.reviewedAt, language)}: `)}<q>{current.reviewNote}</q></p>}
        {current.version < detail.latestVersion && <p className="teach-note">{s("This is not the newest version.", "এটি সবচেয়ে নতুন সংস্করণ নয়।")} <button type="button" className="text-button" onClick={() => onOpenVersion(detail.latestVersion)}>{s("Open the newest version", "সবচেয়ে নতুন সংস্করণ খুলুন")}</button></p>}
        <div className="access-actions">
          <button type="button" className="outline-button" onClick={onEdit}>{s("Edit this topic", "বিষয়টি সম্পাদনা করুন")}</button>
          {history.approvedVersion !== null && !history.withdrawn && <Link className="outline-button" href={`/topics?topic=${encodeURIComponent(topicId)}`} target="_blank">{s("Open the student page ↗", "শিক্ষার্থীর পাতা খুলুন ↗")}</Link>}
        </div>
        {message && <p className="teach-message" role="status">{message[language]}</p>}
      </section>

      {current.status === "pending" && <section className="teach-panel" aria-label={s("What changed", "কী বদলেছে")}>
        <h3>{detail.approved ? s(`What changed compared with the approved version (${versionLabel(detail.approved.version, "en").toLowerCase()})`, `অনুমোদিত সংস্করণের (${versionLabel(detail.approved.version, "bn")}) তুলনায় কী বদলেছে`) : s("What changed", "কী বদলেছে")}</h3>
        <ul className="topic-changes">{detail.changes.map((change, index) => <li key={index}>{change[language]}</li>)}</ul>
      </section>}

      <section className="topic-preview" aria-label={s("Student view preview", "শিক্ষার্থীর দৃশ্যের প্রিভিউ")}>
        <div className="topic-preview-bar">
          <strong>{s("Students will see this:", "শিক্ষার্থীরা এটি দেখবে:")}</strong>
          <div role="group" aria-label={s("Preview language", "প্রিভিউয়ের ভাষা")} className="topic-preview-modes">
            {([["en", "English"], ["bn", "বাংলা"], ["both", s("Side by side", "পাশাপাশি")]] as const).map(([value, label]) => (
              <button type="button" key={value} aria-pressed={mode === value} onClick={() => setMode(value)}>{label}</button>
            ))}
          </div>
        </div>
        <div className={`topics-app topic-preview-frame ${mode === "both" ? "topic-preview-pair" : ""}`}>
          {mode === "both" ? <>{reader("en", 2)}{reader("bn", 2)}</> : reader(mode, 1)}
        </div>
      </section>

      {current.status === "pending" && <section className="teach-panel topic-decision" aria-label={s("Approval decision", "অনুমোদনের সিদ্ধান্ত")}>
        <h3>{s("Your decision", "আপনার সিদ্ধান্ত")}</h3>
        <p className="teach-note">{s(
          "Read the whole topic in English and in Bangla, including the quiz, before you approve. Approving publishes this version to students and records your name. Authors may approve their own topic.",
          "অনুমোদনের আগে কুইজসহ পুরো বিষয়টি ইংরেজি ও বাংলায় পড়ুন। অনুমোদন দিলে এই সংস্করণ শিক্ষার্থীদের কাছে প্রকাশিত হবে এবং আপনার নাম লেখা থাকবে। লেখক নিজেও নিজের বিষয় অনুমোদন করতে পারেন।",
        )}</p>
        {readTick}
        <div className="access-actions">
          <button type="button" className="primary-button" disabled={!confirmed || busy} onClick={() => void decide("approve")}>{s("Approve and publish to students", "অনুমোদন দিয়ে শিক্ষার্থীদের কাছে প্রকাশ করুন")}</button>
        </div>
        <label className="topic-note">{s("Note for the author (needed to send it back)", "লেখকের জন্য নোট (ফেরত পাঠাতে লাগবে)")}
          <textarea rows={3} maxLength={TOPIC_LIMITS.note} value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        <div className="access-actions">
          <button type="button" className="outline-button" disabled={!note.trim() || busy} onClick={() => void decide("reject")}>{s("Send back to the author", "লেখকের কাছে ফেরত পাঠান")}</button>
        </div>
        {error && <p className="auth-error" role="alert">{error[language]}</p>}
      </section>}
      {current.status === "approved" && <section className="teach-panel topic-decision" aria-label={s("Your decision", "আপনার সিদ্ধান্ত")}>
        <h3>{s("Your decision", "আপনার সিদ্ধান্ত")}</h3>
        {history.withdrawn ? <>
          <p className="teach-note">{s(
            "Read the whole topic in English and in Bangla, including the quiz, then approve it again: students and parents see it once more and your name is recorded. To change it first, edit it and approve the new version.",
            "কুইজসহ পুরো বিষয়টি ইংরেজি ও বাংলায় পড়ে আবার অনুমোদন দিন: শিক্ষার্থী ও অভিভাবকেরা আবার এটি দেখবে এবং আপনার নাম লেখা থাকবে। আগে বদলাতে চাইলে সম্পাদনা করে নতুন সংস্করণটি অনুমোদন দিন।",
          )}</p>
          {readTick}
          <div className="access-actions">
            <button type="button" className="primary-button" disabled={!confirmed || busy} onClick={() => void decideTopic("approve")}>{s("Approve again and show to students", "আবার অনুমোদন দিয়ে শিক্ষার্থীদের দেখান")}</button>
          </div>
        </> : <>
          {current.baseline && !baselineReview && <>
            <h4>{s("Confirm your review", "আপনার পর্যালোচনা নিশ্চিত করুন")}</h4>
            <p className="teach-note">{s(
              "Nobody has reviewed this topic individually yet. Read all of it above in English and in Bangla, including the quiz, then confirm: students keep seeing it as it is and your review is recorded under your name.",
              "এই বিষয়টি এখনো কেউ আলাদা করে পর্যালোচনা করেননি। ওপরে কুইজসহ পুরোটা ইংরেজি ও বাংলায় পড়ুন, তারপর নিশ্চিত করুন: শিক্ষার্থীরা বিষয়টি আগের মতোই দেখবে এবং আপনার নামে পর্যালোচনা লেখা থাকবে।",
            )}</p>
            {readTick}
            <div className="access-actions">
              <button type="button" className="primary-button" disabled={!confirmed || busy} onClick={() => void decideTopic("confirm")}>{s("Confirm my review", "আমার পর্যালোচনা নিশ্চিত করুন")}</button>
            </div>
            <h4>{s("Or withdraw it", "অথবা সরিয়ে নিন")}</h4>
          </>}
          <p className="teach-note">{s(
            "Withdrawing hides this topic from students and parents straight away, including its quiz and links to it. Their saved progress is kept. To correct a mistake instead, edit the topic and approve the new version.",
            "সরিয়ে নিলে বিষয়টি সঙ্গে সঙ্গে শিক্ষার্থী ও অভিভাবকদের কাছ থেকে লুকানো হবে, এর কুইজ ও লিংকসহ। তাদের সংরক্ষিত অগ্রগতি থেকে যাবে। ভুল ঠিক করতে চাইলে বিষয়টি সম্পাদনা করে নতুন সংস্করণ অনুমোদন দিন।",
          )}</p>
          <label className="topic-note">{s("Why are you withdrawing it? (needed)", "কেন সরিয়ে নিচ্ছেন? (লিখতে হবে)")}
            <textarea rows={3} maxLength={TOPIC_LIMITS.note} value={withdrawNote} onChange={(event) => setWithdrawNote(event.target.value)} />
          </label>
          <div className="access-actions">
            <button type="button" className="danger-button" disabled={!withdrawNote.trim() || busy} onClick={() => void decideTopic("withdraw")}>{s("Withdraw from students", "শিক্ষার্থীদের কাছ থেকে সরিয়ে নিন")}</button>
          </div>
        </>}
        {error && <p className="auth-error" role="alert">{error[language]}</p>}
      </section>}
      {current.status !== "pending" && current.status !== "approved" && error && <p className="auth-error" role="alert">{error[language]}</p>}

      <section className="teach-panel" aria-label={s("Version history", "সংস্করণের ইতিহাস")}>
        <h3>{s("Version history", "সংস্করণের ইতিহাস")}</h3>
        <div className="portal-table"><table>
          <thead><tr><th>{s("Version", "সংস্করণ")}</th><th>{s("Status", "অবস্থা")}</th><th>{s("Written", "লেখা")}</th><th>{s("Reviewed", "পর্যালোচনা")}</th><th>{s("Note", "নোট")}</th><th><span className="sr-only">{s("Open", "খুলুন")}</span></th></tr></thead>
          <tbody>{[...history.versions].reverse().map((item) => (
            <tr key={item.version} aria-current={item.version === current.version ? "true" : undefined}>
              <td>{versionLabel(item.version, language)}</td>
              <td>{statusLabel(item, language)}</td>
              <td>{item.version === 0 ? s("Shipped with the app", "অ্যাপের সঙ্গে এসেছে") : <>{authorLabel(item, language)}<br /><small>{formatWhen(item.createdAt, language)}</small></>}</td>
              <td>{item.reviewedAt ? <>{item.baseline ? s("Approved as a baseline", "ভিত্তি হিসেবে অনুমোদিত") : who(item.reviewerName)}<br /><small>{formatWhen(item.reviewedAt, language)}</small></> : item.baseline ? s("Approved as a baseline", "ভিত্তি হিসেবে অনুমোদিত") : "—"}</td>
              <td>{item.reviewNote || "—"}</td>
              <td>{item.version !== current.version && <button type="button" className="text-button" onClick={() => onOpenVersion(item.version)}>{s(`Preview ${versionLabel(item.version, "en").toLowerCase()}`, `${versionLabel(item.version, "bn")} দেখুন`)}</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
        {history.decisions.length > 0 && <>
          <h4>{s("Decisions about what students see", "শিক্ষার্থীরা কী দেখবে সে বিষয়ে সিদ্ধান্ত")}</h4>
          <ul className="topic-changes">{[...history.decisions].reverse().map((item, index) => <li key={index}>
            <strong>{decisionLabel(item)}</strong> · {who(item.changedByName)}, {formatWhen(item.changedAt, language)}{item.note && <>: <q>{item.note}</q></>}
          </li>)}</ul>
        </>}
      </section>
    </>
  );
}
