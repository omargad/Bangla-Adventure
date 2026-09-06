"use client";

import Image from "next/image";
import { useState } from "react";
import AuthCard from "../grown-ups/AuthCard";

type LoginRole = "student" | "parent" | "teacher";

type LoginModalProps = {
  open: boolean;
  onClose: () => void;
};

const roleContent = {
  student: {
    label: "Student",
    short: "Learn & play",
    eyebrow: "Student adventure",
    title: "Ready to explore?",
    text: "Use your student or class code to continue your Bangla adventure.",
    image: "/login-icons/student-login.png",
  },
  parent: {
    label: "Parent",
    short: "View progress",
    eyebrow: "Family space",
    title: "See how they’re growing.",
    text: "Sign in to follow learning progress and access family tools.",
    image: "/login-icons/parent-login.png",
  },
  teacher: {
    label: "Teacher",
    short: "Manage classes",
    eyebrow: "Teacher workspace",
    title: "Welcome back, teacher.",
    text: "Sign in to manage learners, activities, quizzes and progress.",
    image: "/login-icons/teacher-login.png",
  },
} satisfies Record<LoginRole, {
  label: string;
  short: string;
  eyebrow: string;
  title: string;
  text: string;
  image: string;
}>;

export default function LoginModal({
  open,
  onClose,
}: LoginModalProps) {
  const [role, setRole] = useState<LoginRole>("student");
  const [studentCode, setStudentCode] = useState("");
  const [studentMessage, setStudentMessage] = useState("");
  const [studentError, setStudentError] = useState(false);

  if (!open) return null;

  const activeRole = roleContent[role];
  const destination = role === "teacher" ? "/teach" : "/family";

  function selectRole(selectedRole: LoginRole) {
    setRole(selectedRole);
    setStudentCode("");
    setStudentMessage("");
    setStudentError(false);
  }

  function handleStudentLogin(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    const code = studentCode.trim();

    if (!code) {
      setStudentMessage("Please enter your student or class code.");
      setStudentError(true);
      return;
    }

    setStudentError(false);

    try {
      window.localStorage.setItem(
        "bangla-adventures-student-code",
        code
      );

      window.localStorage.setItem(
        "bangla-adventures-selected-role",
        "student"
      );
    } catch {
      // Continue even if localStorage is unavailable.
    }

    setStudentMessage("Adventure pass ready! Opening your student space…");

    window.setTimeout(() => {
      onClose();
      window.location.href = "/student";
    }, 500);
  }

  return (
    <div
      className="kid-login-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="kid-login-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="kid-login-title"
      >
        <span className="kid-login-star kid-login-star-one" aria-hidden="true">✦</span>
        <span className="kid-login-star kid-login-star-two" aria-hidden="true">✦</span>
        <span className="kid-login-dot kid-login-dot-one" aria-hidden="true" />
        <span className="kid-login-dot kid-login-dot-two" aria-hidden="true" />

        <button
          type="button"
          className="kid-login-close"
          onClick={onClose}
          aria-label="Close sign in"
        >
          ×
        </button>

        <div className="kid-login-header">
          <div className="kid-login-brand">
            <div className="kid-login-brand-badge">বা</div>
            <div>
              <strong>Bangla Adventures</strong>
              <small>Learn · Explore · Belong</small>
            </div>
          </div>

          <div className="kid-login-title-wrap">
            <div className="kid-login-bagh">
              <Image
                src="/login-icons/bagh-login.png"
                width={116}
                height={116}
                alt=""
                priority
              />
            </div>

            <div>
              <p className="kid-login-kicker">Hi there, adventurer!</p>
              <h2 id="kid-login-title">Where are you heading today?</h2>
              <p className="kid-login-subtitle">
                Choose your space and continue your Bangla journey.
              </p>
            </div>
          </div>
        </div>

        <div className="kid-login-role-grid">
          {(Object.keys(roleContent) as LoginRole[]).map((item) => {
            const content = roleContent[item];
            const selected = role === item;

            return (
              <button
                key={item}
                type="button"
                className={`kid-login-role kid-login-role-${item} ${
                  selected ? "is-active" : ""
                }`}
                onClick={() => selectRole(item)}
                aria-pressed={selected}
              >
                <span className="kid-login-role-image">
                  <Image
                    src={content.image}
                    width={92}
                    height={92}
                    alt=""
                  />
                </span>

                <span className="kid-login-role-copy">
                  <strong>{content.label}</strong>
                  <small>{content.short}</small>
                </span>

                <span className="kid-login-role-status" aria-hidden="true">
                  {selected ? "✓" : ""}
                </span>
              </button>
            );
          })}
        </div>

        <div className={`kid-login-panel kid-login-panel-${role}`}>
          <div className="kid-login-panel-top">
            <div>
              <p>{activeRole.eyebrow}</p>
              <h3>{activeRole.title}</h3>
              <span>{activeRole.text}</span>
            </div>

            <Image
              className="kid-login-active-art"
              src={activeRole.image}
              width={150}
              height={150}
              alt=""
            />
          </div>

          {role === "student" ? (
            <form
              className={`kid-login-form ${
                studentError ? "has-error" : ""
              }`}
              onSubmit={handleStudentLogin}
            >
              <label className="kid-login-label">
                <span>Your student or class code</span>

                <div className="kid-login-input-wrap">
                  <Image
                    src="/login-icons/student-id.png"
                    width={44}
                    height={44}
                    alt=""
                  />

                  <input
                    type="text"
                    value={studentCode}
                    onChange={(event) => {
                      setStudentCode(event.target.value);

                      if (studentError) {
                        setStudentError(false);
                        setStudentMessage("");
                      }
                    }}
                    placeholder="Example: TIGER-204"
                    autoComplete="off"
                    aria-invalid={studentError}
                  />
                </div>
              </label>

              <button type="submit" className="kid-login-primary">
                <span>Start my adventure</span>
                <span className="kid-login-arrow" aria-hidden="true">→</span>
              </button>

              {studentMessage && (
                <p
                  className={`kid-login-message ${
                    studentError ? "error" : "success"
                  }`}
                  role="status"
                >
                  {studentMessage}
                </p>
              )}

              <div className="kid-login-helper">
                <span aria-hidden="true">💡</span>
                Your teacher will give you your student or class code.
              </div>
            </form>
          ) : (
            <div className="kid-login-auth-wrap">
              <AuthCard
                returnTo={destination}
                language="en"
              />
            </div>
          )}
        </div>

        <div className="kid-login-trust">
          <Image
            src="/login-icons/secure-login.png"
            width={48}
            height={48}
            alt=""
          />
          <div>
            <strong>Safe and secure</strong>
            <p>
              Parent and teacher accounts use the existing Bangla Adventures
              authentication system.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
