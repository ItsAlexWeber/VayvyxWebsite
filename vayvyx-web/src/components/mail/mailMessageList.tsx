import { Paperclip, Star } from "lucide-react";
import type { MailMessageSummary, UnifiedMessageSummary } from "../../types/mail.ts";
import { formatMailDate } from "./mailUtils.ts";

type Props = {
  messages: Array<MailMessageSummary | UnifiedMessageSummary>;
  selectedUid: number | null;
  selectedMailAccountId: string | null;
  loading: boolean;
  emptyText: string;
  onSelect: (message: MailMessageSummary | UnifiedMessageSummary) => void;
};

export function MailMessageList({
  messages,
  selectedUid,
  selectedMailAccountId,
  loading,
  emptyText,
  onSelect,
}: Props) {
  if (loading) {
    return <div className="mail-state">Loading messages...</div>;
  }

  if (messages.length === 0) {
    return <div className="mail-state">{emptyText}</div>;
  }

  return (
    <div className="mail-message-list" role="listbox" aria-label="Messages">
      {messages.map((message) => {
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
            onClick={() => onSelect(message)}
          >
            <span className="mail-message-row-top">
              <strong>{message.senderName ?? message.senderAddress ?? "Unknown sender"}</strong>
              <time>{formatMailDate(message.receivedAt ?? message.sentAt)}</time>
            </span>
            <span className="mail-message-subject">{message.subject || "(No subject)"}</span>
            <span className="mail-message-preview">{message.preview}</span>
            <span className="mail-message-meta">
              {unified && <small>{unified.sourceMailboxDisplayName}</small>}
              {message.flagged && <Star size={14} fill="currentColor" />}
              {message.hasAttachments && <Paperclip size={14} />}
            </span>
          </button>
        );
      })}
    </div>
  );
}
