"use client";

import { useState } from "react";
import type { Language } from "../../lib/use-language";
import { accountHome, approvalNotice, canManageUsers, type AccountAccess, type ApprovalStatus } from "../../lib/roles";
import { passwordChangeDestination } from "../../lib/learning-policy";

type Mode = "sign-in" | "sign-up" | "recover";

export default function AuthCard({ returnTo, language = "en", initialMode = "sign-in", requireAdmin = false }: { returnTo: string; language?: Language; initialMode?: "sign-in" | "sign-up"; requireAdmin?: boolean }) {
  const s = (en: string, bn: string) => (language === "bn" ? bn : en);
  const [mode, setMode] = useState<Mode>(requireAdmin ? "sign-in" : initialMode);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [issuedCodes, setIssuedCodes] = useState<string[] | null>(null);
  const [codesCopied, setCodesCopied] = useState(false);
  // Set after a self sign-up: the account cannot sign in until an administrator approves it.
  const [awaitingApproval, setAwaitingApproval] = useState(false);
  const pendingNotice = approvalNotice("pending", "adult");
  const [accountType, setAccountType] = useState<"parent" | "teacher">(returnTo === "/teach" || returnTo === "/studio" ? "teacher" : "parent");
  const [destination, setDestination] = useState(returnTo);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
  }
  const approvalError = (status: Exclude<ApprovalStatus, "approved">) => {
    const [en, bn] = approvalNotice(status, "adult");
    return s(en, bn);
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const endpoint =
        mode === "sign-in"
          ? "/api/auth/sign-in"
          : mode === "sign-up"
            ? "/api/auth/sign-up"
            : "/api/auth/recover";
      const payload =
        mode === "sign-in"
          ? { email, password, requireAdmin }
          : mode === "sign-up"
            ? { email, password, displayName, accountType }
            : { email, recoveryCode, newPassword: password };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        recoveryCodes?: string[];
        adult?: AccountAccess & { mustChangePassword?: boolean };
        approvalStatus?: Exclude<ApprovalStatus, "approved">;
        pendingApproval?: boolean;
      };
      if (!response.ok) {
        setError(data.approvalStatus ? approvalError(data.approvalStatus) : data.error ?? s("Something went wrong. Please try again.", "কিছু একটা সমস্যা হয়েছে। আবার চেষ্টা করুন।"));
        return;
      }
      if (data.pendingApproval) {
        // No session starts: show the recovery codes once, then the sign-in form with the waiting notice.
        setPassword("");
        setAwaitingApproval(true);
        if (data.recoveryCodes?.length) setIssuedCodes(data.recoveryCodes);
        else switchMode("sign-in");
        return;
      }
      if (requireAdmin && (!data.adult || !canManageUsers(data.adult))) {
        setError(s("This account does not have administrator access. Sign in with your administrator account.", "এই অ্যাকাউন্টে প্রশাসকের অনুমতি নেই। প্রশাসকের অ্যাকাউন্টে সাইন ইন করুন।"));
        return;
      }
      const target = returnTo === "/family" && data.adult ? accountHome(data.adult) : returnTo;
      setDestination(target);
      if (data.recoveryCodes?.length) {
        // Recovery of an account an administrator set up renews its codes: show them once before leaving.
        setIssuedCodes(data.recoveryCodes);
        return;
      }
      // An administrator-issued password is replaced before anything else.
      window.location.replace(data.adult?.mustChangePassword ? passwordChangeDestination(target) : target);
    } catch {
      setError(s("Could not reach the server. Check your connection and try again.", "সার্ভারে পৌঁছানো যায়নি। সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।"));
    } finally {
      setBusy(false);
    }
  }

  async function copyCodes() {
    if (!issuedCodes) return;
    try {
      await navigator.clipboard.writeText(issuedCodes.join("\n"));
      setCodesCopied(true);
    } catch {
      setCodesCopied(false);
    }
  }

  if (issuedCodes) {
    return (
      <section className="auth-card" aria-label="Recovery codes">
        {awaitingApproval && <>
          <h2>{s("Account created — waiting for approval", "অ্যাকাউন্ট তৈরি হয়েছে — অনুমোদনের অপেক্ষায়")}</h2>
          <p className="auth-success" role="status">{s(...pendingNotice)}</p>
        </>}
        <h2 className="auth-codes-title">{s("Save your recovery codes", "আপনার পুনরুদ্ধার কোড সংরক্ষণ করুন")}</h2>
        <p className="auth-note">
          {s(
            "There is no email reset on this platform. If you forget your password, one of these one-time codes is the only way back into your account. Store them somewhere safe — they are shown only once.",
            "এই প্ল্যাটফর্মে ইমেইলে রিসেট নেই। পাসওয়ার্ড ভুলে গেলে এই এককালীন কোডগুলোর একটিই অ্যাকাউন্টে ফেরার একমাত্র উপায়। নিরাপদ জায়গায় রাখুন — এগুলো কেবল একবারই দেখানো হয়।",
          )}
        </p>
        <ul className="auth-codes" aria-label="One-time recovery codes">
          {issuedCodes.map((code) => (
            <li key={code}>
              <code>{code}</code>
            </li>
          ))}
        </ul>
        <div className="auth-codes-actions">
          <button type="button" className="outline-button" onClick={() => void copyCodes()}>
            {codesCopied ? s("Copied ✓", "কপি হয়েছে ✓") : s("Copy all codes", "সব কোড কপি করুন")}
          </button>
          <button
            type="button"
            className="auth-submit"
            onClick={() => {
              if (!awaitingApproval) {
                window.location.replace(destination);
                return;
              }
              setIssuedCodes(null);
              switchMode("sign-in");
            }}
          >
            {awaitingApproval ? s("I’ve saved them — back to sign in", "সংরক্ষণ করেছি — সাইন ইনে ফিরুন") : s("I’ve saved them — continue", "সংরক্ষণ করেছি — এগিয়ে যান")}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="auth-card" aria-label="Grown-up account">
      <div className="auth-tabs" role="tablist" aria-label="Sign in or create account">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "sign-in"}
          className={mode === "sign-in" ? "active" : ""}
          onClick={() => switchMode("sign-in")}
        >
          {s("Sign in", "সাইন ইন")}
        </button>
        {!requireAdmin && <button
          type="button"
          role="tab"
          aria-selected={mode === "sign-up"}
          className={mode === "sign-up" ? "active" : ""}
          onClick={() => switchMode("sign-up")}
        >
          {s("Create account", "অ্যাকাউন্ট তৈরি")}
        </button>}
      </div>

      {awaitingApproval && mode === "sign-in" && !error && (
        <p className="auth-success" role="status">{s(...pendingNotice)}</p>
      )}

      {mode === "recover" && (
        <p className="auth-note" role="note">
          {s(
            "Enter one unused recovery code from the list you saved at sign-up. The code is consumed and every signed-in device is signed out.",
            "সাইন-আপের সময় সংরক্ষণ করা তালিকা থেকে একটি অব্যবহৃত পুনরুদ্ধার কোড দিন। কোডটি ব্যবহৃত হয়ে যায় এবং সাইন-ইন থাকা সব ডিভাইস সাইন-আউট হয়।",
          )}
        </p>
      )}

      <form onSubmit={submit}>
        {mode === "sign-up" && <label>
          {s("Account type", "অ্যাকাউন্টের ধরন")}
          <select value={accountType} onChange={(event) => setAccountType(event.target.value as "parent" | "teacher")}>
            <option value="parent">{s("Parent or carer", "অভিভাবক")}</option>
            <option value="teacher">{s("Teacher — approval required", "শিক্ষক — অনুমোদন প্রয়োজন")}</option>
          </select>
          {accountType === "teacher" && <small>{s("An administrator reviews your request before you can teach.", "পড়ানো শুরু করার আগে প্রশাসক আপনার আবেদন পর্যালোচনা করবেন।")}</small>}
        </label>}
        {mode === "sign-up" && <p className="auth-note">{s("An administrator approves every new account before it can sign in.", "প্রতিটি নতুন অ্যাকাউন্ট দিয়ে সাইন ইন করার আগে প্রশাসকের অনুমোদন প্রয়োজন।")}</p>}
        {mode === "sign-up" && (
          <label>
            {accountType === "teacher" ? s("Your name (shown to learners)", "আপনার নাম (শিক্ষার্থীরা দেখবে)") : s("Your name", "আপনার নাম")}
            <input
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={60}
              required
              autoComplete="name"
            />
          </label>
        )}
        <label>
          {s("Email", "ইমেইল")}
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            maxLength={120}
            required
            autoComplete={mode === "sign-in" ? "username" : "email"}
          />
        </label>
        {mode === "recover" && (
          <label>
            {s("Recovery code", "পুনরুদ্ধার কোড")}
            <input
              type="text"
              value={recoveryCode}
              onChange={(event) => setRecoveryCode(event.target.value)}
              maxLength={20}
              required
              placeholder="XXXXX-XXXXX"
              autoComplete="one-time-code"
            />
          </label>
        )}
        <label>
          {mode === "sign-in" ? s("Password", "পাসওয়ার্ড") : mode === "sign-up" ? s("Password", "পাসওয়ার্ড") : s("New password", "নতুন পাসওয়ার্ড")}{" "}
          {mode !== "sign-in" && <small>{s("(at least 10 characters)", "(কমপক্ষে ১০ অক্ষর)")}</small>}
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={mode === "sign-in" ? undefined : 10}
            maxLength={200}
            required
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
          />
        </label>
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="auth-submit" disabled={busy}>
          {busy
            ? s("One moment…", "একটু অপেক্ষা…")
            : mode === "sign-in"
              ? s("Sign in", "সাইন ইন")
              : mode === "sign-up"
                ? s("Create account", "অ্যাকাউন্ট তৈরি")
                : s("Reset password", "পাসওয়ার্ড রিসেট")}
        </button>
      </form>

      {mode === "sign-in" && (
        <button type="button" className="auth-link" onClick={() => switchMode("recover")}>
          {s("Forgot your password? Use a recovery code", "পাসওয়ার্ড ভুলে গেছেন? পুনরুদ্ধার কোড ব্যবহার করুন")}
        </button>
      )}
      {mode === "recover" && (
        <button type="button" className="auth-link" onClick={() => switchMode("sign-in")}>
          {s("Back to sign in", "সাইন ইনে ফিরে যান")}
        </button>
      )}

      <p className="auth-note">
        {s(
          "Grown-up accounts store only your email, display name and a securely hashed password. Learner profiles you create hold no child contact details.",
          "বড়দের অ্যাকাউন্টে কেবল আপনার ইমেইল, নাম ও নিরাপদে হ্যাশ করা পাসওয়ার্ড থাকে। আপনার তৈরি শিক্ষার্থী প্রোফাইলে শিশুর কোনো যোগাযোগ তথ্য থাকে না।",
        )}
      </p>
    </section>
  );
}
