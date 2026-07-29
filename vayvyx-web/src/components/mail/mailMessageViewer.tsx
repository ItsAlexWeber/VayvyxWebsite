import { useMemo, useState } from "react";
import {
  Archive,
  FolderInput,
  Forward,
  Mail,
  MailOpen,
  Reply,
  ReplyAll,
  Star,
  Trash2,
  X,
} from "lucide-react";
import type { MailAccountSummary, MailMessageDetail } from "../../types/mail.ts";
import { addressLabel, canUseRole, formatMailDate } from "./mailUtils.ts";
import { MailAttachmentList } from "./mailAttachmentList.tsx";
import { buildEmailSrcDoc } from "./safeEmailHtml.ts";

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
  onClose: () => void;
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
  onClose,
}: Props) {
  const messageKey = `${message?.mailAccountId ?? "none"}:${message?.folder ?? "none"}:${message?.uid ?? "none"}`;
  const [remoteImageState, setRemoteImageState] = useState({
    messageKey: "",
    loadRemoteImages: false,
  });
  const loadRemoteImages =
    remoteImageState.messageKey === messageKey && remoteImageState.loadRemoteImages;

  if (loading) return <section className="mail-viewer mail-state">Loading message...</section>;
  if (!message) return <section className="mail-viewer mail-state">Select a message.</section>;

  return (
    <section className="mail-viewer" aria-label="Selected message">
      <header className="mail-viewer-header">
        <div className="mail-viewer-title">
          <p className="mail-section-label">{formatMailDate(message.receivedAt ?? message.sentAt)}</p>
          <h2>{message.subject || "(No subject)"}</h2>
        </div>
        <div className="mail-icon-row" aria-label="Message actions">
          {canUseRole(account, "sender") && (
            <>
              <button type="button" onClick={() => onReply("reply")} aria-label="Reply" title="Reply">
                <Reply size={17} />
              </button>
              <button type="button" onClick={() => onReply("replyAll")} aria-label="Reply all" title="Reply all">
                <ReplyAll size={17} />
              </button>
              <button type="button" onClick={() => onReply("forward")} aria-label="Forward" title="Forward">
                <Forward size={17} />
              </button>
              <button
                type="button"
                onClick={onToggleRead}
                aria-label={message.unread ? "Mark read" : "Mark unread"}
                title={message.unread ? "Mark read" : "Mark unread"}
              >
                {message.unread ? <MailOpen size={17} /> : <Mail size={17} />}
              </button>
              <button type="button" onClick={onToggleFlag} aria-label="Flag message" title="Flag message">
                <Star size={17} fill={message.flagged ? "currentColor" : "none"} />
              </button>
            </>
          )}
          {canUseRole(account, "manager") && (
            <>
              <button type="button" onClick={onArchive} aria-label="Archive" title="Archive">
                <Archive size={17} />
              </button>
              <button type="button" onClick={onTrash} aria-label="Trash" title="Trash">
                <Trash2 size={17} />
              </button>
              <button type="button" onClick={onMove} aria-label="Move" title="Move">
                <FolderInput size={17} />
              </button>
            </>
          )}
          <button type="button" onClick={onClose} aria-label="Close message" title="Close message">
            <X size={17} />
          </button>
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

      {message.hasRemoteImages && !loadRemoteImages && (
        <div className="mail-remote-image-banner" role="status">
          <span>Remote images are blocked for your privacy.</span>
          <button
            type="button"
            onClick={() => setRemoteImageState({ messageKey, loadRemoteImages: true })}
          >
            Load images
          </button>
        </div>
      )}

      <SafeEmailHtml
        html={message.htmlBody}
        text={message.textBody}
        loadRemoteImages={loadRemoteImages}
      />

      <MailAttachmentList
        attachments={message.attachments}
        downloadingId={downloadingId}
        onDownload={(attachment) => onDownload(attachment.id)}
      />
    </section>
  );
}

function SafeEmailHtml({
  html,
  text,
  loadRemoteImages,
}: {
  html: string | null;
  text: string;
  loadRemoteImages: boolean;
}) {
  const srcDoc = useMemo(
    () => (html ? buildEmailSrcDoc(html, loadRemoteImages) : ""),
    [html, loadRemoteImages]
  );

  if (!html) return <pre className="mail-plain-body">{text || "No message body."}</pre>;

  return (
    <iframe
      className="mail-html-body-frame"
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      title="Email message body"
      srcDoc={srcDoc}
    />
  );
}
