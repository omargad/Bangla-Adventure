"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useLanguage } from "../../lib/use-language";
import { SCORED_QUIZ_TRIES_PER_DAY, type LearnerTopic, type TopicQuizMarks } from "@/lib/learner-topic";
import { formatNumber, formatWhen, groupByCategory } from "@/lib/topic-model";
import TopicReader from "./TopicReader";
import { scrollToTop } from "@/lib/scroll-to-top";
import { justReturnedTo } from "@/lib/portal-scroll";
import type { TopicReference } from "@/lib/library-links";

const moodleUrl = process.env.NEXT_PUBLIC_MOODLE_URL?.replace(/\/+$/, "");
const courseHref = moodleUrl || "/learn";

type Approval = { version: number; baseline: boolean; approvedAt: string | null; reviewerName: string | null; publishedDirectly: "admin" | "setting" | null; pendingVersions: number[] };
/** Whether the signed-in staff member's topics publish at once, and whether teachers' topics need approval. */
type Publishing = { onSave: "admin" | "setting" | "review"; teacherTopicsNeedApproval: boolean };
type HubTopic = LearnerTopic & { approval?: Approval; references?: TopicReference[] };
type QuizScores = Record<string, { best: number; total: number }>;

export default function TopicsHub() {
  const [language, toggleLanguage] = useLanguage({ title: ["Classroom topics — culture, history & literature | Bangla Adventures", "শ্রেণিকক্ষের বিষয় — সংস্কৃতি, ইতিহাস ও সাহিত্য | Bangla Adventures"] });
  const s = (en: string, bn: string) => (language === "bn" ? bn : en);
  const n = (value: number) => formatNumber(value, language);

  const [topics, setTopics] = useState<HubTopic[]>([]);
  const [readIds, setReadIds] = useState<string[]>([]);
  const [scores, setScores] = useState<QuizScores>({});
  const [canRecord, setCanRecord] = useState(false);
  const [canReview, setCanReview] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [publishing, setPublishing] = useState<Publishing | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  // After a student's quiz: "saved" when the try could raise their saved best score, "practice" after the day's scored tries.
  const [quizSaved, setQuizSaved] = useState<"saved" | "practice" | null>(null);
  // The open topic has its own address (?topic=), given in place with history.replaceState, and follows the address as the
  // topic studio's view does (see app/teach/topics/TopicStudio.tsx), so the sidebar's link to this page shows the list again.
  const params = useSearchParams();
  const [activeId, setActiveId] = useState<string | null>(() => params.get("topic"));
  const address = params.toString(), path = usePathname();
  const [shownAt, setShownAt] = useState(address);
  const [linkedViews, setLinkedViews] = useState(0);
  if (shownAt !== address) {
    setShownAt(address);
    const named = params.get("topic");
    if (named !== activeId) {
      setActiveId(named); setQuizSaved(null);
      // A topic or the list a link opened starts at its top; after Back or Forward the place is left to the browser.
      if (!justReturnedTo(address ? `${path}?${address}` : path)) setLinkedViews((count) => count + 1);
    }
  }
  useEffect(() => { if (linkedViews) scrollToTop(); }, [linkedViews]);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/curriculum", { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setTopics(data.topics); setReadIds(data.readTopicIds); setScores(data.quizScores ?? {}); setCanRecord(data.canRecordProgress);
      setCanReview(Boolean(data.canReview)); setPendingCount(data.pendingCount ?? 0); setPublishing(data.publishing ?? null); setLoaded(true);
    }).catch((error) => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, []);

  const active = useMemo(() => topics.find((topic) => topic.id === activeId) ?? null, [activeId, topics]);
  const groups = useMemo(() => groupByCategory(topics), [topics]);

  const openTopic = (id: string) => {
    setActiveId(id);
    setQuizSaved(null);
    window.history.replaceState(null, "", `/topics?topic=${encodeURIComponent(id)}`);
    scrollToTop();
  };
  const closeTopic = () => { setActiveId(null); setQuizSaved(null); window.history.replaceState(null, "", "/topics"); };

  async function saveProgress(topicId: string, answers?: number[]): Promise<TopicQuizMarks | null> {
    setError(""); setQuizSaved(null);
    try {
      const response = await fetch("/api/student/topic-progress", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topicId, ...(answers ? { answers } : {}) }) });
      const data = await response.json(); if (!response.ok) throw new Error(language === "bn" && data.errorBn ? data.errorBn : data.error);
      setReadIds((current) => current.includes(topicId) ? current : [...current, topicId]);
      if (data.quiz) {
        if (data.quiz.best !== null) setScores((current) => ({ ...current, [topicId]: { best: data.quiz.best, total: data.quiz.total } }));
        setQuizSaved(data.quiz.saved === false ? "practice" : "saved");
        return { score: data.quiz.score, total: data.quiz.total, correct: data.quiz.correct };
      }
    } catch (error) { setError(error instanceof Error ? error.message : s("Could not save progress.", "অগ্রগতি সংরক্ষণ করা যায়নি।")); }
    return null;
  }

  /** A grown-up's quiz is marked on the server too, and nothing is saved. */
  async function markQuiz(topicId: string, answers: number[]): Promise<TopicQuizMarks | null> {
    setError("");
    try {
      const response = await fetch("/api/curriculum/quiz", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topicId, answers }) });
      const data = await response.json(); if (!response.ok) throw new Error(language === "bn" && data.errorBn ? data.errorBn : data.error);
      return data.quiz as TopicQuizMarks;
    } catch (error) { setError(error instanceof Error && error.message ? error.message : s("Could not check the answers. Please try again.", "উত্তর মিলিয়ে দেখা যায়নি। আবার চেষ্টা করুন।")); }
    return null;
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
      : approval.publishedDirectly === "admin"
        ? s(`Teacher view: published at once by ${approval.reviewerName ?? "a former staff member"} on ${formatWhen(approval.approvedAt, language)} (an administrator's own edit).`, `শিক্ষকের দৃশ্য: ${approval.reviewerName ?? "একজন সাবেক কর্মী"} ${formatWhen(approval.approvedAt, language)}-এ সরাসরি প্রকাশ করেছেন (প্রশাসকের নিজের সম্পাদনা)।`)
      : approval.publishedDirectly === "setting"
        ? s(`Teacher view: published at once on ${formatWhen(approval.approvedAt, language)}, without an administrator's review, while teachers' topics did not need approval.`, `শিক্ষকের দৃশ্য: ${formatWhen(approval.approvedAt, language)}-এ প্রশাসকের পর্যালোচনা ছাড়াই সরাসরি প্রকাশিত, কারণ তখন শিক্ষকদের বিষয়ে অনুমোদন লাগত না।`)
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
            checkQuiz={(answers) => canRecord ? saveProgress(active.id, answers) : markQuiz(active.id, answers)}
            quizNote={quizSaved === "saved" ? s("Saved. This topic now counts as read, and your teacher can see your best score.", "সংরক্ষিত। বিষয়টি এখন পড়া হিসেবে গোনা হবে, আর শিক্ষক তোমার সেরা ফল দেখতে পাবেন।")
              : quizSaved === "practice" ? s(
                `This try was practice, so its score was not saved: only the first ${SCORED_QUIZ_TRIES_PER_DAY} tries at a quiz each day count. Your teacher sees your best saved score. Try again tomorrow to improve it.`,
                `এই চেষ্টাটি অনুশীলন ছিল, তাই এর ফল সংরক্ষণ হয়নি: প্রতিদিন একটি কুইজের শুধু প্রথম ${n(SCORED_QUIZ_TRIES_PER_DAY)}টি চেষ্টা গোনা হয়। শিক্ষক তোমার সংরক্ষিত সেরা ফল দেখেন। ফল বাড়াতে কাল আবার চেষ্টা করো।`)
              : undefined}
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
            "Explore short readings and quizzes in English and Bangla, with related learning references. An administrator must verify the relevant textbook edition and pages.",
            "ইংরেজি ও বাংলায় ছোট লেখা আর কুইজ দেখো, সঙ্গে আছে শেখার তথ্যসূত্র। প্রাসঙ্গিক পাঠ্যবইয়ের সংস্করণ ও পৃষ্ঠা প্রশাসককে যাচাই করতে হবে।",
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

      {publishing && <section className="topics-teacher-note">
        <span aria-hidden="true">🍎</span>
        <p>
          {publishing?.onSave === "admin"
            ? s("Administrators: write and edit topics in English and Bangla in ", "প্রশাসকদের জন্য: ইংরেজি ও বাংলায় বিষয় লিখুন ও সম্পাদনা করুন ")
            : s("Teachers: write new topics and edit them in English and Bangla in ", "শিক্ষকদের জন্য: ইংরেজি ও বাংলায় নতুন বিষয় লিখুন ও সম্পাদনা করুন ")}
          <Link href="/teach/topics">{s("Topics →", "“বিষয়” অংশে →")}</Link>{" "}
          {publishing?.onSave === "admin"
            ? <>{s("Your own topics are published as soon as you save them.", "আপনার নিজের বিষয় সংরক্ষণ করলেই প্রকাশিত হয়।")}{" "}{publishing.teacherTopicsNeedApproval
              ? s("Teachers' topics wait for an administrator to approve them.", "শিক্ষকদের বিষয় প্রশাসকের অনুমোদনের অপেক্ষায় থাকে।")
              : s("Teachers' topics are published as soon as they save them, because approval for teachers' topics is switched off.", "শিক্ষকদের বিষয়ের অনুমোদন বন্ধ রাখা আছে, তাই তাঁরা সংরক্ষণ করলেই বিষয় প্রকাশিত হয়।")}</>
            : publishing?.onSave === "setting"
              ? s("Your topics are published to students as soon as you save them: an administrator has switched off approval for teachers' topics.", "প্রশাসক শিক্ষকদের বিষয়ের অনুমোদন বন্ধ রেখেছেন, তাই আপনি সংরক্ষণ করলেই বিষয় শিক্ষার্থীদের কাছে প্রকাশিত হয়।")
              : s("An administrator approves each one before students see it.", "শিক্ষার্থীরা দেখার আগে প্রশাসক প্রতিটি বিষয় অনুমোদন করেন।")}{" "}
          {s("Set class quizzes in your ", "ক্লাসের কুইজ দিন ")}
          <Link href="/teach">{s("teacher workspace →", "শিক্ষকের কর্মক্ষেত্রে →")}</Link>
        </p>
      </section>}
    </main>
  );
}
