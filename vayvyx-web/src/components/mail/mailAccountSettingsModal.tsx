import { useEffect, useRef, useState } from "react";
import type { MailAccountAdminSummary } from "../../types/mail.ts";

type Props = {
  account: MailAccountAdminSummary | null;
  onClose: () => void;
  onSave: (input: Record<string, unknown>) => Promise<void>;
};

export function MailAccountSettingsModal({ account, onClose, onSave }: Props) {
  const [displayName, setDisplayName] = useState(account?.displayName ?? "");
  const [description, setDescription] = useState(account?.description ?? "");
  const [imapHost, setImapHost] = useState(account?.imapHost ?? "sunfire.mxrouting.net");
  const [imapPort, setImapPort] = useState(account?.imapPort ?? 993);
  const [imapSecure, setImapSecure] = useState(account?.imapSecure ?? true);
  const [smtpHost, setSmtpHost] = useState(account?.smtpHost ?? "sunfire.mxrouting.net");
  const [smtpPort, setSmtpPort] = useState(account?.smtpPort ?? 465);
  const [smtpSecure, setSmtpSecure] = useState(account?.smtpSecure ?? true);
  const [isActive, setIsActive] = useState(account?.isActive ?? true);
  const [status, setStatus] = useState("");
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (account?.isActive && !isActive && !window.confirm("Deactivate this mailbox?")) return;
    try {
      await onSave({
        displayName,
        description,
        imapHost,
        imapPort,
        imapSecure,
        smtpHost,
        smtpPort,
        smtpSecure,
        isActive,
      });
      onClose();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to save mailbox.");
    }
  }

  return (
    <div className="mail-modal-backdrop" role="presentation">
      <section className="mail-compose" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header>
          <h2 id="settings-title">Mailbox settings</h2>
          <button ref={closeRef} type="button" onClick={onClose}>Close</button>
        </header>
        <form onSubmit={submit}>
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Display name" />
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description" />
          <input value={imapHost} onChange={(event) => setImapHost(event.target.value)} placeholder="IMAP host" />
          <input type="number" value={imapPort} onChange={(event) => setImapPort(Number(event.target.value))} placeholder="IMAP port" />
          <label className="mail-check"><input type="checkbox" checked={imapSecure} onChange={(event) => setImapSecure(event.target.checked)} /> IMAP secure</label>
          <input value={smtpHost} onChange={(event) => setSmtpHost(event.target.value)} placeholder="SMTP host" />
          <input type="number" value={smtpPort} onChange={(event) => setSmtpPort(Number(event.target.value))} placeholder="SMTP port" />
          <label className="mail-check"><input type="checkbox" checked={smtpSecure} onChange={(event) => setSmtpSecure(event.target.checked)} /> SMTP secure</label>
          <label className="mail-check"><input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} /> Active</label>
          <button className="mail-primary-action" type="submit">Save</button>
        </form>
        {status && <p className="mail-status" aria-live="polite">{status}</p>}
      </section>
    </div>
  );
}
