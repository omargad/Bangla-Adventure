"use client";
import { useCallback, useEffect, useState } from "react";
import PortalShell from "@/app/components/PortalShell";
import ClassAllocation from "@/app/components/ClassAllocation";
import { confirmDiscardPasswords } from "@/app/components/StudentImport";
import { localMessage, useLanguage } from "@/lib/use-language";
import { siteTitle } from "@/lib/site-title";

type ClassRow = { id: string; name: string; teacherId: string; teacherName?: string };
type Teacher = { id: string; displayName: string; email: string };
type ServerMessage = { error?: string; errorBn?: string };

/**
 * Administrators set classes up for teachers: create a class for an approved teacher, give a class to
 * another teacher, and allocate students. Teachers still create their own classes in /teach.
 */
export default function AdminClasses({ name }: { name: string }) {
  const [language, toggleLanguage] = useLanguage({ title: siteTitle });
  const s = (en: string, bn: string) => language === "bn" ? bn : en;
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [teachers, setTeachers] = useState<Teacher[] | null>(null);
  const [selected, setSelected] = useState("");
  // The server's error as sent, shown in the page language.
  const [error, setError] = useState<ServerMessage | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<[string, string] | null>(null);
  const [actionError, setActionError] = useState<{ data: ServerMessage; fallback: [string, string] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTeacher, setNewTeacher] = useState("");
  const [nextTeacher, setNextTeacher] = useState("");
  // Choosing another class remounts the panel, which would discard temporary passwords on screen.
  const [passwordsOnScreen, setPasswordsOnScreen] = useState(false);
  const current = classes.find((item) => item.id === selected);

  const loadClasses = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/classes?scope=all", { signal, cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError(data); return; }
      setClasses(data.classes); setLoaded(true);
    } catch { if (!signal?.aborted) setError({}); }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void loadClasses(controller.signal);
      fetch("/api/admin/teachers", { signal: controller.signal, cache: "no-store" }).then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) { setError(data); return; }
        setTeachers(data.teachers);
      }).catch(() => { if (!controller.signal.aborted) setError({}); });
    }, 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [loadClasses]);

  function choose(classId: string) {
    if (classId === selected || (passwordsOnScreen && !confirmDiscardPasswords(language))) return;
    setSelected(classId); setNextTeacher(""); setNotice(null); setActionError(null);
  }

  async function send(url: string, method: "POST" | "PATCH", body: object, fallback: [string, string]) {
    setBusy(true); setNotice(null); setActionError(null);
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setActionError({ data, fallback }); return null; }
      return data;
    } catch { setActionError({ data: {}, fallback }); return null; }
    finally { setBusy(false); }
  }

  async function createClass(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !newTeacher || !newName.trim()) return;
    const data = await send("/api/classes", "POST", { name: newName.trim(), teacherId: newTeacher }, ["The class could not be created. Please try again.", "ক্লাস তৈরি করা যায়নি। আবার চেষ্টা করুন।"]);
    if (!data) return;
    await loadClasses();
    setNewName(""); setNewTeacher("");
    choose(data.class.id);
    setNotice([`${data.class.name} was created for ${data.class.teacherName}. Add its students below.`, `${data.class.teacherName}-এর জন্য ${data.class.name} তৈরি হয়েছে। নিচে শিক্ষার্থী যোগ করুন।`]);
  }

  async function changeTeacher(event: React.FormEvent) {
    event.preventDefault();
    const teacher = teachers?.find((item) => item.id === nextTeacher);
    if (busy || !current || !teacher) return;
    const previous = current.teacherName ?? s("the current teacher", "বর্তমান শিক্ষক");
    if (!window.confirm(s(
      `Give ${current.name} to ${teacher.displayName}? Its students, activities, announcements, results and attendance stay with the class, and ${previous} will no longer be able to open it.`,
      `${current.name} ক্লাসটি ${teacher.displayName}-কে দেবেন? ক্লাসের শিক্ষার্থী, কার্যক্রম, ঘোষণা, ফলাফল ও উপস্থিতি ক্লাসেই থাকবে, আর ${previous} ক্লাসটি আর খুলতে পারবেন না।`,
    ))) return;
    const data = await send(`/api/classes/${current.id}`, "PATCH", { teacherId: teacher.id }, ["The teacher could not be changed. Please try again.", "শিক্ষক বদলানো যায়নি। আবার চেষ্টা করুন।"]);
    if (!data) return;
    await loadClasses();
    setNextTeacher("");
    setNotice([`${current.name} is now taught by ${teacher.displayName}.`, `${current.name} এখন পড়াবেন ${teacher.displayName}।`]);
  }

  const teacherOptions = (teachers ?? []).map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.displayName} · {teacher.email}</option>);
  return <PortalShell role="admin" name={name} active="admin-classes" language={language} toggleLanguage={toggleLanguage}>
    <h1>{s("Classes and allocation", "ক্লাস ও বরাদ্দ")}</h1><p>{s("Create classes for teachers, change who teaches a class and allocate registered students. Existing learning records are retained when access is removed.", "শিক্ষকদের জন্য ক্লাস তৈরি করুন, কোন শিক্ষক ক্লাস পড়াবেন তা বদলান এবং নিবন্ধিত শিক্ষার্থীদের বরাদ্দ করুন। প্রবেশাধিকার সরালেও আগের শেখার রেকর্ড থেকে যায়।")}</p>
    {error && <p role="alert" className="auth-error">{localMessage(error, language, ["Classes could not be loaded. Please reload the page.", "ক্লাসগুলো লোড করা যায়নি। পাতাটি আবার লোড করুন।"])}</p>}
    {actionError && <p role="alert" className="auth-error">{localMessage(actionError.data, language, actionError.fallback)}</p>}
    {notice && <p role="status" className="teach-message">{s(...notice)}</p>}

    <section className="teach-panel" aria-label={s("Create a class for a teacher", "শিক্ষকের জন্য ক্লাস তৈরি")}>
      <h2>{s("Create a class for a teacher", "শিক্ষকের জন্য ক্লাস তৈরি")}</h2>
      {teachers !== null && teachers.length === 0 ? <p className="teach-empty">{s("There are no approved teachers yet. Approve a teacher account in Users first.", "এখনও কোনো অনুমোদিত শিক্ষক নেই। আগে ব্যবহারকারী অংশে একজন শিক্ষকের অ্যাকাউন্ট অনুমোদন করুন।")}</p>
        : <form className="class-setup-form" onSubmit={createClass}>
          <label>{s("Class name", "ক্লাসের নাম")}<input value={newName} maxLength={60} required placeholder={s("e.g. Sunday 11:30 Level 2", "যেমন: রবিবার ১১:৩০ লেভেল ২")} onChange={(event) => setNewName(event.target.value)} /></label>
          <label>{s("Teacher", "শিক্ষক")}<select value={newTeacher} required onChange={(event) => setNewTeacher(event.target.value)}><option value="">{teachers === null ? s("Loading teachers…", "শিক্ষক লোড হচ্ছে…") : s("Choose a teacher", "শিক্ষক বেছে নিন")}</option>{teacherOptions}</select></label>
          <button className="primary-button" type="submit" disabled={busy || !teachers?.length}>{s("Create class", "ক্লাস তৈরি করুন")}</button>
        </form>}
    </section>

    <label className="portal-field">{s("Choose a class", "একটি ক্লাস বেছে নিন")}<select value={selected} onChange={(e) => choose(e.target.value)}><option value="">{s("Select a class", "ক্লাস বাছাই করুন")}</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.teacherName ? `${c.name} · ${c.teacherName}` : c.name}</option>)}</select></label>
    {loaded && !classes.length && <p>{s("No classes yet. Create one above, or teachers create their own from their workspace.", "এখনও কোনো ক্লাস নেই। ওপরে একটি তৈরি করুন, অথবা শিক্ষকেরা নিজেদের কর্মক্ষেত্র থেকে ক্লাস তৈরি করতে পারেন।")}</p>}
    {current && <section className="teach-panel" aria-label={s("Class teacher", "ক্লাসের শিক্ষক")}>
      <h2>{s("Class teacher", "ক্লাসের শিক্ষক")}</h2>
      <p>{s("Teacher", "শিক্ষক")}: <strong>{current.teacherName ?? "—"}</strong></p>
      <form className="class-setup-form" onSubmit={changeTeacher}>
        <label>{s("Change teacher", "শিক্ষক বদলান")}<select value={nextTeacher} required onChange={(event) => setNextTeacher(event.target.value)}><option value="">{s("Choose a teacher", "শিক্ষক বেছে নিন")}</option>{(teachers ?? []).filter((teacher) => teacher.id !== current.teacherId).map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.displayName} · {teacher.email}</option>)}</select></label>
        <button className="outline-button" type="submit" disabled={busy || !nextTeacher}>{s("Save teacher", "শিক্ষক সংরক্ষণ করুন")}</button>
      </form>
    </section>}
    {selected && <ClassAllocation key={selected} classId={selected} language={language} onPasswordsChange={setPasswordsOnScreen} onChange={() => void loadClasses()} />}
  </PortalShell>;
}
