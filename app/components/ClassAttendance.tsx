"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { localDateKey } from "@/lib/attendance";
import type { AttendanceSheet } from "@/lib/class-attendance";
import { localDate, localDateTime, localMessage, localNumber, type Language } from "@/lib/use-language";

const loadFailed: [string, string] = ["Attendance could not be loaded. Please try again.", "উপস্থিতি লোড করা যায়নি। আবার চেষ্টা করুন।"];
const saveFailed: [string, string] = ["Attendance was not saved. Please try again.", "উপস্থিতি সংরক্ষণ হয়নি। আবার চেষ্টা করুন।"];

/**
 * Take attendance for one class session: everyone now in the class is ticked present, the teacher
 * unticks who is absent and saves. Opening a saved date shows what was saved and by whom; each
 * student shows how many recorded sessions they attended, and past sessions can be reopened.
 */
export default function ClassAttendance({ classId, language, onSaved }: { classId: string; language: Language; onSaved?: () => void }) {
  const s = (en: string, bn: string) => language === "bn" ? bn : en;
  const number = (value: number) => localNumber(value, language);
  const [today] = useState(() => localDateKey());
  const [date, setDate] = useState(today);
  const [sheet, setSheet] = useState<AttendanceSheet | null>(null);
  const [present, setPresent] = useState<Map<string, boolean>>(new Map());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // The server's answer and a fallback, worded in the page language when shown.
  const [error, setError] = useState<{ data?: unknown; fallback: [string, string] } | null>(null);
  const [message, setMessage] = useState("");
  // Ignore a slow answer for a date the teacher has already moved away from.
  const latest = useRef("");

  const load = useCallback(async (day: string) => {
    latest.current = day;
    setLoading(true);
    try {
      const response = await fetch(`/api/classes/${classId}/attendance?${new URLSearchParams({ date: day })}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (latest.current !== day) return;
      if (!response.ok) { setSheet(null); setError({ data, fallback: loadFailed }); return; }
      setSheet(data); setError(null);
      setPresent(new Map((data as AttendanceSheet).students.map((student) => [student.studentId, student.present])));
    } catch {
      if (latest.current === day) { setSheet(null); setError({ fallback: loadFailed }); }
    } finally { if (latest.current === day) setLoading(false); }
  }, [classId]);
  useEffect(() => { const timer = setTimeout(() => void load(date), 0); return () => clearTimeout(timer); }, [load, date]);

  async function save() {
    if (!sheet || busy || !sheet.students.length) return;
    setBusy(true); setError(null); setMessage("");
    try {
      const marks = sheet.students.map((student) => ({ studentId: student.studentId, present: present.get(student.studentId) ?? true }));
      const response = await fetch(`/api/classes/${classId}/attendance`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: sheet.date, marks }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError({ data, fallback: saveFailed }); return; }
      setMessage(s(`Attendance saved for ${localDate(sheet.date, language)}: ${data.present} of ${data.saved} present.`, `${localDate(sheet.date, language)}-এর উপস্থিতি সংরক্ষিত হয়েছে: ${number(data.saved)} জনের মধ্যে ${number(data.present)} জন উপস্থিত।`));
      await load(sheet.date);
      onSaved?.();
    } catch { setError({ fallback: saveFailed }); }
    finally { setBusy(false); }
  }

  const students = sheet?.students ?? [];
  const presentCount = students.filter((student) => present.get(student.studentId) ?? true).length;
  const dayLabel = localDate(date, language);
  return <section className="teach-panel" aria-label={s("Attendance", "উপস্থিতি")}>
    <h3>{s("Attendance", "উপস্থিতি")}</h3>
    <p>{s("Everyone starts ticked as present. Untick the students who are absent, then save. You can open a saved date again to correct it.", "সবাই শুরুতে উপস্থিত হিসেবে টিক দেওয়া থাকে। যারা অনুপস্থিত তাদের টিক তুলে দিন, তারপর সংরক্ষণ করুন। ভুল ঠিক করতে সংরক্ষিত তারিখ আবার খুলতে পারেন।")}</p>
    <label className="attendance-date">{s("Class date", "ক্লাসের তারিখ")}<input type="date" value={date} max={today} required onChange={(event) => { if (event.target.value) { setDate(event.target.value); setMessage(""); } }} /></label>
    {error && <p role="alert" className="auth-error">{localMessage(error.data as Parameters<typeof localMessage>[0], language, error.fallback)}</p>}
    {message && <p role="status" className="teach-message">{message}</p>}
    {loading && !sheet ? <p role="status">{s("Loading attendance…", "উপস্থিতি লোড হচ্ছে…")}</p> : sheet && <>
      <p className="attendance-saved">{sheet.saved
        ? s(`Last saved by ${sheet.saved.recordedBy ?? "a former staff member"} at ${localDateTime(sheet.saved.recordedAt, language)}.`, `সর্বশেষ সংরক্ষণ করেছেন ${sheet.saved.recordedBy ?? "একজন সাবেক কর্মী"}, ${localDateTime(sheet.saved.recordedAt, language)}।`)
        : s(`Not saved yet for ${localDate(sheet.date, language)}.`, `${localDate(sheet.date, language)}-এর উপস্থিতি এখনও সংরক্ষণ করা হয়নি।`)}</p>
      {students.length === 0 ? <p className="teach-empty">{s("No students in this class yet. Add students in the Students section first.", "এই ক্লাসে এখনও কোনো শিক্ষার্থী নেই। আগে শিক্ষার্থী অংশে শিক্ষার্থী যোগ করুন।")}</p> : <>
        <fieldset className="attendance-sheet" disabled={busy}>
          <legend>{s(`Present on ${dayLabel}`, `${dayLabel}-এ উপস্থিত`)}</legend>
          <ul className="attendance-list">{students.map((student) => <li key={student.studentId}>
            <label><input type="checkbox" checked={present.get(student.studentId) ?? true} onChange={(event) => setPresent((current) => new Map(current).set(student.studentId, event.target.checked))} />
              <span><strong>{student.displayName}</strong>{student.username && <small>{student.username}</small>}</span></label>
            <small className="attendance-total">{student.attendance.recorded
              ? s(`Attended ${student.attendance.attended} of ${student.attendance.recorded} session${student.attendance.recorded === 1 ? "" : "s"}`, `${number(student.attendance.recorded)}টি ক্লাসের মধ্যে ${number(student.attendance.attended)}টিতে উপস্থিত`)
              : s("No sessions recorded yet", "এখনও কোনো ক্লাসের উপস্থিতি নেওয়া হয়নি")}</small>
          </li>)}</ul>
        </fieldset>
        <div className="attendance-actions">
          <p>{s(`${presentCount} of ${students.length} present`, `${number(students.length)} জনের মধ্যে ${number(presentCount)} জন উপস্থিত`)}</p>
          <button type="button" className="primary-button" disabled={busy || loading} onClick={() => void save()}>{busy ? s("Saving…", "সংরক্ষণ হচ্ছে…") : s(`Save attendance for ${dayLabel}`, `${dayLabel}-এর উপস্থিতি সংরক্ষণ করুন`)}</button>
        </div>
      </>}
      <h4>{s("Past sessions", "আগের ক্লাসগুলো")}</h4>
      {sheet.sessions.length === 0 ? <p className="teach-empty">{s("No attendance saved for this class yet.", "এই ক্লাসের কোনো উপস্থিতি এখনও সংরক্ষণ করা হয়নি।")}</p>
        : <div className="management-table-wrap"><table className="teach-submissions">
          <caption className="sr-only">{s("Attendance by session", "ক্লাস অনুযায়ী উপস্থিতি")}</caption>
          <thead><tr><th scope="col">{s("Date", "তারিখ")}</th><th scope="col">{s("Present", "উপস্থিত")}</th><th scope="col"><span className="sr-only">{s("Open", "খুলুন")}</span></th></tr></thead>
          <tbody>{sheet.sessions.map((session) => <tr key={session.date} aria-current={session.date === date ? "date" : undefined}>
            <td>{localDate(session.date, language)}</td>
            <td>{s(`${session.present} of ${session.marked}`, `${number(session.marked)} জনের মধ্যে ${number(session.present)} জন`)}</td>
            <td>{session.date !== date && <button type="button" className="text-button" onClick={() => { setDate(session.date); setMessage(""); }}>{s("Open", "খুলুন")}<span className="sr-only"> {localDate(session.date, language)}</span></button>}</td>
          </tr>)}</tbody>
        </table></div>}
    </>}
  </section>;
}
