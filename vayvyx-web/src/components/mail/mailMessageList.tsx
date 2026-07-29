import { Paperclip, Star } from "lucide-react";
import type { MailMessageSummary, UnifiedMessageSummary } from "../../types/mail.ts";
import { formatMailDate } from "./mailUtils.ts";

type Props = {
  messages: Array<MailMessageSummary | UnifiedMessageSummary>;
  selectedUid: number | null;
  selectedMailAccountId: string | null;
  loading: boolean;
  error?: string;
  emptyText: string;
  onSelect: (message: MailMessageSummary | UnifiedMessageSummary) => void;
};

export function MailMessageList({
  messages,
  selectedUid,
  selectedMailAccountId,
  loading,
  error,
  emptyText,
  onSelect,
}: Props) {
  if (loading) {
    return (
      <div className="mail-message-list" role="listbox" aria-label="Messages" aria-busy="true">
        {[0, 1, 2, 3, 4, 5].map((item) => (
          <div className="mail-message-skeleton" key={item}>
            <span />
            <span />
            <span />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="mail-state mail-error-state" role="alert">
        <strong>Messages unavailable</strong>
        <span>{error}</span>
      </div>
    );
  }

  if (messages.length === 0) {
    return <div className="mail-state">{emptyText}</div>;
  }

  return (
    <div className="mail-message-list" role="listbox" aria-label="Messages">
      {messages.map((message, index) => {
        const unified = "sourceEmailAddress" in message ? message : null;
        const selected =
          selectedUid === message.uid && selectedMailAccountId === message.mailAccountId;
        return (
          <button
            key={`${message.mailAccountId}:${message.folder}:${message.uid}`}
            className={`mail-message-row ${message.unread ? "unread" : ""} ${selected ? "active" : ""}`}
            type="button"
            role="option"
            aria-selected={selected}
            aria-label={messageRowLabel(message)}
            onClick={() => onSelect(message)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
              event.preventDefault();
              const nextIndex = event.key === "ArrowDown"
                ? Math.min(messages.length - 1, index + 1)
                : Math.max(0, index - 1);
              const nextMessage = messages[nextIndex];
              onSelect(nextMessage);
              const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                ".mail-message-row"
              );
              buttons?.[nextIndex]?.focus();
            }}
          >
            <span className="mail-message-row-top">
              <strong>{message.senderName ?? message.senderAddress ?? "Unknown sender"}</strong>
              <time dateTime={message.receivedAt ?? message.sentAt ?? undefined}>
                {formatMailDate(message.receivedAt ?? message.sentAt)}
              </time>
            </span>
            <span className="mail-message-subject">{message.subject || "(No subject)"}</span>
            <span className="mail-message-preview">{message.preview || "No preview available"}</span>
            <span className="mail-message-meta">
              {unified && (
                <small title={unified.sourceEmailAddress}>{unified.sourceMailboxDisplayName}</small>
              )}
              <span className="mail-message-indicators" aria-hidden="true">
                {message.flagged && <Star size={14} fill="currentColor" />}
                {message.hasAttachments && <Paperclip size={14} />}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function messageRowLabel(message: MailMessageSummary | UnifiedMessageSummary) {
  const sender = message.senderName ?? message.senderAddress ?? "Unknown sender";
  const subject = message.subject || "No subject";
  const state = [
    message.unread ? "unread" : "read",
    message.flagged ? "flagged" : null,
    message.hasAttachments ? "has attachments" : null,
  ].filter(Boolean).join(", ");

  return `${sender}, ${subject}, ${state}`;
}
