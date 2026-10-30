"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PortalShell from "@/app/components/PortalShell";
import { useLanguage } from "@/lib/use-language";
import type { StaffTopicSummary } from "@/lib/curriculum-catalog";
import { formatNumber, formatWhen, groupByCategory } from "@/lib/topic-model";
import TopicEditor from "./TopicEditor";
import TopicReview from "./TopicReview";
import { authorLabel, call, failure, statusLabel, versionLabel } from "./shared";
import type { Bilingual } from "@/app/topics-content";

type View = { kind: "list" } | { kind: "edit"; topicId: string | null } | { kind: "review"; topicId: string; version: number | null };

function viewPath(view: View) {
  if (view.kind === "edit") return view.topicId ? `/teach/topics?edit=${encodeURIComponent(view.topicId)}` : "/teach/topics?new=1";
  if (view.kind === "review") return `/teach/topics?topic=${encodeURIComponent(view.topicId)}${view.version !== null ? `&version=${view.version}` : ""}`;
  return "/teach/topics";
}

/**
 * Topics: teachers and administrators write topics, edit them, preview
 * them as students will see them and approve them. Only approved versions reach
 * students.
 */
export default function TopicStudio({ name, role, initialView }: { name: string; role: "teacher" | "admin"; initialView: View }) {
  const [language, toggleLanguage] = useLanguage({ title: ["Topics | Bangla Adventures", "বিষয় | Bangla Adventures"] });
  const s = (en: string, bn: string) => (language === "bn" ? bn : en);
  const n = (value: number) => formatNumber(value, language);
  const [view, setView] = useState<View>(initialView);
  const [topics, setTopics] = useState<StaffTopicSummary[] | null>(null);
  const [error, setError] = useState<Bilingual | null>(null);
  const [message, setMessage] = useState<Bilingual | null>(null);

  const fetchTopics = (signal?: AbortSignal) => call<{ topics: StaffTopicSummary[] }>("/api/topics", { signal }).then((data) => data.topics);
  const loadTopics = () => fetchTopics().then(setTopics);
  useEffect(() => {
    const controller = new AbortController();
    fetchTopics(controller.signal).then(setTopics).catch((caught) => { if (!controller.signal.aborted) setError(failure(caught)); });
    return () => controller.abort();
  }, []);

  const go = (next: View, note: Bilingual | null = null) => {
    setView(next); setMessage(note); setError(null);
    window.history.replaceState(null, "", viewPath(next));
    window.scrollTo({ top: 0 });
    if (next.kind === "list") void loadTopics().catch(() => undefined);
  };

  const pending = (topics ?? []).filter((topic) => topic.pendingVersions.length > 0);
  const chip = (topic: StaffTopicSummary) => {
    if (topic.withdrawn) return topic.latest.status === "pending" ? s("Withdrawn · new version waiting", "সরিয়ে নেওয়া · নতুন সংস্করণ অপেক্ষায়") : s("Withdrawn · hidden from students", "সরিয়ে নেওয়া · শিক্ষার্থীরা দেখে না");
    if (topic.baselineReview && topic.latest.status === "approved") return s("Approved · baseline, reviewed", "অনুমোদিত · আগে থেকে থাকা, পর্যালোচিত");
    if (topic.latest.status === "pending") return topic.approved ? s("Approved · new version waiting", "অনুমোদিত · নতুন সংস্করণ অপেক্ষায়") : s("New · waiting for approval", "নতুন · অনুমোদনের অপেক্ষায়");
    if (topic.latest.status === "rejected") return topic.approved ? s("Approved · changes sent back", "অনুমোদিত · পরিবর্তন ফেরত পাঠানো") : s("Sent back · not published", "ফেরত পাঠানো · প্রকাশিত নয়");
    return statusLabel(topic.approved ?? topic.latest, language);
  };
  const row = (topic: StaffTopicSummary, waiting = false) => (
    <li key={topic.id} className="topic-admin-row">
      <span className="topic-emoji" aria-hidden="true">{topic.emoji}</span>
      <span className="topic-admin-title">
        <strong>{topic.title[language]}</strong>
        <small><span className={`topic-status topic-status-${topic.withdrawn ? "rejected" : topic.latest.status}`}>{chip(topic)}</span>{waiting && <> · {versionLabel(topic.latest.version, language)} · {authorLabel(topic.latest, language)}, {formatWhen(topic.latest.createdAt, language)}</>}</small>
      </span>
      <span className="topic-admin-actions">
        {waiting
          ? <button type="button" className="primary-button" aria-label={`${s("Preview & review", "দেখে পর্যালোচনা করুন")}: ${topic.title[language]}`} onClick={() => go({ kind: "review", topicId: topic.id, version: topic.pendingVersions.at(-1) ?? null })}>{s("Preview & review", "দেখে পর্যালোচনা করুন")}</button>
          : <button type="button" className="outline-button" aria-label={`${s("Preview & history", "প্রিভিউ ও ইতিহাস")}: ${topic.title[language]}`} onClick={() => go({ kind: "review", topicId: topic.id, version: null })}>{s("Preview & history", "প্রিভিউ ও ইতিহাস")}</button>}
        <button type="button" className="outline-button" aria-label={`${s("Edit", "সম্পাদনা")}: ${topic.title[language]}`} onClick={() => go({ kind: "edit", topicId: topic.id })}>{s("Edit", "সম্পাদনা")}</button>
      </span>
    </li>
  );

  return (
    <PortalShell role={role} name={name} language={language} toggleLanguage={toggleLanguage} active="content">
      <main className="topic-studio" lang={language}>
        <div className="portal-heading">
          <div>
            <p className="adult-eyebrow">{s("Create · preview · approve", "তৈরি · প্রিভিউ · অনুমোদন")}</p>
            <h1>{s("Topics", "বিষয়")}</h1>
          </div>
          {view.kind === "list"
            ? <button type="button" className="primary-button" onClick={() => go({ kind: "edit", topicId: null })}>+ {s("New topic", "নতুন বিষয়")}</button>
            : <button type="button" className="outline-button" onClick={() => go({ kind: "list" })}>← {s("All topics", "সব বিষয়")}</button>}
        </div>
        {message && <p className="teach-message" role="status">{message[language]}</p>}
        {error && <p className="auth-error" role="alert">{error[language]}</p>}

        {view.kind === "edit" && <TopicEditor key={view.topicId ?? "new"} topicId={view.topicId} language={language} onCancel={() => go({ kind: "list" })}
          onSaved={(topicId, version) => go({ kind: "review", topicId, version }, {
            en: `Saved as ${versionLabel(version, "en").toLowerCase()}. Students will not see it until a teacher or administrator approves it.`,
            bn: `${versionLabel(version, "bn")} হিসেবে সংরক্ষিত। একজন শিক্ষক বা প্রশাসক অনুমোদন না দেওয়া পর্যন্ত শিক্ষার্থীরা এটি দেখবে না।`,
          })} />}
        {view.kind === "review" && <TopicReview key={`${view.topicId}:${view.version}`} topicId={view.topicId} version={view.version} language={language}
          onOpenVersion={(version) => go({ kind: "review", topicId: view.topicId, version })} onEdit={() => go({ kind: "edit", topicId: view.topicId })}
          onDecided={() => void loadTopics().catch(() => undefined)} />}

        {view.kind === "list" && <>
          <p>{s(
            "A topic is a short reading lesson with an optional quiz. Write a new one or edit an existing one in English and Bangla. Students see a topic only after a teacher or administrator has previewed the whole topic and approved it.",
            "বিষয় হলো ছোট একটি পড়ার পাঠ, সঙ্গে ঐচ্ছিক কুইজ। ইংরেজি ও বাংলায় নতুন বিষয় লিখুন বা আগেরটি সম্পাদনা করুন। একজন শিক্ষক বা প্রশাসক পুরো বিষয়টি দেখে অনুমোদন দিলে তবেই শিক্ষার্থীরা তা দেখবে।",
          )}</p>
          {!topics && !error && <p role="status">{s("Loading topics…", "বিষয় লোড হচ্ছে…")}</p>}
          {topics && <>
            <section className="teach-panel" aria-label={s("Waiting for approval", "অনুমোদনের অপেক্ষায়")}>
              <h2>{s("Waiting for approval", "অনুমোদনের অপেক্ষায়")} ({n(pending.length)})</h2>
              {pending.length ? <ul className="topic-admin-list">{pending.map((topic) => row(topic, true))}</ul> : <p>{s("Nothing is waiting. New and edited topics appear here until someone approves them.", "কিছু অপেক্ষায় নেই। নতুন ও সম্পাদিত বিষয় অনুমোদন না হওয়া পর্যন্ত এখানে থাকবে।")}</p>}
            </section>
            {groupByCategory(topics).map(({ category, items }) => (
              <section className="teach-panel" key={category.id} aria-label={category.title[language]}>
                <h2><span aria-hidden="true">{category.icon}</span> {category.title[language]} ({n(items.length)})</h2>
                <ul className="topic-admin-list">{items.map((topic) => row(topic))}</ul>
              </section>
            ))}
            <p className="teach-note">{s("“Approved · baseline” marks the topics that came with the app: students could read them before approval existed, and they have not been individually reviewed. Open one to review it, confirm your review, edit it or withdraw it from students.", "“অনুমোদিত · আগে থেকে থাকা” মানে অ্যাপের সঙ্গে আসা বিষয়: অনুমোদন চালুর আগেই শিক্ষার্থীরা এগুলো পড়তে পারত, আলাদা করে পর্যালোচনা হয়নি। পর্যালোচনা করতে, পর্যালোচনা নিশ্চিত করতে, সম্পাদনা করতে বা শিক্ষার্থীদের কাছ থেকে সরিয়ে নিতে একটি খুলুন।")} <Link href="/topics">{s("See the student topics page →", "শিক্ষার্থীর বিষয়ের পাতা দেখুন →")}</Link></p>
          </>}
        </>}
      </main>
    </PortalShell>
  );
}
