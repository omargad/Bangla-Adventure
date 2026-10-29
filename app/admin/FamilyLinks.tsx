"use client";

import { useCallback, useEffect, useState } from "react";
import type { ParentLink } from "@/lib/parent-access";
import { localMessage } from "@/lib/use-language";

export default function FamilyLinks({ student, language, onClose }: { student: { id: string; displayName: string }; language: "en" | "bn"; onClose: () => void }) {
  const s = (en: string, bn: string) => language === "bn" ? bn : en;
  const [parents, setParents] = useState<ParentLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/admin/family-links?studentId=${encodeURIComponent(student.id)}`, { signal, cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(localMessage(data, language, ["Could not load family access.", "পরিবারের প্রবেশাধিকার লোড করা যায়নি।"]));
    setParents(data.parents);
  }, [student.id, language]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void load(controller.signal).catch((error) => { if (!controller.signal.aborted) setError(error.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [load]);

  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/family-links", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studentId: student.id, parentEmail: values.get("parentEmail"), confirmed: values.get("confirmed") === "on" }) });
      const data = await response.json();
      if (!response.ok) throw new Error(localMessage(data, language, ["Could not link the parent.", "অভিভাবককে যুক্ত করা যায়নি।"]));
      form.reset(); await load();
      setNotice(s("Parent linked. Their dashboard can now show this student's learning records.", "অভিভাবক যুক্ত হয়েছে। এখন তার ড্যাশবোর্ডে এই শিক্ষার্থীর শেখার তথ্য দেখা যাবে।"));
    } catch (error) { setError(error instanceof Error ? error.message : s("Please try again.", "আবার চেষ্টা করুন।")); }
    finally { setBusy(false); }
  }

  async function remove(parent: ParentLink) {
    if (busy || !window.confirm(s(`Remove ${parent.parentName}'s viewing access? The student's learning records will be kept.`, `${parent.parentName}-এর দেখার অনুমতি সরাবেন? শিক্ষার্থীর শেখার তথ্য থাকবে।`))) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/family-links", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studentId: student.id, parentId: parent.parentId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(localMessage(data, language, ["Could not remove access.", "অনুমতি সরানো যায়নি।"]));
      await load(); setNotice(s("Parent access removed. Learning records are unchanged.", "অভিভাবকের অনুমতি সরানো হয়েছে। শেখার তথ্য অপরিবর্তিত আছে।"));
    } catch (error) { setError(error instanceof Error ? error.message : s("Please try again.", "আবার চেষ্টা করুন।")); }
    finally { setBusy(false); }
  }

  return <section className="teach-panel" aria-label="Family access">
    <div className="parent-child-heading"><h2>{s("Family access", "পরিবারের প্রবেশাধিকার")}: {student.displayName}</h2><button className="text-button" onClick={onClose}>{s("Close", "বন্ধ করুন")}</button></div>
    <p>{s("Link only verified parents or guardians. A linked Parent account can view this student's classes, activities and results, but cannot edit them.", "যাচাই করা অভিভাবককেই যুক্ত করুন। যুক্ত Parent অ্যাকাউন্ট ক্লাস, কার্যক্রম ও ফলাফল দেখতে পারবে, বদলাতে পারবে না।")}</p>
    {error && <p role="alert" className="auth-error">{error}</p>}{notice && <p role="status" className="teach-message">{notice}</p>}
    <form className="family-link-form" onSubmit={add}><label>{s("Parent account email", "অভিভাবকের অ্যাকাউন্টের ইমেইল")}<input name="parentEmail" type="email" maxLength={120} required autoComplete="off" /></label><label className="family-link-confirm"><input name="confirmed" type="checkbox" required />{s("I verified this adult is authorized to view this student's learning records.", "এই অভিভাবক শিক্ষার্থীর শেখার তথ্য দেখার অনুমতিপ্রাপ্ত, তা যাচাই করেছি।")}</label><button className="primary-button" disabled={busy || loading}>{s("Link parent", "অভিভাবক যুক্ত করুন")}</button></form>
    {loading ? <p role="status">{s("Loading family access…", "প্রবেশাধিকার লোড হচ্ছে…")}</p> : parents.length === 0 ? <p>{s("No parents linked to this student yet.", "এই শিক্ষার্থীর সঙ্গে এখনও কোনো অভিভাবক যুক্ত নেই।")}</p> : <ul className="family-link-list">{parents.map((parent) => <li key={parent.id}><div><strong>{parent.parentName}</strong><small>{parent.parentEmail}</small>{(parent.role !== "parent" || parent.status !== "active") && <small>{s("Access inactive because of account role or status.", "অ্যাকাউন্টের ভূমিকা বা অবস্থার কারণে প্রবেশাধিকার বন্ধ আছে।")}</small>}</div><button className="text-button" disabled={busy} onClick={() => void remove(parent)}>{s("Remove access", "অনুমতি সরান")}</button></li>)}</ul>}
  </section>;
}
