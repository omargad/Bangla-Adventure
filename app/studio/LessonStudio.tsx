"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import PortalShell from "@/app/components/PortalShell";
import { lessons, levelBands } from "@/app/curriculum";
import type { Bilingual } from "@/app/topics-content";
import { call, failure } from "@/app/teach/topics/shared";
import { groupLessonsByCategory } from "@/lib/lesson-model";
import { formatNumber, formatWhen } from "@/lib/topic-model";
import { useLanguage } from "@/lib/use-language";
import { scrollToTop } from "@/lib/scroll-to-top";
import { justReturnedTo } from "@/lib/portal-scroll";
import LessonReview from "./LessonReview";
import { lessonStatusClass, lessonStatusLabel, slotLabel, type LessonApproval } from "./labels";

type LessonRow = LessonApproval & { pendingAudio: number; video: { status: string; suitabilityStatus: string; takenDown: boolean; replaced: boolean } | null };
type PendingRecording = { id: string; lessonId: string; slot: string; speakerName: string; dialect: string; consentConfirmed: boolean; createdAt: string; uploaderName: string | null };
type StudioList = { lessons: LessonRow[]; pendingRecordings: PendingRecording[] };

const lessonById = new Map(lessons.map((lesson) => [lesson.id, lesson]));
/** The lesson an address of the studio names (?lesson=), if any. */
const lessonAt = (params: URLSearchParams) => { const id = params.get("lesson"); return id && lessonById.has(id) ? id : null; };

/**
 * Staff preview the lessons and upload recordings. Administrators decide which
 * lessons and recordings are published to students.
 */
export default function LessonStudio({ name, role, canApprove }: { name: string; role: "teacher" | "admin"; canApprove: boolean }) {
  const [language, toggleLanguage] = useLanguage({ title: ["Lessons | Bangla Adventures", "পাঠ | Bangla Adventures"] });
  const s = (en: string, bn: string) => (language === "bn" ? bn : en);
  const n = (value: number) => formatNumber(value, language);
  const params = useSearchParams();
  const [lessonId, setLessonId] = useState<string | null>(() => lessonAt(params));
  const [list, setList] = useState<StudioList | null>(null);
  const [error, setError] = useState<Bilingual | null>(null);
  // The open lesson follows the address, as the topic studio's view does (see TopicStudio): open() gives each lesson its own
  // address with history.replaceState, which Next takes for an address of the page as it was rendered.
  const address = params.toString(), path = usePathname();
  const [shownAt, setShownAt] = useState(address);
  const [linkedViews, setLinkedViews] = useState(0);
  if (shownAt !== address) {
    setShownAt(address);
    const named = lessonAt(params);
    if (named !== lessonId) {
      setLessonId(named); setError(null);
      if (!justReturnedTo(address ? `${path}?${address}` : path)) setLinkedViews((count) => count + 1);
    }
  }
  useEffect(() => { if (linkedViews) scrollToTop(); }, [linkedViews]);

  const fetchList = (signal?: AbortSignal) => call<StudioList>("/api/studio/lessons", { signal });
  const loadList = () => fetchList().then(setList).catch((caught) => setError(failure(caught)));
  useEffect(() => {
    const controller = new AbortController();
    fetchList(controller.signal).then(setList).catch((caught) => { if (!controller.signal.aborted) setError(failure(caught)); });
    return () => controller.abort();
  }, []);
  // The list is loaded again whenever it is shown again, so it shows what was just approved or withdrawn.
  const listing = !lessonId, listed = useRef(listing);
  useEffect(() => {
    if (listing && !listed.current) void fetchList().then(setList).catch((caught) => setError(failure(caught)));
    listed.current = listing;
  }, [listing]);

  const open = (next: string | null) => {
    setLessonId(next); setError(null);
    window.history.replaceState(null, "", next ? `/studio?lesson=${encodeURIComponent(next)}` : "/studio");
    scrollToTop();
  };

  const rows = (list?.lessons ?? []).flatMap((row) => { const lesson = lessonById.get(row.lessonId); return lesson ? [{ ...row, category: lesson.category, lesson }] : []; });
  const hidden = rows.filter((row) => row.status !== "approved").length;
  const reviewPending = rows.filter((row) => row.status === "approved" && row.baseline).length;
  const reviewed = rows.filter((row) => row.status === "approved" && !row.baseline).length;
  const title = (lessonId: string) => { const lesson = lessonById.get(lessonId); return lesson ? (language === "bn" ? lesson.titleBn : lesson.title) : lessonId; };
  const decidedBy = (row: LessonApproval) => {
    if (row.status === "approved" && row.baseline) return s("came with the app", "অ্যাপের সঙ্গে এসেছে");
    if (!row.changedAt) return "";
    const who = row.changedByName ?? s("a former staff member", "একজন সাবেক কর্মী");
    return row.status === "approved" ? s(`approved by ${who}, ${formatWhen(row.changedAt, language)}`, `${who} অনুমোদন করেছেন, ${formatWhen(row.changedAt, language)}`)
      : s(`withdrawn by ${who}, ${formatWhen(row.changedAt, language)}`, `${who} সরিয়ে নিয়েছেন, ${formatWhen(row.changedAt, language)}`);
  };

  return (
    <PortalShell role={role} name={name} language={language} toggleLanguage={toggleLanguage} active="lessons">
      <main className="topic-studio lesson-studio" lang={language}>
        <div className="portal-heading">
          <div>
            <p className="adult-eyebrow">{canApprove ? s("Preview · approve · withdraw", "দেখা · অনুমোদন · সরিয়ে নেওয়া") : s("Preview · record · submit", "প্রিভিউ · রেকর্ড · জমা")}</p>
            <h1>{s("Lessons", "পাঠ")}</h1>
          </div>
          {lessonId && <button type="button" className="outline-button" onClick={() => open(null)}>← {s("All lessons", "সব পাঠ")}</button>}
        </div>
        {error && <p className="auth-error" role="alert">{error[language]}</p>}

        {lessonId && <LessonReview key={lessonId} lessonId={lessonId} language={language} canApprove={canApprove} onChanged={() => void loadList()} />}

        {!lessonId && <>
          <p>{s(
            "These are the 18 lessons students open on the adventure page. Teachers can preview each lesson in English and Bangla and submit recordings for administrator review. Administrators approve lessons and recordings and decide which videos students see.",
            "শিক্ষার্থীরা অভিযানের পাতায় এই ১৮টি পাঠ খোলে। শিক্ষকেরা প্রতিটি পাঠ ইংরেজি ও বাংলায় দেখে প্রশাসকের পর্যালোচনার জন্য রেকর্ডিং জমা দিতে পারেন। প্রশাসকেরা পাঠ ও রেকর্ডিং অনুমোদন করেন এবং শিক্ষার্থীরা কোন ভিডিও দেখবে তা ঠিক করেন।",
          )}</p>
          {!list && !error && <p role="status">{s("Loading lessons…", "পাঠ লোড হচ্ছে…")}</p>}
          {list && <>
            <div className="adult-stat-strip lesson-studio-stats">
              <span><strong>{n(rows.length - hidden)}</strong>{s("available to students", "শিক্ষার্থীদের জন্য চালু")}</span>
              <span><strong>{n(reviewed)}</strong>{s("individually reviewed", "আলাদাভাবে পর্যালোচিত")}</span>
              <span><strong>{n(reviewPending)}</strong>{s("available — review pending", "চালু — পর্যালোচনা বাকি")}</span>
              <span><strong>{n(hidden)}</strong>{s("hidden from students", "শিক্ষার্থীরা দেখে না")}</span>
              <span><strong>{n(list.pendingRecordings.length)}</strong>{s("recordings waiting", "রেকর্ডিং অপেক্ষায়")}</span>
            </div>

            <section className="teach-panel" aria-label={s("Recordings waiting for review", "পর্যালোচনার অপেক্ষায় থাকা রেকর্ডিং")}>
              <h2>{s("Recordings waiting for review", "পর্যালোচনার অপেক্ষায় থাকা রেকর্ডিং")} ({n(list.pendingRecordings.length)})</h2>
              {list.pendingRecordings.length === 0
                ? <p>{s("No recordings are waiting. Uploaded recordings appear here until an administrator listens to them and approves them.", "কোনো রেকর্ডিং অপেক্ষায় নেই। প্রশাসক শুনে অনুমোদন না দেওয়া পর্যন্ত আপলোড করা রেকর্ডিং এখানে থাকে।")}</p>
                : <ul className="topic-admin-list">{list.pendingRecordings.map((recording) => (
                  <li key={recording.id} className="topic-admin-row recording-row">
                    <span className="topic-admin-title">
                      <strong>{title(recording.lessonId)} · {slotLabel(recording.slot, language)}</strong>
                      <small>{recording.speakerName} · {recording.dialect} · {s("uploaded by", "আপলোড করেছেন")} {recording.uploaderName ?? s("a former staff member", "একজন সাবেক কর্মী")}, {formatWhen(recording.createdAt, language)}</small>
                    </span>
                    <audio controls preload="none" src={`/api/studio/media/${encodeURIComponent(recording.id)}`} aria-label={`${s("Play", "শুনুন")}: ${title(recording.lessonId)} · ${slotLabel(recording.slot, language)}`} />
                    <span className="topic-admin-actions"><button type="button" className="outline-button" onClick={() => open(recording.lessonId)}>{canApprove ? s("Review in the lesson", "পাঠে গিয়ে পর্যালোচনা") : s("Preview in the lesson", "পাঠে গিয়ে প্রিভিউ")}</button></span>
                  </li>
                ))}</ul>}
            </section>

            {groupLessonsByCategory(rows).map(({ category, items }) => (
              <section className="teach-panel" key={category.id} aria-label={category.title[language]}>
                <h2><span aria-hidden="true">{category.icon}</span> {category.title[language]} ({n(items.length)})</h2>
                <ul className="topic-admin-list">{items.map((row) => {
                  const { lesson } = row;
                  const level = levelBands.find((band) => band.id === lesson.level);
                  const shown = language === "bn" ? lesson.titleBn : lesson.title;
                  return (
                    <li key={row.lessonId} className="topic-admin-row">
                      <span className="lesson-number" aria-hidden="true">{n(lesson.number)}</span>
                      <span className="topic-admin-title">
                        <strong>{shown}</strong>
                        <span lang={language === "bn" ? "en" : "bn"} className="lesson-other-title">{language === "bn" ? lesson.title : lesson.titleBn}</span>
                        <small>
                          <span className={lessonStatusClass(row.status, row.baseline)}>{lessonStatusLabel(row, language)}</span>
                          {" · "}{level?.code}{decidedBy(row) && <> · {decidedBy(row)}</>}
                          {row.pendingAudio > 0 && <> · {s(`${row.pendingAudio} recording${row.pendingAudio === 1 ? "" : "s"} waiting`, `${n(row.pendingAudio)}টি রেকর্ডিং অপেক্ষায়`)}</>}
                          {row.video?.takenDown && <> · {row.video.replaced ? s("video replaced", "ভিডিও বদলানো হয়েছে") : s("video taken down", "ভিডিও সরানো হয়েছে")}</>}
                          {(!row.video || row.video.status === "pending" || row.video.suitabilityStatus === "unchecked") && <> · {s("video review pending", "ভিডিও পর্যালোচনা বাকি")}</>}
                        </small>
                        {row.status === "withdrawn" && row.note && <small>{s("Reason", "কারণ")}: <q>{row.note}</q></small>}
                      </span>
                      <span className="topic-admin-actions">
                        <button type="button" className={row.status === "approved" ? "outline-button" : "primary-button"} aria-label={`${s("Preview lesson", "পাঠটি দেখুন")}: ${shown}`} onClick={() => open(row.lessonId)}>{s("Preview lesson", "পাঠটি দেখুন")}</button>
                      </span>
                    </li>
                  );
                })}</ul>
              </section>
            ))}
            <p className="teach-note">{s(
              "“Available · review pending” marks existing lessons that students could use before approval existed. Administrators review lessons, videos and recordings separately; lesson approval does not approve its media.",
              "“চালু · পর্যালোচনা বাকি” মানে অনুমোদন চালুর আগেই শিক্ষার্থীরা পাঠগুলো ব্যবহার করতে পারত। প্রশাসকেরা পাঠ, ভিডিও ও রেকর্ডিং আলাদাভাবে পর্যালোচনা করেন; পাঠ অনুমোদন মানে মিডিয়ার অনুমোদন নয়।",
            )} <Link href="/teach/topics">{s("Write and submit topics →", "বিষয় লিখে জমা দিন →")}</Link></p>
          </>}
        </>}
      </main>
    </PortalShell>
  );
}
