"use client";

import { useState } from "react";
import type { Language } from "@/lib/use-language";

export type ApprovalState = "pending" | "approved" | "rejected";

/**
 * The server rechecks both Admin access and the exact revision being reviewed. `reviewedBy` is null for work approved
 * at once because an administrator had switched off approval for teachers' class activities or class sources: no
 * administrator is named as having reviewed it.
 */
export default function ContentApproval({ language, status, reviewNote, reviewedBy, isAdmin, onDecision }: {
  language: Language;
  status: ApprovalState;
  reviewNote?: string;
  reviewedBy?: string | null;
  isAdmin: boolean;
  onDecision: (status: "approved" | "rejected", note: string) => Promise<void>;
}) {
  const s = (en: string, bn: string) => language === "bn" ? bn : en;
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function decide(next: "approved" | "rejected") {
    if (busy || (next === "approved" && !confirmed) || (next === "rejected" && !note.trim())) return;
    setBusy(true); setError("");
    try { await onDecision(next, note.trim()); }
    catch (failure) { setError(failure instanceof Error ? failure.message : s("The review could not be saved. Please retry.", "পর্যালোচনা সংরক্ষণ করা যায়নি। আবার চেষ্টা করুন।")); }
    finally { setBusy(false); }
  }
  return <div className="content-approval">
    <p><strong>{status === "approved" ? (reviewedBy === null ? s("Approved · published", "অনুমোদিত · প্রকাশিত") : s("Approved by Admin · published", "প্রশাসক অনুমোদিত · প্রকাশিত"))
      : status === "rejected" ? s("Changes requested · not published", "সংশোধন চাওয়া হয়েছে · প্রকাশিত নয়")
      : s("Awaiting Admin approval · not published", "প্রশাসকের অনুমোদনের অপেক্ষায় · প্রকাশিত নয়")}</strong></p>
    {reviewNote && <p>{s("Review note", "পর্যালোচনার নোট")}: {reviewNote}</p>}
    {isAdmin && <div className="teach-question">
      {status !== "approved" && <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={busy} /> {s("I have reviewed all the content above.", "ওপরের সব বিষয়বস্তু আমি পর্যালোচনা করেছি।")}</label>}
      <label>{s("Review note (required when sending back)", "পর্যালোচনার নোট (ফেরত পাঠাতে আবশ্যক)")}<textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1500} rows={2} disabled={busy} /></label>
      <div className="teach-activity-buttons">
        {status !== "approved" && <button type="button" className="primary-button" disabled={busy || !confirmed} onClick={() => void decide("approved")}>{s("Approve and publish", "অনুমোদন দিয়ে প্রকাশ করুন")}</button>}
        <button type="button" className="outline-button" disabled={busy || !note.trim()} onClick={() => void decide("rejected")}>{status === "approved" ? s("Withdraw and request changes", "প্রকাশনা সরিয়ে সংশোধন চান") : s("Send back for changes", "সংশোধনের জন্য ফেরত পাঠান")}</button>
      </div>
    </div>}
    {error && <p role="alert" className="auth-error">{error}</p>}
  </div>;
}
