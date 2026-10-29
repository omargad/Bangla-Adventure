"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useLanguage } from "@/lib/use-language";
import type { Student } from "@/lib/student-auth";
import type { CatalogTopic } from "@/lib/curriculum-catalog";
import { approvalNotice, type ApprovalStatus } from "@/lib/roles";
import PortalShell from "../components/PortalShell";

type Activity = { id: string; title: string; instructions: string; topicId: string | null; status: string; questions: { prompt: string; options: string[] }[]; submission: { score: number; total: number; submittedAt: string } | null };
type Feed = { metrics: { enrolledClasses: number; assignedActivities: number; completedActivities: number; averagePercent: number }; classes: { id: string; name: string; teacherName: string; announcements: { id: string; body: string; createdAt: string }[]; activities: Activity[] }[] };
type Catalog = { topics: CatalogTopic[]; readTopicIds: string[] };
const PASSWORD_PATH = "/student/password";
async function request<T>(url: string, data?: object): Promise<T> {
  const response = await fetch(url, data ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) } : { cache: "no-store" });
  const payload = await response.json();
  // Learning APIs refuse a temporary password until the student has chosen their own.
  if (response.status === 403 && payload.mustChangePassword) window.location.replace(PASSWORD_PATH);
  if (!response.ok) throw new Error(payload.error ?? "Please try again.");
  return payload as T;
}
export default function StudentPortal({ initialStudent, destination = "/student", initialMode = "sign-in", initialSection = "learning" }: {
  initialStudent: Student | null; destination?: string; initialMode?: "sign-in" | "sign-up"; initialSection?: string;
}) {
  const [language, toggleLanguage] = useLanguage();
  const s = (en: string, bn: string) => language === "bn" ? bn : en;
  const [student, setStudent] = useState(initialStudent);
  const [mode, setMode] = useState(initialMode);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Set after a self sign-up: the account cannot sign in until an administrator approves it.
  const [awaitingApproval, setAwaitingApproval] = useState(false);
  const [feed, setFeed] = useState<Feed | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [section, setSection] = useState(["learning", "activities", "results"].includes(initialSection) ? initialSection : "learning");
  const [activity, setActivity] = useState<Activity | null>(null);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [result, setResult] = useState<{ score: number; total: number } | null>(null);
  const load = useCallback(async () => {
    try {
      const [nextFeed, nextCatalog] = await Promise.all([request<Feed>("/api/student/feed"), request<Catalog>("/api/curriculum")]);
      setFeed(nextFeed); setCatalog(nextCatalog); setError("");
    } catch (error) { setError(error instanceof Error ? error.message : "Could not load your learning."); }
  }, []);
  const studentId = student?.id;
  const activeActivityId = activity?.id;
  useEffect(() => {
    if (!studentId || activeActivityId) return;
    const timer = window.setTimeout(() => void load(), 0);
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    const interval = window.setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    return () => { window.clearTimeout(timer); window.clearInterval(interval); window.removeEventListener("focus", refresh); };
  }, [studentId, load, activeActivityId]);
  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/student/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, displayName, password }) });
      const data = await response.json().catch(() => ({})) as { student?: Student; mustChangePassword?: boolean; pendingApproval?: boolean; approvalStatus?: Exclude<ApprovalStatus, "approved">; error?: string };
      if (!response.ok) {
        setError(data.approvalStatus ? s(...approvalNotice(data.approvalStatus, "student")) : data.error ?? s("Could not sign in. Please try again.", "সাইন ইন করা যায়নি। আবার চেষ্টা করো।"));
        return;
      }
      setPassword("");
      // A new account waits for an administrator: no session starts, so go back to the sign-in form.
      if (data.pendingApproval) { setAwaitingApproval(true); setMode("sign-in"); return; }
      // Leave before rendering My Learning, which would load data the temporary password cannot use.
      if (data.mustChangePassword) { window.location.replace(PASSWORD_PATH); return; }
      setStudent(data.student ?? null);
      window.location.replace(destination);
    } catch { setError(s("Could not reach the server. Check your connection and try again.", "সার্ভারে পৌঁছানো যায়নি। সংযোগ দেখে আবার চেষ্টা করো।")); }
    finally { setBusy(false); }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!activity || busy) return;
    if (!activity.questions.every((_, index) => answers[index] !== undefined)) { setError(s("Answer every question before submitting.", "জমা দেওয়ার আগে সব প্রশ্নের উত্তর দাও।")); return; }
    setBusy(true); setError("");
    try {
      setResult(await request("/api/student/submit", { activityId: activity.id, answers: activity.questions.map((_, index) => answers[index]) }));
      await load();
    } catch (error) { setError(error instanceof Error ? error.message : "Your work was not saved. Please try again."); }
    finally { setBusy(false); }
  }
  if (!student) return <main className="adult-app auth-app" lang={language}>
    <header className="adult-header"><Link className="adult-brand" href="/"><span>বা</span><strong>Bangla Adventures</strong></Link><Link href="/safety">{s("Safety & privacy", "নিরাপত্তা")}</Link><button className="outline-button" onClick={toggleLanguage}>{s("বাংলা", "English")}</button></header>
    <div className="auth-layout"><section className="auth-intro"><p className="adult-eyebrow">{s("Your learning space", "তোমার শেখার জায়গা")}</p><h1>{s("Ready for your next discovery?", "নতুন কিছু জানার জন্য প্রস্তুত?")}</h1><p>{s("Sign in to see your topics and progress. Your teacher will organise your classes — no class code needed.", "বিষয় ও অগ্রগতি দেখতে সাইন ইন করো। শিক্ষক তোমার ক্লাস ঠিক করবেন — কোনো কোড লাগবে না।")}</p></section>
      <section className="auth-card"><div className="auth-tabs" role="tablist" aria-label="Student account"><button role="tab" aria-selected={mode === "sign-in"} onClick={() => { setMode("sign-in"); setError(""); }}>{s("Sign in", "সাইন ইন")}</button><button role="tab" aria-selected={mode === "sign-up"} onClick={() => { setMode("sign-up"); setError(""); }}>{s("Create account", "অ্যাকাউন্ট তৈরি")}</button></div>
        <form onSubmit={signIn}>{mode === "sign-up" && <label>{s("Student name", "শিক্ষার্থীর নাম")}<input required maxLength={60} value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" /></label>}
          <label>{s("Username", "ব্যবহারকারীর নাম")}<input required minLength={3} maxLength={40} pattern="[a-zA-Z0-9._-]+" title="Use letters, numbers, dots, dashes or underscores." value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" /></label>
          <label>{s("Password", "পাসওয়ার্ড")}<input required type="password" minLength={mode === "sign-up" ? 8 : undefined} maxLength={200} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "sign-up" ? "new-password" : "current-password"} /></label>
          {awaitingApproval && mode === "sign-in" && !error && <p role="status" className="auth-success">{s(...approvalNotice("pending", "student"))}</p>}
          {error && <p role="alert" className="auth-error">{error}</p>}<button className="auth-submit" disabled={busy}>{busy ? s("One moment…", "অপেক্ষা করো…") : mode === "sign-up" ? s("Create account", "অ্যাকাউন্ট তৈরি") : s("Sign in", "সাইন ইন")}</button>
        </form><p className="auth-note">{s("Ask a grown-up for help. Use a nickname; no child email or birthday is needed.", "বড়দের সাহায্য নাও। ডাকনাম ব্যবহার করো; শিশুর ইমেইল বা জন্মদিন লাগে না।")}</p>
        <p className="auth-note">{mode === "sign-up"
          ? s("An administrator checks every new account before you can sign in.", "নতুন অ্যাকাউন্ট দিয়ে সাইন ইন করার আগে প্রশাসক সেটি দেখে অনুমোদন করেন।")
          : s("Forgot your password? Ask your teacher or a grown-up to ask an administrator for a new one.", "পাসওয়ার্ড ভুলে গেছ? নতুন পাসওয়ার্ডের জন্য শিক্ষক বা বড়দের মাধ্যমে প্রশাসককে বলো।")}</p>
      </section>
    </div>
  </main>;
  const tabs = [
    { id: "learning", label: s("My Learning", "আমার শেখা") },
    { id: "activities", label: s("My activities", "আমার কার্যক্রম") },
    { id: "results", label: s("My results", "আমার ফলাফল") },
  ].map((item) => ({ ...item, onClick: () => { setSection(item.id); setActivity(null); setError(""); } }));
  const results = feed?.classes.flatMap((c) => c.activities.filter((a) => a.submission).map((a) => ({ ...a, className: c.name }))) ?? [];
  const announcements = (feed?.classes.flatMap((c) => (c.announcements ?? []).map((notice) => ({ ...notice, className: c.name, teacherName: c.teacherName }))) ?? [])
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return <PortalShell role="student" name={student.displayName} language={language} toggleLanguage={toggleLanguage} active={section} items={tabs}>
    <main className="student-workspace">
      <div className="portal-heading"><div><p className="adult-eyebrow">{s("A little progress, every day", "প্রতিদিন একটু অগ্রগতি")}</p><h1>{s("My Learning", "আমার শেখা")}</h1></div><button className="outline-button" onClick={() => void load()}>{s("Refresh", "হালনাগাদ")}</button></div>
      {error && <p className="auth-error" role="alert">{error}</p>}
      {!feed && !error && <p role="status">{s("Loading your learning…", "তোমার বিষয় লোড হচ্ছে…")}</p>}
      {!activity && <section className="workspace-stats" aria-label="Student progress"><div><small>{s("Topics read", "পড়া বিষয়")}</small><strong>{catalog?.readTopicIds.length ?? "—"} / {catalog?.topics.length ?? "—"}</strong></div><div><small>{s("Activities complete", "সম্পন্ন কার্যক্রম")}</small><strong>{feed?.metrics.completedActivities ?? "—"} / {feed?.metrics.assignedActivities ?? "—"}</strong></div><div><small>{s("My classes", "আমার ক্লাস")}</small><strong>{feed?.metrics.enrolledClasses ?? "—"}</strong></div><div><small>{s("Average result", "গড় ফলাফল")}</small><strong>{results.length ? `${feed?.metrics.averagePercent}%` : "—"}</strong></div></section>}
      {!activity && section !== "results" && feed && <section className="teach-panel" aria-label={s("Class announcements", "ক্লাসের ঘোষণা")}>
        <h2>{s("Class announcements", "ক্লাসের ঘোষণা")}</h2>
        {announcements.length === 0 && <p>{s("No class announcements yet. Notices from your allocated classes will appear here.", "এখনও ক্লাসের ঘোষণা নেই। তোমার বরাদ্দ ক্লাসের ঘোষণা এখানে দেখা যাবে।")}</p>}
        <ul className="classroom-announcements">{announcements.map((notice) => <li key={notice.id}>
          <strong>{notice.className}</strong><p>{notice.body}</p><small>{notice.teacherName} · {s("Posted (UTC)", "প্রকাশের সময় (UTC)")}: <time>{notice.createdAt}</time></small>
        </li>)}</ul>
      </section>}
      {activity ? <section className="teach-panel"><button className="text-button" onClick={() => setActivity(null)}>{s("Back to activities", "কার্যক্রমে ফিরি")}</button><h2>{activity.title}</h2><p>{activity.instructions}</p>{activity.topicId && <Link className="outline-button" href={`/topics?topic=${encodeURIComponent(activity.topicId)}`}>{s("Read the learning topic & references", "বিষয় ও তথ্যসূত্র পড়ো")}</Link>}
        {result ? <div role="status"><h3>{s(`You got ${result.score} out of ${result.total}.`, `তুমি ${result.total}টির মধ্যে ${result.score}টি পেরেছ।`)}</h3><p>{s("Your teacher can now see your saved result.", "শিক্ষক এখন তোমার ফলাফল দেখতে পারবেন।")}</p></div> : <form onSubmit={submit}>
          {activity.questions.map((q, index) => <fieldset className="portal-question" key={index}><legend>{index + 1}. {q.prompt}</legend>{q.options.map((option, optionIndex) => <label key={optionIndex}><input type="radio" name={`question-${index}`} required checked={answers[index] === optionIndex} onChange={() => setAnswers({ ...answers, [index]: optionIndex })} />{option}</label>)}</fieldset>)}
          <button className="primary-button" disabled={busy}>{busy ? s("Saving…", "সংরক্ষণ হচ্ছে…") : s("Submit answers", "উত্তর জমা দাও")}</button>
        </form>}
      </section> : <>
        {section === "learning" && <section aria-label="Learning topics"><h2>{s("Choose a topic", "একটি বিষয় বেছে নাও")}</h2><p>{s("Read, explore and mark your progress. Topic drafts keep their educator-review notices.", "পড়ো, জানো ও অগ্রগতি রাখো। বিষয়ের খসড়ায় পর্যালোচনার বিজ্ঞপ্তি থাকবে।")}</p><div className="portal-topic-grid">{catalog?.topics.map((topic) => <Link className="portal-topic-card" key={topic.id} href={`/topics?topic=${encodeURIComponent(topic.id)}`}><small>{topic.theme} · {s(`${topic.minutes} min`, `${topic.minutes.toLocaleString("bn-BD")} মিনিট`)}</small><h3>{topic.title[language]}</h3><p>{topic.tagline[language]}</p><strong>{catalog.readTopicIds.includes(topic.id) ? s("Read · revisit", "পড়া হয়েছে · আবার পড়ি") : s("Start reading", "পড়া শুরু করি")} →</strong></Link>)}</div><Link className="outline-button" href="/learn">{s("More language activities", "আরও ভাষার কার্যক্রম")}</Link></section>}
        {section === "activities" && <section><h2>{s("My class activities", "আমার ক্লাসের কার্যক্রম")}</h2>{feed?.classes.length === 0 && <div className="teach-panel"><h3>{s("Your teacher will add your class", "শিক্ষক তোমার ক্লাস যোগ করবেন")}</h3><p>{s("You can explore your learning topics while you wait.", "অপেক্ষার সময় শেখার বিষয়গুলো পড়তে পারো।")}</p></div>}{feed?.classes.map((c) => <section className="teach-panel" key={c.id}><h3>{c.name}</h3><p>{s("Teacher", "শিক্ষক")}: {c.teacherName}</p>{!c.activities.length && <p>{s("Your teacher has not added activities yet.", "শিক্ষক এখনও কার্যক্রম যোগ করেননি।")}</p>}<div className="portal-topic-grid">{c.activities.map((a) => <button className="portal-topic-card" key={a.id} disabled={a.status !== "open"} onClick={() => { setActivity(a); setAnswers({}); setResult(null); setError(""); }}><h3>{a.title}</h3><p>{a.instructions}</p><strong>{a.submission ? `${s("Result", "ফলাফল")}: ${a.submission.score}/${a.submission.total}` : a.status === "open" ? s("Start activity", "কার্যক্রম শুরু") : s("Closed", "বন্ধ")}</strong></button>)}</div></section>)}</section>}
        {section === "results" && <section className="teach-panel"><h2>{s("My results", "আমার ফলাফল")}</h2>{!results.length ? <p>{s("Complete a class activity to see your results here.", "এখানে ফলাফল দেখতে ক্লাসের কার্যক্রম সম্পন্ন করো।")}</p> : <div className="portal-table"><table><thead><tr><th>Class</th><th>Activity</th><th>Result</th><th>Submitted</th></tr></thead><tbody>{results.map((a) => <tr key={a.id}><td>{a.className}</td><td>{a.title}</td><td>{a.submission!.score}/{a.submission!.total}</td><td>{new Date(a.submission!.submittedAt).toLocaleString()}</td></tr>)}</tbody></table></div>}</section>}
      </>}
    </main>
  </PortalShell>;
}
