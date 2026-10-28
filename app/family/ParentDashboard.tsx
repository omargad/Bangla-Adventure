"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLanguage } from "@/lib/use-language";
import type { ParentOverview } from "@/lib/parent-access";
import PortalShell from "../components/PortalShell";

type SavedProfile = { id: string; displayName: string; progress: { id: string; lessonId: string; skill: string; score: number | null }[]; assignments: { id: string; title: string; status: string; dueAt: string | null }[] };

export default function ParentDashboard({ parentName }: { parentName: string }) {
  const [language, toggleLanguage] = useLanguage();
  const s = (en: string, bn: string) => language === "bn" ? bn : en;
  const [data, setData] = useState<ParentOverview | null>(null);
  const [savedProfiles, setSavedProfiles] = useState<SavedProfile[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const sequence = useRef(0);

  const load = useCallback(async (signal?: AbortSignal, quiet = false) => {
    const requestId = ++sequence.current;
    if (!quiet) setLoading(true);
    try {
      const [overviewResponse, profilesResponse] = await Promise.all([
        fetch("/api/family", { cache: "no-store", signal }),
        fetch("/api/profiles", { cache: "no-store", signal }),
      ]);
      const [overview, profiles] = await Promise.all([overviewResponse.json(), profilesResponse.json()]);
      if (!overviewResponse.ok || !profilesResponse.ok) throw new Error(overview.error ?? profiles.error ?? "Could not load learning records.");
      if (requestId !== sequence.current || signal?.aborted) return;
      setData(overview); setSavedProfiles(profiles.profiles ?? []); setError("");
    } catch (error) {
      if (requestId !== sequence.current || signal?.aborted) return;
      setData(null); setSavedProfiles([]);
      setError(error instanceof Error ? error.message : "Could not load learning records. Please try again.");
    } finally { if (requestId === sequence.current && !signal?.aborted) setLoading(false); }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => { if (document.visibilityState === "visible") void load(controller.signal, true); };
    const first = window.setTimeout(() => void load(controller.signal), 0);
    const interval = window.setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    return () => { controller.abort(); window.clearTimeout(first); window.clearInterval(interval); window.removeEventListener("focus", refresh); };
  }, [load]);

  const children = data?.children ?? [];
  const assigned = children.reduce((sum, child) => sum + child.metrics.assignedActivities, 0);
  const completed = children.reduce((sum, child) => sum + child.metrics.completedActivities, 0);

  return <PortalShell role="parent" name={parentName} active="family" language={language} toggleLanguage={toggleLanguage}><main className="adult-app parent-app" lang={language}>
    <header className="adult-header">
      <Link className="adult-brand" href="/"><span>বা</span><span><strong>Bangla Adventures</strong><small>{s("Parent dashboard", "অভিভাবকের ড্যাশবোর্ড")}</small></span></Link>
      <nav aria-label="Parent navigation"><Link className="active" href="/family">{s("My children", "আমার সন্তান")}</Link><Link href="/account">{s("My account", "আমার অ্যাকাউন্ট")}</Link><Link href="/safety">{s("Safety & privacy", "নিরাপত্তা ও গোপনীয়তা")}</Link></nav>
      <div className="adult-account"><button className="outline-button" onClick={toggleLanguage}>{s("বাংলা", "English")}</button><a href="/api/auth/sign-out?returnTo=%2Fgrown-ups">{s("Sign out", "সাইন আউট")}</a></div>
    </header>
    <div className="adult-content">
      <section className="management-heading"><div><p className="adult-eyebrow">{s(`Welcome, ${parentName}`, `স্বাগতম, ${parentName}`)}</p><h1>{s("Your children's learning", "আপনার সন্তানের শেখার অগ্রগতি")}</h1><p>{s("Follow your children’s classes, activities and results in one place. This is a read-only space: only students and their teachers can update class work.", "আপনার সন্তানের ক্লাস, কার্যক্রম ও ফলাফল এক জায়গায় দেখুন। এখানে শুধু দেখা যায়; শিক্ষার্থী ও শিক্ষক ক্লাসের কাজ হালনাগাদ করেন।")}</p><span className="role-badge">{s("Read-only parent access", "অভিভাবকের শুধু দেখার অনুমতি")}</span></div><button className="outline-button" disabled={loading} onClick={() => void load()}>{s("Refresh progress", "অগ্রগতি হালনাগাদ")}</button></section>
      {error && <p className="auth-error" role="alert">{error}</p>}
      {loading && <p role="status">{s("Loading your children's learning records…", "আপনার সন্তানের শেখার তথ্য লোড হচ্ছে…")}</p>}
      <section className="workspace-stats" aria-label="Family overview"><div><small>{s("Linked children", "যুক্ত সন্তান")}</small><strong>{data ? children.length : "—"}</strong></div><div><small>{s("Assigned activities", "দেওয়া কার্যক্রম")}</small><strong>{data ? assigned : "—"}</strong></div><div><small>{s("Completed", "সম্পন্ন")}</small><strong>{data ? completed : "—"}</strong></div><div><small>{s("Not submitted", "জমা হয়নি")}</small><strong>{data ? assigned - completed : "—"}</strong></div></section>
      {data && children.length === 0 && <section className="teach-panel"><h2>{s("No children linked yet", "এখনও কোনো সন্তান যুক্ত নেই")}</h2><p>{s("Ask your school administrator to connect your parent account to your child’s student account. Knowing a student’s name or username does not grant access.", "আপনার অ্যাকাউন্টের সঙ্গে সন্তানের শিক্ষার্থী অ্যাকাউন্ট যুক্ত করতে প্রশাসককে বলুন। শুধু নাম বা ব্যবহারকারীর নাম জানলেই তথ্য দেখা যায় না।")}</p></section>}
      {children.map((child) => <section className="teach-panel parent-child" key={child.id} aria-label={child.displayName}>
        <div className="parent-child-heading"><div><h2>{child.displayName}</h2><p>{s("Student", "শিক্ষার্থী")}: {child.username} · {child.metrics.enrolledClasses} {s("classes", "ক্লাস")}</p></div><div><span className={`status-badge ${child.status}`}>{child.status}</span><p>{s("Average result", "গড় ফলাফল")}: <strong>{child.metrics.averagePercent === null ? s("Not graded yet", "এখনও মূল্যায়ন হয়নি") : `${child.metrics.averagePercent}%`}</strong></p></div></div>
        <label className="parent-completion">{s("Activities submitted", "জমা দেওয়া কার্যক্রম")}: {child.metrics.completedActivities} / {child.metrics.assignedActivities}<progress max={Math.max(1, child.metrics.assignedActivities)} value={child.metrics.completedActivities} /></label>
        {child.classes.length === 0 && <p>{s("No class enrolments yet. Learning records will appear after your child joins a class.", "এখনও কোনো ক্লাসে ভর্তি হয়নি। ক্লাসে যোগ দেওয়ার পর শেখার তথ্য দেখা যাবে।")}</p>}
        {child.classes.map((classroom) => <section className="parent-class" key={classroom.id}><h3>{classroom.name}</h3><p>{s("Teacher", "শিক্ষক")}: {classroom.teacherName}</p>
          {classroom.activities.length === 0 ? <p>{s("No activities assigned yet.", "এখনও কোনো কার্যক্রম দেওয়া হয়নি।")}</p> : <div className="management-table-wrap"><table className="management-table"><caption className="sr-only">{classroom.name} {s("learning results", "শেখার ফলাফল")}</caption><thead><tr><th>{s("Activity", "কার্যক্রম")}</th><th>{s("Progress", "অগ্রগতি")}</th><th>{s("Result", "ফলাফল")}</th></tr></thead><tbody>{classroom.activities.map((activity) => <tr key={activity.id}><td><strong>{activity.title}</strong>{activity.instructions && <small>{activity.instructions}</small>}</td><td>{activity.submission ? s("Submitted", "জমা হয়েছে") : activity.status === "closed" ? s("Closed · not submitted", "বন্ধ · জমা হয়নি") : s("To do", "করতে হবে")}{activity.submission && <small>{s("Submitted", "জমার সময়")}: {activity.submission.submittedAt}</small>}</td><td>{activity.submission && activity.submission.total > 0 ? `${activity.submission.score} / ${activity.submission.total}` : "—"}</td></tr>)}</tbody></table></div>}
        </section>)}
      </section>)}
      {savedProfiles.length > 0 && <details className="teach-panel"><summary>{s("Previously saved learning profiles", "আগের সংরক্ষিত শেখার প্রোফাইল")}</summary><p>{s("These separate home-learning records are preserved for viewing. They are not automatically linked to student accounts.", "আগের শেখার তথ্য দেখার জন্য সংরক্ষিত আছে। এগুলো শিক্ষার্থী অ্যাকাউন্টের সঙ্গে স্বয়ংক্রিয়ভাবে যুক্ত নয়।")}</p>{savedProfiles.map((profile) => <section className="parent-class" key={profile.id}><h3>{profile.displayName}</h3><p>{profile.progress.length} {s("recorded sessions", "রেকর্ড করা সেশন")}</p><ul>{profile.progress.map((progress) => <li key={progress.id}>{progress.lessonId} · {progress.skill}{progress.score !== null ? ` · ${progress.score}%` : ""}</li>)}</ul><ul>{profile.assignments.map((assignment) => <li key={assignment.id}>{assignment.title} · {assignment.status}{assignment.dueAt ? ` · ${assignment.dueAt}` : ""}</li>)}</ul></section>)}</details>}
      {data && <p className="teach-note">{s("Updates automatically every 30 seconds while this page is visible. Only linked children are shown.", "পাতাটি খোলা থাকলে প্রতি ৩০ সেকেন্ডে হালনাগাদ হয়। শুধু যুক্ত সন্তানদের তথ্য দেখানো হয়।")}</p>}
    </div>
  </main></PortalShell>;
}
