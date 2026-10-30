"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLanguage } from "@/lib/use-language";
import type { TeacherStatus } from "@/lib/roles";

export default function TeacherAccess({ name, status }: { name: string; status: TeacherStatus }) {
  const router = useRouter();
  const [language, toggleLanguage] = useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const s = (en: string, bn: string) => language === "bn" ? bn : en;
  const pending = status === "pending";

  async function requestAccess() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/teacher-request", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not request access.");
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Please try again.");
    } finally { setBusy(false); }
  }

  return <main className="adult-app" lang={language}>
    <header className="adult-header">
      <Link className="adult-brand" href="/"><span>বা</span><strong>Bangla Adventures</strong></Link>
      <nav aria-label={s("Account navigation", "অ্যাকাউন্টের মেনু")}><Link href="/family">{s("Family dashboard", "পরিবারের ড্যাশবোর্ড")}</Link><Link href="/account">{s("My account", "আমার অ্যাকাউন্ট")}</Link></nav>
      <button type="button" className="outline-button" onClick={toggleLanguage}>{s("বাংলা", "English")}</button>
    </header>
    <section className="access-panel">
      <span className="access-symbol" aria-hidden="true">বা</span>
      <p className="adult-eyebrow">{s(`Welcome, ${name}`, `স্বাগতম, ${name}`)}</p>
      <h1>{pending ? s("Your teacher request is with us", "আপনার শিক্ষক হওয়ার আবেদন জমা হয়েছে") : s("Your next chapter starts here", "আপনার নতুন অধ্যায় এখানেই শুরু")}</h1>
      <p>{pending ? s("An administrator must approve your teacher access before you can create classes or see student work. Your family account is ready to use while you wait.", "ক্লাস তৈরি বা শিক্ষার্থীদের কাজ দেখার আগে প্রশাসকের অনুমোদন প্রয়োজন। অপেক্ষার সময় পরিবারের অ্যাকাউন্ট ব্যবহার করতে পারেন।") : s("Request teacher access to create classes, share activities and follow your learners’ progress. Approval is required; signing up never gives access to another teacher’s students.", "ক্লাস তৈরি, কার্যক্রম দেওয়া ও শিক্ষার্থীদের অগ্রগতি দেখতে শিক্ষক হিসেবে আবেদন করুন। প্রশাসকের অনুমোদন প্রয়োজন।")}</p>
      {status === "rejected" && <p role="status">{s("Your previous request was not approved. Contact your administrator before applying again.", "আগের আবেদন অনুমোদিত হয়নি। আবার আবেদনের আগে প্রশাসকের সঙ্গে যোগাযোগ করুন।")}</p>}
      {error && <p className="auth-error" role="alert">{error}</p>}
      <div className="access-actions">
        {pending ? <button className="primary-button" onClick={() => router.refresh()}>{s("Check approval status", "অনুমোদনের অবস্থা দেখুন")}</button> : <button className="primary-button" disabled={busy} onClick={() => void requestAccess()}>{busy ? s("Sending…", "পাঠানো হচ্ছে…") : s("Request teacher access", "শিক্ষক হিসেবে আবেদন করুন")}</button>}
        <Link className="outline-button" href="/family">{s("Go to family dashboard", "পরিবারের ড্যাশবোর্ডে যান")}</Link>
      </div>
      <a className="text-button" href="/api/auth/sign-out?returnTo=%2Fgrown-ups">{s("Sign out", "সাইন আউট")}</a>
    </section>
  </main>;
}
