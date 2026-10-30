"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { localDateTime, localMessage, localNumber, useLanguage } from "../../lib/use-language";
import { siteTitle } from "../../lib/site-title";
import type { AttendanceSummary } from "../../lib/attendance";
import { ANNOUNCEMENT_AUDIENCES, ANNOUNCEMENT_MAX_LENGTH, AUDIENCE_BADGES, AUDIENCE_CHOICES, POSTED_MESSAGES, type AnnouncementAudience } from "../../lib/announcements";
import { buildGradebook } from "../../lib/gradebook";
import type { Topic } from "../topics-content";
import { groupByCategory } from "@/lib/topic-model";
import PortalShell from "../components/PortalShell";
import ClassAllocation from "../components/ClassAllocation";
import ClassAttendance, { confirmDiscardAttendance } from "../components/ClassAttendance";
import Gradebook from "../components/Gradebook";
import { confirmDiscardPasswords } from "../components/StudentImport";
import ClassSources from "./ClassSources";

type ClassSummary = {
  id: string;
  name: string;
  joinCode: string;
  createdAt: string;
  teacherId: string;
  /** Only in an administrator's all-classes listing. */
  teacherName?: string;
  studentCount: number;
  activityCount: number;
  submissionCount: number;
};

type Question = { prompt: string; options: string[]; answer: number };

type SubmissionRow = {
  id: string;
  studentId: string;
  studentName: string;
  score: number;
  total: number;
  submittedAt: string;
  answers: number[];
};

type ActivityDetail = {
  id: string;
  title: string;
  instructions: string;
  topicId: string | null;
  status: string;
  createdAt: string;
  questions: Question[];
  submissions: SubmissionRow[];
};

type ClassDetail = {
  class: { id: string; name: string; joinCode: string; teacherId: string };
  /** Students now in the class, A–Z (`id` is the roster row; `studentId` is null for a class-code learner). */
  students: Array<{ id: string; studentId: string | null; username: string | null; displayName: string; createdAt: string; attendance: AttendanceSummary | null }>;
  announcements: Array<{ id: string; body: string; audience: AnnouncementAudience; authorName: string | null; createdAt: string }>;
  activities: ActivityDetail[];
};

type TopicProgress = {
  classId: string;
  approvedTopics: number;
  students: Array<{ rosterId: string; displayName: string; topicsRead: number; quizzesDone: number; quizPercent: number | null }>;
};

const emptyQuestion = (): Question => ({ prompt: "", options: ["", ""], answer: 0 });

/** A refused request, keeping the server's reply so its message can be shown in the page language. */
class RequestError extends Error {
  constructor(readonly data: Record<string, unknown>) {
    super(typeof data.error === "string" ? data.error : "The request could not be completed. Please try again.");
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await globalThis.fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new RequestError(data);
  return data as T;
}

export default function TeacherDashboard({ teacherName, userId, isAdmin = false }: { teacherName: string; userId?: string; isAdmin?: boolean }) {
  const [language, toggleLanguage] = useLanguage({ title: siteTitle });
  const s = (en: string, bn: string) => (language === "bn" ? bn : en);
  const number = (value: number) => localNumber(value, language);

  const [classList, setClassList] = useState<ClassSummary[]>([]);
  const [detail, setDetail] = useState<ClassDetail | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [classQuery, setClassQuery] = useState("");
  const [section, setSection] = useState("classes");
  // Temporary passwords from a CSV upload exist only on screen, and attendance ticks are lost until
  // saved: ask before closing or switching the class (or, for attendance, leaving that section).
  const [passwordsOnScreen, setPasswordsOnScreen] = useState(false);
  const [attendanceUnsaved, setAttendanceUnsaved] = useState(false);
  const canLeaveAttendance = () => !attendanceUnsaved || confirmDiscardAttendance(language);
  const canLeaveClass = () => (!passwordsOnScreen || confirmDiscardPasswords(language)) && canLeaveAttendance();
  const totals = classList.reduce((total, item) => ({ students: total.students + item.studentCount, activities: total.activities + item.activityCount, submissions: total.submissions + item.submissionCount }), { students: 0, activities: 0, submissions: 0 });
  const visibleClasses = classList.filter((item) => [item.name, item.teacherName ?? ""].some((text) => text.toLowerCase().includes(classQuery.toLowerCase())));
  // Administrators work in every class: name the teacher of each class they do not own.
  const otherTeacher = (item?: ClassSummary) => (isAdmin && item && item.teacherId !== userId ? item.teacherName : undefined);
  const detailTeacher = detail ? otherTeacher(classList.find((item) => item.id === detail.class.id)) : undefined;
  const classesLabel = isAdmin ? s("All classes", "সব ক্লাস") : s("Your classes", "আপনার ক্লাস");

  const [newClassName, setNewClassName] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [audience, setAudience] = useState<AnnouncementAudience>("all");

  const [activityTitle, setActivityTitle] = useState("");
  const [activityInstructions, setActivityInstructions] = useState("");
  const [activityTopic, setActivityTopic] = useState("");
  const [questions, setQuestions] = useState<Question[]>([emptyQuestion()]);
  // Activities whose per-student submissions table is open in Results.
  const [openSubmissions, setOpenSubmissions] = useState<Set<string>>(new Set());
  const [topicProgress, setTopicProgress] = useState<TopicProgress | null>(null);

  const loadClasses = useCallback(async () => {
    try {
      const data = await requestJson<{ classes: ClassSummary[] }>(isAdmin ? "/api/classes?scope=all" : "/api/classes");
      setClassList(data.classes);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not load classes."); }
    finally { setLoading(false); }
  }, [isAdmin]);

  const loadTopics = useCallback(async () => {
    try {
      const curriculum = await requestJson<{ topics: Topic[] }>("/api/curriculum");
      setTopics(curriculum.topics);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not load the learning topics."); }
  }, []);

  useEffect(() => {
    // Initial data fetch: state updates land after the network round-trip,
    // not synchronously in the effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadClasses();
    void loadTopics();
  }, [loadClasses, loadTopics]);

  // Topics read by the class's students, shown with the class results.
  const resultsClassId = section === "results" ? detail?.class.id : undefined;
  useEffect(() => {
    if (!resultsClassId) return;
    const controller = new AbortController();
    requestJson<Omit<TopicProgress, "classId">>(`/api/classes/${resultsClassId}/topic-progress`, { signal: controller.signal, cache: "no-store" })
      // An abort while the body is read leaves no data: keep what is shown.
      .then((data) => { if (!controller.signal.aborted && Array.isArray(data.students)) setTopicProgress({ ...data, classId: resultsClassId }); })
      .catch(() => { if (!controller.signal.aborted) setTopicProgress(null); });
    return () => controller.abort();
  }, [resultsClassId, detail]);

  async function openClass(id: string) {
    try {
      const data = await requestJson<ClassDetail>(`/api/classes/${id}`);
      setDetail(data);
      if (section === "classes") setSection("students");
      if (data.class.id !== detail?.class.id) setOpenSubmissions(new Set());
    } catch (error) { setMessage(localMessage(error instanceof RequestError ? error.data : null, language, ["Could not open the class.", "ক্লাসটি খোলা যায়নি।"])); }
  }

  /** Switch the workspace section from the sidebar, asking first where unsaved work would be lost. */
  function showSection(id: string) {
    if (id === "classes" && detail ? !canLeaveClass() : section === "attendance" && id !== "attendance" && !canLeaveAttendance()) return;
    setSection(id); setMessage("");
    if (id === "classes") { setDetail(null); void loadClasses(); } else if (detail) void openClass(detail.class.id);
  }

  async function request(url: string, init?: RequestInit) {
    try {
      const response = await globalThis.fetch(url, init);
      if (!response.ok) {
        const data = await response.clone().json().catch(() => ({}));
        setMessage(localMessage(data, language, ["The change could not be saved. Please try again.", "পরিবর্তনটি সংরক্ষণ করা যায়নি। আবার চেষ্টা করুন।"]));
      }
      return response;
    } catch {
      const [error, errorBn] = ["Could not reach the server. Your changes have not been saved.", "সার্ভারে পৌঁছানো যায়নি। আপনার পরিবর্তন সংরক্ষণ হয়নি।"];
      setMessage(s(error, errorBn));
      return Response.json({ error, errorBn }, { status: 503 });
    }
  }

  const createClass = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!newClassName.trim()) { setMessage(s("Enter a class name.", "ক্লাসের নাম দিন।")); return; }
    setBusy(true);
    const response = await request("/api/classes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newClassName.trim() }),
    });
    const data = await response.json().catch(() => ({}));
    setBusy(false);
    if (response.ok) {
      setNewClassName("");
      setMessage(s("Class created. Open it to allocate students.", "ক্লাস তৈরি হয়েছে। শিক্ষার্থী বরাদ্দ করতে খুলুন।"));
      await loadClasses();
    } else setMessage(localMessage(data, language, ["Could not create the class.", "ক্লাস তৈরি করা যায়নি।"]));
  };

  const removeClass = async (id: string) => {
    if (!canLeaveClass()) return;
    const owner = otherTeacher(classList.find((item) => item.id === id));
    const question = owner
      ? s(`Delete ${owner}'s class, its activities and submissions?`, `${owner}-এর ক্লাস, কার্যক্রম ও জমাগুলো মুছে ফেলবেন?`)
      : s("Delete this class, its activities and submissions?", "এই ক্লাস, কার্যক্রম ও জমাগুলো মুছে ফেলবেন?");
    if (!window.confirm(question)) return;
    const response = await request(`/api/classes/${id}`, { method: "DELETE" });
    if (response.ok) {
      setDetail(null);
      setSection("classes");
      await loadClasses();
    }
  };

  const postAnnouncement = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!detail || busy) return;
    if (!announcement.trim()) { setMessage(s("Write an announcement before posting.", "প্রকাশের আগে ঘোষণা লিখুন।")); return; }
    setBusy(true);
    const response = await request(`/api/classes/${detail.class.id}/announcements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: announcement.trim(), audience }),
    });
    setBusy(false);
    if (response.ok) {
      // The audience stays as chosen, so a run of parents-only notes never widens to everyone unnoticed.
      setAnnouncement("");
      setMessage(s(...POSTED_MESSAGES[audience]));
      await openClass(detail.class.id);
    }
  };

  const removeAnnouncement = async (announcementId: string) => {
    if (!detail) return;
    if (!window.confirm(s("Remove this announcement? Students and parents will no longer see it.", "এই ঘোষণাটি মুছবেন? শিক্ষার্থী ও অভিভাবকেরা আর এটি দেখতে পাবেন না।"))) return;
    await request(`/api/classes/${detail.class.id}/announcements`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ announcementId }),
    });
    await openClass(detail.class.id);
  };

  const updateQuestion = (index: number, updater: (question: Question) => Question) => {
    setQuestions((current) => current.map((question, i) => (i === index ? updater(question) : question)));
  };

  const createActivity = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!detail || busy) return;
    setBusy(true);
    const response = await request(`/api/classes/${detail.class.id}/activities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: activityTitle,
        instructions: activityInstructions,
        topicId: activityTopic || undefined,
        questions,
      }),
    });
    const data = await response.json().catch(() => ({}));
    setBusy(false);
    if (response.ok) {
      setActivityTitle("");
      setActivityInstructions("");
      setActivityTopic("");
      setQuestions([emptyQuestion()]);
      setMessage(s("Activity published to the class.", "কার্যক্রমটি ক্লাসে প্রকাশিত হয়েছে।"));
      await openClass(detail.class.id);
    } else setMessage(data.error ?? "Could not create the activity.");
  };

  const setActivityStatus = async (activityId: string, status: "open" | "closed") => {
    if (!detail) return;
    await request(`/api/classes/${detail.class.id}/activities`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activityId, status }),
    });
    await openClass(detail.class.id);
  };

  const removeActivity = async (activityId: string) => {
    if (!detail) return;
    if (!window.confirm(s("Remove this activity and its submissions?", "এই কার্যক্রম ও জমাগুলো মুছবেন?"))) return;
    await request(`/api/classes/${detail.class.id}/activities`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activityId }),
    });
    await openClass(detail.class.id);
  };

  const topicTitle = (topicId: string | null) =>
    topicId ? topics.find((topic) => topic.id === topicId)?.title[language] ?? topicId : null;

  // One row per student now in the class and one column per activity (newest first).
  const gradebook = useMemo(() => buildGradebook(detail?.students ?? [], detail?.activities ?? []), [detail]);
  const toggleSubmissions = (activityId: string) => setOpenSubmissions((current) => {
    const next = new Set(current);
    if (!next.delete(activityId)) next.add(activityId);
    return next;
  });

  const resetSubmission = async (submissionId: string) => {
    if (!detail) return;
    if (!window.confirm(s("Reset this student submission?", "এই শিক্ষার্থীর জমা রিসেট করবেন?"))) return;
    await request(`/api/classes/${detail.class.id}/submissions`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ submissionId }),
    });
    await openClass(detail.class.id);
  };

  return (
    <PortalShell role={isAdmin ? "admin" : "teacher"} name={teacherName} language={language} toggleLanguage={toggleLanguage} active={section} sections={[
      ["classes", isAdmin ? s("All classes", "সব ক্লাস") : s("My classes", "আমার ক্লাস")],
      ["students", s("Students", "শিক্ষার্থী")],
      ["activities", s("Activities & quizzes", "কার্যক্রম ও কুইজ")],
      ["results", s("Results", "ফলাফল")],
      ["attendance", s("Attendance", "উপস্থিতি")],
      ["announcements", s("Announcements", "ঘোষণা")],
      ["sources", s("Class sources", "ক্লাসের উৎস")],
    ].map(([id, label]) => ({ id, label, onClick: () => showSection(id) }))}>
    <main className="adult-app teach-app" lang={language}>
      <header className="adult-header">
        <Link className="adult-brand" href="/">
          <span>বা</span>
          <span>
            <strong>Bangla Adventures</strong>
            <small>{s("Teacher workspace", "শিক্ষকের কর্মক্ষেত্র")}</small>
          </span>
        </Link>
        <nav aria-label={s("Sections", "বিভাগ")}>
          <Link className="active" href="/teach">{s("Classes", "ক্লাস")}</Link>
          <Link href="/family">{s("Family", "পরিবার")}</Link>
          <Link href="/studio">{s("Lessons", "পাঠ")}</Link>
          <Link href="/library">{s("Library", "লাইব্রেরি")}</Link>
          <Link href="/account">{s("My account", "আমার অ্যাকাউন্ট")}</Link>
          {isAdmin && <Link href="/admin">{s("Manage users", "ব্যবহারকারী পরিচালনা")}</Link>}
        </nav>
        <div className="adult-account">
          <button lang={language === "bn" ? "en" : "bn"} type="button" className="explore-lang" onClick={toggleLanguage}>
            {s("বাংলায় দেখুন", "View in English")}
          </button>
          <a href="/api/auth/sign-out?returnTo=%2Fgrown-ups">{s("Sign out", "সাইন আউট")}</a>
        </div>
      </header>

      <div className="adult-content">
        <section className="adult-hero">
          <div>
            <p className="adult-eyebrow">{s(`Welcome, ${teacherName}`, `স্বাগতম, ${teacherName}`)}</p>
            <h1>{s("Run your Bangla-school class here.", "আপনার বাংলা স্কুলের ক্লাস এখানেই চালান।")}</h1>
            <p>
              {s(
                "Create a class, allocate registered students and set learning activities. Use the sidebar to switch between students, quizzes, results, attendance, announcements and class sources.",
                "ক্লাস তৈরি করে নিবন্ধিত শিক্ষার্থীদের বরাদ্দ করুন। পাশের মেনু থেকে শিক্ষার্থী, কুইজ, ফলাফল, উপস্থিতি, ঘোষণা ও ক্লাসের উৎস বেছে নিন।",
              )}
            </p>
            {message && <p className="teach-message" role="status">{message}</p>}
          </div>
        </section>

        <section className="workspace-stats" aria-label={s("Teaching overview", "পড়ানোর সারসংক্ষেপ")}>
          <div><small>{classesLabel}</small><strong>{loading ? "—" : number(classList.length)}</strong></div>
          <div><small>{s("Enrolments", "ভর্তি")}</small><strong>{loading ? "—" : number(totals.students)}</strong></div>
          <div><small>{s("Activities", "কার্যক্রম")}</small><strong>{loading ? "—" : number(totals.activities)}</strong></div>
          <div><small>{s("Submissions", "জমা কাজ")}</small><strong>{loading ? "—" : number(totals.submissions)}</strong></div>
        </section>

        {section !== "classes" && <label className="portal-field">{s("Choose a class", "ক্লাস বেছে নিন")}<select value={detail?.class.id ?? ""} onChange={(event) => { if (event.target.value !== detail?.class.id && !canLeaveClass()) return; void openClass(event.target.value); }}><option value="">{s("Select a class", "ক্লাস নির্বাচন")}</option>{classList.map((item) => <option key={item.id} value={item.id}>{otherTeacher(item) ? `${item.name} — ${otherTeacher(item)}` : item.name}</option>)}</select></label>}
        {/* A class section needs a class: say so, and how to make one, instead of leaving an empty list. */}
        {section !== "classes" && !detail && !loading && (
          <div className="teach-empty">
            <p>{classList.length === 0
              ? isAdmin
                ? s("No teacher has created a class yet. Create one in All classes first.", "এখনো কোনো ক্লাস নেই। আগে “সব ক্লাস”-এ একটি ক্লাস তৈরি করুন।")
                : s("You have no classes yet. Create your first class in My classes, then come back here.", "আপনার এখনো কোনো ক্লাস নেই। আগে “আমার ক্লাস”-এ একটি ক্লাস তৈরি করুন, তারপর এখানে ফিরে আসুন।")
              : s("Choose a class above to continue.", "চালিয়ে যেতে ওপর থেকে একটি ক্লাস বেছে নিন।")}</p>
            {classList.length === 0 && <button type="button" className="outline-button" onClick={() => showSection("classes")}>{isAdmin ? s("Go to All classes", "সব ক্লাসে যান") : s("Go to My classes", "আমার ক্লাসে যান")}</button>}
          </div>
        )}
        {!detail && (
          <>
            <section hidden={section !== "classes"} className="teach-panel" aria-label={classesLabel}>
              <h2>{classesLabel}</h2>
              <form className="teach-inline-form" onSubmit={createClass}>
                <input
                  value={newClassName}
                  onChange={(event) => setNewClassName(event.target.value)}
                  placeholder={s("e.g. Sunday Level 2", "যেমন: রবিবার লেভেল ২")}
                  maxLength={60}
                  required
                  aria-label={s("New class name", "নতুন ক্লাসের নাম")}
                />
                <button className="primary-button" type="submit" disabled={busy}>
                  {s("Create class", "ক্লাস তৈরি করুন")}
                </button>
              </form>
              <label className="teach-search">{s("Find a class", "ক্লাস খুঁজুন")}<input type="search" value={classQuery} onChange={(event) => setClassQuery(event.target.value)} placeholder={isAdmin ? s("Search classes or teachers…", "ক্লাস বা শিক্ষক খুঁজুন…") : s("Search your classes…", "আপনার ক্লাস খুঁজুন…")} /></label>
              {loading ? <p role="status">{isAdmin ? s("Loading all classes…", "সব ক্লাস লোড হচ্ছে…") : s("Loading your classes…", "আপনার ক্লাস লোড হচ্ছে…")}</p> : classList.length === 0 ? (
                <p className="teach-empty">{isAdmin ? s("No teacher has created a class yet.", "এখনো কোনো শিক্ষক ক্লাস তৈরি করেননি।") : s("No classes yet — create your first one above.", "এখনো কোনো ক্লাস নেই — উপরে প্রথমটি তৈরি করুন।")}</p>
              ) : visibleClasses.length === 0 ? <p className="teach-empty">{s("No class matches your search.", "খোঁজ অনুযায়ী কোনো ক্লাস নেই।")}</p> : (
                <div className="teach-class-grid">
                  {visibleClasses.map((item) => (
                    <button type="button" className="teach-class-card" key={item.id} onClick={() => openClass(item.id)}>
                      <strong>{item.name}</strong>
                      {otherTeacher(item) && <small>{s("Teacher", "শিক্ষক")}: {otherTeacher(item)}</small>}
                      <small>
                        {number(item.studentCount)} {s("students", "শিক্ষার্থী")} · {number(item.activityCount)} {s("activities", "কার্যক্রম")} · {number(item.submissionCount)} {s("submissions", "জমা")}
                      </small>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {detail && (
          <>
            <section className="teach-panel teach-class-head" aria-label={detail.class.name}>
              <button type="button" className="topics-back" onClick={() => { if (!canLeaveClass()) return; setDetail(null); setSection("classes"); void loadClasses(); }}>
                ← {s("All classes", "সব ক্লাস")}
              </button>
              <div className="teach-class-title">
                <h2>{detail.class.name}</h2>
                {detailTeacher && <p>{s("Teacher", "শিক্ষক")}: <strong>{detailTeacher}</strong></p>}
                <p>
                  {s("Students see allocated classes in My Learning. No class code is required.", "শিক্ষার্থীরা ড্যাশবোর্ডে বরাদ্দ ক্লাস দেখে। কোনো কোড লাগে না।")}
                </p>
              </div>
              <button type="button" className="text-button danger" onClick={() => removeClass(detail.class.id)}>
                {s("Delete class", "ক্লাস মুছুন")}
              </button>
            </section>

            {/* Hidden rather than unmounted, so moving between sections keeps an upload's temporary passwords. */}
            <div hidden={section !== "students"}><ClassAllocation key={detail.class.id} classId={detail.class.id} language={language} onPasswordsChange={setPasswordsOnScreen} onChange={() => { void loadClasses(); void openClass(detail.class.id); }} /></div>
            <section hidden={section !== "results"} className="teach-panel" aria-label={s("Grades and results", "গ্রেড ও ফলাফল")}>
              <h3>{s("Grades & results", "গ্রেড ও ফলাফল")}</h3>
              <div className="grade-tools">
                <a className="outline-button" href={`/api/classes/${detail.class.id}/grades?format=csv`}>
                  {s("Export CSV", "CSV নামান")}
                </a>
              </div>
              <Gradebook gradebook={gradebook} language={language} />
            </section>

            <section hidden={section !== "results"} className="teach-panel" aria-label={s("Submissions by activity", "কার্যক্রম অনুযায়ী জমা")}>
              <h3>{s("Submissions by activity", "কার্যক্রম অনুযায়ী জমা")}</h3>
              {gradebook.activities.length === 0 ? (
                <p className="teach-empty">{s("No activities yet. Set one in Activities & quizzes.", "এখনো কোনো কার্যক্রম নেই। কার্যক্রম ও কুইজ অংশে একটি দিন।")}</p>
              ) : (
                gradebook.activities.map((column, index) => {
                  const activity = detail.activities.find((item) => item.id === column.id);
                  const submitted = gradebook.rows.filter((row) => row.cells[index]).length;
                  const open = openSubmissions.has(column.id);
                  return (
                    <article className="teach-activity" key={column.id}>
                      <header>
                        <div>
                          <strong>{column.title}</strong>
                          <small>
                            {number(activity?.questions.length ?? 0)} {s("questions", "প্রশ্ন")}
                            {" · "}
                            {activity?.status === "open" ? s("open", "খোলা") : s("closed", "বন্ধ")}
                          </small>
                        </div>
                        <button type="button" className="text-button" aria-expanded={open} onClick={() => toggleSubmissions(column.id)}>
                          {s(`${submitted} of ${gradebook.rows.length} submitted`, `${number(gradebook.rows.length)} জনের মধ্যে ${number(submitted)} জন জমা দিয়েছে`)}
                        </button>
                      </header>
                      {open && (gradebook.rows.length === 0 ? (
                        <p className="teach-empty">{s("No students in this class yet.", "এই ক্লাসে এখনও কোনো শিক্ষার্থী নেই।")}</p>
                      ) : (
                        <div className="management-table-wrap">
                          <table className="teach-submissions">
                            <caption className="sr-only">{column.title}</caption>
                            <thead>
                              <tr>
                                <th>{s("Student", "শিক্ষার্থী")}</th>
                                <th>{s("Score", "স্কোর")}</th>
                                <th>{s("Submitted", "জমার সময়")}</th>
                                <th>{s("Manage", "পরিচালনা")}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {gradebook.rows.map((row) => {
                                const cell = row.cells[index];
                                return (
                                  <tr key={row.student.id}>
                                    <td>{row.student.displayName}</td>
                                    <td>{cell ? `${number(cell.score)}/${number(cell.total)}` : <span className="gradebook-missing-text">—</span>}</td>
                                    <td>{cell ? localDateTime(cell.submittedAt, language) : <span className="gradebook-missing-text">{s("Not submitted", "জমা হয়নি")}</span>}</td>
                                    <td>
                                      {cell && (
                                        <button type="button" className="text-button danger" onClick={() => resetSubmission(cell.id)}>
                                          {s("Reset", "রিসেট")}
                                        </button>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      ))}
                    </article>
                  );
                })
              )}
            </section>

            <section hidden={section !== "results"} className="teach-panel" aria-label={s("Topics read", "পড়া বিষয়")}>
              <h3>{s("Topics read", "পড়া বিষয়")}</h3>
              <p className="teach-note">{s("A topic counts as read when the student marks it complete or finishes its quiz. Quiz results are each student's best score.", "শিক্ষার্থী পড়া সম্পন্ন চিহ্নিত করলে বা কুইজ শেষ করলে বিষয়টি পড়া হিসেবে গোনা হয়। কুইজের ফল হলো প্রত্যেকের সেরা ফল।")}</p>
              {topicProgress?.classId !== detail.class.id ? <p role="status">{s("Loading topics read…", "পড়া বিষয় লোড হচ্ছে…")}</p> : topicProgress.students.length === 0 ? (
                <p className="teach-empty">{s("No students are allocated to this class yet.", "এই ক্লাসে এখনো কোনো শিক্ষার্থী বরাদ্দ নেই।")}</p>
              ) : (
                <div className="management-table-wrap">
                  <table className="management-table">
                    <caption className="sr-only">{s("Topics read and topic quiz results by student", "শিক্ষার্থী অনুযায়ী পড়া বিষয় ও বিষয়-কুইজের ফল")}</caption>
                    <thead><tr><th scope="col">{s("Student", "শিক্ষার্থী")}</th><th scope="col">{s("Topics read", "পড়া বিষয়")}</th><th scope="col">{s("Topic quizzes done", "শেষ করা বিষয়-কুইজ")}</th><th scope="col">{s("Topic quiz average", "বিষয়-কুইজের গড়")}</th></tr></thead>
                    <tbody>{topicProgress.students.map((row) => (
                      <tr key={row.rosterId}>
                        <th scope="row">{row.displayName}</th>
                        <td>{number(row.topicsRead)} / {number(topicProgress.approvedTopics)}</td>
                        <td>{number(row.quizzesDone)}</td>
                        <td>{row.quizPercent === null ? "—" : `${number(row.quizPercent)}%`}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </section>

            {section === "attendance" && <ClassAttendance key={detail.class.id} classId={detail.class.id} language={language} onDirtyChange={setAttendanceUnsaved} onSaved={() => void openClass(detail.class.id)} />}

            {section === "sources" && <ClassSources key={detail.class.id} classId={detail.class.id} language={language} isAdmin={isAdmin} />}

            <section hidden={section !== "announcements"} className="teach-panel" aria-label={s("Announcements", "ঘোষণা")}>
              <h3>{s("Announcements", "ঘোষণা")}</h3>
              <form className="teach-activity-form teach-announcement-form" onSubmit={postAnnouncement}>
                <textarea
                  value={announcement}
                  onChange={(event) => setAnnouncement(event.target.value)}
                  placeholder={s("e.g. This term's theme is festivals — read the Pohela Boishakh topic!", "যেমন: এবারের থিম উৎসব — পহেলা বৈশাখ বিষয়টি পড়ে এসো!")}
                  maxLength={ANNOUNCEMENT_MAX_LENGTH}
                  rows={4}
                  required
                  aria-label={s("New announcement", "নতুন ঘোষণা")}
                />
                <small className="teach-count">{number(announcement.length)} / {number(ANNOUNCEMENT_MAX_LENGTH)}</small>
                <label className="teach-topic-pick">
                  {s("Who can see it", "কারা দেখতে পাবে")}
                  <select value={audience} onChange={(event) => setAudience(event.target.value as AnnouncementAudience)}>
                    {ANNOUNCEMENT_AUDIENCES.map((value) => <option key={value} value={value}>{s(...AUDIENCE_CHOICES[value])}</option>)}
                  </select>
                </label>
                <p className="teach-note">
                  {s(
                    "Parents see announcements in their parent portal once an administrator has linked them to a student in this class.",
                    "প্রশাসক যে অভিভাবকদের এই ক্লাসের কোনো শিক্ষার্থীর সঙ্গে যুক্ত করেছেন, তাঁরা অভিভাবক পোর্টালে ঘোষণা দেখতে পান।",
                  )}
                </p>
                <div className="teach-form-actions">
                  <button className="primary-button" type="submit" disabled={busy}>
                    {s("Post", "প্রকাশ")}
                  </button>
                </div>
              </form>
              {detail.announcements.length === 0 ? (
                <p className="teach-empty">{s("No announcements yet.", "এখনও কোনো ঘোষণা নেই।")}</p>
              ) : (
                <ul className="teach-announcements">
                  {detail.announcements.map((item) => (
                    <li key={item.id}>
                      <div>
                        <p className="announcement-meta">
                          <span className={`audience-badge ${item.audience}`}>{s(...AUDIENCE_BADGES[item.audience])}</span>
                          <small>{item.authorName ? s(`Posted by ${item.authorName}`, `${item.authorName} লিখেছেন`) : s("Posted by a former staff member", "একজন প্রাক্তন কর্মী লিখেছেন")} · <time>{localDateTime(item.createdAt, language)}</time></small>
                        </p>
                        <p className="announcement-body">{item.body}</p>
                      </div>
                      <button type="button" className="text-button danger" onClick={() => removeAnnouncement(item.id)}>
                        {s("Remove", "মুছুন")}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section hidden={section !== "activities"} className="teach-panel" aria-label={s("New activity", "নতুন কার্যক্রম")}>
              <h3>{s("Set a quiz or activity", "কুইজ বা কার্যক্রম দিন")}</h3>
              <form className="teach-activity-form" onSubmit={createActivity}>
                <input
                  value={activityTitle}
                  onChange={(event) => setActivityTitle(event.target.value)}
                  placeholder={s("Activity title, e.g. Festivals check-in", "কার্যক্রমের নাম, যেমন: উৎসব যাচাই")}
                  maxLength={120}
                  aria-label={s("Activity title", "কার্যক্রমের নাম")}
                  required
                />
                <textarea
                  value={activityInstructions}
                  onChange={(event) => setActivityInstructions(event.target.value)}
                  placeholder={s("Instructions for students (optional)", "শিক্ষার্থীদের জন্য নির্দেশনা (ঐচ্ছিক)")}
                  maxLength={1000}
                  aria-label={s("Activity instructions", "কার্যক্রমের নির্দেশনা")}
                  rows={2}
                />
                <label className="teach-topic-pick">
                  {s("Link a classroom topic (students get a 'read this first' pointer):", "শ্রেণিকক্ষ-বিষয় যুক্ত করুন (শিক্ষার্থীরা ‘আগে এটি পড়ো’ নির্দেশ পাবে):")}
                  <select value={activityTopic} onChange={(event) => setActivityTopic(event.target.value)}>
                    <option value="">{s("No linked topic", "কোনো বিষয় নয়")}</option>
                    {groupByCategory(topics).map(({ category, items }) => (
                      <optgroup key={category.id} label={category.title[language]}>
                        {items.map((topic) => <option key={topic.id} value={topic.id}>{topic.title[language]}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </label>

                {questions.map((question, questionIndex) => (
                  <fieldset className="teach-question" key={questionIndex}>
                    <legend>{s("Question", "প্রশ্ন")} {questionIndex + 1}</legend>
                    <input
                      value={question.prompt}
                      onChange={(event) => updateQuestion(questionIndex, (q) => ({ ...q, prompt: event.target.value }))}
                      placeholder={s("The question prompt", "প্রশ্নটি লিখুন")}
                      maxLength={300}
                      aria-label={s(`Question ${questionIndex + 1}`, `প্রশ্ন ${questionIndex + 1}`)}
                      required
                    />
                    {question.options.map((option, optionIndex) => (
                      <div className="teach-option-row" key={optionIndex}>
                        <input
                          type="radio"
                          name={`answer-${questionIndex}`}
                          checked={question.answer === optionIndex}
                          onChange={() => updateQuestion(questionIndex, (q) => ({ ...q, answer: optionIndex }))}
                          aria-label={s("Mark as the correct answer", "সঠিক উত্তর চিহ্নিত করুন")}
                        />
                        <input
                          value={option}
                          onChange={(event) =>
                            updateQuestion(questionIndex, (q) => ({
                              ...q,
                              options: q.options.map((item, i) => (i === optionIndex ? event.target.value : item)),
                            }))
                          }
                          placeholder={`${s("Option", "অপশন")} ${optionIndex + 1}`}
                          maxLength={200}
                          aria-label={s(`Question ${questionIndex + 1} option ${optionIndex + 1}`, `প্রশ্ন ${questionIndex + 1}, অপশন ${optionIndex + 1}`)}
                          required
                        />
                        {question.options.length > 2 && (
                          <button
                            type="button"
                            className="text-button danger"
                            onClick={() =>
                              updateQuestion(questionIndex, (q) => ({
                                ...q,
                                options: q.options.filter((_, i) => i !== optionIndex),
                                answer: q.answer === optionIndex ? 0 : q.answer > optionIndex ? q.answer - 1 : q.answer,
                              }))
                            }
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                    <div className="teach-question-actions">
                      {question.options.length < 6 && (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => updateQuestion(questionIndex, (q) => ({ ...q, options: [...q.options, ""] }))}
                        >
                          + {s("Add option", "অপশন যোগ")}
                        </button>
                      )}
                      {questions.length > 1 && (
                        <button
                          type="button"
                          className="text-button danger"
                          onClick={() => setQuestions((current) => current.filter((_, i) => i !== questionIndex))}
                        >
                          {s("Remove question", "প্রশ্ন বাদ দিন")}
                        </button>
                      )}
                    </div>
                  </fieldset>
                ))}

                <div className="teach-form-actions">
                  {questions.length < 20 && (
                    <button type="button" className="text-button" onClick={() => setQuestions((current) => [...current, emptyQuestion()])}>
                      + {s("Add question", "প্রশ্ন যোগ করুন")}
                    </button>
                  )}
                  <button className="primary-button" type="submit" disabled={busy}>
                    {s("Publish to the class", "ক্লাসে প্রকাশ করুন")}
                  </button>
                </div>
              </form>
            </section>

            <section hidden={section !== "activities"} className="teach-panel" aria-label={s("Activities and submissions", "কার্যক্রম ও জমা")}>
              <h3>{s("Activities & submissions", "কার্যক্রম ও জমা")}</h3>
              {detail.activities.length === 0 ? (
                <p className="teach-empty">{s("No activities yet.", "এখনো কোনো কার্যক্রম নেই।")}</p>
              ) : (
                <>
                  <p className="teach-note">{s("Scores for each student are in Results.", "প্রত্যেক শিক্ষার্থীর স্কোর ফলাফল অংশে আছে।")}</p>
                  {detail.activities.map((activity) => (
                    <article className="teach-activity" key={activity.id}>
                      <header>
                        <div>
                          <strong>{activity.title}</strong>
                          <small>
                            {number(activity.questions.length)} {s("questions", "প্রশ্ন")}
                            {activity.topicId && <> · {s("topic:", "বিষয়:")} {topicTitle(activity.topicId)}</>}
                            {" · "}
                            {activity.status === "open" ? s("open", "খোলা") : s("closed", "বন্ধ")}
                            {" · "}
                            {s(`${activity.submissions.length} of ${detail.students.length} submitted`, `${number(detail.students.length)} জনের মধ্যে ${number(activity.submissions.length)} জন জমা দিয়েছে`)}
                          </small>
                        </div>
                        <div className="teach-activity-buttons">
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => setActivityStatus(activity.id, activity.status === "open" ? "closed" : "open")}
                          >
                            {activity.status === "open" ? s("Close", "বন্ধ করুন") : s("Reopen", "আবার খুলুন")}
                          </button>
                          <button type="button" className="text-button danger" onClick={() => removeActivity(activity.id)}>
                            {s("Delete", "মুছুন")}
                          </button>
                        </div>
                      </header>
                    </article>
                  ))}
                </>
              )}
            </section>
          </>
        )}
      </div>
    </main>
    </PortalShell>
  );
}
