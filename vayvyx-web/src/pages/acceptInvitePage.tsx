import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { PasswordField } from "../components/passwordField.tsx";
import type { NavigateWithTransition } from "../app.tsx";
import {
  getPasswordPolicyHint,
  validateNewPasswordPair,
} from "../lib/authValidation.ts";
import { accessApi } from "../lib/accessApi.ts";
import { supabase } from "../lib/supabaseClient.ts";
import "../styles/accessPages.css";

type AcceptInvitePageProps = {
  onNavigate: NavigateWithTransition;
};

type InviteState = "checking" | "ready" | "invalid" | "success";

const invalidInviteMessage =
  "This invitation link is invalid or has expired.";
const readyMessage = "Complete your Vayvyx account setup.";
const successMessage = "Your Vayvyx account is ready.";

function inviteUrlHasError() {
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

export function AcceptInvitePage({ onNavigate }: AcceptInvitePageProps) {
  const [inviteState, setInviteState] = useState<InviteState>("checking");
  const [email, setEmail] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [statusMessage, setStatusMessage] = useState(readyMessage);
  const [statusType, setStatusType] = useState<"success" | "error">("success");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const sessionReadyRef = useRef(false);
  const submitInFlightRef = useRef(false);
  const redirectTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let isMounted = true;

    function acceptSession(session: Session | null) {
      if (!session?.user) return;
      sessionReadyRef.current = true;
      setEmail(session.user.email ?? null);
      const metadataName = session.user.user_metadata?.full_name;
      if (typeof metadataName === "string" && metadataName.trim()) {
        setFullName((current) => current || metadataName.trim());
      }
      setInviteState("ready");
      setStatusType("success");
      setStatusMessage(readyMessage);
    }

    function markInvalid() {
      if (sessionReadyRef.current) return;
      setInviteState("invalid");
      setStatusType("error");
      setStatusMessage(invalidInviteMessage);
    }

    const subscription = supabase.auth.onAuthStateChange(
      (event: AuthChangeEvent, session: Session | null) => {
        if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
          acceptSession(session);
        }
      },
    );

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!isMounted) return;
        if (error || inviteUrlHasError()) {
          markInvalid();
          return;
        }
        if (data.session?.user) {
          acceptSession(data.session);
          return;
        }
        markInvalid();
      })
      .catch(() => {
        if (isMounted) markInvalid();
      });

    return () => {
      isMounted = false;
      if (redirectTimerRef.current) {
        window.clearTimeout(redirectTimerRef.current);
      }
      subscription.data.subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting || submitInFlightRef.current) return;

    if (inviteState !== "ready") {
      setInviteState("invalid");
      setStatusType("error");
      setStatusMessage(invalidInviteMessage);
      return;
    }

    if (!fullName.trim()) {
      setStatusType("error");
      setStatusMessage("Enter your full name.");
      return;
    }

    const validationMessage = validateNewPasswordPair(
      newPassword,
      confirmPassword,
    );

    if (validationMessage) {
      setStatusType("error");
      setStatusMessage(validationMessage);
      return;
    }

    setIsSubmitting(true);
    submitInFlightRef.current = true;
    setStatusType("success");
    setStatusMessage("Completing account setup...");

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
        data: {
          full_name: fullName.trim(),
        },
      });

      if (error) throw error;

      await accessApi.completeInvite(fullName.trim());
      setInviteState("success");
      setStatusType("success");
      setStatusMessage(successMessage);
      setNewPassword("");
      setConfirmPassword("");

      try {
        await supabase.auth.signOut();
      } catch {
        // Setup succeeded; keep the user-facing state generic.
      }

      redirectTimerRef.current = window.setTimeout(() => {
        onNavigate("/login");
      }, 900);
    } catch {
      setStatusType("error");
      setStatusMessage("Account setup is temporarily unavailable. Try again shortly.");
    } finally {
      submitInFlightRef.current = false;
      setIsSubmitting(false);
    }
  }

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
            <p className="access-eyebrow">Invitation</p>
            <h1>Welcome to Vayvyx.</h1>
            <p className="access-description">
              Finish your invited account setup with a password only you know.
            </p>

            <div className="access-feature-list">
              <div className="access-feature">
                <span className="access-feature-icon">01</span>
                <div>
                  <strong>Temporary session</strong>
                  <p>
                    Your invitation session is used only to complete setup.
                  </p>
                </div>
              </div>
              <div className="access-feature">
                <span className="access-feature-icon">02</span>
                <div>
                  <strong>No shared passwords</strong>
                  <p>
                    Administrators can invite you or send reset links, but
                    cannot see your password.
                  </p>
                </div>
              </div>
              <div className="access-feature">
                <span className="access-feature-icon">03</span>
                <div>
                  <strong>Fresh sign-in</strong>
                  <p>
                    After setup, you will sign in normally with your new
                    password.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="access-panel-footer">
            <span>Secure invitation</span>
            <span>Private beta</span>
          </div>
        </section>

        <section className="access-form-panel">
          <div className="access-form-header">
            <div className="access-mobile-logo">
              <img src="/vayvyx-logo.png" alt="Vayvyx logo" />
            </div>
            <p className="access-eyebrow">Account setup</p>
            <h2>Complete account setup</h2>
            <p>
              {email
                ? `Invitation for ${email}`
                : "Open your invitation link to complete setup."}
            </p>
          </div>

          {inviteState === "checking" && (
            <div
              className="access-message access-message-success"
              role="status"
              aria-live="polite"
            >
              Checking your invitation...
            </div>
          )}

          {(inviteState === "ready" || inviteState === "success") && (
            <form className="access-form" onSubmit={handleSubmit}>
              {inviteState === "ready" && (
                <>
                  <label className="access-field">
                    <span>Full name</span>
                    <input
                      type="text"
                      value={fullName}
                      onChange={(event) => setFullName(event.target.value)}
                      placeholder="Your full name"
                      autoComplete="name"
                      disabled={isSubmitting}
                    />
                  </label>

                  <PasswordField
                    id="invite-new-password"
                    label="New password"
                    value={newPassword}
                    onChange={setNewPassword}
                    disabled={isSubmitting}
                    helpText={getPasswordPolicyHint()}
                  />

                  <PasswordField
                    id="invite-confirm-password"
                    label="Confirm new password"
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    disabled={isSubmitting}
                  />
                </>
              )}

              <div
                className={`access-message access-message-${statusType}`}
                role="status"
                aria-live="polite"
              >
                {statusMessage}
              </div>

              {inviteState === "ready" && (
                <button
                  className="access-primary-button"
                  type="submit"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Completing..." : "Complete account setup"}
                </button>
              )}
            </form>
          )}

          {inviteState === "invalid" && (
            <div className="access-form access-recovery-actions">
              <div
                className="access-message access-message-error"
                role="status"
                aria-live="polite"
              >
                {statusMessage}
              </div>
              <button
                className="access-primary-button"
                type="button"
                onClick={() => onNavigate("/request-demo")}
              >
                Request another invitation
              </button>
            </div>
          )}

          <div className="access-form-divider">
            <span>Need help?</span>
          </div>

          <a className="access-secondary-button access-button-link" href="mailto:support@vayvyx.com">
            Contact support
          </a>
        </section>
      </div>

      <footer className="access-page-footer">
        <span>&copy; 2026 Vayvyx</span>
        <span>Invitation setup</span>
      </footer>
    </main>
  );
}
