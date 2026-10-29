"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import LessonExperience, { lessonSteps, type LessonStep } from "@/app/components/LessonExperience";
import { lessons, levelBands } from "@/app/curriculum";
import type { Bilingual } from "@/app/topics-content";
import { call, failure } from "@/app/teach/topics/shared";
import { lessonCategory, LESSON_NOTE_LIMIT, type LearnerVideo } from "@/lib/lesson-model";
import { formatNumber, formatWhen, type Language } from "@/lib/topic-model";
import { lessonStatusClass, lessonStatusLabel, type LessonApproval } from "./labels";
import { LessonRecordings, VideoCheck, type Recording, type VideoCheckRecord } from "./LessonMedia";
import SpecialistChecks, { type SpecialistCheck } from "./SpecialistChecks";

type HistoryEntry = { status: "approved" | "withdrawn"; baseline: boolean; changedByName: string | null; changedAt: string; note: string };
export type LessonDetail = {
  approval: LessonApproval; history: HistoryEntry[]; recordings: Recording[];
  video: VideoCheckRecord | null; learnerVideo: LearnerVideo | null; specialistChecks: SpecialistCheck[];
};

/**
 * One lesson in the Studio: the whole lesson rendered as students see it (in a
 * preview that saves nothing), the shared approve / withdraw decision, its
 * history, human audio, the video check and the optional specialist checks.
 */
export default function LessonReview({ lessonId, language, onChanged }: { lessonId: string; language: Language; onChanged: () => void }) {
  const s = (en: string, bn: string) => (language === "bn" ? bn : en);
  const lesson = lessons.find((item) => item.id === lessonId)!;
  const level = levelBands.find((band) => band.id === lesson.level)!;
  const [detail, setDetail] = useState<LessonDetail | null>(null);
  const [error, setError] = useState<Bilingual | null>(null);
  const [message, setMessage] = useState<Bilingual | null>(null);
  const [previewLanguage, setPreviewLanguage] = useState<Language>(language);
  const [viewed, setViewed] = useState<LessonStep[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [approveNote, setApproveNote] = useState("");
  const [withdrawNote, setWithdrawNote] = useState("");
  const [busy, setBusy] = useState(false);

  const url = `/api/studio/lessons/${encodeURIComponent(lessonId)}`;
  const load = () => call<LessonDetail>(url).then(setDetail).catch((caught) => setError(failure(caught)));
  useEffect(() => {
    const controller = new AbortController();
    call<LessonDetail>(url, { signal: controller.signal }).then(setDetail).catch((caught) => { if (!controller.signal.aborted) setError(failure(caught)); });
    return () => controller.abort();
  }, [url]);

  const markViewed = useCallback((step: LessonStep) => setViewed((current) => (current.includes(step) ? current : [...current, step])), []);
  const allViewed = lessonSteps.every((step) => viewed.includes(step));

  async function decide(decision: "approve" | "withdraw") {
    if (busy || !detail) return;
    const wasVisible = detail.approval.status === "approved";
    setBusy(true); setError(null); setMessage(null);
    try {
      const body = decision === "approve" ? { decision, note: approveNote, confirmedRead: confirmed } : { decision, note: withdrawNote };
      const next = await call<LessonDetail>(url, { method: "POST", body: JSON.stringify(body) });
      setDetail(next);
      setMessage(decision === "withdraw"
        ? { en: "Withdrawn. Students and parents no longer see this lesson.", bn: "সরিয়ে নেওয়া হয়েছে। শিক্ষার্থী ও অভিভাবকেরা আর এই পাঠ দেখবে না।" }
        : wasVisible
          ? { en: "Review recorded. Students keep seeing this lesson, now approved under your name.", bn: "পর্যালোচনা সংরক্ষিত হয়েছে। শিক্ষার্থীরা পাঠটি দেখতেই থাকবে, এখন আপনার নামে অনুমোদিত।" }
          : { en: "Approved. Students can open this lesson again.", bn: "অনুমোদিত। শিক্ষার্থীরা আবার এই পাঠ খুলতে পারবে।" });
      setConfirmed(false); setApproveNote(""); setWithdrawNote("");
      onChanged();
    } catch (caught) { setError(failure(caught)); }
    finally { setBusy(false); }
  }

  if (!detail) {
    return <section className="teach-panel">{error ? <p className="auth-error" role="alert">{error[language]}</p> : <p role="status">{s("Loading the lesson…", "পাঠ লোড হচ্ছে…")}</p>}</section>;
  }

  const { approval } = detail;
  const who = (name: string | null) => name ?? s("a former staff member", "একজন সাবেক কর্মী");
  const category = lessonCategory(lesson.category);
  const baselineOnly = approval.status === "approved" && approval.baseline;
  // Approving needs every part opened and the full-review tick, whether the lesson is hidden or only approved as a baseline.
  const reviewForm = <>
    <p className={allViewed ? "lesson-review-progress done" : "lesson-review-progress"} role="status">
      {allViewed ? "✓ " : ""}{s(`Parts of the lesson opened: ${viewed.length} of ${lessonSteps.length}`, `পাঠের যে অংশগুলো খোলা হয়েছে: ${formatNumber(lessonSteps.length, "bn")}টির মধ্যে ${formatNumber(viewed.length, "bn")}টি`)}
    </p>
    <label className="topic-confirm"><input type="checkbox" checked={confirmed} disabled={!allViewed} onChange={(event) => setConfirmed(event.target.checked)} /> {s("I have reviewed the whole lesson in English and Bangla", "আমি পুরো পাঠ ইংরেজি ও বাংলায় দেখেছি")}</label>
    <label className="topic-note">{s("Note (optional)", "নোট (ঐচ্ছিক)")}
      <textarea rows={2} maxLength={LESSON_NOTE_LIMIT} value={approveNote} onChange={(event) => setApproveNote(event.target.value)} />
    </label>
    <div className="access-actions">
      <button type="button" className="primary-button" disabled={!confirmed || busy} onClick={() => void decide("approve")}>{baselineOnly ? s("Confirm my review", "আমার পর্যালোচনা নিশ্চিত করুন") : s("Approve for students", "শিক্ষার্থীদের জন্য অনুমোদন দিন")}</button>
    </div>
  </>;
  return (
    <>
      <section className="teach-panel topic-review-head" aria-label={s("Lesson details", "পাঠের তথ্য")}>
        <p className="adult-eyebrow">{category.icon} {category.title[language]} · {level.code} · {s(`Lesson ${lesson.number}`, `পাঠ ${formatNumber(lesson.number, "bn")}`)}</p>
        <h2>{lesson.title}</h2>
        <p className="lesson-review-title-bn" lang="bn">{lesson.titleBn}</p>
        <p><span className={lessonStatusClass(approval.status)}>{lessonStatusLabel(approval, language)}</span></p>
        {approval.status === "approved" && approval.baseline && <p className="teach-note">{s(
          "Pre-existing content, approved as a baseline: students could already use this lesson before lesson approval existed. It has not been individually reviewed.",
          "আগে থেকে থাকা বিষয়বস্তু, ভিত্তি হিসেবে অনুমোদিত: পাঠ অনুমোদন চালুর আগেই শিক্ষার্থীরা এই পাঠ ব্যবহার করত। এটি আলাদা করে পর্যালোচনা করা হয়নি।",
        )}</p>}
        {approval.status === "approved" && !approval.baseline && approval.changedAt && <p className="teach-note">{s(`Approved by ${who(approval.changedByName)}, ${formatWhen(approval.changedAt, language)}.`, `${who(approval.changedByName)} অনুমোদন করেছেন, ${formatWhen(approval.changedAt, language)}।`)}</p>}
        {approval.status === "withdrawn" && approval.changedAt && <p className="teach-note">{s(`Withdrawn by ${who(approval.changedByName)}, ${formatWhen(approval.changedAt, language)}: `, `${who(approval.changedByName)} সরিয়ে নিয়েছেন, ${formatWhen(approval.changedAt, language)}: `)}<q>{approval.note}</q></p>}
        {approval.status === "waiting" && <p className="teach-note">{s("Nobody has approved this lesson yet, so students cannot see it.", "এই পাঠ এখনো কেউ অনুমোদন করেননি, তাই শিক্ষার্থীরা এটি দেখতে পায় না।")}</p>}
        {message && <p className="teach-message" role="status">{message[language]}</p>}
      </section>

      <section className="topic-preview lesson-preview" aria-label={s("Student view preview", "শিক্ষার্থীর দৃশ্যের প্রিভিউ")}>
        <div className="topic-preview-bar">
          <strong>{s("Students will see this:", "শিক্ষার্থীরা এটি দেখবে:")}</strong>
          <div role="group" aria-label={s("Preview language", "প্রিভিউয়ের ভাষা")} className="topic-preview-modes">
            {([["en", "English"], ["bn", "বাংলা"]] as const).map(([value, label]) => (
              <button type="button" key={value} aria-pressed={previewLanguage === value} onClick={() => setPreviewLanguage(value)}>{label}</button>
            ))}
          </div>
        </div>
        <p className="teach-note">{s(
          "This is the lesson exactly as students get it, with the Bangla transcripts, the English support and the correct answers shown so you can check them. Nothing you do here is saved. Sound plays the lesson’s recording (an approved human recording when there is one).",
          "শিক্ষার্থীরা যেভাবে পায় পাঠটি ঠিক সেভাবে দেখানো হচ্ছে; যাচাইয়ের জন্য বাংলা লেখা, ইংরেজি সহায়তা ও সঠিক উত্তর খোলা আছে। এখানে কিছুই সংরক্ষণ হয় না। শব্দ বাজালে পাঠের রেকর্ডিং বাজে (অনুমোদিত মানুষের রেকর্ডিং থাকলে সেটি)।",
        )}</p>
        <PreviewPlayer lessonId={lessonId} language={previewLanguage} video={detail.learnerVideo} level={level} onStepView={markViewed} />
      </section>

      <section className="teach-panel topic-decision" aria-label={s("Your decision", "আপনার সিদ্ধান্ত")}>
        <h3>{s("Your decision", "আপনার সিদ্ধান্ত")}</h3>
        {approval.status === "approved" ? <>
          {baselineOnly && <>
            <h4>{s("Confirm your review", "আপনার পর্যালোচনা নিশ্চিত করুন")}</h4>
            <p className="teach-note">{s(
              "Nobody has reviewed this lesson individually yet. Open every part of it in the preview above and read it in English and in Bangla, then confirm: students keep seeing it and the lesson is approved under your name.",
              "এই পাঠ এখনো কেউ আলাদা করে পর্যালোচনা করেননি। ওপরের প্রিভিউতে পাঠের প্রতিটি অংশ খুলে ইংরেজি ও বাংলায় পড়ুন, তারপর নিশ্চিত করুন: শিক্ষার্থীরা পাঠটি দেখতেই থাকবে এবং আপনার নামে অনুমোদন লেখা থাকবে।",
            )}</p>
            {reviewForm}
            <h4>{s("Or withdraw it", "অথবা সরিয়ে নিন")}</h4>
          </>}
          <p className="teach-note">{s(
            "Withdrawing hides this lesson from students and parents straight away: the lesson list, links to it, practice words, worksheets and new assignments. Their saved progress is kept. Approve it again once it is fixed.",
            "সরিয়ে নিলে পাঠটি সঙ্গে সঙ্গে শিক্ষার্থী ও অভিভাবকদের কাছ থেকে লুকানো হবে: পাঠের তালিকা, পাঠের লিংক, শব্দ অনুশীলন, ওয়ার্কশিট ও নতুন কাজ। তাদের সংরক্ষিত অগ্রগতি থেকে যাবে। ঠিক করার পর আবার অনুমোদন দিন।",
          )}</p>
          <label className="topic-note">{s("Why are you withdrawing it? (needed)", "কেন সরিয়ে নিচ্ছেন? (লিখতে হবে)")}
            <textarea rows={3} maxLength={LESSON_NOTE_LIMIT} value={withdrawNote} onChange={(event) => setWithdrawNote(event.target.value)} />
          </label>
          <div className="access-actions">
            <button type="button" className="danger-button" disabled={!withdrawNote.trim() || busy} onClick={() => void decide("withdraw")}>{s("Withdraw from students", "শিক্ষার্থীদের কাছ থেকে সরিয়ে নিন")}</button>
          </div>
        </> : <>
          <p className="teach-note">{s(
            "Open every part of the lesson in the preview above and read it in English and in Bangla before you approve. Approving shows the lesson to students and records your name.",
            "অনুমোদনের আগে ওপরের প্রিভিউতে পাঠের প্রতিটি অংশ খুলে ইংরেজি ও বাংলায় পড়ুন। অনুমোদন দিলে পাঠটি শিক্ষার্থীরা দেখবে এবং আপনার নাম লেখা থাকবে।",
          )}</p>
          {reviewForm}
        </>}
        {error && <p className="auth-error" role="alert">{error[language]}</p>}
      </section>

      <section className="teach-panel" aria-label={s("Approval history", "অনুমোদনের ইতিহাস")}>
        <h3>{s("Approval history", "অনুমোদনের ইতিহাস")}</h3>
        {detail.history.length === 0 ? <p>{s("No decisions yet.", "এখনো কোনো সিদ্ধান্ত হয়নি।")}</p> : <div className="portal-table"><table>
          <thead><tr><th>{s("When", "কখন")}</th><th>{s("Decision", "সিদ্ধান্ত")}</th><th>{s("By", "কে")}</th><th>{s("Note", "নোট")}</th></tr></thead>
          <tbody>{detail.history.map((entry, index) => (
            <tr key={`${entry.changedAt}-${index}`}>
              <td>{formatWhen(entry.changedAt, language)}</td>
              <td>{entry.baseline ? s("Approved as a baseline when lesson approval started", "পাঠ অনুমোদন চালুর সময় ভিত্তি হিসেবে অনুমোদিত") : entry.status === "approved" ? s("Approved", "অনুমোদিত") : s("Withdrawn", "সরিয়ে নেওয়া")}</td>
              <td>{entry.baseline ? "—" : who(entry.changedByName)}</td>
              <td>{entry.note || "—"}</td>
            </tr>
          ))}</tbody>
        </table></div>}
      </section>

      <LessonRecordings lessonId={lessonId} language={language} recordings={detail.recordings} onChanged={() => { void load(); onChanged(); }} />
      <VideoCheck lessonId={lessonId} language={language} check={detail.video} learnerVideo={detail.learnerVideo} onChanged={() => { void load(); onChanged(); }} />
      <SpecialistChecks lessonId={lessonId} language={language} checks={detail.specialistChecks} onChanged={() => void load()} />
    </>
  );
}

/**
 * The learner lesson component in preview mode. Sound plays the lesson's own
 * recording when the lesson offers one, otherwise the device voice; nothing is
 * awarded or saved.
 */
function PreviewPlayer({ lessonId, language, video, level, onStepView }: {
  lessonId: string; language: Language; video: LearnerVideo | null; level: (typeof levelBands)[number]; onStepView: (step: LessonStep) => void;
}) {
  const lesson = lessons.find((item) => item.id === lessonId)!;
  const [isSpeaking, setIsSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setIsSpeaking(false);
  }, []);
  useEffect(() => stop, [stop]);

  function speak(text: string, lang = "bn-BD", source?: string) {
    stop();
    if (source) {
      const audio = new Audio(source);
      audioRef.current = audio;
      audio.onended = () => setIsSpeaking(false);
      audio.onerror = () => setIsSpeaking(false);
      setIsSpeaking(true);
      void audio.play().catch(() => setIsSpeaking(false));
      return;
    }
    if (!("speechSynthesis" in window)) return;
    const root = lang.split("-")[0];
    const voice = window.speechSynthesis.getVoices().find((item) => item.lang.toLowerCase().startsWith(root));
    // Never let a voice for another language read the line aloud.
    if (!voice) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.voice = voice;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }

  return (
    <div className="lesson-preview-frame" lang={language}>
      <LessonExperience
        lesson={lesson} video={video} preview onStepView={onStepView} level={level} language={language} completed={[]}
        soundEnabled isSpeaking={isSpeaking} onSpeak={speak} onStopAudio={stop} onAward={() => undefined} onCue={() => undefined}
        onClose={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      />
    </div>
  );
}
