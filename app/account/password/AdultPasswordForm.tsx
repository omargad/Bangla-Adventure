"use client";
import Link from "next/link";
import { useState } from "react";
import { useLanguage } from "@/lib/use-language";

/**
 * The required change of a temporary password an administrator issued, at first sign-in or after a reset;
 * every other adult page is blocked until it is done.
 */
export default function AdultPasswordForm({ name, email, destination }: { name: string; email: string; destination: string }) {
  const [language, toggleLanguage] = useLanguage();
  const s = (en: string, bn: string) => language === "bn" ? bn : en;
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (newPassword !== confirmPassword) { setError(s("The two new passwords do not match.", "নতুন পাসওয়ার্ড দুটি মেলেনি।")); return; }
    if (newPassword === currentPassword) { setError(s("Choose a new password that is different from the temporary one.", "অস্থায়ী পাসওয়ার্ড থেকে আলাদা একটি নতুন পাসওয়ার্ড বেছে নিন।")); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/account/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword, newPassword }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? s("Your password was not changed. Please try again.", "পাসওয়ার্ড বদলানো যায়নি। আবার চেষ্টা করুন।"));
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      // The new recovery codes are shown once, before leaving the page.
      if (Array.isArray(data.recoveryCodes) && data.recoveryCodes.length) setCodes(data.recoveryCodes);
      else window.location.replace(destination);
    } catch (error) { setError(error instanceof Error ? error.message : s("Your password was not changed. Please try again.", "পাসওয়ার্ড বদলানো যায়নি। আবার চেষ্টা করুন।")); }
    finally { setBusy(false); }
  }
  async function copyCodes() {
    if (!codes) return;
    try { await navigator.clipboard.writeText(codes.join("\n")); setCopied(true); } catch { setCopied(false); }
  }
  const signedInAs = <p>{s("Signed in as", "সাইন ইন করেছেন")} <strong>{name}</strong> ({email})</p>;
  return <main className="adult-app auth-app" lang={language}>
    <header className="adult-header"><Link className="adult-brand" href="/"><span>বা</span><strong>Bangla Adventures</strong></Link><a href="/api/auth/sign-out?returnTo=%2Fgrown-ups">{s("Sign out", "সাইন আউট")}</a><button type="button" className="outline-button" onClick={toggleLanguage}>{s("বাংলা", "English")}</button></header>
    <div className="auth-layout"><section className="auth-intro"><p className="adult-eyebrow">{s("Keep your account safe", "আপনার অ্যাকাউন্ট নিরাপদ রাখুন")}</p>
      <h1>{codes ? s("Your password is changed", "আপনার পাসওয়ার্ড বদলানো হয়েছে") : s("Choose your own password", "নিজের পাসওয়ার্ড বেছে নিন")}</h1>
      <p>{s("An administrator gave you this temporary password. Now choose a password that only you know. You will use it every time you sign in, and any other device signed in to this account will be signed out.", "একজন প্রশাসক আপনাকে এই অস্থায়ী পাসওয়ার্ডটি দিয়েছেন। এখন এমন একটি পাসওয়ার্ড বেছে নিন যা শুধু আপনি জানেন। প্রতিবার সাইন ইন করতে এটি লাগবে, আর এই অ্যাকাউন্টে সাইন ইন থাকা অন্য সব ডিভাইস সাইন আউট হয়ে যাবে।")}</p>
      {signedInAs}
    </section>
      {codes ? <section className="auth-card" aria-label={s("New recovery codes", "নতুন পুনরুদ্ধার কোড")}>
        <h2 className="auth-codes-title">{s("Save your new recovery codes", "নতুন পুনরুদ্ধার কোড সংরক্ষণ করুন")}</h2>
        <p className="auth-note">{s("If you forget your password, one of these one-time codes lets you choose a new one. They replace any recovery codes you had before: old codes no longer work, so throw them away. Store these somewhere safe — they are shown only once.", "পাসওয়ার্ড ভুলে গেলে এই এককালীন কোডগুলোর একটি দিয়ে নতুন পাসওয়ার্ড বেছে নিতে পারবেন। আগের সব পুনরুদ্ধার কোডের বদলে এগুলো দেওয়া হলো: পুরোনো কোড আর কাজ করবে না, তাই সেগুলো ফেলে দিন। এগুলো নিরাপদ জায়গায় রাখুন — কেবল একবারই দেখানো হয়।")}</p>
        <ul className="auth-codes" aria-label={s("One-time recovery codes", "এককালীন পুনরুদ্ধার কোড")}>{codes.map((code) => <li key={code}><code>{code}</code></li>)}</ul>
        <div className="auth-codes-actions">
          <button type="button" className="outline-button" onClick={() => void copyCodes()}>{copied ? s("Copied ✓", "কপি হয়েছে ✓") : s("Copy all codes", "সব কোড কপি করুন")}</button>
          <button type="button" className="auth-submit" onClick={() => window.location.replace(destination)}>{s("I’ve saved them — continue", "সংরক্ষণ করেছি — এগিয়ে যান")}</button>
        </div>
      </section> : <section className="auth-card" aria-label={s("Password form", "পাসওয়ার্ড ফর্ম")}>
        <form onSubmit={submit}><input type="email" name="username" value={email} autoComplete="username" readOnly hidden />
          <label>{s("Temporary password", "অস্থায়ী পাসওয়ার্ড")}<input required type="password" maxLength={200} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" /></label>
          <label>{s("New password", "নতুন পাসওয়ার্ড")} <small>{s("(at least 10 characters)", "(কমপক্ষে ১০ অক্ষর)")}</small><input required type="password" minLength={10} maxLength={200} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" /></label>
          <label>{s("Type the new password again", "নতুন পাসওয়ার্ড আবার লিখুন")}<input required type="password" minLength={10} maxLength={200} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" /></label>
          {error && <p role="alert" className="auth-error">{error}</p>}
          <button className="auth-submit" disabled={busy}>{busy ? s("One moment…", "একটু অপেক্ষা…") : s("Save my new password", "নতুন পাসওয়ার্ড সংরক্ষণ করুন")}</button>
        </form>
        <p className="auth-note">{s("Forgot the temporary password? Ask your administrator to reset it.", "অস্থায়ী পাসওয়ার্ড ভুলে গেছেন? প্রশাসককে রিসেট করতে বলুন।")}</p>
      </section>}
    </div>
  </main>;
}
