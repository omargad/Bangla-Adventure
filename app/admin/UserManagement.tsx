"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { localDateTime as localTime, MessageError, serverMessage, useLanguage, type Message } from "@/lib/use-language";
import FamilyLinks from "./FamilyLinks";
import FamilyImport from "./FamilyImport";
import { confirmDiscardPasswords } from "../components/StudentImport";
import PortalShell from "../components/PortalShell";

type User = { id: string; kind: "adult" | "student"; displayName: string; email?: string; username?: string; role: string; status: string; teacherStatus: string; approvalStatus: string; mustChangePassword?: boolean; createdAt: string };
type UsersPage = { users: User[]; total: number; pageSize: number; stats: { adults: number; students: number; teachers: number; pending: number }; approvals: { users: User[]; total: number }; audit: { id: string; action: string; targetType: string; targetId: string; targetLabel: { en: string; bn: string } | null; createdAt: string }[] };
/** Every action written to the audit log, in both languages; an unknown one is shown as it is stored. */
const AUDIT_ACTIONS: Record<string, Message> = {
  created: ["Account created", "অ্যাকাউন্ট তৈরি"],
  update: ["Account changed", "অ্যাকাউন্ট বদলানো হয়েছে"],
  approve: ["Teacher request approved", "শিক্ষক হওয়ার আবেদন অনুমোদিত"],
  reject: ["Teacher request declined", "শিক্ষক হওয়ার আবেদন প্রত্যাখ্যাত"],
  "account-approved": ["Account approved", "অ্যাকাউন্ট অনুমোদিত"],
  "account-declined": ["Account declined", "অ্যাকাউন্ট প্রত্যাখ্যাত"],
  "revoke-sessions": ["Signed out everywhere", "সব জায়গা থেকে সাইন আউট"],
  "password-reset": ["Password reset", "পাসওয়ার্ড রিসেট"],
  "password-changed": ["Password changed", "পাসওয়ার্ড বদলানো হয়েছে"],
  "student-password-changed": ["Student changed their password", "শিক্ষার্থী পাসওয়ার্ড বদলেছে"],
  "teacher-requested": ["Asked to become a teacher", "শিক্ষক হওয়ার আবেদন"],
  "parent-linked": ["Parent linked", "অভিভাবক যুক্ত"],
  "parent-unlinked": ["Parent link removed", "অভিভাবকের সংযোগ সরানো হয়েছে"],
  "student-provisioned": ["Student account made for a class", "ক্লাসের জন্য শিক্ষার্থীর অ্যাকাউন্ট তৈরি"],
  "class-allocated": ["Added to a class", "ক্লাসে যোগ করা হয়েছে"],
  "class-allocation-removed": ["Removed from a class", "ক্লাস থেকে সরানো হয়েছে"],
  "class-created-for-teacher": ["Class created for a teacher", "শিক্ষকের জন্য ক্লাস তৈরি"],
  "class-teacher-changed": ["Class given to another teacher", "ক্লাসের শিক্ষক বদল"],
  "class-deleted": ["Class deleted", "ক্লাস মুছে ফেলা হয়েছে"],
  "submission-reset": ["Quiz answers reset", "কুইজের উত্তর রিসেট"],
  "announcement-removed": ["Announcement removed", "ঘোষণা সরানো হয়েছে"],
  "class-source-added": ["Class source added", "ক্লাসের উৎস যোগ"],
  "class-source-updated": ["Class source changed", "ক্লাসের উৎস বদলানো হয়েছে"],
  "class-source-removed": ["Class source removed", "ক্লাসের উৎস সরানো হয়েছে"],
  "topic-created": ["Topic written", "বিষয় লেখা হয়েছে"],
  "topic-edit-submitted": ["Topic edit sent for approval", "বিষয়ের সম্পাদনা অনুমোদনের জন্য পাঠানো হয়েছে"],
  "topic-version-approved": ["Topic approved", "বিষয় অনুমোদিত"],
  "topic-version-rejected": ["Topic edit sent back", "বিষয়ের সম্পাদনা ফেরত পাঠানো হয়েছে"],
  "topic-withdrawn": ["Topic withdrawn from students", "শিক্ষার্থীদের কাছ থেকে বিষয় সরানো হয়েছে"],
  "topic-review-confirmed": ["Topic review confirmed", "বিষয়ের পর্যালোচনা নিশ্চিত"],
  "topic-restored": ["Topic approved again", "বিষয় আবার অনুমোদিত"],
  "lesson-approved": ["Lesson approved", "পাঠ অনুমোদিত"],
  "lesson-withdrawn": ["Lesson withdrawn from students", "শিক্ষার্থীদের কাছ থেকে পাঠ সরানো হয়েছে"],
  "lesson-audio-uploaded": ["Lesson recording uploaded", "পাঠের রেকর্ডিং আপলোড"],
  "lesson-video-checked": ["Lesson video checked", "পাঠের ভিডিও যাচাই"],
  "library-link-updated": ["Textbook link changed", "পাঠ্যবইয়ের লিংক বদলানো হয়েছে"],
  "library-link-held": ["Older textbook link held for a check", "পুরোনো পাঠ্যবইয়ের লিংক যাচাইয়ের জন্য আটকে রাখা হয়েছে"],
  "library-link-restored": ["Held textbook link restored", "আটকে রাখা লিংক ফিরিয়ে আনা হয়েছে"],
  "library-link-discarded": ["Held textbook link discarded", "আটকে রাখা লিংক বাদ দেওয়া হয়েছে"],
  "library-source-added": ["Textbook source added", "পাঠ্যবইয়ের উৎস যোগ"],
  "library-source-updated": ["Textbook details changed", "পাঠ্যবইয়ের তথ্য বদলানো হয়েছে"],
  "library-source-reset": ["Textbook changes undone", "পাঠ্যবইয়ের পরিবর্তন বাতিল"],
  "library-source-hidden": ["Textbook hidden", "পাঠ্যবই লুকানো হয়েছে"],
  "library-source-shown": ["Textbook shown again", "পাঠ্যবই আবার দেখানো হচ্ছে"],
};
const AUDIT_TARGETS: Record<string, Message> = {
  adult: ["Adult", "বড়দের অ্যাকাউন্ট"], student: ["Student", "শিক্ষার্থী"], "class-student": ["Class list entry", "ক্লাসের তালিকা"],
  class: ["Class", "ক্লাস"], topic: ["Topic", "বিষয়"], lesson: ["Lesson", "পাঠ"], "library-source": ["Textbook", "পাঠ্যবই"],
};

const failed = (error: unknown, fallback: Message): Message => error instanceof MessageError ? error.text : fallback;
const tryAgain: Message = ["Please try again.", "আবার চেষ্টা করুন।"];

/** Sign-in details shown once after an administrator creates an account or resets a password. */
type Credentials = { reason: "created" | "reset"; kind: "adult" | "student"; displayName: string; account: string; temporaryPassword: string; recoveryCodes: string[]; signInUrl: string };

export default function UserManagement({ actorId, actorName }: { actorId: string; actorName: string }) {
  const [language, toggleLanguage] = useLanguage({ title: ["User management | Bangla Adventures", "ব্যবহারকারী ব্যবস্থাপনা | Bangla Adventures"] });
  const s = (en: string, bn: string) => language === "bn" ? bn : en;
  const pick = ([en, bn]: Message) => s(en, bn);
  const number = (value: number | undefined) => value === undefined ? "—" : value.toLocaleString(language === "bn" ? "bn-BD" : "en-AU");
  const [kind, setKind] = useState<"adult" | "student">("adult");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<UsersPage | null>(null);
  const [error, setError] = useState<string | Message>("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<User | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createType, setCreateType] = useState<"parent" | "teacher" | "student">("parent");
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [familyStudent, setFamilyStudent] = useState<User | null>(null);
  const [showFamilyImport, setShowFamilyImport] = useState(false);
  // A family import's sign-in sheet keeps its panel open; a new key clears it.
  const [familySheetShown, setFamilySheetShown] = useState(false);
  const [familyImportKey, setFamilyImportKey] = useState(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ kind, filter, q: search, page: String(page) });
      const response = await fetch(`/api/admin/users?${params}`, { signal });
      const payload = await response.json();
      if (!response.ok) throw new MessageError(serverMessage(payload, ["Could not load users.", "ব্যবহারকারীদের লোড করা যায়নি।"]));
      setData(payload);
      setError("");
    } catch (error) {
      if (signal?.aborted) return;
      setData(null);
      setError(failed(error, ["Could not load users.", "ব্যবহারকারীদের লোড করা যায়নি।"]));
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [kind, filter, search, page]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [load]);

  // The temporary password exists nowhere else: warn before a reload or closing the tab loses it.
  useEffect(() => {
    if (!credentials) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [credentials]);

  async function update(user: User, values: Record<string, unknown>) {
    if (busy) return;
    if ((values.action || (values.role && values.role !== user.role) || values.status !== undefined) && !window.confirm(s(`Apply this change to ${user.displayName}? Permission changes sign the user out.`, `${user.displayName}-এর এই পরিবর্তনটি করবেন? অনুমতি বদলালে সাইন আউট হবে।`))) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: user.kind, ...values }) });
      const payload = await response.json();
      if (!response.ok) throw new MessageError(serverMessage(payload, ["Could not update the user.", "অ্যাকাউন্টটি হালনাগাদ করা যায়নি।"]));
      setEditing(null);
      setNotice(values.action === "approve" || values.action === "reject" ? decisionNotice(user, payload.user) : s("Account updated. The action has been recorded.", "অ্যাকাউন্ট হালনাগাদ হয়েছে। পরিবর্তনটি নথিভুক্ত হয়েছে।"));
      await load();
    } catch (error) { setError(failed(error, tryAgain)); }
    finally { setBusy(false); }
  }

  /** What an approval decision did, from the account as it was and as the server left it. */
  function decisionNotice(before: User, after: User) {
    const name = before.displayName;
    const recorded = s(" The action has been recorded.", " পরিবর্তনটি নথিভুক্ত হয়েছে।");
    // An approved parent's teacher request: only the request was decided; the parent account is unchanged.
    if (before.approvalStatus === "approved") return (after.role === "teacher"
      ? s(`${name} is now an approved teacher.`, `${name} এখন অনুমোদিত শিক্ষক।`)
      : s(`${name}’s teacher request was declined. Their parent account is unchanged and they can still sign in.`, `${name}-এর শিক্ষক হওয়ার আবেদন প্রত্যাখ্যান করা হয়েছে। তাঁর অভিভাবক অ্যাকাউন্ট আগের মতোই আছে, তিনি সাইন ইন করতে পারবেন।`)) + recorded;
    if (after.approvalStatus === "declined") return s(`${name} was declined and cannot sign in. You can approve the account later.`, `${name}-কে প্রত্যাখ্যান করা হয়েছে, তিনি সাইন ইন করতে পারবেন না। পরে চাইলে অনুমোদন দিতে পারবেন।`) + recorded;
    return (after.role === "teacher"
      ? s(`${name} is approved as a teacher and can now sign in.`, `${name} শিক্ষক হিসেবে অনুমোদিত হয়েছেন এবং এখন সাইন ইন করতে পারবেন।`)
      : s(`${name} is approved and can now sign in.`, `${name} অনুমোদিত হয়েছেন এবং এখন সাইন ইন করতে পারবেন।`)) + recorded;
  }

  // Only one set of sign-in details is shown at a time: replacing it loses that temporary password for good.
  // A family import's sheet counts too: it is discarded (after asking) before new details are shown.
  const credentialsReplaced = () => !credentials || window.confirm(s(`The sign-in details for ${credentials.displayName} are still shown and will be replaced; that temporary password cannot be shown again. Continue?`, `${credentials.displayName}-এর সাইন-ইন তথ্য এখনও দেখানো হচ্ছে, সেটি সরে যাবে; ওই অস্থায়ী পাসওয়ার্ড আর দেখানো যাবে না। এগিয়ে যাবেন?`));
  function replaceCredentials() {
    if (familySheetShown) {
      if (!confirmDiscardPasswords(language)) return false;
      setFamilyImportKey((key) => key + 1);
    }
    return credentialsReplaced();
  }

  // A family import replaces any single account's sign-in details still on screen.
  function beforeFamilyImport() {
    if (!credentialsReplaced()) return false;
    setCredentials(null);
    return true;
  }

  function closeFamilyImport() {
    if (familySheetShown && !confirmDiscardPasswords(language)) return;
    setFamilySheetShown(false); setShowFamilyImport(false);
  }

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !replaceCredentials()) return;
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...values, kind: createType === "student" ? "student" : "adult", role: createType }) });
      const payload = await response.json();
      if (!response.ok) throw new MessageError(serverMessage(payload, ["Could not create the account.", "অ্যাকাউন্টটি তৈরি করা যায়নি।"]));
      form.reset();
      setShowCreate(false);
      setCredentials({ reason: "created", kind: payload.user.kind, displayName: payload.user.displayName, account: payload.user.email ?? payload.user.username, temporaryPassword: payload.temporaryPassword, recoveryCodes: payload.recoveryCodes ?? [], signInUrl: `${window.location.origin}${payload.user.kind === "student" ? "/student" : "/grown-ups"}` });
      setNotice(s("Account created. Give the person their sign-in details privately.", "অ্যাকাউন্ট তৈরি হয়েছে। সাইন-ইন তথ্য ব্যক্তিগতভাবে সংশ্লিষ্ট ব্যক্তিকে দিন।"));
      await load();
    } catch (error) { setError(failed(error, tryAgain)); }
    finally { setBusy(false); }
  }

  async function resetPassword(user: User) {
    if (busy || !replaceCredentials()) return;
    if (!window.confirm(s(`Reset the password for ${user.displayName}? They are signed out everywhere and must choose a new password at their next sign-in.`, `${user.displayName}-এর পাসওয়ার্ড রিসেট করবেন? সব জায়গা থেকে সাইন আউট হবে এবং পরের বার সাইন ইন করে নতুন পাসওয়ার্ড বেছে নিতে হবে।`))) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}/password`, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: user.kind }) });
      const payload = await response.json();
      if (!response.ok) throw new MessageError(serverMessage(payload, ["Could not reset the password.", "পাসওয়ার্ড রিসেট করা যায়নি।"]));
      setEditing(null); setShowCreate(false);
      setCredentials({ reason: "reset", kind: payload.user.kind, displayName: payload.user.displayName, account: payload.user.email ?? payload.user.username, temporaryPassword: payload.temporaryPassword, recoveryCodes: [], signInUrl: `${window.location.origin}${payload.user.kind === "student" ? "/student" : "/grown-ups"}` });
      setNotice(s("Password reset. The action has been recorded.", "পাসওয়ার্ড রিসেট হয়েছে। পরিবর্তনটি নথিভুক্ত হয়েছে।"));
      await load();
    } catch (error) { setError(failed(error, tryAgain)); }
    finally { setBusy(false); }
  }

  function hideCredentials() {
    if (window.confirm(s("Hide the sign-in details? The temporary password cannot be shown again.", "সাইন-ইন তথ্য লুকাবেন? অস্থায়ী পাসওয়ার্ড আর দেখানো যাবে না।"))) setCredentials(null);
  }

  // A teacher applicant declined at sign-up keeps the request: approving the account later grants it.
  const declinedApplicant = (user: User) => user.approvalStatus === "declined" && user.teacherStatus === "rejected";
  const accountType = (user: User) => user.kind === "student" ? s("Student", "শিক্ষার্থী") : user.teacherStatus === "pending" || declinedApplicant(user) ? s("Teacher request", "শিক্ষক হওয়ার আবেদন") : s("Parent", "অভিভাবক");
  const roleLabel = (user: User) => user.kind === "student" ? s("Student", "শিক্ষার্থী")
    // A teacher applicant who cannot sign in yet is a request, as in the approval queue, not a parent.
    : user.approvalStatus !== "approved" && (user.teacherStatus === "pending" || declinedApplicant(user)) ? s("Teacher request", "শিক্ষক হওয়ার আবেদন")
    : user.role === "admin" ? s("Administrator", "প্রশাসক") : user.role === "teacher" ? s("Teacher", "শিক্ষক") : s("Parent", "অভিভাবক");
  const statusLabel = (user: User) => user.status === "active" ? s("Active", "সক্রিয়") : s("Suspended", "স্থগিত");
  const roleOptions = <><option value="parent">{s("Parent", "অভিভাবক")}</option><option value="teacher">{s("Teacher", "শিক্ষক")}</option><option value="admin">{s("Administrator", "প্রশাসক")}</option></>;
  const undecided = (user: User) => user.approvalStatus !== "approved" || user.teacherStatus === "pending";
  // A suspended account is reactivated before anyone approves or declines it.
  const decisionButtons = (user: User) => user.status === "active" && <>
    {(user.approvalStatus === "pending" || user.teacherStatus === "pending") && <><button className="outline-button" disabled={busy} onClick={() => void update(user, { action: "approve" })}>{s("Approve", "অনুমোদন")}</button><button className="text-button" disabled={busy} onClick={() => void update(user, { action: "reject" })}>{s("Decline", "প্রত্যাখ্যান")}</button></>}
    {user.approvalStatus === "declined" && <button className="outline-button" disabled={busy} onClick={() => void update(user, { action: "approve" })}>{declinedApplicant(user) ? s("Approve as teacher", "শিক্ষক হিসেবে অনুমোদন") : s("Approve", "অনুমোদন")}</button>}
  </>;

  return <PortalShell role="admin" name={actorName} active="admin-users" language={language} toggleLanguage={toggleLanguage}><main className="adult-app management-app" lang={language}>
    <header className="adult-header">
      <Link className="adult-brand" href="/"><span>বা</span><span><strong>Bangla Adventures</strong><small>{s("Administration", "প্রশাসন")}</small></span></Link>
      <nav aria-label={s("Administration", "প্রশাসন")}><Link className="active" href="/admin">{s("Users", "ব্যবহারকারী")}</Link><Link href="/teach">{s("Teacher workspace", "শিক্ষকের কর্মক্ষেত্র")}</Link><Link href="/account">{s("My account", "আমার অ্যাকাউন্ট")}</Link></nav>
      <div className="adult-account"><button className="outline-button" onClick={toggleLanguage}>{s("বাংলা", "English")}</button><a href="/api/auth/sign-out?returnTo=%2F">{s("Sign out", "সাইন আউট")}</a></div>
    </header>
    <div className="adult-content">
      <section className="management-heading"><div><p className="adult-eyebrow">{s(`Welcome, ${actorName}`, `স্বাগতম, ${actorName}`)}</p><h1>{s("People make the adventure", "মানুষের হাতেই অভিযানের শুরু")}</h1><p>{s("Approve new accounts, support families and keep account access under control.", "নতুন অ্যাকাউন্ট অনুমোদন করুন, পরিবারকে সহায়তা করুন ও অ্যাকাউন্টের প্রবেশাধিকার পরিচালনা করুন।")}</p></div><div className="management-heading-actions"><button className="outline-button" aria-expanded={showFamilyImport || familySheetShown} onClick={() => showFamilyImport || familySheetShown ? closeFamilyImport() : setShowFamilyImport(true)}>{s("Import families (CSV)", "পরিবার যোগ করুন (CSV)")}</button><button className="primary-button" onClick={() => { setShowCreate(!showCreate); setEditing(null); }}>{showCreate ? s("Close form", "ফর্ম বন্ধ করুন") : s("Create user", "ব্যবহারকারী তৈরি")}</button></div></section>
      {error && <p role="alert" className="auth-error">{typeof error === "string" ? error : pick(error)}</p>}
      {notice && <p role="status" className="teach-message">{notice}</p>}
      <section className="workspace-stats" aria-label={s("User overview", "ব্যবহারকারীদের সারসংক্ষেপ")}>
        <div><small>{s("Adult accounts", "বড়দের অ্যাকাউন্ট")}</small><strong>{number(data?.stats.adults)}</strong></div>
        <div><small>{s("Students", "শিক্ষার্থী")}</small><strong>{number(data?.stats.students)}</strong></div>
        <div><small>{s("Active teachers", "সক্রিয় শিক্ষক")}</small><strong>{number(data?.stats.teachers)}</strong></div>
        <button onClick={() => { const queue = document.getElementById("approval-queue-title"); queue?.scrollIntoView({ block: "start" }); queue?.focus(); }}><small>{s("Awaiting approval", "অনুমোদনের অপেক্ষায়")}</small><strong>{number(data?.stats.pending)}</strong></button>
      </section>
      {credentials && <section className="teach-panel" aria-labelledby="credential-sheet-title">
        <h2 id="credential-sheet-title">{credentials.reason === "created" ? s("Account created", "অ্যাকাউন্ট তৈরি হয়েছে") : s("Password reset", "পাসওয়ার্ড রিসেট হয়েছে")}: {credentials.displayName}</h2>
        <p><strong>{s("Print or copy these sign-in details now — the temporary password will not be shown again.", "এখনই সাইন-ইন তথ্য প্রিন্ট বা কপি করে রাখুন — অস্থায়ী পাসওয়ার্ড আর দেখানো হবে না।")}</strong> {s("Give them to the person privately; nothing is sent by email.", "তথ্যগুলো ব্যক্তিগতভাবে সংশ্লিষ্ট ব্যক্তিকে দিন; কোনো ইমেইল পাঠানো হয় না।")}</p>
        <div className="student-import-actions"><button type="button" className="primary-button" onClick={() => window.print()}>{s("Print sign-in details", "সাইন-ইন তথ্য প্রিন্ট করুন")}</button><button type="button" className="text-button" onClick={hideCredentials}>{s("Hide sign-in details", "সাইন-ইন তথ্য লুকান")}</button></div>
        <div className="credential-sheet">
          <h3>{s("Bangla Adventures sign-in details", "Bangla Adventures সাইন-ইন তথ্য")}</h3>
          <dl>
            <div><dt>{s("Name", "নাম")}</dt><dd>{credentials.displayName}</dd></div>
            <div><dt>{credentials.kind === "student" ? s("Username", "ব্যবহারকারীর নাম") : s("Email", "ইমেইল")}</dt><dd><code>{credentials.account}</code></dd></div>
            <div><dt>{s("Temporary password", "অস্থায়ী পাসওয়ার্ড")}</dt><dd><code>{credentials.temporaryPassword}</code></dd></div>
            <div><dt>{s("Sign in at", "সাইন ইনের ঠিকানা")}</dt><dd>{credentials.signInUrl}</dd></div>
          </dl>
          <p>{s("At the first sign-in you will be asked to choose your own password. Only you will know it.", "প্রথমবার সাইন ইন করলে নিজের পাসওয়ার্ড বেছে নিতে বলা হবে। সেটি শুধু আপনিই জানবেন।")}</p>
          {credentials.recoveryCodes.length > 0 && <>
            <h4>{s("Recovery codes", "পুনরুদ্ধার কোড")}</h4>
            <p>{s("One-time password-recovery codes: if the password is forgotten, each code can be used once to choose a new one. They are not a second sign-in step. A new set is given when you choose your own password, and these codes then stop working.", "এককালীন পাসওয়ার্ড পুনরুদ্ধার কোড: পাসওয়ার্ড ভুলে গেলে প্রতিটি কোড একবার ব্যবহার করে নতুন পাসওয়ার্ড বেছে নেওয়া যায়। এগুলো সাইন ইনের দ্বিতীয় ধাপ নয়। নিজের পাসওয়ার্ড বেছে নিলে নতুন কোড দেওয়া হবে, তখন এই কোডগুলো আর কাজ করবে না।")}</p>
            <ul className="auth-codes" aria-label={s("One-time recovery codes", "এককালীন পুনরুদ্ধার কোড")}>{credentials.recoveryCodes.map((code) => <li key={code}><code>{code}</code></li>)}</ul>
          </>}
        </div>
      </section>}
      {(showFamilyImport || familySheetShown) && <FamilyImport key={familyImportKey} language={language} onImported={() => void load()} onPasswordsChange={setFamilySheetShown} beforeUpload={beforeFamilyImport} onClose={closeFamilyImport} />}
      {familyStudent && <FamilyLinks key={familyStudent.id} student={familyStudent} language={language} onClose={() => setFamilyStudent(null)} />}
      {showCreate && <section className="teach-panel"><h2>{s("Create an account", "অ্যাকাউন্ট তৈরি করুন")}</h2><form className="management-form" onSubmit={create}>
        <label>{s("Account type", "অ্যাকাউন্টের ধরন")}<select name="accountType" required value={createType} onChange={(event) => setCreateType(event.target.value as "parent" | "teacher" | "student")}><option value="parent">{s("Parent", "অভিভাবক")}</option><option value="teacher">{s("Approved teacher", "অনুমোদিত শিক্ষক")}</option><option value="student">{s("Student", "শিক্ষার্থী")}</option></select></label>
        <label>{s("Display name", "প্রদর্শিত নাম")}<input name="displayName" maxLength={60} required /></label>
        {createType === "student"
          ? <label key="username">{s("Username", "ব্যবহারকারীর নাম")}<input name="username" required minLength={3} maxLength={40} pattern="[a-zA-Z0-9._-]+" title={s("Use 3–40 letters, numbers, dots, dashes or underscores.", "৩–৪০টি অক্ষর, সংখ্যা, ডট, ড্যাশ বা আন্ডারস্কোর ব্যবহার করুন।")} autoComplete="off" /></label>
          : <label key="email">{s("Email", "ইমেইল")}<input name="email" type="email" required maxLength={120} autoComplete="off" /></label>}
        <p>{s("A temporary password is created and shown once, ready to print. The person chooses their own password the first time they sign in. No child email or birth date is needed.", "একটি অস্থায়ী পাসওয়ার্ড তৈরি হয়ে একবারই দেখানো হবে, প্রিন্ট করে নিতে পারবেন। প্রথমবার সাইন ইন করার সময় ব্যক্তি নিজের পাসওয়ার্ড বেছে নেবেন। শিশুর ইমেইল বা জন্মতারিখের প্রয়োজন নেই।")}</p>
        <button className="primary-button" disabled={busy}>{busy ? s("Creating…", "তৈরি হচ্ছে…") : s("Create account", "অ্যাকাউন্ট তৈরি")}</button>
      </form></section>}
      {editing && <section className="teach-panel"><h2>{s("Edit account", "অ্যাকাউন্ট সম্পাদনা")}: {editing.displayName}</h2><form key={editing.id} className="management-form" onSubmit={(event) => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); void update(editing, values); }}>
        <label>{s("Display name", "প্রদর্শিত নাম")}<input name="displayName" defaultValue={editing.displayName} maxLength={60} required /></label>
        {editing.kind === "adult" && <label>{s("Role", "ভূমিকা")}<select name="role" defaultValue={editing.role} disabled={editing.id === actorId}>{roleOptions}</select></label>}
        <p>{s("Role changes revoke existing sessions. Teachers cannot access other teachers’ classes.", "ভূমিকা বদলালে পুরোনো সেশন বাতিল হবে। শিক্ষকেরা অন্য শিক্ষকের ক্লাসে প্রবেশ করতে পারবেন না।")}</p>
        <div className="access-actions"><button className="primary-button" disabled={busy}>{s("Save changes", "পরিবর্তন সংরক্ষণ")}</button><button className="outline-button" type="button" onClick={() => setEditing(null)}>{s("Cancel", "বাতিল")}</button></div>
      </form></section>}
      <section className="teach-panel approval-queue" aria-labelledby="approval-queue-title">
        <h2 id="approval-queue-title" tabIndex={-1}>{s("Waiting for approval", "অনুমোদনের অপেক্ষায়")} ({number(data?.approvals.total)})</h2>
        <p>{s("Students, parents and teachers who create their own account cannot sign in until you approve them. Approve only people you can identify; a declined account can be approved later.", "যে শিক্ষার্থী, অভিভাবক ও শিক্ষক নিজে অ্যাকাউন্ট তৈরি করেন, আপনার অনুমোদন ছাড়া তাঁরা সাইন ইন করতে পারেন না। যাঁদের চেনেন শুধু তাঁদের অনুমোদন দিন; প্রত্যাখ্যাত অ্যাকাউন্ট পরে অনুমোদন করা যায়।")}</p>
        {data && (data.approvals.users.length === 0
          ? <p className="teach-empty">{s("No accounts are waiting for approval.", "অনুমোদনের অপেক্ষায় কোনো অ্যাকাউন্ট নেই।")}</p>
          : <ul className="approval-list">{data.approvals.users.map((user) => <li key={`${user.kind}-${user.id}`}>
            <div><strong>{user.displayName}</strong><small>{user.email ?? user.username}</small></div>
            <span className="role-badge">{accountType(user)}</span>
            <small>{s("Created", "তৈরি")} <time dateTime={user.createdAt}>{localTime(user.createdAt, language)}</time></small>
            <div className="management-row-actions">{decisionButtons(user)}</div>
          </li>)}</ul>)}
        {data && data.approvals.total > data.approvals.users.length && <p>{s(`Showing the oldest ${number(data.approvals.users.length)} of ${number(data.approvals.total)}. Use the “Waiting for approval” filter below to see the rest.`, `${number(data.approvals.total)}টির মধ্যে সবচেয়ে পুরোনো ${number(data.approvals.users.length)}টি দেখানো হচ্ছে। বাকিগুলো দেখতে নিচে “অনুমোদনের অপেক্ষায়” বাছাই ব্যবহার করুন।`)}</p>}
      </section>
      <section className="teach-panel">
        <div className="management-toolbar">
          <div className="management-tabs" role="group" aria-label={s("Account type", "অ্যাকাউন্টের ধরন")}><button aria-pressed={kind === "adult"} onClick={() => { setKind("adult"); setFilter("all"); setPage(1); }}>{s("Adults", "বড়রা")}</button><button aria-pressed={kind === "student"} onClick={() => { setKind("student"); setFilter("all"); setPage(1); }}>{s("Students", "শিক্ষার্থী")}</button></div>
          <form className="management-search" onSubmit={(event) => { event.preventDefault(); setSearch(query); setPage(1); }}><label className="sr-only" htmlFor="user-search">{s("Search users", "ব্যবহারকারী খুঁজুন")}</label><input id="user-search" value={query} maxLength={120} onChange={(event) => setQuery(event.target.value)} placeholder={s("Search by name or account…", "নাম বা অ্যাকাউন্ট দিয়ে খুঁজুন…")} /><button className="outline-button">{s("Search", "খুঁজুন")}</button></form>
          <select aria-label={s("Filter users", "ব্যবহারকারী বাছাই")} value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1); }}><option value="all">{s("All accounts", "সব অ্যাকাউন্ট")}</option><option value="pending">{s("Waiting for approval", "অনুমোদনের অপেক্ষায়")}</option><option value="declined">{s("Declined", "প্রত্যাখ্যাত")}</option>{kind === "adult" && roleOptions}<option value="suspended">{s("Suspended", "স্থগিত")}</option></select>
        </div>
        {loading ? <p role="status">{s("Loading users…", "ব্যবহারকারী লোড হচ্ছে…")}</p> : data && <>
          <div className="management-table-wrap"><table className="management-table"><caption className="sr-only">{s("User accounts", "ব্যবহারকারীর অ্যাকাউন্ট")}</caption><thead><tr><th>{s("Person", "ব্যক্তি")}</th><th>{s("Role", "ভূমিকা")}</th><th>{s("Status", "অবস্থা")}</th><th>{s("Actions", "করণীয়")}</th></tr></thead><tbody>{data.users.map((user) => <tr key={user.id}>
            <td><strong>{user.displayName}{user.id === actorId ? s(" (you)", " (আপনি)") : ""}</strong><small>{user.email ?? user.username}</small></td>
            <td><span className="role-badge">{roleLabel(user)}</span></td><td>
              {/* An account that cannot sign in yet shows only its approval state, never "Active"; a suspended one stays marked. */}
              {(user.approvalStatus === "approved" || user.status !== "active") && <span className={`status-badge ${user.status}`}>{statusLabel(user)}</span>}
              {user.approvalStatus === "pending" && <span className="status-badge pending">{s("Waiting for approval", "অনুমোদনের অপেক্ষায়")}</span>}
              {user.approvalStatus === "declined" && <span className="status-badge declined">{s("Declined", "প্রত্যাখ্যাত")}</span>}
              {user.teacherStatus === "pending" && <small>{s("Teacher approval requested", "শিক্ষকের অনুমোদন চাওয়া হয়েছে")}</small>}
              {declinedApplicant(user) && <small>{s("Teacher request declined along with the account", "অ্যাকাউন্টের সঙ্গে শিক্ষক হওয়ার আবেদনও প্রত্যাখ্যাত হয়েছে")}</small>}
              {user.status !== "active" && undecided(user) && <small>{s("Reactivate the account to approve or decline it", "অনুমোদন বা প্রত্যাখ্যান করতে আগে অ্যাকাউন্টটি পুনরায় চালু করুন")}</small>}
              {user.mustChangePassword && <small>{s("Temporary password not yet changed", "অস্থায়ী পাসওয়ার্ড এখনও বদলানো হয়নি")}</small>}</td>
            <td><div className="management-row-actions">{user.kind === "student" && user.approvalStatus === "approved" && <button className="text-button" disabled={busy} onClick={() => { setFamilyStudent(user); setEditing(null); setShowCreate(false); }}>{s("Family access", "পরিবারের প্রবেশাধিকার")}</button>}{decisionButtons(user)}<button className="text-button" disabled={busy} onClick={() => { setEditing(user); setShowCreate(false); }}>{s("Edit", "সম্পাদনা")}</button><button className="text-button" disabled={busy || user.id === actorId} onClick={() => void update(user, { status: user.status === "active" ? "suspended" : "active" })}>{user.status === "active" ? s("Suspend", "স্থগিত") : s("Reactivate", "পুনরায় চালু")}</button><button className="text-button" disabled={busy || user.id === actorId} onClick={() => void update(user, { action: "revoke-sessions" })}>{s("Revoke sessions", "সেশন বাতিল")}</button><button className="text-button" disabled={busy || user.id === actorId} onClick={() => void resetPassword(user)}>{s("Reset password", "পাসওয়ার্ড রিসেট")}</button></div></td>
          </tr>)}</tbody></table></div>
          {data.users.length === 0 && <p className="teach-empty">{s("No accounts match these filters.", "এই বাছাইয়ে কোনো অ্যাকাউন্ট নেই।")}</p>}
          <div className="management-pagination"><button className="outline-button" disabled={page <= 1} onClick={() => { setPage(page - 1); }}>{s("Previous", "আগের")}</button><span>{s("Page", "পৃষ্ঠা")} {number(page)} · {number(data.total)} {s("accounts", "অ্যাকাউন্ট")}</span><button className="outline-button" disabled={page * data.pageSize >= data.total} onClick={() => { setPage(page + 1); }}>{s("Next", "পরের")}</button></div>
        </>}
        {error && <button className="outline-button" onClick={() => void load()}>{s("Retry", "আবার চেষ্টা")}</button>}
      </section>
      <details className="teach-panel"><summary>{s("Recent changes", "সাম্প্রতিক পরিবর্তন")}</summary><ul className="audit-list">{data?.audit.map((event) => <li key={event.id}><strong>{AUDIT_ACTIONS[event.action] ? pick(AUDIT_ACTIONS[event.action]) : event.action.replaceAll("-", " ")}</strong><span>{AUDIT_TARGETS[event.targetType] ? pick(AUDIT_TARGETS[event.targetType]) : event.targetType} · {event.targetLabel ? s(event.targetLabel.en, event.targetLabel.bn) : event.targetId.slice(0, 8)}</span><time dateTime={event.createdAt}>{localTime(event.createdAt, language)}</time></li>)}</ul><p>{s("Suspension preserves learning records. No permanent user deletion is performed here.", "স্থগিত করলে শেখার তথ্য সংরক্ষিত থাকে। এখানে কোনো ব্যবহারকারী স্থায়ীভাবে মুছে ফেলা হয় না।")}</p></details>
    </div>
  </main></PortalShell>;
}
