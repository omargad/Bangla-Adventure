"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

type Props = {
  children: ReactNode;
};

type AccessState = "checking" | "allowed" | "blocked";

export default function StudentAccessGate({ children }: Props) {
  const [access, setAccess] = useState<AccessState>("checking");
  const [studentCode, setStudentCode] = useState("");

  useEffect(() => {
    try {
      const role = window.localStorage.getItem(
        "bangla-adventures-selected-role"
      );
      const code = window.localStorage.getItem(
        "bangla-adventures-student-code"
      );

      if (role === "student" && code?.trim()) {
        setStudentCode(code.trim());
        setAccess("allowed");
      } else {
        setAccess("blocked");
      }
    } catch {
      setAccess("blocked");
    }
  }, []);

  function signOutStudent() {
    try {
      window.localStorage.removeItem("bangla-adventures-selected-role");
      window.localStorage.removeItem("bangla-adventures-student-code");
    } catch {
      // Continue to the public page even if storage is unavailable.
    }

    window.location.href = "/";
  }

  if (access === "checking") {
    return (
      <main className="student-access-screen student-access-loading">
        <div className="student-access-card">
          <div className="student-access-logo" aria-hidden="true">বা</div>
          <p className="student-access-kicker">Bangla Adventures</p>
          <h1>Checking your adventure pass…</h1>
          <div className="student-access-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </div>
      </main>
    );
  }

  if (access === "blocked") {
    return (
      <main className="student-access-screen">
        <section className="student-access-card student-access-blocked">
          <div className="student-access-character" aria-hidden="true">
            🐯
          </div>

          <p className="student-access-kicker">Student area</p>
          <h1>This adventure needs a student sign-in.</h1>

          <p className="student-access-copy">
            You can explore the public Bangla Adventures website without an
            account, but lessons, games, stars and learning progress are
            available only after student access is selected.
          </p>

          <div className="student-access-lock" aria-hidden="true">
            <span>🔒</span>
            <div>
              <strong>Student activities protected</strong>
              <small>Sign in from the public homepage to continue.</small>
            </div>
          </div>

          <div className="student-access-actions">
            <Link className="student-access-primary" href="/">
              Go to sign in <span aria-hidden="true">→</span>
            </Link>

            <Link className="student-access-secondary" href="/">
              Back to public website
            </Link>
          </div>

          <p className="student-access-demo-note">
            Guest access does not unlock student learning activities.
          </p>
        </section>
      </main>
    );
  }

  return (
    <>
      <div className="student-session-strip">
        <div>
          <span aria-hidden="true">🎒</span>
          <p>
            <strong>Student access active</strong>
            <small>{studentCode}</small>
          </p>
        </div>

        <button type="button" onClick={signOutStudent}>
          Sign out
        </button>
      </div>

      {children}
    </>
  );
}
