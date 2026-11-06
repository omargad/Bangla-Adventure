"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { localDateTime, localNumber, MessageError, serverMessage, useLanguage, type Message } from "@/lib/use-language";
import type { Student } from "@/lib/student-auth";
import type { LearnerTopic } from "@/lib/learner-topic";
import { groupByCategory } from "@/lib/topic-model";
import type { ClassSource } from "@/lib/class-sources";
import { approvalNotice, type ApprovalStatus } from "@/lib/roles";
import { scrollToTop } from "@/lib/scroll-to-top";
import { presentQuizOptions } from "@/lib/quiz-option-order";
import { isStudentPageTitle, studentPageTitle } from "@/lib/student-page-title";
import PortalShell from "../components/PortalShell";
import ClassSourceList from "../references/ClassSourceList";
import ContentNarration from "../components/ContentNarration";
import { activityNarrationText, detectNarrationLanguage } from "@/lib/narration-model";

type Activity = { id: string; title: string; instructions: string; topicId: string | null; status: string; questions: { prompt: string; options: string[] }[]; submission: { score: number; total: number; submittedAt: string } | null };
type Attendance = { attended: number; recorded: number };
type Feed = { metrics: { enrolledClasses: number; assignedActivities: number; completedActivities: number; averagePercent: number; attendedSessions: number; recordedSessions: number }; classes: { id: string; name: string; teacherName: string; attendance: Attendance; announcements: { id: string; body: string; authorName: string | null; createdAt: string }[]; activities: Activity[]; sources: ClassSource[] }[] };
type Catalog = { topics: LearnerTopic[]; readTopicIds: string[]; quizScores?: Record<string, { best: number; total: number }> };
const PASSWORD_PATH = "/student/password";
async function request<T>(url: string, data?: object): Promise<T> {
  const response = await fetch(url, data ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) } : { cache: "no-store" });
  const payload = await response.json();
  // Learning APIs refuse a temporary password until the student has chosen their own.
  if (response.status === 403 && payload.mustChangePassword) window.location.replace(PASSWORD_PATH);
  if (!response.ok) throw new RequestError(serverMessage(payload, ["Please try again.", "আবার চেষ্টা করো।"]), payload);
  return payload as T;
}
/** A refused request with what the server sent, for a refusal the page answers itself. */
class RequestError extends MessageError {
  constructor(text: Message, readonly payload: Record<string, unknown>) { super(text); }
}
type Review = { picked: number; answer: number; correct: boolean };
/** A handed-in activity: just now (with each question's answer, since the submission is final) or earlier. */
type Result = { score: number; total: number; submittedAt?: string; review?: Review[]; earlier?: boolean };
export default function StudentPortal({ initialStudent, destination = "/student", initialMode = "sign-in", initialSection = "learning" }: {
  initialStudent: Student | null; destination?: string; initialMode?: "sign-in" | "sign-up"; initialSection?: string;
}) {
  const [language, toggleLanguage] = useLanguage();
  const s = (en: string, bn: string) => language === "bn" ? bn : en;
  const number = (value: number) => localNumber(value, language);
  const student = initialStudent;
  const [mode, setMode] = useState(initialMode);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | Message>("");
  const shownError = typeof error === "string" ? error : s(...error);
  // Set after a self sign-up: the account cannot sign in until an administrator approves it.
  const [awaitingApproval, setAwaitingApproval] = useState(false);
  // Loading My Learning failed: in place of the content when nothing has loaded yet, otherwise over the foot of the screen.
  const [loadError, setLoadError] = useState<string | Message>("");
  // The reader can close the notice of a failed refresh; it stays closed until a refresh works again.
  const [refreshNoticeClosed, setRefreshNoticeClosed] = useState(false);
  const shownLoadError = typeof loadError === "string" ? loadError : s(...loadError);
  const [feed, setFeed] = useState<Feed | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [section, setSection] = useState(["learning", "activities", "results"].includes(initialSection) ? initialSection : "learning");
  const [activity, setActivity] = useState<Activity | null>(null);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [result, setResult] = useState<Result | null>(null);
  const title = studentPageTitle(Boolean(student), activity ? "activities" : section, mode)[language === "bn" ? 1 : 0];
  useEffect(() => {
    document.title = title;
    // Next may stream this route's initial metadata after an in-page tab change.
    const observer = new MutationObserver(() => {
      if (document.title !== title && isStudentPageTitle(document.title)) document.title = title;
    });
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [title]);
  const load = useCallback(async () => {
    try {
      const [nextFeed, nextCatalog] = await Promise.all([request<Feed>("/api/student/feed"), request<Catalog>("/api/curriculum")]);
      setFeed(nextFeed); setCatalog(nextCatalog); setLoadError(""); setRefreshNoticeClosed(false);
    } catch (error) { setLoadError(error instanceof MessageError ? error.text : ["Could not load your learning.", "তোমার শেখা লোড করা যায়নি।"]); }
  }, []);
  const studentId = student?.id;
  const activeActivityId = activity?.id;
  const instructionsNarration = activity ? activityNarrationText(activity, "instructions") ?? "" : "";
  useEffect(() => {
    if (!studentId || activeActivityId) return;
    const timer = window.setTimeout(() => void load(), 0);
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    const interval = window.setInterval(refresh, 30000);
    // Also when the connection comes back, so a refresh that failed offline is not left reporting it.
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => { window.clearTimeout(timer); window.clearInterval(interval); window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh); };
  }, [studentId, load, activeActivityId]);
  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    let leaving = false;
    try {
      const response = await fetch(`/api/student/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, displayName, password }) });
      const data = await response.json().catch(() => ({})) as { student?: Student; mustChangePassword?: boolean; pendingApproval?: boolean; approvalStatus?: Exclude<ApprovalStatus, "approved">; error?: string; errorBn?: string };
      if (!response.ok) {
        setError(data.approvalStatus ? approvalNotice(data.approvalStatus, "student") : serverMessage(data, ["Could not sign in. Please try again.", "সাইন ইন করা যায়নি। আবার চেষ্টা করো।"]));
        return;
      }
      setPassword("");
      // A new account waits for an administrator: no session starts, so go back to the sign-in form.
      if (data.pendingApproval) { setAwaitingApproval(true); setMode("sign-in"); return; }
      // Leave before rendering My Learning, which would load data the temporary password cannot use.
      if (data.mustChangePassword) { leaving = true; window.location.replace(PASSWORD_PATH); return; }
      // The destination page loads My Learning itself. Rendering it here first would start loading data
      // that the navigation then throws away, and show the page twice.
      leaving = true;
      window.location.replace(destination);
    } catch { setError(s("Could not reach the server. Check your connection and try again.", "সার্ভারে পৌঁছানো যায়নি। সংযোগ দেখে আবার চেষ্টা করো।")); }
    // While the browser leaves, the button stays busy so the form cannot be sent twice.
    finally { if (!leaving) setBusy(false); }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!activity || busy) return;
    if (!activity.questions.every((_, index) => answers[index] !== undefined)) { setError(s("Answer every question before submitting.", "জমা দেওয়ার আগে সব প্রশ্নের উত্তর দাও।")); return; }
    setBusy(true); setError("");
    try {
      setResult(await request<Result>("/api/student/submit", { activityId: activity.id, answers: activity.questions.map((_, index) => answers[index]) }));
      await load();
    } catch (error) {
      // Handed in already (another tab or device): the first answers stay, so show that result.
      const earlier = error instanceof RequestError && error.payload.alreadySubmitted ? error.payload.submission as Result | undefined : undefined;
      if (earlier) { setResult({ ...earlier, earlier: true }); void load(); return; }
      setError(error instanceof MessageError ? error.text : ["Your work was not saved. Please try again.", "তোমার কাজ সংরক্ষণ হয়নি। আবার চেষ্টা করো।"]);
    }
    finally { setBusy(false); }
  }
  if (!student) return <main className="adult-app auth-app" lang={language}>
    <header className="adult-header"><Link className="adult-brand" href="/"><span>বা</span><strong>Bangla Adventures</strong></Link><Link href="/safety">{s("Safety & privacy", "নিরাপত্তা")}</Link><button lang={language === "bn" ? "en" : "bn"} className="outline-button" onClick={toggleLanguage}>{s("বাংলা", "English")}</button></header>
    <div className="auth-layout"><section className="auth-intro"><p className="adult-eyebrow">{s("Your learning space", "তোমার শেখার জায়গা")}</p><h1>{s("Ready for your next discovery?", "নতুন কিছু জানার জন্য প্রস্তুত?")}</h1><p>{s("Sign in to see your topics and progress. Your teacher will organise your classes — no class code needed.", "বিষয় ও অগ্রগতি দেখতে সাইন ইন করো। শিক্ষক তোমার ক্লাস ঠিক করবেন — কোনো কোড লাগবে না।")}</p></section>
      <section className="auth-card"><div className="auth-tabs" role="tablist" aria-label={s("Student account", "শিক্ষার্থীর অ্যাকাউন্ট")}><button role="tab" aria-selected={mode === "sign-in"} onClick={() => { setMode("sign-in"); setError(""); }}>{s("Sign in", "সাইন ইন")}</button><button role="tab" aria-selected={mode === "sign-up"} onClick={() => { setMode("sign-up"); setError(""); }}>{s("Create account", "অ্যাকাউন্ট তৈরি")}</button></div>
        <form onSubmit={signIn}>{mode === "sign-up" && <label>{s("Student name", "শিক্ষার্থীর নাম")}<input required maxLength={60} value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" /></label>}
          <label>{s("Username", "ব্যবহারকারীর নাম")}<input required minLength={3} maxLength={40} pattern="[a-zA-Z0-9._\-]+" title={s("Use letters, numbers, dots, dashes or underscores.", "ইংরেজি অক্ষর, সংখ্যা, ডট (.), ড্যাশ (-) বা আন্ডারস্কোর (_) ব্যবহার করো।")} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" /></label>
          <label>{s("Password", "পাসওয়ার্ড")}<input required type="password" minLength={mode === "sign-up" ? 8 : undefined} maxLength={200} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "sign-up" ? "new-password" : "current-password"} /></label>
          {awaitingApproval && mode === "sign-in" && !error && <p role="status" className="auth-success">{s(...approvalNotice("pending", "student"))}</p>}
          {error && <p role="alert" className="auth-error">{shownError}</p>}<button className="auth-submit" disabled={busy}>{busy ? s("One moment…", "অপেক্ষা করো…") : mode === "sign-up" ? s("Create account", "অ্যাকাউন্ট তৈরি") : s("Sign in", "সাইন ইন")}</button>
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
  ].map((item) => ({ ...item, onClick: () => { setSection(item.id); setActivity(null); setError(""); scrollToTop("instant"); } }));
  const results = feed?.classes.flatMap((c) => c.activities.filter((a) => a.submission).map((a) => ({ ...a, className: c.name }))) ?? [];
  // A closed card cannot be opened, so it says why, with the result when there is one.
  const activityState = (a: Activity) => {
    const score = a.submission && `${number(a.submission.score)}/${number(a.submission.total)}`;
    if (a.status !== "open") return score ? s(`Closed · Your result: ${score}`, `বন্ধ · তোমার ফলাফল: ${score}`) : s("Closed", "বন্ধ");
    return score ? s(`Submitted · Result: ${score}`, `জমা দেওয়া হয়েছে · ফলাফল: ${score}`) : s("Start activity", "কার্যক্রম শুরু");
  };
  // Each post names the teacher or administrator who wrote it, or no one once that account is deleted.
  const announcements = (feed?.classes.flatMap((c) => (c.announcements ?? []).map((notice) => ({ ...notice, className: c.name }))) ?? [])
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return <PortalShell role="student" name={student.displayName} language={language} toggleLanguage={toggleLanguage} active={section} items={tabs}>
    <main className="student-workspace">
      <div className="portal-heading"><div><p className="adult-eyebrow">{s("A little progress, every day", "প্রতিদিন একটু অগ্রগতি")}</p><h1>{s("My Learning", "আমার শেখা")}</h1></div><button className="outline-button" onClick={() => void load()}>{s("Refresh", "হালনাগাদ")}</button></div>
      {!activity && <section className="workspace-stats student-stats" aria-label={s("Student progress", "শিক্ষার্থীর অগ্রগতি")}><div><small>{s("Topics read", "পড়া বিষয়")}</small><strong>{catalog ? `${number(catalog.readTopicIds.length)} / ${number(catalog.topics.length)}` : "— / —"}</strong></div><div><small>{s("Activities complete", "সম্পন্ন কার্যক্রম")}</small><strong>{feed ? `${number(feed.metrics.completedActivities)} / ${number(feed.metrics.assignedActivities)}` : "— / —"}</strong></div><div><small>{s("Classes I’m in", "আমি যে ক্লাসগুলোতে আছি")}</small><strong>{feed ? number(feed.metrics.enrolledClasses) : "—"}</strong></div><div><small>{s("Average result", "গড় ফলাফল")}</small><strong>{feed && results.length ? `${number(feed.metrics.averagePercent)}%` : "—"}</strong></div><div><small>{s("Classes attended", "উপস্থিত ক্লাস")}</small><strong>{feed?.metrics.recordedSessions ? `${number(feed.metrics.attendedSessions)} / ${number(feed.metrics.recordedSessions)}` : "—"}</strong></div></section>}
      {/* Nothing above the content moves when it arrives: the loading line, or why loading failed, stands in its place. */}
      {!feed && (loadError ? <p className="auth-error" role="alert">{shownLoadError}</p> : <p role="status">{s("Loading your learning…", "তোমার বিষয় লোড হচ্ছে…")}</p>)}
      {feed && loadError && !activity && !refreshNoticeClosed && <div className="portal-refresh-error">
        <p role="alert">{shownLoadError}</p>
        <button type="button" aria-label={s("Close this notice", "এই বার্তাটি বন্ধ করো")} onClick={() => setRefreshNoticeClosed(true)}>×</button>
      </div>}
      {!activity && section !== "results" && feed && <section className="teach-panel" aria-label={s("Class announcements", "ক্লাসের ঘোষণা")}>
        <h2>{s("Class announcements", "ক্লাসের ঘোষণা")}</h2>
        {announcements.length === 0 && <p>{s("No class announcements yet. Notices from your allocated classes will appear here.", "এখনও ক্লাসের ঘোষণা নেই। তোমার বরাদ্দ ক্লাসের ঘোষণা এখানে দেখা যাবে।")}</p>}
        <ul className="classroom-announcements">{announcements.map((notice) => <li key={notice.id}>
          <strong>{notice.className}</strong><p className="announcement-body">{notice.body}</p><small>{notice.authorName ?? s("A former staff member", "একজন প্রাক্তন কর্মী")} · {s("Posted", "প্রকাশের সময়")}: <time>{localDateTime(notice.createdAt, language)}</time></small>
        </li>)}</ul>
      </section>}
      {activity ? <section className="teach-panel"><button className="text-button" onClick={() => setActivity(null)}>{s("Back to activities", "কার্যক্রমে ফিরি")}</button><h2>{activity.title}</h2><p>{activity.instructions}</p>{activity.topicId && <Link className="outline-button" href={`/topics?topic=${encodeURIComponent(activity.topicId)}`}>{s("Read the learning topic & references", "বিষয় ও তথ্যসূত্র পড়ো")}</Link>}
        <ContentNarration source={{ kind: "activity", id: activity.id, slot: "instructions", language: detectNarrationLanguage(instructionsNarration) }} text={instructionsNarration} language={language} label={s("Listen to instructions", "নির্দেশনা শুনি")} disabled={activity.status !== "open"} />
        {result ? <div role="status"><h3>{s(`You got ${result.score} out of ${result.total}.`, `তুমি ${number(result.total)}টির মধ্যে ${number(result.score)}টি পেরেছ।`)}</h3>
          <p>{result.earlier
            ? s(`You handed this in${result.submittedAt ? ` on ${localDateTime(result.submittedAt, language)}` : ""}. Your first answers are kept, and your teacher can see your result.`, `তুমি এটি ${result.submittedAt ? `${localDateTime(result.submittedAt, language)}-এ ` : ""}জমা দিয়েছ। প্রথমবারের উত্তরই রাখা আছে, আর শিক্ষক তোমার ফলাফল দেখতে পারবেন।`)
            : s("Your teacher can now see your saved result.", "শিক্ষক এখন তোমার ফলাফল দেখতে পারবেন।")}</p>
          <p>{s("Each activity is handed in once. Ask your teacher if you need another try.", "প্রতিটি কার্যক্রম একবারই জমা দেওয়া যায়। আবার চেষ্টা করতে চাইলে শিক্ষককে বলো।")}</p>
          {result.review && <ol className="activity-review" aria-label={s("Your answers", "তোমার উত্তর")}>{result.review.map((item, index) => { const question = activity.questions[index]; return question && <li key={index}>
            <strong>{question.prompt}</strong>
            <span>{item.correct ? s(`Right: ${question.options[item.answer]}`, `ঠিক: ${question.options[item.answer]}`) : s(`Your answer: ${question.options[item.picked] ?? "—"} · Correct answer: ${question.options[item.answer]}`, `তোমার উত্তর: ${question.options[item.picked] ?? "—"} · সঠিক উত্তর: ${question.options[item.answer]}`)}</span>
          </li>; })}</ol>}
        </div> : <form onSubmit={submit}>
          {activity.questions.map((q, index) => <fieldset className="portal-question" key={index}><legend>{index + 1}. {q.prompt}</legend><ContentNarration source={{ kind: "activity", id: activity.id, slot: `question:${index}`, language: detectNarrationLanguage(q.prompt) }} text={q.prompt} language={language} label={s("Listen to question", "প্রশ্ন শুনি")} disabled={activity.status !== "open"} />{presentQuizOptions(q.options, `${student.id}:${activity.id}`, index).map(({ text, originalIndex }) => <label key={originalIndex}><input type="radio" name={`question-${index}`} required checked={answers[index] === originalIndex} onChange={() => setAnswers({ ...answers, [index]: originalIndex })} />{text}</label>)}</fieldset>)}
          {error && <p className="auth-error" role="alert">{shownError}</p>}
          <button className="primary-button" disabled={busy}>{busy ? s("Saving…", "সংরক্ষণ হচ্ছে…") : s("Submit answers", "উত্তর জমা দাও")}</button>
        </form>}
      </section> : feed && catalog && <>
        {section === "learning" && <section aria-label={s("Learning topics", "শেখার বিষয়")}><h2>{s("Choose a topic", "একটি বিষয় বেছে নাও")}</h2><p>{s("Read, explore and mark your progress. Finishing a topic's quiz also counts as reading it.", "পড়ো, জানো ও অগ্রগতি রাখো। কোনো বিষয়ের কুইজ শেষ করলেও সেটি পড়া হিসেবে গোনা হয়।")}</p>
          {groupByCategory(catalog.topics).map(({ category, items }) => <section key={category.id} aria-label={category.title[language]}><h3 className="portal-category-heading"><span aria-hidden="true">{category.icon}</span> {category.title[language]}</h3><div className="portal-topic-grid">{items.map((topic) => { const best = catalog.quizScores?.[topic.id]; return <Link className="portal-topic-card" key={topic.id} href={`/topics?topic=${encodeURIComponent(topic.id)}`}><small>{s(`${topic.minutes} min`, `${number(topic.minutes)} মিনিট`)}{best ? ` · ${s("quiz best", "কুইজে সেরা")} ${number(best.best)}/${number(best.total)}` : ""}</small><h3>{topic.title[language]}</h3><p>{topic.tagline[language]}</p><strong>{catalog.readTopicIds.includes(topic.id) ? s("Read · revisit", "পড়া হয়েছে · আবার পড়ি") : s("Start reading", "পড়া শুরু করি")} →</strong></Link>; })}</div></section>)}
          <Link className="outline-button" href="/learn">{s("More language activities", "আরও ভাষার কার্যক্রম")}</Link></section>}
        {section === "activities" && <section><h2>{s("My class activities", "আমার ক্লাসের কার্যক্রম")}</h2>{feed.classes.length === 0 && <div className="teach-panel"><h3>{s("Your teacher will add your class", "শিক্ষক তোমার ক্লাস যোগ করবেন")}</h3><p>{s("You can explore your learning topics while you wait.", "অপেক্ষার সময় শেখার বিষয়গুলো পড়তে পারো।")}</p></div>}{feed.classes.map((c) => <section className="teach-panel" key={c.id}><h3>{c.name}</h3><p>{s("Teacher", "শিক্ষক")}: {c.teacherName} · {c.attendance.recorded ? s(`You attended ${c.attendance.attended} of ${c.attendance.recorded} class${c.attendance.recorded === 1 ? "" : "es"}`, `${number(c.attendance.recorded)}টি ক্লাসের মধ্যে ${number(c.attendance.attended)}টিতে তুমি উপস্থিত ছিলে`) : s("No attendance taken yet", "এখনও উপস্থিতি নেওয়া হয়নি")}</p>{c.sources.length > 0 && <section className="class-sources-inline" aria-label={`${c.name}: ${s("Class sources", "ক্লাসের উৎস")}`}><h4>{s("Class sources", "ক্লাসের উৎস")}</h4><ClassSourceList sources={c.sources} language={language} /></section>}{!c.activities.length && <p>{s("Your teacher has not added activities yet.", "শিক্ষক এখনও কার্যক্রম যোগ করেননি।")}</p>}<div className="portal-topic-grid">{c.activities.map((a) => <button className="portal-topic-card" key={a.id} disabled={a.status !== "open"} onClick={() => { setActivity(a); setAnswers({}); setResult(a.submission ? { ...a.submission, earlier: true } : null); setError(""); }}><h3>{a.title}</h3><p>{a.instructions}</p><strong>{activityState(a)}</strong></button>)}</div></section>)}</section>}
        {section === "results" && <section className="teach-panel"><h2>{s("My results", "আমার ফলাফল")}</h2>{!results.length ? <p>{s("Complete a class activity to see your results here.", "এখানে ফলাফল দেখতে ক্লাসের কার্যক্রম সম্পন্ন করো।")}</p> : <div className="portal-table"><table><thead><tr><th>{s("Class", "ক্লাস")}</th><th>{s("Activity", "কার্যক্রম")}</th><th>{s("Result", "ফলাফল")}</th><th>{s("Submitted", "জমার সময়")}</th></tr></thead><tbody>{results.map((a) => <tr key={a.id}><td>{a.className}</td><td>{a.title}</td><td>{number(a.submission!.score)}/{number(a.submission!.total)}</td><td>{localDateTime(a.submission!.submittedAt, language)}</td></tr>)}</tbody></table></div>}</section>}
      </>}
    </main>
  </PortalShell>;
}
