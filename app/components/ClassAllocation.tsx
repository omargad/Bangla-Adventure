"use client";
import { useCallback, useEffect, useState } from "react";
import { localMessage, localNumber, type Language } from "@/lib/use-language";
import StudentImport from "./StudentImport";

/** A student now in the class; `studentId` and `username` are null for an old class-code learner. */
type Allocation = { id: string; studentId: string | null; username: string | null; displayName: string };
type Candidate = { id: string; username: string; displayName: string };
const searchFailed: [string, string] = ["Students could not be loaded.", "শিক্ষার্থীদের লোড করা যায়নি।"];

/**
 * A class's Students section: search every active, approved student by name or username, tick
 * them and add them in one go; the one list of students now in the class, where access can be
 * removed; or upload a CSV (StudentImport).
 */
export default function ClassAllocation({ classId, language = "en", headingLevel = 2, onChange, onPasswordsChange }: { classId: string; language?: Language; headingLevel?: 2 | 3; onChange?: () => void; onPasswordsChange?: (shown: boolean) => void }) {
  const s = (en: string, bn: string) => language === "bn" ? bn : en;
  // h2 panels on /admin/classes; h3 inside a class's Students section, which has its own h2.
  const [Heading, Subheading] = headingLevel === 3 ? ["h3", "h4"] as const : ["h2", "h3"] as const;
  const number = (value: number) => localNumber(value, language);
  const [students, setStudents] = useState<Allocation[]>([]);
  const [query, setQuery] = useState("");
  const [available, setAvailable] = useState<{ students: Candidate[]; more: boolean } | null>(null);
  const [searching, setSearching] = useState(false);
  // Kept apart from `error` so a later successful search clears it without hiding a failed save.
  const [searchError, setSearchError] = useState("");
  // Ticked students, kept while the teacher searches for more.
  const [selected, setSelected] = useState<Map<string, Candidate>>(new Map());
  const [refresh, setRefresh] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const failed: [string, string] = ["Could not save. Please retry.", "সংরক্ষণ করা যায়নি। আবার চেষ্টা করুন।"];
  const load = useCallback(async () => {
    const response = await fetch(`/api/classes/${classId}/students`, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(localMessage(data, language, ["The class list could not be loaded.", "ক্লাসের তালিকা লোড করা যায়নি।"]));
    setStudents(data.students);
  }, [classId, language]);
  useEffect(() => { const timer = setTimeout(() => void load().catch((error) => setError(error.message)), 0); return () => clearTimeout(timer); }, [load]);
  // Search as the teacher types, after a short pause; a newer search cancels the older one.
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(`/api/classes/${classId}/students?${new URLSearchParams({ available: "1", q: query.trim() })}`, { cache: "no-store", signal: controller.signal });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(localMessage(data, language, searchFailed));
        setAvailable({ students: data.students, more: data.more }); setSearchError("");
      } catch (error) { if (!controller.signal.aborted) setSearchError(error instanceof Error && error.name !== "TypeError" ? error.message : localMessage(null, language, searchFailed)); }
      finally { if (!controller.signal.aborted) setSearching(false); }
    }, query ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [classId, query, refresh, language]);
  function toggle(student: Candidate, checked: boolean) {
    setSelected((current) => { const next = new Map(current); if (checked) next.set(student.id, student); else next.delete(student.id); return next; });
  }
  function selectAllShown() {
    setSelected((current) => new Map([...current, ...(available?.students ?? []).map((student) => [student.id, student] as const)]));
  }
  async function send(method: "POST" | "DELETE", body: object) {
    const response = await fetch(`/api/classes/${classId}/students`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(localMessage(data, language, failed));
    return data;
  }
  async function addSelected() {
    if (busy || !selected.size) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const { allocated } = await send("POST", { studentIds: [...selected.keys()] });
      setSelected(new Map()); setRefresh((value) => value + 1);
      await load(); onChange?.();
      setMessage(s(`${allocated} student${allocated === 1 ? "" : "s"} added to this class.`, `${number(allocated)} জন শিক্ষার্থী এই ক্লাসে যোগ হয়েছে।`));
    } catch (error) { setError(error instanceof Error ? error.message : s(...failed)); setRefresh((value) => value + 1); }
    finally { setBusy(false); }
  }
  async function remove(student: Allocation) {
    if (busy || !student.studentId || !window.confirm(s(`Remove ${student.displayName} from this class? They leave the class list, results and attendance; their work is kept and comes back if they are added again.`, `${student.displayName}-কে এই ক্লাস থেকে সরাবেন? তাকে ক্লাসের তালিকা, ফলাফল ও উপস্থিতিতে আর দেখা যাবে না; তার কাজ সংরক্ষিত থাকবে এবং আবার যোগ করলে ফিরে আসবে।`))) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await send("DELETE", { studentId: student.studentId });
      setRefresh((value) => value + 1);
      await load(); onChange?.(); setMessage(s(`${student.displayName} was removed from this class.`, `${student.displayName}-কে এই ক্লাস থেকে সরানো হয়েছে।`));
    } catch (error) { setError(error instanceof Error ? error.message : s(...failed)); }
    finally { setBusy(false); }
  }
  const shown = available?.students ?? [];
  const allShownSelected = shown.length > 0 && shown.every((student) => selected.has(student.id));
  return <><section className="teach-panel" aria-label={s("Allocate students", "শিক্ষার্থী বরাদ্দ")}><Heading>{s("Allocate students", "শিক্ষার্থী বরাদ্দ")}</Heading>
    <p>{s("Find students by name or username, tick them and add them to this class. The class appears automatically on their dashboard; no code is needed.", "নাম বা ব্যবহারকারীর নাম দিয়ে শিক্ষার্থী খুঁজুন, টিক দিন এবং এই ক্লাসে যোগ করুন। ড্যাশবোর্ডে ক্লাস নিজেই দেখা যাবে; কোড লাগবে না।")}</p>
    <form className="teach-inline-form" role="search" onSubmit={(event) => event.preventDefault()}>
      <label>{s("Find students", "শিক্ষার্থী খুঁজুন")}<input type="search" value={query} maxLength={60} autoComplete="off" placeholder={s("Name or username", "নাম বা ব্যবহারকারীর নাম")} onChange={(event) => setQuery(event.target.value)} /></label>
    </form>
    <div className="allocation-picker">
      <div className="allocation-picker-actions">
        <button type="button" className="outline-button" disabled={busy || !shown.length || allShownSelected} onClick={selectAllShown}>{s("Select all shown", "দেখানো সবাইকে বাছাই")}</button>
        {selected.size > 0 && <button type="button" className="text-button" disabled={busy} onClick={() => setSelected(new Map())}>{s("Clear selection", "বাছাই মুছুন")}</button>}
        <button type="button" className="primary-button" disabled={busy || !selected.size} onClick={() => void addSelected()}>{busy ? s("Adding…", "যোগ হচ্ছে…") : s(`Add selected (${selected.size})`, `বাছাই করাদের যোগ করুন (${number(selected.size)})`)}</button>
      </div>
      {available === null ? <p role="status">{s("Loading students…", "শিক্ষার্থী লোড হচ্ছে…")}</p>
        : shown.length === 0 ? <p className="teach-empty">{query.trim() ? s("No student who can be added matches this search. Only approved, active students who are not in this class are listed.", "এই খোঁজে যোগ করার মতো কোনো শিক্ষার্থী নেই। শুধু অনুমোদিত, সক্রিয় এবং এই ক্লাসের বাইরের শিক্ষার্থীদের দেখানো হয়।") : s("No students can be added right now. Only approved, active students who are not in this class are listed.", "এখন যোগ করার মতো কোনো শিক্ষার্থী নেই। শুধু অনুমোদিত, সক্রিয় এবং এই ক্লাসের বাইরের শিক্ষার্থীদের দেখানো হয়।")}</p>
        : <ul className="allocation-choices" aria-label={s("Students you can add", "যাদের যোগ করা যায়")} aria-busy={searching}>{shown.map((student) => <li key={student.id}>
          <label><input type="checkbox" checked={selected.has(student.id)} disabled={busy} onChange={(event) => toggle(student, event.target.checked)} /><span><strong>{student.displayName}</strong> <small>{student.username}</small></span></label>
        </li>)}</ul>}
      {searchError && <p role="alert" className="auth-error">{searchError}</p>}
      {available?.more && <p className="allocation-more">{s(`Showing the first ${shown.length} students. Type part of a name or username to find others.`, `প্রথম ${number(shown.length)} জন দেখানো হচ্ছে। অন্যদের খুঁজতে নাম বা ব্যবহারকারীর নামের অংশ লিখুন।`)}</p>}
    </div>
    {error && <p role="alert" className="auth-error">{error}</p>}{message && <p role="status" className="teach-message">{message}</p>}
    <Subheading>{s(`Students in this class (${students.length})`, `এই ক্লাসের শিক্ষার্থী (${number(students.length)})`)}</Subheading>
    <ul className="family-link-list">{students.map((student) => <li key={student.id}><span><strong>{student.displayName}</strong> · {student.username ?? s("joined with a class code (no account)", "ক্লাস কোড দিয়ে যোগ দিয়েছে (অ্যাকাউন্ট নেই)")}</span>{student.studentId && <button className="text-button" disabled={busy} onClick={() => void remove(student)}>{s("Remove allocation", "বরাদ্দ সরান")}</button>}</li>)}</ul>
    {students.length === 0 && <p className="teach-empty">{s("No students yet. Tick students above or upload a CSV file below.", "এখনও কোনো শিক্ষার্থী নেই। ওপরে টিক দিন বা নিচে CSV ফাইল আপলোড করুন।")}</p>}
  </section>
  <StudentImport classId={classId} language={language} headingLevel={headingLevel} onPasswordsChange={onPasswordsChange} onImported={() => { setRefresh((value) => value + 1); void load().catch((error) => setError(error.message)); onChange?.(); }} /></>;
}
