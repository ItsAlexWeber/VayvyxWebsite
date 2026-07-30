import { useState, type FormEvent } from "react";
import type { NavigateWithTransition } from "../app.tsx";
import {
  normalizeAuthEmail,
  passwordMinimumLength,
} from "../lib/authValidation.ts";
import { supabase } from "../lib/supabaseClient.ts";
import "../styles/accessPages.css";

type LoginPageProps = {
  onNavigate: NavigateWithTransition;
};

type AuthMode = "login" | "create";
type MessageType = "success" | "error";

type StatusMessage = {
  type: MessageType;
  text: string;
};

export function LoginPage({ onNavigate }: LoginPageProps) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [statusMessage, setStatusMessage] =
    useState<StatusMessage | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setStatusMessage(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedEmail = normalizeAuthEmail(email);

    if (!normalizedEmail || !password) {
      setStatusMessage({
        type: "error",
        text: "Enter your email address and password.",
      });

      return;
    }

    if (password.length < passwordMinimumLength) {
      setStatusMessage({
        type: "error",
        text: "Your password must contain at least eight characters.",
      });

      return;
    }

    if (mode === "create" && !fullName.trim()) {
      setStatusMessage({
        type: "error",
        text: "Enter your name to create an account.",
      });

      return;
    }

    setIsSubmitting(true);
    setStatusMessage(null);

    try {
      if (mode === "login") {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });

        if (error) {
          throw error;
        }

        if (!data.session) {
          throw new Error("A valid login session could not be created.");
        }

        onNavigate("/account");
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          data: {
            full_name: fullName.trim(),
          },
        },
      });

      if (error) {
        throw error;
      }

      if (data.session) {
        onNavigate("/account");
        return;
      }

      setStatusMessage({
        type: "success",
        text: "Your account was created. Check your email to confirm your address before logging in.",
      });

      setPassword("");
    } catch (error) {
      setStatusMessage({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Vayvyx could not complete the request.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="access-page">
      <button
        className="access-back-button"
        type="button"
        onClick={() => onNavigate("/")}
      >
        <span aria-hidden="true">←</span>
        Back to site
      </button>

      <div className="access-layout">
        <section className="access-information-panel">
          <div className="access-brand">
            <div className="access-brand-logo">
              <img src="/vayvyx-logo.png" alt="" />
            </div>

            <span>Vayvyx</span>
          </div>

          <div className="access-information-content">
            <p className="access-eyebrow">Private beta access</p>

            <h1>Enter the Vayvyx workspace.</h1>

            <p className="access-description">
              Sign in with an approved Vayvyx account to review your access,
              license status, and available beta resources.
            </p>

            <div className="access-feature-list">
              <div className="access-feature">
                <span className="access-feature-icon">01</span>

                <div>
                  <strong>Approved accounts</strong>
                  <p>
                    Workspace access is limited to registered beta users and
                    approved testers.
                  </p>
                </div>
              </div>

              <div className="access-feature">
                <span className="access-feature-icon">02</span>

                <div>
                  <strong>License validation</strong>
                  <p>
                    Account access and product licensing are checked separately.
                  </p>
                </div>
              </div>

              <div className="access-feature">
                <span className="access-feature-icon">03</span>

                <div>
                  <strong>Controlled rollout</strong>
                  <p>
                    Beta access is intentionally limited while the product is
                    tested and refined.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="access-panel-footer">
            <span>Controlled access</span>
            <span>Private beta</span>
          </div>
        </section>

        <section className="access-form-panel">
          <div className="access-form-header">
            <div className="access-mobile-logo">
              <img src="/vayvyx-logo.png" alt="Vayvyx logo" />
            </div>

            <p className="access-eyebrow">
              {mode === "login" ? "Welcome back" : "Account setup"}
            </p>

            <h2>
              {mode === "login"
                ? "Log in to your account"
                : "Create your account"}
            </h2>

            <p>
              {mode === "login"
                ? "Use the email address associated with your Vayvyx access."
                : "Account creation does not automatically activate a product license."}
            </p>
          </div>

          <div className="access-mode-toggle" aria-label="Authentication mode">
            <button
              className={mode === "login" ? "active" : ""}
              type="button"
              onClick={() => changeMode("login")}
            >
              Log in
            </button>

            <button
              className={mode === "create" ? "active" : ""}
              type="button"
              onClick={() => changeMode("create")}
            >
              Create account
            </button>
          </div>

          <form className="access-form" onSubmit={handleSubmit}>
            {mode === "create" && (
              <label className="access-field">
                <span>Name</span>

                <input
                  type="text"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="Your full name"
                  autoComplete="name"
                  disabled={isSubmitting}
                />
              </label>
            )}

            <label className="access-field">
              <span>Email address</span>

              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@company.com"
                autoComplete="email"
                disabled={isSubmitting}
              />
            </label>

            <label className="access-field">
              <span>Password</span>

              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                disabled={isSubmitting}
              />

              {mode === "create" && (
                <small>Use at least eight characters.</small>
              )}
            </label>

            {mode === "login" && (
              <a
                className="access-inline-link"
                href="/forgot-password"
                onClick={(event) => {
                  event.preventDefault();
                  onNavigate("/forgot-password");
                }}
              >
                Forgot password?
              </a>
            )}

            {statusMessage && (
              <div
                className={`access-message access-message-${statusMessage.type}`}
                role="status"
                aria-live="polite"
              >
                {statusMessage.text}
              </div>
            )}

            <button
              className="access-primary-button"
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting
                ? "Please wait..."
                : mode === "login"
                  ? "Log in"
                  : "Create account"}
            </button>
          </form>

          <div className="access-form-divider">
            <span>Need access?</span>
          </div>

          <button
            className="access-secondary-button"
            type="button"
            onClick={() => onNavigate("/request-demo")}
          >
            Request private beta access
          </button>

          <p className="access-security-note">
            Do not share your password or account credentials with another
            person.
          </p>
        </section>
      </div>

      <footer className="access-page-footer">
        <span>© 2026 Vayvyx</span>
        <span>Private beta</span>
      </footer>
    </main>
  );
}
