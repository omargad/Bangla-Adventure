"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import PortalShell from "@/app/components/PortalShell";
import { useLanguage } from "@/lib/use-language";
import { scrollToTop } from "@/lib/scroll-to-top";
import { justReturnedTo } from "@/lib/portal-scroll";
import type { StaffTopicSummary } from "@/lib/curriculum-catalog";
import { formatNumber, formatWhen, groupByCategory, TOPIC_ID_PATTERN } from "@/lib/topic-model";
import TopicEditor from "./TopicEditor";
import TopicReview from "./TopicReview";
import { authorLabel, call, failure, savedMessage, statusLabel, versionLabel } from "./shared";
import ApprovalSetting, { stillWaiting, type Publishing } from "./ApprovalSetting";
import type { Bilingual } from "@/app/topics-content";

type View = { kind: "list" } | { kind: "edit"; topicId: string | null } | { kind: "review"; topicId: string; version: number | null };

function viewPath(view: View) {
  if (view.kind === "edit") return view.topicId ? `/teach/topics?edit=${encodeURIComponent(view.topicId)}` : "/teach/topics?new=1";
  if (view.kind === "review") return `/teach/topics?topic=${encodeURIComponent(view.topicId)}${view.version !== null ? `&version=${view.version}` : ""}`;
  return "/teach/topics";
}

/** The view an address of the studio names (the page's search params). */
function viewAt(params: URLSearchParams): View {
  const topic = params.get("topic"), version = params.get("version"), edit = params.get("edit");
  if (params.get("new") === "1") return { kind: "edit", topicId: null };
  if (edit && TOPIC_ID_PATTERN.test(edit)) return { kind: "edit", topicId: edit };
  if (topic && TOPIC_ID_PATTERN.test(topic)) return { kind: "review", topicId: topic, version: version && /^\d{1,6}$/.test(version) ? Number(version) : null };
  return { kind: "list" };
}

/**
 * Teachers and administrators write, edit and preview topics. Only administrators approve
 * topics: an administrator's own topics are published when saved, and teachers' topics wait
 * for an administrator unless an administrator has switched that approval off (the switch is
 * on this page). The wording follows the setting and the account, as GET /api/topics reports them.
 */
export default function TopicStudio({ name, role, canApprove }: { name: string; role: "teacher" | "admin"; canApprove: boolean }) {
  const [language, toggleLanguage] = useLanguage({ title: ["Topics | Bangla Adventures", "বিষয় | Bangla Adventures"] });
  const s = (en: string, bn: string) => (language === "bn" ? bn : en);
  const n = (value: number) => formatNumber(value, language);
  const params = useSearchParams();
  const [view, setView] = useState<View>(() => viewAt(params));
  const [topics, setTopics] = useState<StaffTopicSummary[] | null>(null);
  const [publishing, setPublishing] = useState<Publishing | null>(null);
  const [error, setError] = useState<Bilingual | null>(null);
  const [message, setMessage] = useState<Bilingual | null>(null);
  // go() below shows a view in place and gives it its own address with history.replaceState. Next takes that for an address of
  // the page as it was rendered: a link to another of these addresses (the sidebar's Topics) shows the page again without
  // rendering it anew, and Back to one shows the page as rendered where it was opened. So the view is read from the address,
  // here when the address changes and above when the studio opens.
  // A view a link opened starts at its top, as go() and a new page do; after Back or Forward the place is left to the browser.
  const address = params.toString(), path = usePathname();
  const [shownAt, setShownAt] = useState(address);
  const [linkedViews, setLinkedViews] = useState(0);
  if (shownAt !== address) {
    setShownAt(address);
    const named = viewAt(params);
    if (viewPath(named) !== viewPath(view)) {
      setView(named); setMessage(null); setError(null);
      if (!justReturnedTo(address ? `${path}?${address}` : path)) setLinkedViews((count) => count + 1);
    }
  }
  useEffect(() => { if (linkedViews) scrollToTop(); }, [linkedViews]);

  const fetchTopics = (signal?: AbortSignal) => call<{ topics: StaffTopicSummary[]; publishing: Publishing }>("/api/topics", { signal });
  const show = (data: { topics: StaffTopicSummary[]; publishing: Publishing }) => { setTopics(data.topics); setPublishing(data.publishing); };
  const loadTopics = () => fetchTopics().then(show);
  useEffect(() => {
    const controller = new AbortController();
    fetchTopics(controller.signal).then(show).catch((caught) => { if (!controller.signal.aborted) setError(failure(caught)); });
    return () => controller.abort();
  }, []);
  // The list is loaded again whenever it is shown again, so it shows what was just saved or decided.
  const listing = view.kind === "list", listed = useRef(listing);
  useEffect(() => {
    if (listing && !listed.current) void fetchTopics().then(show).catch(() => undefined);
    listed.current = listing;
  }, [listing]);
  // Until the list answers, an administrator's saves publish and a teacher's are assumed to wait; the save's answer is what counts.
  const onSave = publishing?.onSave ?? (canApprove ? "admin" : "review");

  const go = (next: View, note: Bilingual | null = null) => {
    setView(next); setMessage(note); setError(null);
    window.history.replaceState(null, "", viewPath(next));
    scrollToTop();
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
          ? <button type="button" className="primary-button" aria-label={`${canApprove ? s("Preview & review", "দেখে পর্যালোচনা করুন") : s("Preview submission", "জমা দেওয়া বিষয় দেখুন")}: ${topic.title[language]}`} onClick={() => go({ kind: "review", topicId: topic.id, version: topic.pendingVersions.at(-1) ?? null })}>{canApprove ? s("Preview & review", "দেখে পর্যালোচনা করুন") : s("Preview submission", "জমা দেওয়া বিষয় দেখুন")}</button>
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
            <p className="adult-eyebrow">{canApprove ? s("Create · review · approve", "তৈরি · পর্যালোচনা · অনুমোদন") : onSave === "setting" ? s("Create · preview · publish", "তৈরি · প্রিভিউ · প্রকাশ") : s("Create · preview · submit", "তৈরি · প্রিভিউ · জমা")}</p>
            <h1>{s("Topics", "বিষয়")}</h1>
          </div>
          {view.kind === "list"
            ? <button type="button" className="primary-button" onClick={() => go({ kind: "edit", topicId: null })}>+ {s("New topic", "নতুন বিষয়")}</button>
            : <button type="button" className="outline-button" onClick={() => go({ kind: "list" })}>← {s("All topics", "সব বিষয়")}</button>}
        </div>
        {message && <p className="teach-message" role="status">{message[language]}</p>}
        {error && <p className="auth-error" role="alert">{error[language]}</p>}

        {view.kind === "edit" && <TopicEditor key={view.topicId ?? "new"} topicId={view.topicId} language={language} onSave={onSave} onCancel={() => go({ kind: "list" })}
          onSaved={(saved) => go({ kind: "review", topicId: saved.topicId, version: saved.version }, savedMessage(saved))} />}
        {view.kind === "review" && <TopicReview key={`${view.topicId}:${view.version}`} topicId={view.topicId} version={view.version} language={language} canApprove={canApprove} onSave={onSave}
          onOpenVersion={(version) => go({ kind: "review", topicId: view.topicId, version })} onEdit={() => go({ kind: "edit", topicId: view.topicId })}
          onDecided={() => void loadTopics().catch(() => undefined)} />}

        {view.kind === "list" && <>
          <p>{s("A topic is a short reading lesson with an optional quiz, written in English and Bangla. Only administrators approve topics.", "বিষয় হলো ছোট একটি পড়ার পাঠ, সঙ্গে ঐচ্ছিক কুইজ, ইংরেজি ও বাংলায় লেখা। শুধু প্রশাসকেরা বিষয় অনুমোদন করেন।")}{" "}
            {onSave === "admin"
              ? <>{s("As an administrator, your own new topics and edits are published to students as soon as you save them.", "প্রশাসক হিসেবে আপনার নিজের নতুন বিষয় ও সম্পাদনা সংরক্ষণের সঙ্গে সঙ্গে শিক্ষার্থীদের কাছে প্রকাশিত হয়।")}{" "}
                {publishing && (publishing.teacherTopicsNeedApproval
                  ? s("Teachers' new topics and edits wait here until an administrator approves them.", "শিক্ষকদের নতুন বিষয় ও সম্পাদনা প্রশাসক অনুমোদন না দেওয়া পর্যন্ত এখানে অপেক্ষায় থাকে।")
                  : s("Teachers' new topics and edits are published as soon as they save them, because approval for teachers' topics is off.", "শিক্ষকদের বিষয়ের অনুমোদন বন্ধ, তাই শিক্ষকেরা সংরক্ষণ করলেই নতুন বিষয় ও সম্পাদনা প্রকাশিত হয়।"))}</>
              : onSave === "setting"
                ? s("An administrator has switched off approval for teachers' topics, so your new topics and edits are published to students as soon as you save them. An edit of a topic an administrator withdrew still waits for an administrator.", "প্রশাসক শিক্ষকদের বিষয়ের অনুমোদন বন্ধ রেখেছেন, তাই আপনার নতুন বিষয় ও সম্পাদনা সংরক্ষণের সঙ্গে সঙ্গে শিক্ষার্থীদের কাছে প্রকাশিত হয়। প্রশাসক কোনো বিষয় সরিয়ে নিলে তার সম্পাদনা তবুও প্রশাসকের অপেক্ষায় থাকে।")
                : s("Write or edit a topic, then submit it for administrator review. Your new topics and changes reach students only after an administrator approves them.", "বিষয় লিখে বা সম্পাদনা করে প্রশাসকের পর্যালোচনার জন্য জমা দিন। প্রশাসক অনুমোদন দিলেই আপনার নতুন বিষয় ও পরিবর্তন শিক্ষার্থীদের কাছে প্রকাশিত হয়।")}
          </p>
          {canApprove && publishing && <ApprovalSetting publishing={publishing} waiting={pending.length} language={language}
            onChanged={(note) => { setMessage(note); setError(null); void loadTopics().catch(() => undefined); }} />}
          {!topics && !error && <p role="status">{s("Loading topics…", "বিষয় লোড হচ্ছে…")}</p>}
          {topics && <>
            <section className="teach-panel" aria-label={s("Waiting for approval", "অনুমোদনের অপেক্ষায়")}>
              <h2>{s("Waiting for approval", "অনুমোদনের অপেক্ষায়")} ({n(pending.length)})</h2>
              {!canApprove && onSave === "setting" && pending.length > 0 && <p className="teach-note" role="note">{stillWaiting(pending.length, language)}</p>}
              {pending.length ? <ul className="topic-admin-list">{pending.map((topic) => row(topic, true))}</ul> : <p>{publishing && !publishing.teacherTopicsNeedApproval
                ? s("Nothing is waiting. While approval for teachers' topics is off, only edits of withdrawn topics wait here for an administrator.", "কিছু অপেক্ষায় নেই। শিক্ষকদের বিষয়ের অনুমোদন বন্ধ থাকলে শুধু সরিয়ে নেওয়া বিষয়ের সম্পাদনা এখানে প্রশাসকের অপেক্ষায় থাকে।")
                : s("Nothing is waiting. Teachers' new and edited topics appear here until an administrator reviews them.", "কিছু অপেক্ষায় নেই। প্রশাসকের পর্যালোচনা না হওয়া পর্যন্ত শিক্ষকদের নতুন ও সম্পাদিত বিষয় এখানে থাকবে।")}</p>}
            </section>
            {groupByCategory(topics).map(({ category, items }) => (
              <section className="teach-panel" key={category.id} aria-label={category.title[language]}>
                <h2><span aria-hidden="true">{category.icon}</span> {category.title[language]} ({n(items.length)})</h2>
                <ul className="topic-admin-list">{items.map((topic) => row(topic))}</ul>
              </section>
            ))}
            <p className="teach-note">{s("“Approved · baseline” marks topics students could read before approval existed. They have not been individually reviewed. Teachers can preview them and submit edits; administrators confirm reviews and control publication.", "“অনুমোদিত · আগে থেকে থাকা” মানে অনুমোদন চালুর আগেই শিক্ষার্থীরা বিষয়গুলো পড়তে পারত। আলাদা করে পর্যালোচনা হয়নি। শিক্ষকেরা প্রিভিউ দেখে সম্পাদনা জমা দিতে পারেন; প্রশাসকেরা পর্যালোচনা নিশ্চিত করেন ও প্রকাশ নিয়ন্ত্রণ করেন।")} <Link href="/topics">{s("See the student topics page →", "শিক্ষার্থীর বিষয়ের পাতা দেখুন →")}</Link></p>
          </>}
        </>}
      </main>
    </PortalShell>
  );
}
