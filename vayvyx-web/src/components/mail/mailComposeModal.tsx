import { Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { MailAccountSummary, MailMessageDetail, SendMessageRequest, SendMessageResult } from "../../types/mail.ts";

type Props = {
  account: MailAccountSummary;
  mode: SendMessageRequest["mode"];
  originalMessage: MailMessageDetail | null;
  onClose: () => void;
  onSend: (input: SendMessageRequest, attachments: File[]) => Promise<SendMessageResult>;
};

export function MailComposeModal({
  account,
  mode,
  originalMessage,
  onClose,
  onSend,
}: Props) {
  const [to, setTo] = useState(prefillTo(mode, originalMessage, account.emailAddress));
  const [cc, setCc] = useState(prefillCc(mode, originalMessage, account.emailAddress));
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState(prefillSubject(mode, originalMessage));
  const [body, setBody] = useState(prefillBody(mode, originalMessage));
  const [attachments, setAttachments] = useState<File[]>([]);
  const [status, setStatus] = useState("");
  const [sending, setSending] = useState(false);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !sending) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, sending]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("");
    setSending(true);

    try {
      const result = await onSend(
        {
          mode,
          to: splitAddresses(to),
          cc: splitAddresses(cc),
          bcc: splitAddresses(bcc),
          subject,
          textBody: body,
          originalFolder: originalMessage?.folder,
          originalUid: originalMessage?.uid,
          inReplyTo: mode === "compose" ? undefined : originalMessage?.messageId ?? undefined,
          references: mode === "compose" ? [] : originalMessage?.references ?? [],
        },
        attachments
      );
      setStatus(result.sentFolderWarning ?? "Message sent.");
      window.setTimeout(onClose, 500);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Send failed. Your draft is still here.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mail-modal-backdrop" role="presentation">
      <section className="mail-compose" role="dialog" aria-modal="true" aria-labelledby="compose-title">
        <header>
          <div>
            <p className="mail-section-label">Sending from {account.emailAddress}</p>
            <h2 id="compose-title">{modeLabel(mode)}</h2>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close compose">
            <X size={18} />
          </button>
        </header>

        <form onSubmit={submit}>
          <input aria-label="To" placeholder="To" value={to} onChange={(event) => setTo(event.target.value)} />
          <input aria-label="Cc" placeholder="Cc" value={cc} onChange={(event) => setCc(event.target.value)} />
          <input aria-label="Bcc" placeholder="Bcc" value={bcc} onChange={(event) => setBcc(event.target.value)} />
          <input aria-label="Subject" placeholder="Subject" value={subject} onChange={(event) => setSubject(event.target.value)} />
          <textarea aria-label="Message body" value={body} onChange={(event) => setBody(event.target.value)} />
          <input
            aria-label="Attachments"
            type="file"
            multiple
            onChange={(event) => setAttachments(Array.from(event.target.files ?? []))}
          />
          <div className="mail-compose-actions">
            <button className="mail-primary-action" type="submit" disabled={sending}>
              <Send size={17} />
              {sending ? "Sending..." : "Send"}
            </button>
            <button type="button" onClick={onClose} disabled={sending}>
              Cancel
            </button>
          </div>
        </form>

        {status && <p className="mail-status" aria-live="polite">{status}</p>}
      </section>
    </div>
  );
}

function splitAddresses(value: string) {
  return value
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function prefillTo(mode: SendMessageRequest["mode"], message: MailMessageDetail | null, self: string) {
  if (!message || mode === "compose" || mode === "forward") return "";
  const source = message.replyTo.length > 0 ? message.replyTo : message.from;
  return source.filter((item) => item.address.toLowerCase() !== self.toLowerCase()).map((item) => item.address).join(", ");
}

function prefillCc(mode: SendMessageRequest["mode"], message: MailMessageDetail | null, self: string) {
  if (!message || mode !== "replyAll") return "";
  const excluded = new Set([self.toLowerCase()]);
  return [...message.to, ...message.cc]
    .filter((item) => !excluded.has(item.address.toLowerCase()))
    .map((item) => item.address)
    .join(", ");
}

function prefillSubject(mode: SendMessageRequest["mode"], message: MailMessageDetail | null) {
  if (!message) return "";
  if (mode === "forward") return `Fwd: ${message.subject}`;
  if (mode === "reply" || mode === "replyAll") return message.subject.toLowerCase().startsWith("re:") ? message.subject : `Re: ${message.subject}`;
  return "";
}

function prefillBody(mode: SendMessageRequest["mode"], message: MailMessageDetail | null) {
  if (mode !== "forward" || !message) return "";
  return `\n\nForwarded message:\nFrom: ${message.senderAddress ?? "Unknown"}\nSubject: ${message.subject}\n\n${message.textBody}`;
}

function modeLabel(mode: SendMessageRequest["mode"]) {
  if (mode === "replyAll") return "Reply all";
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}
