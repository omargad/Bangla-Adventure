"use client";
import { useEffect, useRef, useState } from "react";
import PortalShell from "@/app/components/PortalShell";
import Gradebook from "@/app/components/Gradebook";
import type { Gradebook as GradebookData } from "@/lib/gradebook";
import { localDateTime, localNumber, useLanguage } from "@/lib/use-language";

type ClassResults = {
  id: string;
  name: string;
  teacherName: string;
  teacherEmail: string;
  studentCount: number;
  activityCount: number;
  submissionCount: number;
  averagePercent: number | null;
  attendancePercent: number | null;
};

type ResultRow = {
  submissionId: string;
  activityTitle: string;
  studentName: string;
  score: number;
  total: number;
  percent: number;
  submittedAt: string;
};

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "The request could not be completed. Please try again.");
  return data as T;
}

const byActivityThenStudent = (a: ResultRow, b: ResultRow) => a.activityTitle.localeCompare(b.activityTitle) || a.studentName.localeCompare(b.studentName);

export default function AdminResults({ name }: { name: string }) {
  const [language, toggleLanguage] = useLanguage();
  const s = (en: string, bn: string) => language === "bn" ? bn : en;
  const number = (value: number) => localNumber(value, language);
  const percent = (value: number | null) => value === null ? "—" : `${number(value)}%`;
  const [classes, setClasses] = useState<ClassResults[] | null>(null);
  const [gradebook, setGradebook] = useState<GradebookData | null>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [rows, setRows] = useState<ResultRow[] | null>(null);
  const [loadingRows, setLoadingRows] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  // Ignore a slow response for a class the administrator has already moved away from.
  const latestClass = useRef("");
  const resultsHeading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const selected = classes?.find((item) => item.id === selectedId);
  const search = query.trim().toLowerCase();
  const visible = (classes ?? []).filter((item) => !search || [item.name, item.teacherName, item.teacherEmail].some((value) => value.toLowerCase().includes(search)));

  useEffect(() => {
    const controller = new AbortController();
    requestJson<{ classes: ClassResults[] }>("/api/admin/results", { signal: controller.signal })
      .then((data) => setClasses(data.classes))
      .catch((error) => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, []);

  // The results panel opens below a possibly long table: take keyboard and screen-reader focus to it.
  useEffect(() => { if (selectedId) resultsHeading.current?.focus(); }, [selectedId]);

  async function loadRows(classId: string) {
    latestClass.current = classId;
    setLoadingRows(true);
    try {
      const data = await requestJson<{ rows: ResultRow[]; gradebook: GradebookData }>(`/api/classes/${classId}/grades`);
      if (latestClass.current === classId) { setRows([...data.rows].sort(byActivityThenStudent)); setGradebook(data.gradebook); }
    } catch (error) {
      if (latestClass.current === classId) setError(error instanceof Error ? error.message : "Could not load the class results.");
    } finally {
      if (latestClass.current === classId) setLoadingRows(false);
    }
  }

  function openClass(classId: string) {
    setSelectedId(classId); setRows(null); setGradebook(null); setError(""); setNotice("");
    void loadRows(classId);
  }

  function closeClass() {
    latestClass.current = "";
    setSelectedId(""); setRows(null); setGradebook(null); setLoadingRows(false); setNotice("");
    opener.current?.focus();
  }

  async function reset(row: ResultRow) {
    if (!selected || busy) return;
    if (!window.confirm(s(
      `Reset ${row.studentName}'s submission for "${row.activityTitle}"? The score is deleted and the student can submit again.`,
      `"${row.activityTitle}"-এ ${row.studentName}-এর জমা রিসেট করবেন? স্কোর মুছে যাবে এবং শিক্ষার্থী আবার জমা দিতে পারবে।`,
    ))) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await requestJson(`/api/classes/${selected.id}/submissions`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ submissionId: row.submissionId }) });
      setNotice(s("Submission reset. The student can submit the activity again.", "জমা রিসেট হয়েছে। শিক্ষার্থী আবার কার্যক্রমটি জমা দিতে পারবে।"));
      await loadRows(selected.id);
      setClasses((await requestJson<{ classes: ClassResults[] }>("/api/admin/results")).classes);
    } catch (error) { setError(error instanceof Error ? error.message : "The submission could not be reset. Please try again."); }
    finally { setBusy(false); }
  }

  return <PortalShell role="admin" name={name} active="results" language={language} toggleLanguage={toggleLanguage}>
    <h1>{s("Grades & results", "গ্রেড ও ফলাফল")}</h1>
    <p>{s(
      "Review results and attendance in every class, download a class's grades as CSV and reset a submission so the student can try again. Administrator resets are recorded in the access log.",
      "সব ক্লাসের ফলাফল ও উপস্থিতি দেখুন, কোনো ক্লাসের গ্রেড CSV হিসেবে নামান এবং শিক্ষার্থী যেন আবার চেষ্টা করতে পারে সে জন্য জমা রিসেট করুন। প্রশাসকের রিসেট প্রবেশাধিকারের লগে সংরক্ষিত হয়।",
    )}</p>
    {error && <p role="alert" className="auth-error">{error}</p>}
    {notice && <p role="status" className="teach-message">{notice}</p>}
    <section className="teach-panel" aria-labelledby="all-classes-heading">
      <h2 id="all-classes-heading">{s("All classes", "সব ক্লাস")}</h2>
      <div className="management-toolbar"><div className="management-search">
        <label className="sr-only" htmlFor="results-search">{s("Search classes", "ক্লাস খুঁজুন")}</label>
        <input id="results-search" type="search" value={query} maxLength={120} onChange={(event) => setQuery(event.target.value)} placeholder={s("Search by class or teacher…", "ক্লাস বা শিক্ষকের নাম দিয়ে খুঁজুন…")} />
      </div></div>
      {classes === null ? !error && <p role="status">{s("Loading classes…", "ক্লাস লোড হচ্ছে…")}</p>
        : classes.length === 0 ? <p className="teach-empty">{s("No classes yet. Teachers create classes from their workspace.", "এখনো কোনো ক্লাস নেই। শিক্ষকেরা তাঁদের কর্মক্ষেত্র থেকে ক্লাস তৈরি করেন।")}</p>
        : visible.length === 0 ? <p className="teach-empty">{s("No classes match this search.", "এই খোঁজে কোনো ক্লাস মেলেনি।")}</p>
        : <div className="management-table-wrap"><table className="management-table">
          <caption className="sr-only">{s("Results by class", "ক্লাস অনুযায়ী ফলাফল")}</caption>
          <thead><tr><th scope="col">{s("Class", "ক্লাস")}</th><th scope="col">{s("Teacher", "শিক্ষক")}</th><th scope="col">{s("Students", "শিক্ষার্থী")}</th><th scope="col">{s("Submissions", "জমা")}</th><th scope="col">{s("Average", "গড়")}</th><th scope="col">{s("Attendance", "উপস্থিতি")}</th><th scope="col">{s("Actions", "করণীয়")}</th></tr></thead>
          <tbody>{visible.map((item) => <tr key={item.id}>
            <td><strong>{item.name}</strong><small>{number(item.activityCount)} {s("activities", "কার্যক্রম")}</small></td>
            <td><strong>{item.teacherName}</strong><small>{item.teacherEmail}</small></td>
            <td>{number(item.studentCount)}</td>
            <td>{number(item.submissionCount)}</td>
            <td>{percent(item.averagePercent)}</td>
            <td>{item.attendancePercent === null ? "—" : s(`${number(item.attendancePercent)}% present`, `${number(item.attendancePercent)}% উপস্থিত`)}</td>
            <td><div className="management-row-actions"><button type="button" className="outline-button" aria-expanded={item.id === selectedId} aria-controls={item.id === selectedId ? "class-results" : undefined} aria-label={`${s("View results", "ফলাফল দেখুন")}: ${item.name}`} onClick={(event) => { opener.current = event.currentTarget; if (item.id === selectedId) closeClass(); else openClass(item.id); }}>{s("View results", "ফলাফল দেখুন")}</button></div></td>
          </tr>)}</tbody>
        </table></div>}
    </section>
    {selected && <section id="class-results" className="teach-panel" aria-labelledby="class-results-heading">
      <h2 id="class-results-heading" ref={resultsHeading} tabIndex={-1}>{s("Results", "ফলাফল")}: {selected.name}</h2>
      <p>{s("Teacher", "শিক্ষক")}: {selected.teacherName} · {number(selected.studentCount)} {s("students", "শিক্ষার্থী")} · {s("Average", "গড়")}: {percent(selected.averagePercent)}</p>
      <div className="grade-tools">
        <a className="outline-button" href={`/api/classes/${selected.id}/grades?format=csv`}>{s("Download CSV", "CSV নামান")}</a>
        <button type="button" className="text-button" onClick={closeClass}>{s("Close", "বন্ধ করুন")}</button>
      </div>
      {gradebook && <><h3>{s("Gradebook and attendance", "গ্রেডবুক ও উপস্থিতি")}</h3><Gradebook gradebook={gradebook} language={language} /><h3>{s("Submissions", "জমা")}</h3></>}
      {loadingRows && rows === null ? <p role="status">{s("Loading results…", "ফলাফল লোড হচ্ছে…")}</p>
        : rows && (rows.length === 0 ? <p className="teach-empty">{s("No submissions yet.", "এখনো কোনো জমা নেই।")}</p>
        : <div className="management-table-wrap"><table className="management-table">
          <caption className="sr-only">{s("Submissions in this class", "এই ক্লাসের জমা")}</caption>
          <thead><tr><th scope="col">{s("Student", "শিক্ষার্থী")}</th><th scope="col">{s("Activity", "কার্যক্রম")}</th><th scope="col">{s("Score", "স্কোর")}</th><th scope="col">{s("Submitted", "জমার সময়")}</th><th scope="col">{s("Manage", "পরিচালনা")}</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.submissionId}>
            <td><strong>{row.studentName}</strong></td>
            <td>{row.activityTitle}</td>
            <td>{number(row.score)}/{number(row.total)}<small>{number(row.percent)}%</small></td>
            <td>{localDateTime(row.submittedAt, language)}</td>
            <td><button type="button" className="text-button danger" disabled={busy} onClick={() => void reset(row)}>{s("Reset", "রিসেট")}</button></td>
          </tr>)}</tbody>
        </table></div>)}
    </section>}
  </PortalShell>;
}
