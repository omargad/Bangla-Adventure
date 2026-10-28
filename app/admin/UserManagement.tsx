"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useLanguage } from "@/lib/use-language";
import FamilyLinks from "./FamilyLinks";
import PortalShell from "../components/PortalShell";

type User = { id: string; kind: "adult" | "student"; displayName: string; email?: string; username?: string; role: string; status: string; teacherStatus: string; createdAt: string };
type UsersPage = { users: User[]; total: number; pageSize: number; stats: { adults: number; students: number; teachers: number; pending: number }; audit: { id: string; action: string; targetType: string; targetId: string; createdAt: string }[] };

export default function UserManagement({ actorId, actorName }: { actorId: string; actorName: string }) {
  const [language, toggleLanguage] = useLanguage();
  const s = (en: string, bn: string) => language === "bn" ? bn : en;
  const [kind, setKind] = useState<"adult" | "student">("adult");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<UsersPage | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<User | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [codes, setCodes] = useState<string[]>([]);
  const [familyStudent, setFamilyStudent] = useState<User | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ kind, filter, q: search, page: String(page) });
      const response = await fetch(`/api/admin/users?${params}`, { signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not load users.");
      setData(payload);
      setError("");
    } catch (error) {
      if (signal?.aborted) return;
      setData(null);
      setError(error instanceof Error ? error.message : "Please try again.");
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [kind, filter, search, page]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [load]);

  async function update(user: User, values: Record<string, unknown>) {
    if (busy) return;
    if ((values.action || (values.role && values.role !== user.role) || values.status !== undefined) && !window.confirm(s(`Apply this change to ${user.displayName}? Permission changes sign the user out.`, `${user.displayName}-এর এই পরিবর্তনটি করবেন? অনুমতি বদলালে সাইন আউট হবে।`))) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: user.kind, ...values }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not update the user.");
      setEditing(null);
      setNotice(s("Account updated. The action has been recorded.", "অ্যাকাউন্ট হালনাগাদ হয়েছে। পরিবর্তনটি নথিভুক্ত হয়েছে।"));
      await load();
    } catch (error) { setError(error instanceof Error ? error.message : "Please try again."); }
    finally { setBusy(false); }
  }

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const type = values.accountType;
    setBusy(true); setError(""); setNotice(""); setCodes([]);
    try {
      const response = await fetch("/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...values, kind: type === "student" ? "student" : "adult", role: type }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not create the account.");
      form.reset();
      setShowCreate(false);
      setCodes(payload.recoveryCodes ?? []);
      setNotice(s("Account created. Share its credentials privately with the intended user or guardian.", "অ্যাকাউন্ট তৈরি হয়েছে। তথ্য শুধু সংশ্লিষ্ট ব্যক্তি বা অভিভাবককে ব্যক্তিগতভাবে দিন।"));
      await load();
    } catch (error) { setError(error instanceof Error ? error.message : "Please try again."); }
    finally { setBusy(false); }
  }

  return <PortalShell role="admin" name={actorName} active="users" language={language} toggleLanguage={toggleLanguage}><main className="adult-app management-app" lang={language}>
    <header className="adult-header">
      <Link className="adult-brand" href="/"><span>বা</span><span><strong>Bangla Adventures</strong><small>{s("Administration", "প্রশাসন")}</small></span></Link>
      <nav aria-label="Administration"><Link className="active" href="/admin">{s("Users", "ব্যবহারকারী")}</Link><Link href="/teach">{s("Teacher workspace", "শিক্ষকের কর্মক্ষেত্র")}</Link><Link href="/account">{s("My account", "আমার অ্যাকাউন্ট")}</Link></nav>
      <div className="adult-account"><button className="outline-button" onClick={toggleLanguage}>{s("বাংলা", "English")}</button><a href="/api/auth/sign-out?returnTo=%2F">{s("Sign out", "সাইন আউট")}</a></div>
    </header>
    <div className="adult-content">
      <section className="management-heading"><div><p className="adult-eyebrow">{s(`Welcome, ${actorName}`, `স্বাগতম, ${actorName}`)}</p><h1>{s("People make the adventure", "মানুষের হাতেই অভিযানের শুরু")}</h1><p>{s("Approve teachers, support families and keep account access under control.", "শিক্ষকদের অনুমোদন দিন, পরিবারকে সহায়তা করুন ও অ্যাকাউন্টের প্রবেশাধিকার পরিচালনা করুন।")}</p></div><button className="primary-button" onClick={() => { setShowCreate(!showCreate); setEditing(null); }}>{showCreate ? s("Close form", "ফর্ম বন্ধ করুন") : s("Create user", "ব্যবহারকারী তৈরি")}</button></section>
      {error && <p role="alert" className="auth-error">{error}</p>}
      {notice && <p role="status" className="teach-message">{notice}</p>}
      <section className="workspace-stats" aria-label="User overview">
        <div><small>{s("Adult accounts", "বড়দের অ্যাকাউন্ট")}</small><strong>{data?.stats.adults ?? "—"}</strong></div>
        <div><small>{s("Students", "শিক্ষার্থী")}</small><strong>{data?.stats.students ?? "—"}</strong></div>
        <div><small>{s("Active teachers", "সক্রিয় শিক্ষক")}</small><strong>{data?.stats.teachers ?? "—"}</strong></div>
        <button onClick={() => { setKind("adult"); setFilter("pending"); setPage(1); }}><small>{s("Awaiting approval", "অনুমোদনের অপেক্ষায়")}</small><strong>{data?.stats.pending ?? "—"}</strong></button>
      </section>
      {!!codes.length && <section className="teach-panel"><h2>{s("Save these recovery codes now", "পুনরুদ্ধার কোড এখনই সংরক্ষণ করুন")}</h2><p>{s("Shown once. Share privately with the account owner. They are not stored in this browser.", "একবারই দেখানো হয়। অ্যাকাউন্টের মালিককে ব্যক্তিগতভাবে দিন।")}</p><ul className="auth-codes">{codes.map((code) => <li key={code}><code>{code}</code></li>)}</ul><button className="outline-button" onClick={() => setCodes([])}>{s("I have saved them", "সংরক্ষণ করেছি")}</button></section>}
      {familyStudent && <FamilyLinks key={familyStudent.id} student={familyStudent} language={language} onClose={() => setFamilyStudent(null)} />}
      {showCreate && <section className="teach-panel"><h2>{s("Create an account", "অ্যাকাউন্ট তৈরি করুন")}</h2><form className="management-form" onSubmit={create}>
        <label>{s("Account type", "অ্যাকাউন্টের ধরন")}<select name="accountType" required><option value="parent">{s("Parent", "অভিভাবক")}</option><option value="teacher">{s("Approved teacher", "অনুমোদিত শিক্ষক")}</option><option value="student">{s("Student", "শিক্ষার্থী")}</option></select></label>
        <label>{s("Display name", "প্রদর্শিত নাম")}<input name="displayName" maxLength={60} required /></label>
        <label>{s("Email — adults only", "ইমেইল — শুধু বড়দের")}<input name="email" type="email" maxLength={120} autoComplete="off" /></label>
        <label>{s("Username — students only", "ব্যবহারকারীর নাম — শুধু শিক্ষার্থীদের")}<input name="username" maxLength={40} autoComplete="off" /></label>
        <label>{s("Initial password", "প্রাথমিক পাসওয়ার্ড")}<input name="password" type="password" required minLength={10} maxLength={200} autoComplete="new-password" /></label>
        <p>{s("Use at least 10 characters. No child email or birth date is needed.", "অন্তত ১০ অক্ষর ব্যবহার করুন। শিশুর ইমেইল বা জন্মতারিখের প্রয়োজন নেই।")}</p>
        <button className="primary-button" disabled={busy}>{busy ? s("Creating…", "তৈরি হচ্ছে…") : s("Create account", "অ্যাকাউন্ট তৈরি")}</button>
      </form></section>}
      {editing && <section className="teach-panel"><h2>{s("Edit account", "অ্যাকাউন্ট সম্পাদনা")}: {editing.displayName}</h2><form key={editing.id} className="management-form" onSubmit={(event) => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); void update(editing, values); }}>
        <label>{s("Display name", "প্রদর্শিত নাম")}<input name="displayName" defaultValue={editing.displayName} maxLength={60} required /></label>
        {editing.kind === "adult" && <label>{s("Role", "ভূমিকা")}<select name="role" defaultValue={editing.role} disabled={editing.id === actorId}><option value="parent">Parent</option><option value="teacher">Teacher</option><option value="admin">Administrator</option></select></label>}
        <p>{s("Role changes revoke existing sessions. Teachers cannot access other teachers’ classes.", "ভূমিকা বদলালে পুরোনো সেশন বাতিল হবে। শিক্ষকেরা অন্য শিক্ষকের ক্লাসে প্রবেশ করতে পারবেন না।")}</p>
        <div className="access-actions"><button className="primary-button" disabled={busy}>{s("Save changes", "পরিবর্তন সংরক্ষণ")}</button><button className="outline-button" type="button" onClick={() => setEditing(null)}>{s("Cancel", "বাতিল")}</button></div>
      </form></section>}
      <section className="teach-panel">
        <div className="management-toolbar">
          <div className="management-tabs" role="group" aria-label="Account type"><button aria-pressed={kind === "adult"} onClick={() => { setKind("adult"); setFilter("all"); setPage(1); }}>{s("Adults", "বড়রা")}</button><button aria-pressed={kind === "student"} onClick={() => { setKind("student"); setFilter("all"); setPage(1); }}>{s("Students", "শিক্ষার্থী")}</button></div>
          <form className="management-search" onSubmit={(event) => { event.preventDefault(); setSearch(query); setPage(1); }}><label className="sr-only" htmlFor="user-search">{s("Search users", "ব্যবহারকারী খুঁজুন")}</label><input id="user-search" value={query} maxLength={120} onChange={(event) => setQuery(event.target.value)} placeholder={s("Search by name or account…", "নাম বা অ্যাকাউন্ট দিয়ে খুঁজুন…")} /><button className="outline-button">{s("Search", "খুঁজুন")}</button></form>
          <select aria-label={s("Filter users", "ব্যবহারকারী বাছাই")} value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1); }}><option value="all">{s("All accounts", "সব অ্যাকাউন্ট")}</option>{kind === "adult" && <><option value="pending">{s("Pending teachers", "অপেক্ষমান শিক্ষক")}</option><option value="teacher">Teacher</option><option value="parent">Parent</option><option value="admin">Administrator</option></>}<option value="suspended">{s("Suspended", "স্থগিত")}</option></select>
        </div>
        {loading ? <p role="status">{s("Loading users…", "ব্যবহারকারী লোড হচ্ছে…")}</p> : data && <>
          <div className="management-table-wrap"><table className="management-table"><caption className="sr-only">{s("User accounts", "ব্যবহারকারীর অ্যাকাউন্ট")}</caption><thead><tr><th>{s("Person", "ব্যক্তি")}</th><th>{s("Role", "ভূমিকা")}</th><th>{s("Status", "অবস্থা")}</th><th>{s("Actions", "করণীয়")}</th></tr></thead><tbody>{data.users.map((user) => <tr key={user.id}>
            <td><strong>{user.displayName}{user.id === actorId ? s(" (you)", " (আপনি)") : ""}</strong><small>{user.email ?? user.username}</small></td>
            <td><span className="role-badge">{user.role}</span></td><td><span className={`status-badge ${user.status}`}>{user.status}</span>{user.teacherStatus === "pending" && <small>{s("Teacher approval requested", "শিক্ষকের অনুমোদন চাওয়া হয়েছে")}</small>}</td>
            <td><div className="management-row-actions">{user.kind === "student" && <button className="text-button" disabled={busy} onClick={() => { setFamilyStudent(user); setEditing(null); setShowCreate(false); }}>{s("Family access", "পরিবারের প্রবেশাধিকার")}</button>}{user.teacherStatus === "pending" && user.status === "active" && <><button className="outline-button" disabled={busy} onClick={() => void update(user, { action: "approve" })}>{s("Approve", "অনুমোদন")}</button><button className="text-button" disabled={busy} onClick={() => void update(user, { action: "reject" })}>{s("Decline", "প্রত্যাখ্যান")}</button></>}<button className="text-button" disabled={busy} onClick={() => { setEditing(user); setShowCreate(false); }}>{s("Edit", "সম্পাদনা")}</button><button className="text-button" disabled={busy || user.id === actorId} onClick={() => void update(user, { status: user.status === "active" ? "suspended" : "active" })}>{user.status === "active" ? s("Suspend", "স্থগিত") : s("Reactivate", "পুনরায় চালু")}</button><button className="text-button" disabled={busy || user.id === actorId} onClick={() => void update(user, { action: "revoke-sessions" })}>{s("Revoke sessions", "সেশন বাতিল")}</button></div></td>
          </tr>)}</tbody></table></div>
          {data.users.length === 0 && <p className="teach-empty">{s("No accounts match these filters.", "এই বাছাইয়ে কোনো অ্যাকাউন্ট নেই।")}</p>}
          <div className="management-pagination"><button className="outline-button" disabled={page <= 1} onClick={() => { setPage(page - 1); }}>{s("Previous", "আগের")}</button><span>{s("Page", "পৃষ্ঠা")} {page} · {data.total} {s("accounts", "অ্যাকাউন্ট")}</span><button className="outline-button" disabled={page * data.pageSize >= data.total} onClick={() => { setPage(page + 1); }}>{s("Next", "পরের")}</button></div>
        </>}
        {error && <button className="outline-button" onClick={() => void load()}>{s("Retry", "আবার চেষ্টা")}</button>}
      </section>
      <details className="teach-panel"><summary>{s("Recent access changes", "সাম্প্রতিক প্রবেশাধিকারের পরিবর্তন")}</summary><ul className="audit-list">{data?.audit.map((event) => <li key={event.id}><strong>{event.action.replaceAll("-", " ")}</strong><span>{event.targetType} · {event.targetId.slice(0, 8)}</span><time>{event.createdAt}</time></li>)}</ul><p>{s("Suspension preserves learning records. No permanent user deletion is performed here.", "স্থগিত করলে শেখার তথ্য সংরক্ষিত থাকে। এখানে কোনো ব্যবহারকারী স্থায়ীভাবে মুছে ফেলা হয় না।")}</p></details>
    </div>
  </main></PortalShell>;
}
