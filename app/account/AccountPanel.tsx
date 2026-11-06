"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { localMessage, useLanguage } from "../../lib/use-language";
import type { AdultRole } from "../../lib/roles";

/** What the data export holds for each kind of account, in both languages (see exportAccountData). */
const EXPORT_CONTENTS: Record<AdultRole, [string, string]> = {
  parent: [
    "Download a machine-readable copy of what this account holds: your name and email, the children an administrator linked to you (their names), any home learner profiles with their progress and assignments, and a history of the changes made to this account. Your children’s class results and attendance are kept in their school records, so they are not in this file.",
    "এই অ্যাকাউন্টে যা রাখা আছে তার একটি কপি নামান: আপনার নাম ও ইমেইল, প্রশাসক আপনার সঙ্গে যে শিশুদের যুক্ত করেছেন (তাদের নাম), বাসার শিক্ষার্থী প্রোফাইল থাকলে সেগুলোর অগ্রগতি ও কাজ, আর এই অ্যাকাউন্টে করা পরিবর্তনের ইতিহাস। শিশুদের ক্লাসের ফলাফল ও উপস্থিতি স্কুলের রেকর্ডে থাকে, তাই এই ফাইলে নেই।",
  ],
  teacher: [
    "Download a machine-readable copy of what this account holds: your name and email, the names of the classes you teach, your home learner profiles with their progress and assignments, your content-studio drafts, reviews and recordings, and a history of the changes made to and by this account. Your students’ results and attendance belong to the class records, so they are not in this file.",
    "এই অ্যাকাউন্টে যা রাখা আছে তার একটি কপি নামান: আপনার নাম ও ইমেইল, আপনি যে ক্লাসগুলো পড়ান সেগুলোর নাম, বাসার শিক্ষার্থী প্রোফাইল ও সেগুলোর অগ্রগতি ও কাজ, কনটেন্ট-স্টুডিওর খসড়া, পর্যালোচনা ও রেকর্ডিং, আর এই অ্যাকাউন্টে ও এই অ্যাকাউন্ট থেকে করা পরিবর্তনের ইতিহাস। শিক্ষার্থীদের ফলাফল ও উপস্থিতি ক্লাসের রেকর্ডে থাকে, তাই এই ফাইলে নেই।",
  ],
  admin: [
    "Download a machine-readable copy of what this account holds: your name and email, the names of any classes you teach, your home learner profiles with their progress and assignments, your content-studio drafts, reviews and recordings, and a history of the changes made to and by this account. Other people’s accounts and records are not in this file.",
    "এই অ্যাকাউন্টে যা রাখা আছে তার একটি কপি নামান: আপনার নাম ও ইমেইল, আপনি কোনো ক্লাস পড়ালে সেগুলোর নাম, বাসার শিক্ষার্থী প্রোফাইল ও সেগুলোর অগ্রগতি ও কাজ, কনটেন্ট-স্টুডিওর খসড়া, পর্যালোচনা ও রেকর্ডিং, আর এই অ্যাকাউন্টে ও এই অ্যাকাউন্ট থেকে করা পরিবর্তনের ইতিহাস। অন্যদের অ্যাকাউন্ট ও রেকর্ড এই ফাইলে নেই।",
  ],
};

/** Who can delete their own account here, and what has to happen first. */
const DELETE_NOTE: Record<AdultRole, [string, string] | null> = {
  parent: null,
  teacher: [
    "If you teach any classes, ask an administrator to move them to another teacher first: classes are not deleted with your account.",
    "আপনি কোনো ক্লাস পড়ালে আগে একজন প্রশাসককে ক্লাসগুলো অন্য শিক্ষকের কাছে সরিয়ে দিতে বলুন: আপনার অ্যাকাউন্টের সঙ্গে ক্লাস মোছা হয় না।",
  ],
  admin: [
    "An administrator account cannot be deleted here: another administrator must change your role first.",
    "প্রশাসকের অ্যাকাউন্ট এখান থেকে মোছা যায় না: আগে অন্য একজন প্রশাসককে আপনার ভূমিকা বদলাতে হবে।",
  ],
};

export default function AccountPanel({ email, displayName, role }: { email: string; displayName: string; role: AdultRole }) {
  const router = useRouter();
  const [language] = useLanguage({ title: ["Your account | Bangla Adventures", "আপনার অ্যাকাউন্ট | Bangla Adventures"] });
  const s = (en: string, bn: string) => (language === "bn" ? bn : en);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [codesPassword, setCodesPassword] = useState("");
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [codesError, setCodesError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setPasswordMessage(null);
    try {
      const response = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; errorBn?: string };
      if (!response.ok) {
        setPasswordMessage({ ok: false, text: localMessage(data, language, ["Could not change the password.", "পাসওয়ার্ড বদলানো যায়নি।"]) });
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setPasswordMessage({
        ok: true,
        text: s(
          "Password changed. Any other signed-in devices have been signed out.",
          "পাসওয়ার্ড বদলানো হয়েছে। সাইন-ইন থাকা অন্য সব ডিভাইস সাইন-আউট হয়েছে।",
        ),
      });
    } catch {
      setPasswordMessage({ ok: false, text: s("Could not reach the server. Try again.", "সার্ভারে পৌঁছানো যায়নি। আবার চেষ্টা করুন।") });
    } finally {
      setBusy(false);
    }
  }

  async function signOutEverywhere() {
    setBusy(true);
    try {
      await fetch("/api/account/sessions", { method: "DELETE" });
      router.push("/");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function regenerateCodes(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setCodesError(null);
    try {
      const response = await fetch("/api/account/recovery-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: codesPassword }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        errorBn?: string;
        recoveryCodes?: string[];
      };
      if (!response.ok || !data.recoveryCodes) {
        setCodesError(localMessage(data, language, ["Could not generate new codes.", "নতুন কোড তৈরি করা যায়নি।"]));
        return;
      }
      setCodesPassword("");
      setNewCodes(data.recoveryCodes);
    } catch {
      setCodesError(s("Could not reach the server. Try again.", "সার্ভারে পৌঁছানো যায়নি। আবার চেষ্টা করুন।"));
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount(event: React.FormEvent) {
    event.preventDefault();
    setDeleteError(null);
    if (deleteConfirm.trim().toUpperCase() !== "DELETE") {
      setDeleteError(s('Type "DELETE" to confirm you want everything removed.', 'নিশ্চিত করতে "DELETE" লিখুন।'));
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: deletePassword }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; errorBn?: string };
      if (!response.ok) {
        setDeleteError(localMessage(data, language, ["Could not delete the account.", "অ্যাকাউন্ট মোছা যায়নি।"]));
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setDeleteError(s("Could not reach the server. Try again.", "সার্ভারে পৌঁছানো যায়নি। আবার চেষ্টা করুন।"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="adult-app" lang={language}>
      <div className="adult-content account-content">
        <section className="adult-hero">
          <div>
            <p className="adult-eyebrow">{s("Account controls", "অ্যাকাউন্ট নিয়ন্ত্রণ")}</p>
            <h1>{s("Your data, in your hands.", "আপনার তথ্য, আপনারই হাতে।")}</h1>
            <p>
              {s("Signed in as", "সাইন-ইন করেছেন")} <strong>{displayName}</strong> ({email}).{" "}
              {s(
                "Change your password and recovery codes, download a copy of this account’s data, or delete the account here.",
                "এখান থেকে পাসওয়ার্ড ও পুনরুদ্ধার কোড বদলান, এই অ্যাকাউন্টের তথ্যের একটি কপি নামান, অথবা অ্যাকাউন্টটি মুছে ফেলুন।",
              )}
            </p>
          </div>
        </section>

        <div className="account-grid">
          <section className="account-card" aria-labelledby="account-password">
            <h2 id="account-password">{s("Change password", "পাসওয়ার্ড বদলান")}</h2>
            <p>{s("Changing your password signs out every other device.", "পাসওয়ার্ড বদলালে অন্য সব ডিভাইস সাইন-আউট হয়ে যায়।")}</p>
            <form onSubmit={changePassword}>
              <label>
                {s("Current password", "বর্তমান পাসওয়ার্ড")}
                <input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required autoComplete="current-password" />
              </label>
              <label>
                {s("New password", "নতুন পাসওয়ার্ড")} <small>{s("(at least 10 characters)", "(কমপক্ষে ১০ অক্ষর)")}</small>
                <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={10} required autoComplete="new-password" />
              </label>
              {passwordMessage && (
                <p className={passwordMessage.ok ? "auth-success" : "auth-error"} role="status">{passwordMessage.text}</p>
              )}
              <button type="submit" className="auth-submit" disabled={busy}>{busy ? s("One moment…", "একটু অপেক্ষা…") : s("Change password", "পাসওয়ার্ড বদলান")}</button>
            </form>
          </section>

          <section className="account-card" aria-labelledby="account-data">
            <h2 id="account-data">{s("Your data", "আপনার তথ্য")}</h2>
            <p>{s(...EXPORT_CONTENTS[role])}</p>
            <a className="outline-button" href="/api/account/export" download>{s("Download data export (JSON)", "তথ্য রপ্তানি নামান (JSON)")}</a>
            <h3>{s("Sessions", "সেশন")}</h3>
            <p>{s("Suspect a shared or public computer stayed signed in? End every session at once.", "কোনো শেয়ার করা বা পাবলিক কম্পিউটারে সাইন-ইন রয়ে গেছে মনে হচ্ছে? সব সেশন একসঙ্গে বন্ধ করুন।")}</p>
            <button type="button" className="outline-button" onClick={() => void signOutEverywhere()} disabled={busy}>{s("Sign out everywhere", "সব জায়গায় সাইন আউট")}</button>
          </section>

          <section className="account-card" aria-labelledby="account-codes">
            <h2 id="account-codes">{s("Recovery codes", "পুনরুদ্ধার কোড")}</h2>
            <p>{s("Recovery codes are the only way back in if you forget your password — there is no email reset. Generating a new set invalidates every previous code.", "পাসওয়ার্ড ভুলে গেলে পুনরুদ্ধার কোডই ফিরে আসার একমাত্র উপায় — ইমেইলে রিসেট নেই। নতুন সেট তৈরি করলে আগের সব কোড বাতিল হয়ে যায়।")}</p>
            {newCodes ? (
              <>
                <ul className="auth-codes" aria-label={s("One-time recovery codes", "এককালীন পুনরুদ্ধার কোড")}>
                  {newCodes.map((code) => (
                    <li key={code}><code>{code}</code></li>
                  ))}
                </ul>
                <p className="auth-success" role="status">{s("Save these now — they are shown only once.", "এখনই সংরক্ষণ করুন — এগুলো কেবল একবারই দেখানো হয়।")}</p>
              </>
            ) : (
              <form onSubmit={regenerateCodes}>
                <label>
                  {s("Current password", "বর্তমান পাসওয়ার্ড")}
                  <input type="password" value={codesPassword} onChange={(event) => setCodesPassword(event.target.value)} required autoComplete="current-password" />
                </label>
                {codesError && (<p className="auth-error" role="alert">{codesError}</p>)}
                <button type="submit" className="outline-button" disabled={busy}>{busy ? s("One moment…", "একটু অপেক্ষা…") : s("Generate new recovery codes", "নতুন পুনরুদ্ধার কোড তৈরি করুন")}</button>
              </form>
            )}
          </section>

          <section className="account-card account-danger" aria-labelledby="account-delete">
            <h2 id="account-delete">{s("Delete account", "অ্যাকাউন্ট মুছুন")}</h2>
            <p>{s("Permanently removes this grown-up account and everything it owns: all learner profiles, progress, assignments, drafts, reviews and uploaded audio. Lesson decisions and video checks you made for students stay in place, shown as made by a former staff member. Children’s device-local stars are unaffected. This cannot be undone — export your data first if you want a copy.", "এই বড়দের অ্যাকাউন্ট ও এর সবকিছু স্থায়ীভাবে মুছে ফেলে: সব শিক্ষার্থী প্রোফাইল, অগ্রগতি, কাজ, খসড়া, পর্যালোচনা ও আপলোড করা অডিও। শিক্ষার্থীদের জন্য আপনার নেওয়া পাঠের সিদ্ধান্ত ও ভিডিও যাচাই থেকে যাবে, একজন সাবেক কর্মীর নামে দেখানো হবে। শিশুদের ডিভাইসে থাকা তারা অক্ষত থাকে। এটি ফেরানো যায় না — কপি চাইলে আগে তথ্য রপ্তানি করুন।")}</p>
            {DELETE_NOTE[role] && <p>{s(...DELETE_NOTE[role])}</p>}
            <form onSubmit={deleteAccount}>
              <label>
                {s("Current password", "বর্তমান পাসওয়ার্ড")}
                <input type="password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} required autoComplete="current-password" />
              </label>
              <label>
                {s("Type", "লিখুন")} <strong>DELETE</strong> {s("to confirm", "নিশ্চিত করতে")}
                <input type="text" value={deleteConfirm} onChange={(event) => setDeleteConfirm(event.target.value)} required />
              </label>
              {deleteError && (<p className="auth-error" role="alert">{deleteError}</p>)}
              <button type="submit" className="danger-button" disabled={busy}>{busy ? s("One moment…", "একটু অপেক্ষা…") : s("Permanently delete account", "অ্যাকাউন্ট স্থায়ীভাবে মুছুন")}</button>
            </form>
          </section>
        </div>
      </div>
    </main>
  );
}
