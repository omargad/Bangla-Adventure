"use client";

import { useState } from "react";

type LoginRole = "student" | "parent" | "teacher";

type LoginModalProps = {
  open: boolean;
  onClose: () => void;
};

export default function LoginModal({
  open,
  onClose,
}: LoginModalProps) {
  const [role, setRole] = useState<LoginRole>("student");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");

  if (!open) {
    return null;
  }

  function selectRole(selectedRole: LoginRole) {
    setRole(selectedRole);
    setUsername("");
    setPassword("");
    setMessage("");
  }

  function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!username.trim() || !password.trim()) {
      setMessage("Please complete all fields.");
      return;
    }

    /*
      Authentication will be connected to the backend later.

      Planned access:
      Student -> learning/class area
      Parent  -> /family
      Teacher -> /teach
    */

    setMessage(
      `${
        role.charAt(0).toUpperCase() + role.slice(1)
      } login is ready for authentication integration.`
    );
  }

  return (
    <div
      className="login-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="login-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-modal-title"
      >
        <button
          type="button"
          className="login-modal-close"
          onClick={onClose}
          aria-label="Close login"
        >
          ×
        </button>

        <div className="login-modal-heading">
          <div className="login-modal-logo" aria-hidden="true">
            বা
          </div>

          <p className="login-modal-kicker">Welcome back 👋</p>

          <h2 id="login-modal-title">
            Sign in to Bangla Adventures
          </h2>

          <p>
            Choose your account type and continue your learning journey.
          </p>
        </div>

        <div className="login-role-options">
          <button
            type="button"
            className={`login-role-card ${
              role === "student" ? "active" : ""
            }`}
            onClick={() => selectRole("student")}
          >
            <span className="login-role-icon" aria-hidden="true">
              🧒
            </span>

            <span>
              <strong>Student</strong>
              <small>Learn, play and complete activities</small>
            </span>
          </button>

          <button
            type="button"
            className={`login-role-card ${
              role === "parent" ? "active" : ""
            }`}
            onClick={() => selectRole("parent")}
          >
            <span className="login-role-icon" aria-hidden="true">
              👨‍👩‍👧
            </span>

            <span>
              <strong>Parent</strong>
              <small>View your child's learning progress</small>
            </span>
          </button>

          <button
            type="button"
            className={`login-role-card ${
              role === "teacher" ? "active" : ""
            }`}
            onClick={() => selectRole("teacher")}
          >
            <span className="login-role-icon" aria-hidden="true">
              👩‍🏫
            </span>

            <span>
              <strong>Teacher</strong>
              <small>Manage classes, quizzes and results</small>
            </span>
          </button>
        </div>

        <form className="login-form" onSubmit={handleLogin}>
          {role === "student" ? (
            <label className="login-field">
              <span>Student / Class Code</span>

              <input
                type="text"
                value={username}
                onChange={(event) =>
                  setUsername(event.target.value)
                }
                placeholder="Enter your student code"
                autoComplete="username"
              />
            </label>
          ) : (
            <label className="login-field">
              <span>Email Address</span>

              <input
                type="email"
                value={username}
                onChange={(event) =>
                  setUsername(event.target.value)
                }
                placeholder="name@example.com"
                autoComplete="email"
              />
            </label>
          )}

          <label className="login-field">
            <span>Password</span>

            <div className="login-password-field">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) =>
                  setPassword(event.target.value)
                }
                placeholder="Enter your password"
                autoComplete="current-password"
              />

              <button
                type="button"
                onClick={() =>
                  setShowPassword((current) => !current)
                }
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </label>

          <div className="login-helper-row">
            <label className="remember-login">
              <input type="checkbox" />
              <span>Remember me</span>
            </label>

            {role !== "student" && (
              <button
                type="button"
                className="forgot-password"
              >
                Forgot password?
              </button>
            )}
          </div>

          <button
            type="submit"
            className="login-main-button"
          >
            {role === "student" && "Start learning"}
            {role === "parent" && "Parent sign in"}
            {role === "teacher" && "Teacher sign in"}
          </button>

          {message && (
            <p className="login-message" role="status">
              {message}
            </p>
          )}
        </form>

        <div className="login-role-information">
          {role === "student" && (
            <>
              <strong>Student access</strong>
              <p>
                Complete lessons, quizzes and activities and
                view your own learning progress.
              </p>
            </>
          )}

          {role === "parent" && (
            <>
              <strong>Parent access</strong>
              <p>
                Follow your child's progress, activities and
                learning journey.
              </p>
            </>
          )}

          {role === "teacher" && (
            <>
              <strong>Teacher access</strong>
              <p>
                Manage classes, quizzes, activities,
                submissions and student results.
              </p>
            </>
          )}
        </div>

        <p className="login-privacy-note">
          🔒 Your account details should only be used to
          provide access to the appropriate learning area.
        </p>
      </section>
    </div>
  );
}