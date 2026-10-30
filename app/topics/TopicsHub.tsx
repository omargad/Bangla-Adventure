"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLanguage } from "../../lib/use-language";
import type { Topic } from "../topics-content";
import { formatNumber, formatWhen, groupByCategory } from "@/lib/topic-model";
import TopicReader from "./TopicReader";
import type { TopicReference } from "@/lib/library-links";

const moodleUrl = process.env.NEXT_PUBLIC_MOODLE_URL?.replace(/\/+$/, "");
const courseHref = moodleUrl || "/learn";

type Approval = { version: number; baseline: boolean; approvedAt: string | null; reviewerName: string | null; pendingVersions: number[] };
type HubTopic = Topic & { approval?: Approval; references?: TopicReference[] };
type QuizScores = Record<string, { best: number; total: number }>;

export default function TopicsHub({ initialTopic }: { initialTopic?: string }) {
  const [language, toggleLanguage] = useLanguage({ title: ["Classroom topics — culture, history & literature | Bangla Adventures", "শ্রেণিকক্ষের বিষয় — সংস্কৃতি, ইতিহাস ও সাহিত্য | Bangla Adventures"] });
  const s = (en: string, bn: string) => (language === "bn" ? bn : en);
  const n = (value: number) => formatNumber(value, language);

  const [topics, setTopics] = useState<HubTopic[]>([]);
  const [readIds, setReadIds] = useState<string[]>([]);
  const [scores, setScores] = useState<QuizScores>({});
  const [canRecord, setCanRecord] = useState(false);
  const [canReview, setCanReview] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [quizSaved, setQuizSaved] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(initialTopic ?? null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/curriculum", { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setTopics(data.topics); setReadIds(data.readTopicIds); setScores(data.quizScores ?? {}); setCanRecord(data.canRecordProgress);
      setCanReview(Boolean(data.canReview)); setPendingCount(data.pendingCount ?? 0); setLoaded(true);
    }).catch((error) => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, []);

  const active = useMemo(() => topics.find((topic) => topic.id === activeId) ?? null, [activeId, topics]);
  const groups = useMemo(() => groupByCategory(topics), [topics]);

  const openTopic = (id: string) => {
    setActiveId(id);
    setQuizSaved(false);
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  };
  const closeTopic = () => { setActiveId(null); setQuizSaved(false); };

  async function saveProgress(topicId: string, answers?: number[]) {
    setError(""); setQuizSaved(false);
    try {
      const response = await fetch("/api/student/topic-progress", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topicId, ...(answers ? { answers } : {}) }) });
      const data = await response.json(); if (!response.ok) throw new Error(language === "bn" && data.errorBn ? data.errorBn : data.error);
      setReadIds((current) => current.includes(topicId) ? current : [...current, topicId]);
      if (data.quiz) {
        setScores((current) => ({ ...current, [topicId]: { best: data.quiz.best, total: data.quiz.total } }));
        setQuizSaved(true);
      }
    } catch (error) { setError(error instanceof Error ? error.message : s("Could not save progress.", "অগ্রগতি সংরক্ষণ করা যায়নি।")); }
  }

  const header = (
    <header className="explore-header">
      <Link className="adult-brand" href="/">
        <span>বা</span>
        <span><strong>Bangla Adventures</strong><small>{s("Classroom topics", "শ্রেণিকক্ষের বিষয়")}</small></span>
      </Link>
      <nav aria-label={s("Sections", "বিভাগ")}>
        {active ? <button type="button" className="topics-back" onClick={closeTopic}>← {s("All topics", "সব বিষয়")}</button> : <>
          <a href={courseHref}>{s("Learning course", "শেখার কোর্স")}</a>
          <Link className="active" href="/topics">{s("Topics", "বিষয়")}</Link>
          <Link href="/library">{s("Textbook library", "পাঠ্যবই লাইব্রেরি")}</Link>
        </>}
      </nav>
      <button lang={language === "bn" ? "en" : "bn"} type="button" className="explore-lang" onClick={toggleLanguage}>{s("বাংলায় দেখুন", "View in English")}</button>
    </header>
  );

  function approvalLabel(approval: Approval) {
    const who = approval.baseline
      ? s("Teacher view: pre-existing content, approved as a baseline (not individually reviewed).", "শিক্ষকের দৃশ্য: আগে থেকে থাকা বিষয়বস্তু, ভিত্তি হিসেবে অনুমোদিত (আলাদা করে পর্যালোচনা হয়নি)।")
      : s(`Teacher view: approved by ${approval.reviewerName ?? "a former staff member"} on ${formatWhen(approval.approvedAt, language)}.`, `শিক্ষকের দৃশ্য: ${approval.reviewerName ?? "একজন সাবেক কর্মী"} ${formatWhen(approval.approvedAt, language)}-এ অনুমোদন করেছেন।`);
    return approval.pendingVersions.length ? `${who} ${s("A newer version is waiting for approval.", "একটি নতুন সংস্করণ অনুমোদনের অপেক্ষায়।")}` : who;
  }

  if (active) {
    const read = readIds.includes(active.id);
    return (
      <main className="explore-app topics-app" lang={language}>
        {header}
        <article className="topic-reader">
          <button type="button" className="outline-button" onClick={closeTopic}>{s("All topics", "সব বিষয়")}</button>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <TopicReader
            key={active.id}
            topic={active}
            language={language}
            best={scores[active.id]}
            onQuizChecked={canRecord ? (answers) => void saveProgress(active.id, answers) : undefined}
            quizNote={quizSaved ? s("Saved. This topic now counts as read, and your teacher can see your best score.", "সংরক্ষিত। বিষয়টি এখন পড়া হিসেবে গোনা হবে, আর শিক্ষক তোমার সেরা ফল দেখতে পাবেন।") : undefined}
            onPickAnother={closeTopic}
            beforeQuiz={canRecord && (
              <button type="button" className="primary-button" disabled={read} onClick={() => void saveProgress(active.id)}>
                {read ? s("Reading complete", "পড়া সম্পন্ন") : s("Mark reading complete", "পড়া সম্পন্ন হিসেবে রাখো")}
              </button>
            )}
          />
          {canReview && active.approval && <p className="topic-staff-note" role="note">
            {approvalLabel(active.approval)} <Link href={`/teach/topics?topic=${encodeURIComponent(active.id)}`}>{s("Edit or review it in Topics →", "“বিষয়” অংশে সম্পাদনা বা পর্যালোচনা →")}</Link>
          </p>}
        </article>
      </main>
    );
  }

  return (
    <main className="explore-app topics-app" lang={language}>
      {header}

      <section className="explore-hero">
        <p className="adult-eyebrow">{s("History · our country · culture · literature", "ইতিহাস · আমাদের দেশ · সংস্কৃতি · সাহিত্য")}</p>
        <h1>{s("Got a topic from Bangla school? Start here.", "বাংলা স্কুল থেকে বিষয় পেয়েছ? শুরু এখানেই।")}</h1>
        <p>
          {s(
            "Read a short, kid-friendly page, check the government textbook it comes from, then take a short quiz you can show your teacher. Everything works in English and Bangla.",
            "ছোট, সহজ একটি পাতা পড়ো, কোন সরকারি পাঠ্যবই থেকে এসেছে দেখো, তারপর ছোট একটি কুইজ দিয়ে শিক্ষককে দেখাও। সবকিছু ইংরেজি ও বাংলায় চলে।",
          )}
        </p>
        {canRecord && loaded && <p className="topics-progress" role="status">
          {s(`Topics read: ${readIds.length} of ${topics.length}`, `পড়া বিষয়: ${n(topics.length)}টির মধ্যে ${n(readIds.length)}টি`)}
        </p>}
      </section>

      {canReview && <aside className="topic-staff-note" role="note">
        {s("Teacher view: students see only the approved topics below.", "শিক্ষকের দৃশ্য: শিক্ষার্থীরা শুধু নিচের অনুমোদিত বিষয়গুলো দেখে।")}{" "}
        {pendingCount > 0 && s(`${pendingCount} ${pendingCount === 1 ? "topic is" : "topics are"} waiting for approval.`, `${n(pendingCount)}টি বিষয় অনুমোদনের অপেক্ষায়।`)}{" "}
        <Link href="/teach/topics">{s("Open Topics →", "“বিষয়” অংশ খুলুন →")}</Link>
      </aside>}

      {error && <p className="auth-error" role="alert">{error}</p>}
      {!loaded && !error && <p role="status">{s("Loading learning topics…", "শেখার বিষয় লোড হচ্ছে…")}</p>}
      {groups.map(({ category, items }) => (
        <section className="explore-section" key={category.id} aria-label={category.title[language]}>
          <h2><span aria-hidden="true">{category.icon}</span> {category.title[language]}</h2>
          <p className="explore-section-note">{category.note[language]}</p>
          <div className="topics-grid">
            {items.map((topic) => {
              const best = scores[topic.id];
              return (
                <button type="button" className="topic-card" key={topic.id} onClick={() => openTopic(topic.id)}>
                  <span className="topic-emoji" aria-hidden="true">{topic.emoji}</span>
                  <strong>{topic.title[language]}</strong>
                  <p>{topic.tagline[language]}</p>
                  {canReview && topic.approval && <span className="topic-draft-chip">{topic.approval.pendingVersions.length ? s("New version waiting", "নতুন সংস্করণ অপেক্ষায়") : topic.approval.baseline ? s("Approved · baseline", "অনুমোদিত · আগে থেকে থাকা") : s("Approved", "অনুমোদিত")}</span>}
                  {readIds.includes(topic.id) && <span className="topic-read-chip">{s("Read ✓", "পড়া হয়েছে ✓")}</span>}
                  <small>
                    {best
                      ? s(`Quiz done — best ${best.best}/${best.total} ⭐`, `কুইজ শেষ — সেরা ${n(best.best)}/${n(best.total)} ⭐`)
                      : topic.quiz.length
                        ? s(`${topic.minutes} min read + quiz`, `${n(topic.minutes)} মিনিট পড়া + কুইজ`)
                        : s(`${topic.minutes} min read`, `${n(topic.minutes)} মিনিট পড়া`)}
                  </small>
                </button>
              );
            })}
          </div>
        </section>
      ))}
      {loaded && !topics.length && <p>{s("No topics have been approved yet.", "এখনো কোনো বিষয় অনুমোদিত হয়নি।")}</p>}

      {canReview && <section className="topics-teacher-note">
        <span aria-hidden="true">🍎</span>
        <p>
          {s("Teachers: write new topics, preview them in English and Bangla and approve them in ", "শিক্ষকদের জন্য: নতুন বিষয় লিখুন, ইংরেজি ও বাংলায় দেখে নিন এবং অনুমোদন দিন ")}
          <Link href="/teach/topics">{s("Topics →", "“বিষয়” অংশে →")}</Link>{" "}
          {s("Set class quizzes in your ", "ক্লাসের কুইজ দিন ")}
          <Link href="/teach">{s("teacher workspace →", "শিক্ষকের কর্মক্ষেত্রে →")}</Link>
        </p>
      </section>}
    </main>
  );
}
