"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { localDateKey } from "@/lib/attendance";
import type { AttendanceSheet } from "@/lib/class-attendance";
import { localDate, localDateTime, localMessage, localNumber, type Language } from "@/lib/use-language";
import { useLeaveGuard } from "./leave-guard";

const loadFailed: [string, string] = ["Attendance could not be loaded. Please try again.", "উপস্থিতি লোড করা যায়নি। আবার চেষ্টা করুন।"];
const saveFailed: [string, string] = ["Attendance was not saved. Please try again.", "উপস্থিতি সংরক্ষণ হয়নি। আবার চেষ্টা করুন।"];
const discardQuestion = (language: Language) => language === "bn"
  ? "এই উপস্থিতির পরিবর্তনগুলো এখনও সংরক্ষণ করা হয়নি। পরিবর্তনগুলো বাদ দেবেন?"
  : "These attendance changes are not saved yet. Discard them?";

/** Asked before anything would throw away attendance ticks that are not saved yet. */
export function confirmDiscardAttendance(language: Language = "en"): boolean {
  return window.confirm(discardQuestion(language));
}

/** Present, absent, or null: not recorded (a student added to the class after a saved session). */
type Mark = boolean | null;
type Marks = Map<string, Mark>;

/** The marks a sheet opens with; after a reload, the teacher's own ticks for students still listed. */
function startingMarks(sheet: AttendanceSheet, keep?: Marks): Marks {
  return new Map(sheet.students.map((student) => {
    const kept = keep?.get(student.studentId);
    return [student.studentId, kept === undefined || kept === null ? student.present : kept];
  }));
}

/**
 * Take attendance for one class session: everyone now in the class is ticked present, the teacher
 * unticks who is absent and saves. Opening a saved date shows what was saved and by whom; a student
 * added to the class after that date is shown as not recorded and is saved only if the teacher adds
 * them. Each student shows how many recorded sessions they attended, and past sessions can be
 * reopened. Unsaved ticks are reported through onDirtyChange and are not dropped without asking.
 */
export default function ClassAttendance({ classId, language, onSaved, onDirtyChange }: { classId: string; language: Language; onSaved?: () => void; onDirtyChange?: (dirty: boolean) => void }) {
  const s = (en: string, bn: string) => language === "bn" ? bn : en;
  const number = (value: number) => localNumber(value, language);
  const [today] = useState(() => localDateKey());
  const [date, setDate] = useState(today);
  const [sheet, setSheet] = useState<AttendanceSheet | null>(null);
  const [marks, setMarks] = useState<Marks>(new Map());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // The server's answer and a fallback, worded in the page language when shown.
  const [error, setError] = useState<{ data?: unknown; fallback: [string, string] } | null>(null);
  // The class list changed after the sheet loaded, so the save was refused: offer to reload it.
  const [stale, setStale] = useState(false);
  const [message, setMessage] = useState("");
  // Ignore a slow answer for a date the teacher has already moved away from.
  const latest = useRef("");

  const load = useCallback(async (day: string, keep?: Marks) => {
    latest.current = day;
    setLoading(true);
    try {
      const response = await fetch(`/api/classes/${classId}/attendance?${new URLSearchParams({ date: day })}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (latest.current !== day) return false;
      if (!response.ok) { setSheet(null); setError({ data, fallback: loadFailed }); return false; }
      setSheet(data); setError(null); setStale(false);
      setMarks(startingMarks(data as AttendanceSheet, keep));
      return true;
    } catch {
      if (latest.current === day) { setSheet(null); setError({ fallback: loadFailed }); }
      return false;
    } finally { if (latest.current === day) setLoading(false); }
  }, [classId]);
  useEffect(() => { const timer = setTimeout(() => void load(date), 0); return () => clearTimeout(timer); }, [load, date]);

  const students = useMemo(() => sheet?.students ?? [], [sheet]);
  const initial = useMemo(() => new Map(students.map((student) => [student.studentId, student.present])), [students]);
  const markOf = (studentId: string): Mark => {
    const mark = marks.get(studentId);
    return mark === undefined ? initial.get(studentId) ?? null : mark;
  };
  const dirty = students.some((student) => markOf(student.studentId) !== initial.get(student.studentId));
  useLeaveGuard(dirty, discardQuestion(language), onDirtyChange);
  const setMark = (studentId: string, mark: Mark) => setMarks((current) => new Map(current).set(studentId, mark));

  function openDate(day: string) {
    if (day === date || (dirty && !confirmDiscardAttendance(language))) return;
    setDate(day); setSheet(null); setMarks(new Map()); setError(null); setStale(false); setMessage("");
  }

  async function save() {
    if (!sheet || busy) return;
    const marked = sheet.students.flatMap((student) => {
      const mark = markOf(student.studentId);
      return mark === null ? [] : [{ studentId: student.studentId, present: mark }];
    });
    if (!marked.length) return;
    setBusy(true); setError(null); setStale(false); setMessage("");
    try {
      const response = await fetch(`/api/classes/${classId}/attendance`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: sheet.date, marks: marked }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError({ data, fallback: saveFailed }); setStale(response.status === 409); return; }
      setMessage(s(`Attendance saved for ${localDate(sheet.date, language)}: ${data.present} of ${data.saved} present.`, `${localDate(sheet.date, language)}-এর উপস্থিতি সংরক্ষিত হয়েছে: ${number(data.saved)} জনের মধ্যে ${number(data.present)} জন উপস্থিত।`));
      await load(sheet.date);
      onSaved?.();
    } catch { setError({ fallback: saveFailed }); }
    finally { setBusy(false); }
  }

  /** After a refused save: fetch the class list again, keeping the ticks of students still in it. */
  async function reload() {
    if (!sheet || busy) return;
    setBusy(true);
    try {
      if (await load(sheet.date, marks)) setMessage(s("The class list has been updated. Your ticks are kept for students still in the class. Check the list and save again.", "ক্লাসের তালিকা হালনাগাদ হয়েছে। যারা এখনও ক্লাসে আছে তাদের টিক রাখা আছে। তালিকা দেখে আবার সংরক্ষণ করুন।"));
    } finally { setBusy(false); }
  }

  const recorded = students.filter((student) => markOf(student.studentId) !== null);
  const presentCount = recorded.filter((student) => markOf(student.studentId)).length;
  const unrecorded = students.length - recorded.length;
  const dayLabel = localDate(date, language);
  return <section className="teach-panel" aria-label={s("Attendance", "উপস্থিতি")}>
    <p>{s("Everyone starts ticked as present. Untick the students who are absent, then save. You can open a saved date again to correct it.", "সবাই শুরুতে উপস্থিত হিসেবে টিক দেওয়া থাকে। যারা অনুপস্থিত তাদের টিক তুলে দিন, তারপর সংরক্ষণ করুন। ভুল ঠিক করতে সংরক্ষিত তারিখ আবার খুলতে পারেন।")}</p>
    <label className="attendance-date">{s("Class date", "ক্লাসের তারিখ")}<input type="date" value={date} max={today} required onChange={(event) => { if (event.target.value) openDate(event.target.value); }} /></label>
    {error && <div className="attendance-error">
      <p role="alert" className="auth-error">{localMessage(error.data as Parameters<typeof localMessage>[0], language, error.fallback)}</p>
      {stale && sheet && <button type="button" className="outline-button" disabled={busy} onClick={() => void reload()}>{s("Reload the list", "তালিকা আবার লোড করুন")}</button>}
    </div>}
    {message && <p role="status" className="teach-message">{message}</p>}
    {loading && !sheet ? <p role="status">{s("Loading attendance…", "উপস্থিতি লোড হচ্ছে…")}</p> : sheet && <>
      <p className="attendance-saved">{sheet.saved
        ? s(`Last saved by ${sheet.saved.recordedBy ?? "a former staff member"} at ${localDateTime(sheet.saved.recordedAt, language)}.`, `সর্বশেষ সংরক্ষণ করেছেন ${sheet.saved.recordedBy ?? "একজন সাবেক কর্মী"}, ${localDateTime(sheet.saved.recordedAt, language)}।`)
        : s(`Not saved yet for ${localDate(sheet.date, language)}.`, `${localDate(sheet.date, language)}-এর উপস্থিতি এখনও সংরক্ষণ করা হয়নি।`)}</p>
      {students.length === 0 ? <p className="teach-empty">{s("No students in this class yet. Add students in the Students section first.", "এই ক্লাসে এখনও কোনো শিক্ষার্থী নেই। আগে শিক্ষার্থী অংশে শিক্ষার্থী যোগ করুন।")}</p> : <>
        {sheet.saved && students.some((student) => !student.saved) && <p className="attendance-note">{s("Students added to the class after this date have no mark for it. Record one only if they were at this class.", "এই তারিখের পরে যারা ক্লাসে যোগ হয়েছে, তাদের এই দিনের উপস্থিতি নেই। তারা এই ক্লাসে থাকলে তবেই যোগ করুন।")}</p>}
        <fieldset className="attendance-sheet" disabled={busy}>
          <legend>{s(`Present on ${dayLabel}`, `${dayLabel}-এ উপস্থিত`)}</legend>
          <ul className="attendance-list">{students.map((student) => {
            const mark = markOf(student.studentId);
            const name = <span><strong>{student.displayName}</strong>{student.username && <small>{student.username}</small>}</span>;
            // On a saved date, a student without a mark joined the class later: recorded only if added.
            const optional = Boolean(sheet.saved) && !student.saved;
            return <li key={student.studentId} className={mark === null ? "attendance-unrecorded" : undefined}>
              {mark === null ? <div className="attendance-student">{name}</div>
                : <label><input type="checkbox" checked={mark} onChange={(event) => setMark(student.studentId, event.target.checked)} />{name}</label>}
              {optional && (mark === null
                ? <span className="attendance-optional"><small>{s("Not recorded for this date", "এই তারিখে উপস্থিতি নেওয়া হয়নি")}</small>
                  <button type="button" className="text-button" onClick={() => setMark(student.studentId, true)}>{s("Record for this date", "এই তারিখে যোগ করুন")}<span className="sr-only"> {student.displayName}</span></button></span>
                : <button type="button" className="text-button" onClick={() => setMark(student.studentId, null)}>{s("Leave out", "বাদ রাখুন")}<span className="sr-only"> {student.displayName}</span></button>)}
              <small className="attendance-total">{student.attendance.recorded
                ? s(`Attended ${student.attendance.attended} of ${student.attendance.recorded} session${student.attendance.recorded === 1 ? "" : "s"}`, `${number(student.attendance.recorded)}টি ক্লাসের মধ্যে ${number(student.attendance.attended)}টিতে উপস্থিত`)
                : s("No sessions recorded yet", "এখনও কোনো ক্লাসের উপস্থিতি নেওয়া হয়নি")}</small>
            </li>;
          })}</ul>
        </fieldset>
        <div className="attendance-actions">
          <p>{s(`${presentCount} of ${recorded.length} present`, `${number(recorded.length)} জনের মধ্যে ${number(presentCount)} জন উপস্থিত`)}
            {unrecorded > 0 && s(` · ${unrecorded} not recorded`, ` · ${number(unrecorded)} জনের উপস্থিতি নেওয়া হয়নি`)}
            {dirty && <small className="attendance-unsaved">{s("Changes not saved yet", "পরিবর্তন এখনও সংরক্ষণ করা হয়নি")}</small>}</p>
          <button type="button" className="primary-button" disabled={busy || loading || recorded.length === 0} onClick={() => void save()}>{busy ? s("Saving…", "সংরক্ষণ হচ্ছে…") : s(`Save attendance for ${dayLabel}`, `${dayLabel}-এর উপস্থিতি সংরক্ষণ করুন`)}</button>
        </div>
      </>}
      <h3>{s("Past sessions", "আগের ক্লাসগুলো")}</h3>
      {sheet.sessions.length === 0 ? <p className="teach-empty">{s("No attendance saved for this class yet.", "এই ক্লাসের কোনো উপস্থিতি এখনও সংরক্ষণ করা হয়নি।")}</p>
        : <div className="management-table-wrap"><table className="teach-submissions">
          <caption className="sr-only">{s("Attendance by session", "ক্লাস অনুযায়ী উপস্থিতি")}</caption>
          <thead><tr><th scope="col">{s("Date", "তারিখ")}</th><th scope="col">{s("Present", "উপস্থিত")}</th><th scope="col"><span className="sr-only">{s("Open", "খুলুন")}</span></th></tr></thead>
          <tbody>{sheet.sessions.map((session) => <tr key={session.date} aria-current={session.date === date ? "date" : undefined}>
            <td>{localDate(session.date, language)}</td>
            <td>{s(`${session.present} of ${session.marked}`, `${number(session.marked)} জনের মধ্যে ${number(session.present)} জন`)}</td>
            <td>{session.date !== date && <button type="button" className="text-button" onClick={() => openDate(session.date)}>{s("Open", "খুলুন")}<span className="sr-only"> {localDate(session.date, language)}</span></button>}</td>
          </tr>)}</tbody>
        </table></div>}
    </>}
  </section>;
}
