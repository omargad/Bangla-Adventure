"use client";
import { useCallback, useEffect, useState } from "react";
import type { Language } from "@/lib/use-language";
import StudentImport from "./StudentImport";
export default function ClassAllocation({ classId, language = "en", onChange, onPasswordsChange }: { classId: string; language?: Language; onChange?: () => void; onPasswordsChange?: (shown: boolean) => void }) {
  const s = (en: string, bn: string) => language === "bn" ? bn : en;
  const [students, setStudents] = useState<{ studentId: string; username: string; displayName: string; active: boolean }[]>([]);
  const [username, setUsername] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch(`/api/classes/${classId}/students`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    setStudents(data.students);
  }, [classId]);
  useEffect(() => { const timer = setTimeout(() => void load().catch((error) => setError(error.message)), 0); return () => clearTimeout(timer); }, [load]);
  async function save(studentId?: string) {
    if (busy) return;
    if (studentId && !window.confirm(s("Remove class access? Existing results will be retained.", "ক্লাসের প্রবেশাধিকার সরাবেন? ফলাফল থাকবে।"))) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/classes/${classId}/students`, { method: studentId ? "DELETE" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(studentId ? { studentId } : { username }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setUsername(""); await load(); onChange?.(); setMessage(s("Class allocation saved.", "ক্লাস বরাদ্দ সংরক্ষিত হয়েছে।"));
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save. Please retry."); }
    finally { setBusy(false); }
  }
  return <><section className="teach-panel"><h2>{s("Allocate students", "শিক্ষার্থী বরাদ্দ")}</h2><p>{s("Enter the registered student username. The class appears automatically on their dashboard; no code is needed.", "নিবন্ধিত ব্যবহারকারীর নাম দিন। ড্যাশবোর্ডে ক্লাস নিজেই দেখা যাবে; কোড লাগবে না।")}</p>
    <form className="teach-inline-form" onSubmit={(e) => { e.preventDefault(); void save(); }}><label>{s("Student username", "শিক্ষার্থীর ব্যবহারকারীর নাম")}<input required minLength={3} maxLength={40} pattern="[a-zA-Z0-9._-]+" value={username} onChange={(e) => setUsername(e.target.value)} /></label><button className="primary-button" disabled={busy}>{s("Allocate student", "শিক্ষার্থী বরাদ্দ করুন")}</button></form>
    {error && <p role="alert" className="auth-error">{error}</p>}{message && <p role="status" className="teach-message">{message}</p>}
    <ul className="family-link-list">{students.map((student) => <li key={student.studentId}><span><strong>{student.displayName}</strong> · {student.username} {!student.active && `(${s("Access removed", "প্রবেশ বন্ধ")})`}</span>{student.active && <button className="text-button" disabled={busy} onClick={() => void save(student.studentId)}>{s("Remove allocation", "বরাদ্দ সরান")}</button>}</li>)}</ul>
  </section>
  <StudentImport classId={classId} language={language} onPasswordsChange={onPasswordsChange} onImported={() => { void load().catch((error) => setError(error.message)); onChange?.(); }} /></>;
}
