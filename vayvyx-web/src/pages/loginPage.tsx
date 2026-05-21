import { useState } from "react";
import type { NavigateWithTransition } from "../app.tsx";
import { supabase } from "../lib/supabaseClient.ts";

type LoginPageProps = {
  onNavigate: NavigateWithTransition;
};

export function LoginPage({ onNavigate }: LoginPageProps) {
  const [mode, setMode] = useState<"login" | "create">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    if (!supabase) {
      setMessage(
        "Supabase is not connected yet. Add your Supabase URL and anon key to .env.local."
      );
      return;
    }

    if (!email.trim() || !password.trim()) {
      setMessage("Enter your email and password.");
      return;
    }

    setIsSubmitting(true);

    const response =
      mode === "login"
        ? await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
          })
        : await supabase.auth.signUp({
            email: email.trim(),
            password,
          });

    setIsSubmitting(false);

    if (response.error) {
      setMessage(response.error.message);
      return;
    }

    if (response.data.session) {
      setMessage(
        mode === "login"
          ? "Logged in successfully."
          : "Account created successfully."
      );

      window.setTimeout(() => {
        onNavigate("/account");
      }, 500);

      return;
    }

    setMessage("Account created. Check your email to confirm your account.");
  }

  return (
    <main className="simple-page auth-screen">
      <button className="back-button" onClick={() => onNavigate("/")}>
        ← Back
      </button>

      <section className="glass-card compact-card">
        <div className="card-logo">
          <img src="/vayvyx-logo.png" alt="Vayvyx logo" />
        </div>

        <p className="eyebrow">Vayvyx account</p>

        <h1>{mode === "login" ? "Log in" : "Create account"}</h1>

        <div className="auth-mode-toggle">
          <button
            type="button"
            className={mode === "login" ? "active" : ""}
            onClick={() => {
              setMode("login");
              setMessage("");
            }}
          >
            Log in
          </button>

          <button
            type="button"
            className={mode === "create" ? "active" : ""}
            onClick={() => {
              setMode("create");
              setMessage("");
            }}
          >
            Create
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />

          <button type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? "Working..."
              : mode === "login"
                ? "Log in"
                : "Create account"}
          </button>
        </form>

        {message && <p className="form-message">{message}</p>}
      </section>
    </main>
  );
}