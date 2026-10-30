"use client";
import Link from "next/link";
import { useState } from "react";
import { localMessage, useLanguage } from "@/lib/use-language";
import PortalShell from "@/app/components/PortalShell";

export default function StudentPasswordForm({ name, username, required }: { name: string; username: string; required: boolean }) {
  const [language, toggleLanguage] = useLanguage({ title: ["Change your password | Bangla Adventures", "পাসওয়ার্ড বদলাও | Bangla Adventures"] });
  const s = (en: string, bn: string) => language === "bn" ? bn : en;
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (newPassword !== confirmPassword) { setError(s("The two new passwords do not match.", "নতুন পাসওয়ার্ড দুটি মেলেনি।")); return; }
    if (newPassword === currentPassword) { setError(s("Choose a new password that is different from your current one.", "বর্তমান পাসওয়ার্ড থেকে আলাদা একটি নতুন পাসওয়ার্ড বেছে নাও।")); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/student/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword, newPassword }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(localMessage(data, language, ["Your password was not changed. Please try again.", "পাসওয়ার্ড বদলানো যায়নি। আবার চেষ্টা করো।"]));
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); setSaved(true);
      window.location.replace("/student");
    } catch (error) { setError(error instanceof Error ? error.message : s("Your password was not changed. Please try again.", "পাসওয়ার্ড বদলানো যায়নি। আবার চেষ্টা করো।")); }
    finally { setBusy(false); }
  }
  const form = <section className="auth-card student-password-card" aria-label={s("Password form", "পাসওয়ার্ড ফর্ম")}>
    <form onSubmit={submit}><input type="text" name="username" value={username} autoComplete="username" readOnly hidden />
      <label>{required ? s("Temporary password", "অস্থায়ী পাসওয়ার্ড") : s("Current password", "বর্তমান পাসওয়ার্ড")}<input required type="password" maxLength={200} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" /></label>
      <label>{s("New password", "নতুন পাসওয়ার্ড")} <small>{s("(at least 8 characters)", "(কমপক্ষে ৮ অক্ষর)")}</small><input required type="password" minLength={8} maxLength={200} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" /></label>
      <label>{s("Type the new password again", "নতুন পাসওয়ার্ড আবার লেখো")}<input required type="password" minLength={8} maxLength={200} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" /></label>
      {error && <p role="alert" className="auth-error">{error}</p>}
      {saved && <p role="status" className="auth-success">{s("Password changed. Opening My Learning…", "পাসওয়ার্ড বদলানো হয়েছে। আমার শেখা খুলছে…")}</p>}
      <button className="auth-submit" disabled={busy || saved}>{busy ? s("One moment…", "অপেক্ষা করো…") : s("Save my new password", "নতুন পাসওয়ার্ড সংরক্ষণ করো")}</button>
    </form>
    <p className="auth-note">{required
      ? s("Ask a grown-up for help if you need it. Don't share your password with friends.", "দরকার হলে বড়দের সাহায্য নাও। বন্ধুদের সঙ্গে পাসওয়ার্ড শেয়ার কোরো না।")
      : <Link href="/student">{s("Back to My Learning", "আমার শেখায় ফিরে যাও")}</Link>}</p>
  </section>;
  const signedInAs = <p>{s("Signed in as", "সাইন ইন করেছ")} <strong>{name}</strong> ({username})</p>;
  // A voluntary change stays in the portal; the required one stands alone, since every other page is blocked until it is done.
  if (!required) return <PortalShell role="student" name={name} language={language} toggleLanguage={toggleLanguage} active="password">
    <main className="student-workspace">
      <div className="portal-heading"><div><p className="adult-eyebrow">{s("Keep your account safe", "তোমার অ্যাকাউন্ট নিরাপদ রাখো")}</p><h1>{s("Change your password", "পাসওয়ার্ড বদলাও")}</h1></div></div>
      <p>{s("Choose a new password. Any other device where you are signed in will be signed out.", "নতুন পাসওয়ার্ড বেছে নাও। অন্য যে ডিভাইসে সাইন ইন করা আছে, সেগুলো থেকে সাইন আউট হয়ে যাবে।")}</p>
      {signedInAs}
      {form}
    </main>
  </PortalShell>;
  return <main className="adult-app auth-app" lang={language}>
    <header className="adult-header"><Link className="adult-brand" href="/student"><span>বা</span><strong>Bangla Adventures</strong></Link><a href="/api/student/sign-out?returnTo=%2Fstudent">{s("Sign out", "সাইন আউট")}</a><button className="outline-button" onClick={toggleLanguage}>{s("বাংলা", "English")}</button></header>
    <div className="auth-layout"><section className="auth-intro"><p className="adult-eyebrow">{s("Keep your account safe", "তোমার অ্যাকাউন্ট নিরাপদ রাখো")}</p>
      <h1>{s("Choose your own password", "নিজের পাসওয়ার্ড বেছে নাও")}</h1>
      <p>{s("Your teacher or an administrator gave you a temporary password so you could sign in. Now choose a password that only you know. You will use it every time you sign in.", "সাইন ইন করার জন্য শিক্ষক বা প্রশাসক তোমাকে একটি অস্থায়ী পাসওয়ার্ড দিয়েছেন। এখন এমন একটি পাসওয়ার্ড বেছে নাও যা শুধু তুমি জানো। প্রতিবার সাইন ইন করতে এটি লাগবে।")}</p>
      {signedInAs}
    </section>
      {form}
    </div>
  </main>;
}
