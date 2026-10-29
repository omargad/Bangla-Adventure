"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PortalShell from "@/app/components/PortalShell";
import { lessons, levelBands } from "@/app/curriculum";
import type { Bilingual } from "@/app/topics-content";
import { call, failure } from "@/app/teach/topics/shared";
import { groupLessonsByCategory } from "@/lib/lesson-model";
import { formatNumber, formatWhen } from "@/lib/topic-model";
import { useLanguage } from "@/lib/use-language";
import LessonReview from "./LessonReview";
import { lessonStatusClass, lessonStatusLabel, slotLabel, type LessonApproval } from "./labels";

type LessonRow = LessonApproval & { pendingAudio: number; video: { status: string; suitabilityStatus: string; takenDown: boolean; replaced: boolean } | null };
type PendingRecording = { id: string; lessonId: string; slot: string; speakerName: string; dialect: string; consentConfirmed: boolean; createdAt: string; uploaderName: string | null };
type StudioList = { lessons: LessonRow[]; pendingRecordings: PendingRecording[] };

const lessonById = new Map(lessons.map((lesson) => [lesson.id, lesson]));

/**
 * Lessons: every teacher and administrator sees the 18 lessons grouped by
 * category with one shared status, previews a lesson in full as students see it
 * (in English and Bangla) and approves or withdraws it. Recordings from any staff
 * member wait here until someone listens to them and approves them.
 */
export default function LessonStudio({ name, role, initialLessonId }: { name: string; role: "teacher" | "admin"; initialLessonId: string | null }) {
  const [language, toggleLanguage] = useLanguage();
  const s = (en: string, bn: string) => (language === "bn" ? bn : en);
  const n = (value: number) => formatNumber(value, language);
  const [lessonId, setLessonId] = useState<string | null>(initialLessonId);
  const [list, setList] = useState<StudioList | null>(null);
  const [error, setError] = useState<Bilingual | null>(null);

  const fetchList = (signal?: AbortSignal) => call<StudioList>("/api/studio/lessons", { signal });
  const loadList = () => fetchList().then(setList).catch((caught) => setError(failure(caught)));
  useEffect(() => {
    const controller = new AbortController();
    fetchList(controller.signal).then(setList).catch((caught) => { if (!controller.signal.aborted) setError(failure(caught)); });
    return () => controller.abort();
  }, []);

  const open = (next: string | null) => {
    setLessonId(next); setError(null);
    window.history.replaceState(null, "", next ? `/studio?lesson=${encodeURIComponent(next)}` : "/studio");
    window.scrollTo({ top: 0 });
    if (!next) void loadList();
  };

  const rows = (list?.lessons ?? []).flatMap((row) => { const lesson = lessonById.get(row.lessonId); return lesson ? [{ ...row, category: lesson.category, lesson }] : []; });
  const hidden = rows.filter((row) => row.status !== "approved").length;
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
            <p className="adult-eyebrow">{s("Preview · approve · withdraw", "দেখা · অনুমোদন · সরিয়ে নেওয়া")}</p>
            <h1>{s("Lessons", "পাঠ")}</h1>
          </div>
          {lessonId && <button type="button" className="outline-button" onClick={() => open(null)}>← {s("All lessons", "সব পাঠ")}</button>}
        </div>
        {error && <p className="auth-error" role="alert">{error[language]}</p>}

        {lessonId && <LessonReview key={lessonId} lessonId={lessonId} language={language} onChanged={() => void loadList()} />}

        {!lessonId && <>
          <p>{s(
            "These are the 18 lessons students open on the adventure page. Students see a lesson only while it is approved. Open “Preview lesson” to go through the whole lesson in English and Bangla exactly as students see it, then approve it or withdraw it.",
            "শিক্ষার্থীরা অভিযানের পাতায় এই ১৮টি পাঠ খোলে। পাঠ অনুমোদিত থাকলেই শুধু শিক্ষার্থীরা তা দেখে। “পাঠটি দেখুন” চেপে শিক্ষার্থীরা যেভাবে দেখে ঠিক সেভাবে পুরো পাঠ ইংরেজি ও বাংলায় দেখে নিন, তারপর অনুমোদন দিন বা সরিয়ে নিন।",
          )}</p>
          {!list && !error && <p role="status">{s("Loading lessons…", "পাঠ লোড হচ্ছে…")}</p>}
          {list && <>
            <div className="adult-stat-strip lesson-studio-stats">
              <span><strong>{n(rows.length - hidden)}</strong>{s("approved for students", "শিক্ষার্থীদের জন্য অনুমোদিত")}</span>
              <span><strong>{n(hidden)}</strong>{s("hidden from students", "শিক্ষার্থীরা দেখে না")}</span>
              <span><strong>{n(list.pendingRecordings.length)}</strong>{s("recordings waiting", "রেকর্ডিং অপেক্ষায়")}</span>
            </div>

            <section className="teach-panel" aria-label={s("Recordings waiting for review", "পর্যালোচনার অপেক্ষায় থাকা রেকর্ডিং")}>
              <h2>{s("Recordings waiting for review", "পর্যালোচনার অপেক্ষায় থাকা রেকর্ডিং")} ({n(list.pendingRecordings.length)})</h2>
              {list.pendingRecordings.length === 0
                ? <p>{s("No recordings are waiting. Recordings any teacher uploads appear here until someone listens to them and approves them.", "কোনো রেকর্ডিং অপেক্ষায় নেই। যেকোনো শিক্ষকের আপলোড করা রেকর্ডিং কেউ শুনে অনুমোদন না দেওয়া পর্যন্ত এখানে থাকে।")}</p>
                : <ul className="topic-admin-list">{list.pendingRecordings.map((recording) => (
                  <li key={recording.id} className="topic-admin-row recording-row">
                    <span className="topic-admin-title">
                      <strong>{title(recording.lessonId)} · {slotLabel(recording.slot, language)}</strong>
                      <small>{recording.speakerName} · {recording.dialect} · {s("uploaded by", "আপলোড করেছেন")} {recording.uploaderName ?? s("a former staff member", "একজন সাবেক কর্মী")}, {formatWhen(recording.createdAt, language)}</small>
                    </span>
                    <audio controls preload="none" src={`/api/studio/media/${encodeURIComponent(recording.id)}`} aria-label={`${s("Play", "শুনুন")}: ${title(recording.lessonId)} · ${slotLabel(recording.slot, language)}`} />
                    <span className="topic-admin-actions"><button type="button" className="outline-button" onClick={() => open(recording.lessonId)}>{s("Review in the lesson", "পাঠে গিয়ে পর্যালোচনা")}</button></span>
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
                          <span className={lessonStatusClass(row.status)}>{lessonStatusLabel(row, language)}</span>
                          {" · "}{level?.code}{decidedBy(row) && <> · {decidedBy(row)}</>}
                          {row.pendingAudio > 0 && <> · {s(`${row.pendingAudio} recording${row.pendingAudio === 1 ? "" : "s"} waiting`, `${n(row.pendingAudio)}টি রেকর্ডিং অপেক্ষায়`)}</>}
                          {row.video?.takenDown && <> · {row.video.replaced ? s("video replaced", "ভিডিও বদলানো হয়েছে") : s("video taken down", "ভিডিও সরানো হয়েছে")}</>}
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
              "“Approved · baseline” marks the lessons that came with the app: students could use them before lesson approval existed, and they have not been individually reviewed. Preview one to review it; withdraw it if something needs fixing.",
              "“অনুমোদিত · আগে থেকে থাকা” মানে অ্যাপের সঙ্গে আসা পাঠ: পাঠ অনুমোদন চালুর আগেই শিক্ষার্থীরা এগুলো ব্যবহার করত, আলাদা করে পর্যালোচনা হয়নি। পর্যালোচনা করতে একটি খুলুন; কিছু ঠিক করার থাকলে সরিয়ে নিন।",
            )} <Link href="/teach/topics">{s("Topics are written and approved in Topics →", "বিষয় লেখা ও অনুমোদন হয় “বিষয়” অংশে →")}</Link></p>
          </>}
        </>}
      </main>
    </PortalShell>
  );
}
