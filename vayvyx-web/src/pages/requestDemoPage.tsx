import { useState } from "react";
import type { NavigateWithTransition } from "../app.tsx";
import { supabase } from "../lib/supabaseClient.ts";

type RequestDemoPageProps = {
  onNavigate: NavigateWithTransition;
};

export function RequestDemoPage({ onNavigate }: RequestDemoPageProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [message, setMessage] = useState("");

  const [formStatus, setFormStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormStatus("");

    if (!name.trim() || !email.trim()) {
      setFormStatus("Name and email are required.");
      return;
    }

    if (!supabase) {
      setFormStatus(
        "Supabase is not connected yet. Add your Supabase URL and anon key to .env.local."
      );
      return;
    }

    setIsSubmitting(true);

    const { error } = await supabase.from("demo_requests").insert({
      name: name.trim(),
      email: email.trim(),
      company: company.trim(),
      message: message.trim(),
    });

    setIsSubmitting(false);

    if (error) {
      setFormStatus(error.message);
      return;
    }

    setName("");
    setEmail("");
    setCompany("");
    setMessage("");
    setFormStatus("Demo request submitted.");
  }

  return (
    <main className="simple-page auth-screen">
      <button className="back-button" onClick={() => onNavigate("/")}>
        ← Back
      </button>

      <section className="glass-card compact-card demo-card">
        <div className="card-logo">
          <img src="/vayvyx-logo.png" alt="Vayvyx logo" />
        </div>

        <p className="eyebrow">Request demo</p>

        <h1>Request access</h1>

        <form onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />

          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />

          <input
            type="text"
            placeholder="Company"
            value={company}
            onChange={(event) => setCompany(event.target.value)}
          />

          <textarea
            placeholder="Message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />

          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Submitting..." : "Submit request"}
          </button>
        </form>

        {formStatus && <p className="form-message">{formStatus}</p>}
      </section>
    </main>
  );
}