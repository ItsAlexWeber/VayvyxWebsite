/* eslint-disable react-hooks/set-state-in-effect */
import { ArrowLeft, Plus, RefreshCcw, Shield } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { NavigateWithTransition } from "../app.tsx";
import { MailAccountSettingsModal } from "../components/mail/mailAccountSettingsModal.tsx";
import { MailConnectionTestPanel } from "../components/mail/mailConnectionTestPanel.tsx";
import { MailMemberAccessPanel } from "../components/mail/mailMemberAccessPanel.tsx";
import { mailApi, MailApiRequestError, setMailApiAuthRequiredHandler } from "../lib/mailApi.ts";
import type {
  MailAccountAdminSummary,
  MailAdminUserSearchResult,
  MailboxAccessRole,
} from "../types/mail.ts";
import "../styles/mailAdminSettingsPage.css";

type Props = {
  onNavigate: NavigateWithTransition;
};

const blankForm = {
  emailAddress: "",
  displayName: "",
  description: "",
  username: "",
  password: "",
  imapHost: "sunfire.mxrouting.net",
  imapPort: 993,
  imapSecure: true,
  smtpHost: "sunfire.mxrouting.net",
  smtpPort: 465,
  smtpSecure: true,
  fromName: "",
  replyToAddress: "",
  maxAttachmentMb: 25,
  initialMembers: [],
};

export function MailAdminSettingsPage({ onNavigate }: Props) {
  const [accounts, setAccounts] = useState<MailAccountAdminSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(blankForm);
  const [editing, setEditing] = useState<MailAccountAdminSummary | null>(null);
  const [rotatePassword, setRotatePassword] = useState("");
  const [testResult, setTestResult] = useState("");
  const [busy, setBusy] = useState(false);

  const selected = accounts.find((account) => account.id === selectedId) ?? accounts[0] ?? null;

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await mailApi.getAdminAccounts();
      setAccounts(data);
      setSelectedId((current) => current ?? data[0]?.id ?? null);
    } catch (caught) {
      if (caught instanceof MailApiRequestError && caught.code === "AUTH_REQUIRED") {
        onNavigate("/login");
      } else if (caught instanceof MailApiRequestError && caught.code === "ACCESS_DENIED") {
        setError("You do not have permission to manage company mail.");
      } else {
        setError(caught instanceof Error ? caught.message : "Unable to load mail settings.");
      }
    } finally {
      setLoading(false);
    }
  }, [onNavigate]);

  useEffect(() => {
    setMailApiAuthRequiredHandler(() => onNavigate("/login"));
    loadAccounts();
    return () => setMailApiAuthRequiredHandler(null);
  }, [loadAccounts, onNavigate]);

  async function createMailbox(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const created = await mailApi.createAdminAccount({
        ...form,
        description: form.description || null,
        fromName: form.fromName || null,
        replyToAddress: form.replyToAddress || null,
      });
      setAccounts((items) => [...items, created]);
      setSelectedId(created.id);
      setForm(blankForm);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to add mailbox.");
    } finally {
      setBusy(false);
      setForm((current) => ({ ...current, password: "" }));
    }
  }

  async function rotateCredentials() {
    if (!selected || !rotatePassword) return;
    if (!window.confirm("Rotate credentials for this mailbox?")) return;
    setBusy(true);
    try {
      await mailApi.rotateCredentials(selected.id, rotatePassword);
      setTestResult("Credentials rotated.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to rotate credentials.");
    } finally {
      setRotatePassword("");
      setBusy(false);
    }
  }

  async function updateSelected(input: Record<string, unknown>) {
    if (!editing) return;
    const updated = await mailApi.updateAdminAccount(editing.id, input);
    setAccounts((items) => items.map((item) => (item.id === updated.id ? updated : item)));
  }

  async function runTest(kind: "imap" | "smtp") {
    if (!selected) return;
    setBusy(true);
    setTestResult("");
    try {
      if (kind === "imap") await mailApi.testImap(selected.id);
      else await mailApi.testSmtp(selected.id);
      setTestResult(`${kind.toUpperCase()} authentication succeeded.`);
    } catch (caught) {
      setTestResult(caught instanceof Error ? caught.message : "Connection test failed.");
    } finally {
      setBusy(false);
    }
  }

  async function searchUsers(query: string): Promise<MailAdminUserSearchResult[]> {
    return mailApi.searchUsers(query);
  }

  async function addMember(userId: string, role: MailboxAccessRole) {
    if (!selected) return;
    await mailApi.addMember(selected.id, userId, role);
    await loadAccounts();
  }

  async function updateMember(userId: string, role: MailboxAccessRole) {
    if (!selected) return;
    await mailApi.updateMember(selected.id, userId, role);
    await loadAccounts();
  }

  async function removeMember(userId: string) {
    if (!selected) return;
    await mailApi.removeMember(selected.id, userId);
    await loadAccounts();
  }

  if (loading) {
    return <main className="mail-admin-page"><div className="mail-state">Loading mail settings...</div></main>;
  }

  return (
    <main className="mail-admin-page">
      <header className="mail-admin-header">
        <button type="button" onClick={() => onNavigate("/account")}>
          <ArrowLeft size={17} /> Account
        </button>
        <div>
          <p className="mail-section-label">Company mail</p>
          <h1>Mail settings</h1>
        </div>
        <button type="button" onClick={loadAccounts}>
          <RefreshCcw size={17} /> Refresh
        </button>
      </header>

      {error && <p className="mail-warning" aria-live="polite">{error}</p>}

      <section className="mail-admin-grid">
        <aside className="mail-admin-list">
          {accounts.length === 0 && (
            <div className="mail-admin-empty">
              <strong>No mailboxes configured</strong>
              <small>Add the first company mailbox to begin.</small>
            </div>
          )}
          {accounts.map((account) => (
            <button
              key={account.id}
              type="button"
              className={selected?.id === account.id ? "active" : ""}
              onClick={() => setSelectedId(account.id)}
            >
              <Shield size={16} />
              <span>
                <strong>{account.displayName}</strong>
                <small>{account.emailAddress}</small>
              </span>
              <em>{account.isActive ? "active" : "inactive"}</em>
            </button>
          ))}
        </aside>

        <section className="mail-admin-main">
          <form className="mail-admin-panel" onSubmit={createMailbox}>
            <h2><Plus size={18} /> Add mailbox</h2>
            <div className="mail-admin-form-grid">
              <input placeholder="Email address" value={form.emailAddress} onChange={(event) => setForm({ ...form, emailAddress: event.target.value })} />
              <input placeholder="Display name" value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} />
              <input placeholder="Username" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} />
              <input type="password" placeholder="Mailbox password or app password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
              <input placeholder="IMAP host" value={form.imapHost} onChange={(event) => setForm({ ...form, imapHost: event.target.value })} />
              <input type="number" placeholder="IMAP port" value={form.imapPort} onChange={(event) => setForm({ ...form, imapPort: Number(event.target.value) })} />
              <input placeholder="SMTP host" value={form.smtpHost} onChange={(event) => setForm({ ...form, smtpHost: event.target.value })} />
              <input type="number" placeholder="SMTP port" value={form.smtpPort} onChange={(event) => setForm({ ...form, smtpPort: Number(event.target.value) })} />
              <input placeholder="Sender display name" value={form.fromName} onChange={(event) => setForm({ ...form, fromName: event.target.value })} />
              <input placeholder="Reply-to address" value={form.replyToAddress} onChange={(event) => setForm({ ...form, replyToAddress: event.target.value })} />
            </div>
            <div className="mail-admin-actions">
              <label className="mail-check"><input type="checkbox" checked={form.imapSecure} onChange={(event) => setForm({ ...form, imapSecure: event.target.checked })} /> IMAP secure</label>
              <label className="mail-check"><input type="checkbox" checked={form.smtpSecure} onChange={(event) => setForm({ ...form, smtpSecure: event.target.checked })} /> SMTP secure</label>
              <button className="mail-primary-action" type="submit" disabled={busy || !form.password}>Add mailbox</button>
            </div>
          </form>

          {selected && (
            <>
              <section className="mail-admin-panel">
                <h2>{selected.displayName}</h2>
                <p>{selected.emailAddress}</p>
                <div className="mail-admin-actions">
                  <button type="button" onClick={() => setEditing(selected)}>Edit settings</button>
                  <input type="password" placeholder="New password" value={rotatePassword} onChange={(event) => setRotatePassword(event.target.value)} />
                  <button type="button" onClick={rotateCredentials} disabled={busy || !rotatePassword}>Rotate credentials</button>
                </div>
              </section>
              <MailConnectionTestPanel
                busy={busy}
                result={testResult}
                onTestImap={() => runTest("imap")}
                onTestSmtp={() => runTest("smtp")}
              />
              <MailMemberAccessPanel
                account={selected}
                onSearchUsers={searchUsers}
                onAdd={addMember}
                onUpdate={updateMember}
                onRemove={removeMember}
              />
            </>
          )}
        </section>
      </section>

      {editing && (
        <MailAccountSettingsModal
          account={editing}
          onClose={() => setEditing(null)}
          onSave={updateSelected}
        />
      )}
    </main>
  );
}
