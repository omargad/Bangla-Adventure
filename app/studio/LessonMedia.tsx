"use client";

import { useState } from "react";
import { lessons } from "@/app/curriculum";
import type { Bilingual } from "@/app/topics-content";
import { call, failure } from "@/app/teach/topics/shared";
import type { LearnerVideo } from "@/lib/lesson-model";
import { formatWhen, type Language } from "@/lib/topic-model";
import {
  audioSlots, captionStatuses, optionLabel, recordingStatusLabel, slotLabel, suitabilityStatuses, videoStatuses,
} from "./labels";

export type Recording = {
  id: string; slot: string; originalName: string; byteSize: number; speakerName: string; dialect: string; consentConfirmed: boolean;
  reviewStatus: string; notes: string; createdAt: string; uploaderName: string | null; reviewerName: string | null; reviewedAt: string | null;
};
export type VideoCheckRecord = {
  status: string; captionsStatus: string; suitabilityStatus: string; replacementUrl: string; notes: string; checkedAt: string; checkerName: string | null;
};

const formerStaff: Bilingual = { en: "a former staff member", bn: "একজন সাবেক কর্মী" };

/**
 * Human recordings for one lesson from every staff member. Anyone on the staff
 * can play a recording (including one still waiting) and approve it after
 * listening; the approval records their name.
 */
export function LessonRecordings({ lessonId, language, recordings, onChanged }: { lessonId: string; language: Language; recordings: Recording[]; onChanged: () => void }) {
  const s = (en: string, bn: string) => (language === "bn" ? bn : en);
  const [played, setPlayed] = useState<string[]>([]);
  const [listened, setListened] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<Bilingual | null>(null);
  const [message, setMessage] = useState<Bilingual | null>(null);

  async function review(recording: Recording, reviewStatus: string) {
    setBusy(recording.id); setError(null); setMessage(null);
    try {
      await call("/api/studio/media", { method: "PATCH", body: JSON.stringify({ id: recording.id, reviewStatus, notes: "", ...(reviewStatus === "approved" ? { confirmedListened: listened.includes(recording.id) } : {}) }) });
      setMessage(reviewStatus === "approved"
        ? { en: "Recording approved. Learners now hear it for this part of the lesson instead of a computer voice.", bn: "রেকর্ডিং অনুমোদিত। শিক্ষার্থীরা এখন পাঠের এই অংশে কম্পিউটারের কণ্ঠের বদলে এটি শুনবে।" }
        : { en: "Recording updated.", bn: "রেকর্ডিং হালনাগাদ হয়েছে।" });
      onChanged();
    } catch (caught) { setError(failure(caught)); }
    finally { setBusy(""); }
  }

  return (
    <section className="teach-panel" aria-label={s("Human audio recordings", "মানুষের কণ্ঠের রেকর্ডিং")}>
      <h3>{s("Human audio recordings", "মানুষের কণ্ঠের রেকর্ডিং")}</h3>
      <p className="teach-note">{s(
        "Play a recording before you approve it. Once approved, learners hear it on every device instead of a computer voice: the complete dialogue in Listen, the guided reading and the word bank in Read, the sentence patterns in Speak, and the words in word practice.",
        "অনুমোদনের আগে রেকর্ডিংটি বাজিয়ে শুনুন। অনুমোদনের পর শিক্ষার্থীরা সব ডিভাইসে কম্পিউটারের কণ্ঠের বদলে এটি শুনবে: ‘শুনি’ অংশে পুরো কথোপকথন, ‘পড়ি’ অংশে পড়ার লেখা ও শব্দভান্ডার, ‘বলি’ অংশে বাক্যের ধাঁচ, আর শব্দ অনুশীলনের শব্দগুলো।",
      )}</p>
      {recordings.length === 0 && <p>{s("No recordings yet. Learners hear a computer voice for this lesson.", "এখনো কোনো রেকর্ডিং নেই। শিক্ষার্থীরা এই পাঠে কম্পিউটারের কণ্ঠ শোনে।")}</p>}
      {recordings.length > 0 && <ul className="topic-admin-list">{recordings.map((recording) => {
        const label = slotLabel(recording.slot, language);
        return (
          <li key={recording.id} className="topic-admin-row recording-row">
            <span className="topic-admin-title">
              <strong>{label}</strong>
              <small><span className={`topic-status ${recording.reviewStatus === "approved" ? "topic-status-approved" : recording.reviewStatus === "pending" ? "topic-status-pending" : recording.reviewStatus === "changes-requested" ? "topic-status-rejected" : ""}`}>{recordingStatusLabel(recording.reviewStatus, language)}</span> · {recording.speakerName} · {recording.dialect} · {recording.consentConfirmed ? s("consent confirmed", "সম্মতি নিশ্চিত") : s("consent missing", "সম্মতি নেই")}</small>
              <small>{s("Uploaded by", "আপলোড করেছেন")} {recording.uploaderName ?? formerStaff[language]}, {formatWhen(recording.createdAt, language)}{recording.reviewedAt && <> · {s("reviewed by", "পর্যালোচনা করেছেন")} {recording.reviewerName ?? formerStaff[language]}, {formatWhen(recording.reviewedAt, language)}</>}</small>
            </span>
            <audio controls preload="none" src={`/api/studio/media/${encodeURIComponent(recording.id)}`} aria-label={`${s("Play", "শুনুন")}: ${label}`} onPlay={() => setPlayed((current) => (current.includes(recording.id) ? current : [...current, recording.id]))} />
            <span className="topic-admin-actions recording-actions">
              {recording.reviewStatus !== "approved" && <>
                <label className="recording-listened"><input type="checkbox" disabled={!played.includes(recording.id)} checked={listened.includes(recording.id)} onChange={(event) => setListened((current) => (event.target.checked ? [...current, recording.id] : current.filter((id) => id !== recording.id)))} /> {s("I listened to the whole recording", "আমি পুরো রেকর্ডিং শুনেছি")}</label>
                <button type="button" className="primary-button" disabled={busy === recording.id || !listened.includes(recording.id) || !recording.consentConfirmed} onClick={() => void review(recording, "approved")}>{s("Approve recording", "রেকর্ডিং অনুমোদন")}</button>
              </>}
              {recording.reviewStatus === "approved" && <button type="button" className="outline-button" disabled={busy === recording.id} onClick={() => void review(recording, "retired")}>{s("Stop using it", "ব্যবহার বন্ধ করুন")}</button>}
              {recording.reviewStatus !== "changes-requested" && recording.reviewStatus !== "retired" && <button type="button" className="outline-button" disabled={busy === recording.id} onClick={() => void review(recording, "changes-requested")}>{s("Ask for a new recording", "নতুন রেকর্ডিং চান")}</button>}
            </span>
          </li>
        );
      })}</ul>}
      {message && <p className="teach-message" role="status">{message[language]}</p>}
      {error && <p className="auth-error" role="alert">{error[language]}</p>}
      <RecordingUpload lessonId={lessonId} language={language} onUploaded={onChanged} />
    </section>
  );
}

function RecordingUpload({ lessonId, language, onUploaded }: { lessonId: string; language: Language; onUploaded: () => void }) {
  const s = (en: string, bn: string) => (language === "bn" ? bn : en);
  const [slot, setSlot] = useState("dialogue");
  const [speakerName, setSpeakerName] = useState("");
  const [dialect, setDialect] = useState("Bangladesh standard");
  const [consent, setConsent] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Bilingual | null>(null);
  const [done, setDone] = useState(false);
  const [fileKey, setFileKey] = useState(0);

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) { setError({ en: "Choose an audio file.", bn: "একটি অডিও ফাইল বেছে নিন।" }); return; }
    setSaving(true); setError(null); setDone(false);
    const form = new FormData();
    form.set("file", file); form.set("lessonId", lessonId); form.set("slot", slot); form.set("speakerName", speakerName); form.set("dialect", dialect); form.set("consentConfirmed", String(consent));
    const response = await fetch("/api/studio/media", { method: "POST", body: form }).catch(() => null);
    const data = response ? await response.json().catch(() => null) as { error?: string; errorBn?: string } | null : null;
    setSaving(false);
    if (!response?.ok) {
      setError({ en: data?.error ?? "Upload failed. Please try again.", bn: data?.errorBn ?? data?.error ?? "আপলোড হয়নি। আবার চেষ্টা করুন।" });
      return;
    }
    setFile(null); setConsent(false); setDone(true);
    setFileKey((key) => key + 1);
    onUploaded();
  }

  return (
    <details className="lesson-upload">
      <summary>{s("Upload a recording", "একটি রেকর্ডিং আপলোড করুন")}</summary>
      <form className="portal-editor" onSubmit={upload}>
        <label>{s("Part of the lesson", "পাঠের অংশ")}
          <select value={slot} onChange={(event) => setSlot(event.target.value)}>{audioSlots.map((value) => <option key={value} value={value}>{slotLabel(value, language)}</option>)}</select>
        </label>
        <label>{s("Speaker name (for the credit)", "বক্তার নাম (কৃতজ্ঞতার জন্য)")}<input required maxLength={80} value={speakerName} onChange={(event) => setSpeakerName(event.target.value)} /></label>
        <label>{s("Dialect or way of speaking", "উপভাষা বা বলার ধরন")}<input required maxLength={80} value={dialect} onChange={(event) => setDialect(event.target.value)} /></label>
        <label>{s("Audio file (MP3, WAV, OGG, M4A or WebM, up to 12 MB)", "অডিও ফাইল (MP3, WAV, OGG, M4A বা WebM, সর্বোচ্চ ১২ MB)")}<input key={fileKey} required type="file" accept="audio/*" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
        <label className="topic-confirm"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /> {s("The speaker (and a guardian, for a child) agreed to this use and credit.", "বক্তা (শিশু হলে অভিভাবকও) এই ব্যবহার ও নাম উল্লেখে সম্মতি দিয়েছেন।")}</label>
        <div className="access-actions"><button type="submit" className="outline-button" disabled={saving}>{saving ? s("Uploading…", "আপলোড হচ্ছে…") : s("Upload for review", "পর্যালোচনার জন্য আপলোড")}</button></div>
        {done && <p className="teach-message" role="status">{s("Uploaded. It waits for review; any teacher or administrator can play and approve it.", "আপলোড হয়েছে। এটি পর্যালোচনার অপেক্ষায়; যেকোনো শিক্ষক বা প্রশাসক শুনে অনুমোদন দিতে পারবেন।")}</p>}
        {error && <p className="auth-error" role="alert">{error[language]}</p>}
      </form>
    </details>
  );
}

/**
 * The shared video check: the newest check from any staff member decides what
 * learners get. A video marked unsuitable, to be replaced or unavailable is taken
 * out of the lesson; a YouTube replacement link is shown instead when given.
 */
export function VideoCheck({ lessonId, language, check, learnerVideo, onChanged }: {
  lessonId: string; language: Language; check: VideoCheckRecord | null; learnerVideo: LearnerVideo | null; onChanged: () => void;
}) {
  const s = (en: string, bn: string) => (language === "bn" ? bn : en);
  const lesson = lessons.find((item) => item.id === lessonId)!;
  const [status, setStatus] = useState(check?.status ?? "pending");
  const [captions, setCaptions] = useState(check?.captionsStatus ?? "unchecked");
  const [suitability, setSuitability] = useState(check?.suitabilityStatus ?? "unchecked");
  const [replacement, setReplacement] = useState(check?.replacementUrl ?? "");
  const [notes, setNotes] = useState(check?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Bilingual | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true); setError(null); setSaved(false);
    try {
      await call("/api/studio/video-reviews", { method: "POST", body: JSON.stringify({ lessonId, status, captionsStatus: captions, suitabilityStatus: suitability, replacementUrl: replacement, notes }) });
      setSaved(true);
      onChanged();
    } catch (caught) { setError(failure(caught)); }
    finally { setSaving(false); }
  }

  const select = (label: string, value: string, set: (value: string) => void, options: Record<string, Bilingual>) => (
    <label>{label}<select value={value} onChange={(event) => set(event.target.value)}>{Object.keys(options).map((key) => <option key={key} value={key}>{optionLabel(options, key, language)}</option>)}</select></label>
  );
  const effect = learnerVideo === null
    ? s("Learners do not see this video, and no replacement is set.", "শিক্ষার্থীরা এই ভিডিও দেখে না, এবং কোনো বিকল্প ঠিক করা নেই।")
    : learnerVideo.replaced
      ? s("Learners do not see this video; they see the replacement linked below.", "শিক্ষার্থীরা এই ভিডিও দেখে না; তারা নিচের লিংকের বিকল্প ভিডিও দেখে।")
      : s("Learners see this video.", "শিক্ষার্থীরা এই ভিডিও দেখে।");

  return (
    <section className="teach-panel" aria-label={s("Video check", "ভিডিও যাচাই")}>
      <h3>{s("Video check", "ভিডিও যাচাই")}</h3>
      <p><strong>{lesson.video.title}</strong> · {lesson.video.channel} · {lesson.video.duration} · <a href={`https://www.youtube.com/watch?v=${lesson.video.id}`} target="_blank" rel="noreferrer">{s("Watch on YouTube ↗", "YouTube-এ দেখুন ↗")}</a></p>
      <p className="teach-note">{check
        ? s(`Last checked by ${check.checkerName ?? formerStaff.en}, ${formatWhen(check.checkedAt, language)}.`, `সর্বশেষ যাচাই করেছেন ${check.checkerName ?? formerStaff.bn}, ${formatWhen(check.checkedAt, language)}।`)
        : s("Nobody has checked this video yet.", "এই ভিডিও এখনো কেউ যাচাই করেননি।")} <strong>{effect}</strong></p>
      <div className="portal-editor">
        <div className="topic-editor-row">
          {select(s("Decision", "সিদ্ধান্ত"), status, setStatus, videoStatuses)}
          {select(s("Captions", "ক্যাপশন"), captions, setCaptions, captionStatuses)}
          {select(s("Suitable for children?", "শিশুদের জন্য উপযুক্ত?"), suitability, setSuitability, suitabilityStatuses)}
        </div>
        <label>{s("Replacement YouTube link (used when this video is taken down)", "বিকল্প YouTube লিংক (এই ভিডিও সরানো হলে দেখানো হবে)")}
          <input type="url" maxLength={400} value={replacement} onChange={(event) => setReplacement(event.target.value)} placeholder="https://www.youtube.com/watch?v=…" />
        </label>
        <label>{s("Notes", "নোট")}<textarea rows={3} maxLength={1500} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
        <p className="teach-note">{s("Choosing “Replace this video”, “Unavailable on YouTube” or “Unsuitable for children” takes the video out of the lesson for learners.", "“ভিডিওটি বদলাতে হবে”, “YouTube-এ পাওয়া যায় না” বা “শিশুদের জন্য উপযুক্ত নয়” বেছে নিলে শিক্ষার্থীদের পাঠ থেকে ভিডিওটি সরে যাবে।")}</p>
        <div className="access-actions"><button type="button" className="outline-button" disabled={saving} onClick={() => void save()}>{s("Save video check", "ভিডিও যাচাই সংরক্ষণ")}</button></div>
        {saved && <p className="teach-message" role="status">{s("Video check saved.", "ভিডিও যাচাই সংরক্ষিত হয়েছে।")}</p>}
        {error && <p className="auth-error" role="alert">{error[language]}</p>}
      </div>
    </section>
  );
}
