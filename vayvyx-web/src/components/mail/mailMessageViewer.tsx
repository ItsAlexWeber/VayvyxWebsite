import { Archive, FolderInput, Forward, Reply, ReplyAll, Star, Trash2 } from "lucide-react";
import type { MailAccountSummary, MailMessageDetail } from "../../types/mail.ts";
import { addressLabel, canUseRole, formatMailDate } from "./mailUtils.ts";
import { MailAttachmentList } from "./mailAttachmentList.tsx";

type Props = {
  account: MailAccountSummary | null;
  message: MailMessageDetail | null;
  loading: boolean;
  downloadingId: string | null;
  onDownload: (attachmentId: string) => void;
  onReply: (mode: "reply" | "replyAll" | "forward") => void;
  onToggleRead: () => void;
  onToggleFlag: () => void;
  onArchive: () => void;
  onTrash: () => void;
  onMove: () => void;
};

export function MailMessageViewer({
  account,
  message,
  loading,
  downloadingId,
  onDownload,
  onReply,
  onToggleRead,
  onToggleFlag,
  onArchive,
  onTrash,
  onMove,
}: Props) {
  if (loading) return <section className="mail-viewer mail-state">Loading message...</section>;
  if (!message) return <section className="mail-viewer mail-state">Select a message.</section>;

  return (
    <section className="mail-viewer" aria-label="Selected message">
      <header className="mail-viewer-header">
        <div>
          <p className="mail-section-label">{formatMailDate(message.receivedAt ?? message.sentAt)}</p>
          <h2>{message.subject || "(No subject)"}</h2>
        </div>
        <div className="mail-icon-row">
          {canUseRole(account, "sender") && (
            <>
              <button type="button" onClick={() => onReply("reply")} aria-label="Reply">
                <Reply size={17} />
              </button>
              <button type="button" onClick={() => onReply("replyAll")} aria-label="Reply all">
                <ReplyAll size={17} />
              </button>
              <button type="button" onClick={() => onReply("forward")} aria-label="Forward">
                <Forward size={17} />
              </button>
              <button type="button" onClick={onToggleRead}>
                {message.unread ? "Mark read" : "Mark unread"}
              </button>
              <button type="button" onClick={onToggleFlag} aria-label="Flag message">
                <Star size={17} fill={message.flagged ? "currentColor" : "none"} />
              </button>
            </>
          )}
          {canUseRole(account, "manager") && (
            <>
              <button type="button" onClick={onArchive} aria-label="Archive">
                <Archive size={17} />
              </button>
              <button type="button" onClick={onTrash} aria-label="Trash">
                <Trash2 size={17} />
              </button>
              <button type="button" onClick={onMove} aria-label="Move">
                <FolderInput size={17} />
              </button>
            </>
          )}
        </div>
      </header>

      <div className="mail-address-block">
        <span>From {message.from.map((item) => addressLabel(item.name, item.address)).join(", ")}</span>
        {message.replyTo.length > 0 && (
          <span>Reply to {message.replyTo.map((item) => addressLabel(item.name, item.address)).join(", ")}</span>
        )}
        <span>To {message.to.map((item) => addressLabel(item.name, item.address)).join(", ")}</span>
        {message.cc.length > 0 && <span>Cc {message.cc.map((item) => addressLabel(item.name, item.address)).join(", ")}</span>}
      </div>

      {message.hasRemoteImages && (
        <p className="mail-warning">Remote images are blocked.</p>
      )}

      <SafeEmailHtml html={message.htmlBody} text={message.textBody} />

      <MailAttachmentList
        attachments={message.attachments}
        downloadingId={downloadingId}
        onDownload={(attachment) => onDownload(attachment.id)}
      />
    </section>
  );
}

function SafeEmailHtml({ html, text }: { html: string | null; text: string }) {
  if (!html) return <pre className="mail-plain-body">{text || "No message body."}</pre>;

  return (
    <div
      className="mail-html-body"
      // Only backend-sanitized email HTML from MailMessageDetail may enter this boundary.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
