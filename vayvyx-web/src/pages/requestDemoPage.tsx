import { useState, type FormEvent } from "react";
import type { NavigateWithTransition } from "../app.tsx";
import { supabase } from "../lib/supabaseClient.ts";
import "../styles/accessPages.css";

type RequestDemoPageProps = {
  onNavigate: NavigateWithTransition;
};

type MessageType = "success" | "error";

type StatusMessage = {
  type: MessageType;
  text: string;
};

export function RequestDemoPage({
  onNavigate,
}: RequestDemoPageProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [message, setMessage] = useState("");
  const [statusMessage, setStatusMessage] =
    useState<StatusMessage | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedEmail = email.trim().toLowerCase();

    if (!name.trim() || !normalizedEmail) {
      setStatusMessage({
        type: "error",
        text: "Enter your name and email address.",
      });

      return;
    }

    setIsSubmitting(true);
    setStatusMessage(null);

    try {
      const { error } = await supabase.from("demo_requests").insert({
        name: name.trim(),
        email: normalizedEmail,
        company: company.trim() || null,
        message: message.trim() || null,
      });

      if (error) {
        throw error;
      }

      setStatusMessage({
        type: "success",
        text: "Your request was received. Vayvyx will review the information you provided.",
      });

      setName("");
      setEmail("");
      setCompany("");
      setMessage("");
    } catch (error) {
      setStatusMessage({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Vayvyx could not submit your request.",
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

      <div className="access-layout access-layout-demo">
        <section className="access-information-panel">
          <div className="access-brand">
            <div className="access-brand-logo">
              <img src="/vayvyx-logo.png" alt="" />
            </div>

            <span>Vayvyx</span>
          </div>

          <div className="access-information-content access-information-content-demo">
            <p className="access-eyebrow">Request private access</p>

            <h1>Help shape a focused coordination workspace.</h1>

            <p className="access-description">
              Vayvyx is being introduced through a controlled beta. Access
              requests are reviewed to ensure each tester is a good fit for the
              current stage of development.
            </p>

            <div className="access-feature-list">
              <div className="access-feature">
                <span className="access-feature-icon">01</span>

                <div>
                  <strong>Submit your request</strong>
                  <p>
                    Tell us about your role and why you are interested in
                    testing Vayvyx.
                  </p>
                </div>
              </div>

              <div className="access-feature">
                <span className="access-feature-icon">02</span>

                <div>
                  <strong>Access review</strong>
                  <p>
                    Requests are reviewed before an account or beta license is
                    approved.
                  </p>
                </div>
              </div>

              <div className="access-feature">
                <span className="access-feature-icon">03</span>

                <div>
                  <strong>Workflow feedback</strong>
                  <p>
                    Selected testers help shape improvements through practical
                    coordination use.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="access-panel-footer">
            <span>Limited availability</span>
            <span>Private beta</span>
          </div>
        </section>

        <section className="access-form-panel access-form-panel-demo">
          <div className="access-form-header">
            <div className="access-mobile-logo">
              <img src="/vayvyx-logo.png" alt="Vayvyx logo" />
            </div>

            <p className="access-eyebrow">Private beta</p>

            <h2>Request a demo</h2>

            <p>
              Provide a few details about yourself and your interest in Vayvyx.
            </p>
          </div>

          <form
            className="access-form access-form-demo"
            onSubmit={handleSubmit}
          >
            <label className="access-field">
              <span>Name</span>

              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Your full name"
                autoComplete="name"
                disabled={isSubmitting}
              />
            </label>

            <label className="access-field">
              <span>Work email</span>

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
              <span>
                Company or organization
                <small className="access-optional-label">Optional</small>
              </span>

              <input
                type="text"
                value={company}
                onChange={(event) => setCompany(event.target.value)}
                placeholder="Company name"
                autoComplete="organization"
                disabled={isSubmitting}
              />
            </label>

            <label className="access-field">
              <span>
                How would you use Vayvyx?
                <small className="access-optional-label">Optional</small>
              </span>

              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Briefly describe your role, workflow, or interest in the beta."
                disabled={isSubmitting}
              />

              <small>
                Do not include confidential project names, documents, or
                sensitive company information.
              </small>
            </label>

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
              {isSubmitting ? "Submitting..." : "Submit request"}
            </button>
          </form>

          <div className="access-form-divider">
            <span>Already approved?</span>
          </div>

          <button
            className="access-secondary-button"
            type="button"
            onClick={() => onNavigate("/login")}
          >
            Log in to Vayvyx
          </button>

          <p className="access-security-note">
            Submitting a request does not guarantee access or activate a
            product license.
          </p>
        </section>
      </div>

      <footer className="access-page-footer">
        <span>© 2026 Vayvyx</span>
        <span>Controlled beta access</span>
      </footer>
    </main>
  );
}