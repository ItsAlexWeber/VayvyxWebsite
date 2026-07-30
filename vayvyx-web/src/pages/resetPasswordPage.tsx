import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type {
  AuthChangeEvent,
  Session,
} from "@supabase/supabase-js";
import { PasswordField } from "../components/passwordField.tsx";
import type { NavigateWithTransition } from "../app.tsx";
import {
  getPasswordPolicyHint,
  validateNewPasswordPair,
} from "../lib/authValidation.ts";
import { authEmailApi } from "../lib/authEmailApi.ts";
import { supabase } from "../lib/supabaseClient.ts";
import "../styles/accessPages.css";

type ResetPasswordPageProps = {
  onNavigate: NavigateWithTransition;
};

type RecoveryState = "checking" | "ready" | "invalid" | "success";

type StatusMessage = {
  type: "success" | "error";
  text: string;
};

const invalidRecoveryMessage =
  "This password-reset link is invalid or has expired.";
const updateFailureMessage =
  "Password update is temporarily unavailable. Try again shortly.";
const passwordChangedMessage =
  "Your password was changed. You may sign in with the new password.";
const loginRedirectDelayMs = 850;

function recoveryUrlHasError() {
  const hashParams = new URLSearchParams(
    window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash,
  );
  const queryParams = new URLSearchParams(window.location.search);

  return (
    hashParams.has("error") ||
    hashParams.has("error_code") ||
    queryParams.has("error") ||
    queryParams.has("error_code")
  );
}

function hasUsableSession(session: Session | null) {
  return Boolean(session?.user);
}

export function ResetPasswordPage({ onNavigate }: ResetPasswordPageProps) {
  const [recoveryState, setRecoveryState] =
    useState<RecoveryState>("checking");
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(
    null,
  );
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const redirectTimerRef = useRef<number | null>(null);
  const recoveryReadyRef = useRef(false);
  const updateInFlightRef = useRef(false);

  useEffect(() => {
    let isMounted = true;

    function markReady(session: Session | null) {
      if (!hasUsableSession(session)) {
        return;
      }

      recoveryReadyRef.current = true;
      setRecoveryState("ready");
      setStatusMessage(null);
    }

    function markInvalid() {
      if (recoveryReadyRef.current) {
        return;
      }

      setRecoveryState("invalid");
      setStatusMessage({
        type: "error",
        text: invalidRecoveryMessage,
      });
    }

    const authSubscription = supabase.auth.onAuthStateChange(
      (event: AuthChangeEvent, session: Session | null) => {
        if (event === "PASSWORD_RECOVERY") {
          markReady(session);
        }
      },
    );

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!isMounted) {
          return;
        }

        if (error || recoveryUrlHasError()) {
          markInvalid();
          return;
        }

        if (hasUsableSession(data.session)) {
          markReady(data.session);
          return;
        }

        markInvalid();
      })
      .catch(() => {
        if (!isMounted) {
          return;
        }

        markInvalid();
      });

    return () => {
      isMounted = false;

      if (redirectTimerRef.current) {
        window.clearTimeout(redirectTimerRef.current);
      }

      authSubscription.data.subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting || updateInFlightRef.current) {
      return;
    }

    if (recoveryState !== "ready") {
      setRecoveryState("invalid");
      setStatusMessage({
        type: "error",
        text: invalidRecoveryMessage,
      });
      return;
    }

    const validationMessage = validateNewPasswordPair(
      newPassword,
      confirmPassword,
    );

    if (validationMessage) {
      setStatusMessage({
        type: "error",
        text: validationMessage,
      });
      return;
    }

    setIsSubmitting(true);
    updateInFlightRef.current = true;
    setStatusMessage(null);

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) {
        throw error;
      }

      setRecoveryState("success");
      setStatusMessage({
        type: "success",
        text: passwordChangedMessage,
      });
      setNewPassword("");
      setConfirmPassword("");

      await authEmailApi.notifyPasswordChanged();

      try {
        await supabase.auth.signOut();
      } catch {
        // The password change already succeeded; avoid surfacing auth internals.
      }

      redirectTimerRef.current = window.setTimeout(() => {
        onNavigate("/login");
      }, loginRedirectDelayMs);
    } catch {
      setStatusMessage({
        type: "error",
        text: updateFailureMessage,
      });
    } finally {
      updateInFlightRef.current = false;
      setIsSubmitting(false);
    }
  }

  const isReady = recoveryState === "ready";
  const isInvalid = recoveryState === "invalid";
  const isSuccess = recoveryState === "success";

  return (
    <main className="access-page">
      <button
        className="access-back-button"
        type="button"
        onClick={() => onNavigate("/login")}
      >
        <span aria-hidden="true">{"<-"}</span>
        Return to sign in
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
            <p className="access-eyebrow">Secure reset</p>

            <h1>Choose a new password.</h1>

            <p className="access-description">
              Complete the Supabase recovery flow by setting a new password for
              your Vayvyx account.
            </p>

            <div className="access-feature-list">
              <div className="access-feature">
                <span className="access-feature-icon">01</span>

                <div>
                  <strong>Recovery-only session</strong>
                  <p>
                    This page uses the temporary recovery session only to
                    update your password.
                  </p>
                </div>
              </div>

              <div className="access-feature">
                <span className="access-feature-icon">02</span>

                <div>
                  <strong>Protected fields</strong>
                  <p>
                    Tokens, URL fragments, and Supabase internals are never
                    displayed in the browser.
                  </p>
                </div>
              </div>

              <div className="access-feature">
                <span className="access-feature-icon">03</span>

                <div>
                  <strong>Fresh sign-in</strong>
                  <p>
                    After the change succeeds, the recovery session is signed
                    out and you can log in normally.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="access-panel-footer">
            <span>Password reset</span>
            <span>Supabase Auth</span>
          </div>
        </section>

        <section className="access-form-panel">
          <div className="access-form-header">
            <div className="access-mobile-logo">
              <img src="/vayvyx-logo.png" alt="Vayvyx logo" />
            </div>

            <p className="access-eyebrow">Account recovery</p>

            <h2>Update password</h2>

            <p>
              Enter and confirm your new password. Use the reset email again if
              this link has expired.
            </p>
          </div>

          {recoveryState === "checking" && (
            <div
              className="access-message access-message-success"
              role="status"
              aria-live="polite"
            >
              Checking your reset link...
            </div>
          )}

          {(isReady || isSuccess) && (
            <form
              className="access-form"
              onSubmit={handleSubmit}
              aria-describedby="reset-password-status"
            >
              {isReady && (
                <>
                  <PasswordField
                    id="reset-new-password"
                    label="New password"
                    value={newPassword}
                    onChange={setNewPassword}
                    disabled={isSubmitting}
                    helpText={getPasswordPolicyHint()}
                  />

                  <PasswordField
                    id="reset-confirm-password"
                    label="Confirm new password"
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    disabled={isSubmitting}
                  />
                </>
              )}

              {statusMessage && (
                <div
                  id="reset-password-status"
                  className={`access-message access-message-${statusMessage.type}`}
                  role="status"
                  aria-live="polite"
                >
                  {statusMessage.text}
                </div>
              )}

              {isReady && (
                <button
                  className="access-primary-button"
                  type="submit"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Updating..." : "Update password"}
                </button>
              )}
            </form>
          )}

          {isInvalid && (
            <div className="access-form access-recovery-actions">
              {statusMessage && (
                <div
                  id="reset-password-status"
                  className={`access-message access-message-${statusMessage.type}`}
                  role="status"
                  aria-live="polite"
                >
                  {statusMessage.text}
                </div>
              )}

              <button
                className="access-primary-button"
                type="button"
                onClick={() => onNavigate("/forgot-password")}
              >
                Request another reset link
              </button>
            </div>
          )}

          <div className="access-form-divider">
            <span>Back to account access</span>
          </div>

          <button
            className="access-secondary-button"
            type="button"
            onClick={() => onNavigate("/login")}
          >
            Return to sign in
          </button>

          <p className="access-security-note">
            Choose a password you do not use on other services.
          </p>
        </section>
      </div>

      <footer className="access-page-footer">
        <span>&copy; 2026 Vayvyx</span>
        <span>Secure account recovery</span>
      </footer>
    </main>
  );
}
