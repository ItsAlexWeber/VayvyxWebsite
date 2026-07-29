import { Download, Paperclip } from "lucide-react";
import type { MailAttachmentMetadata } from "../../types/mail.ts";

type Props = {
  attachments: MailAttachmentMetadata[];
  downloadingId: string | null;
  onDownload: (attachment: MailAttachmentMetadata) => void;
};

export function MailAttachmentList({
  attachments,
  downloadingId,
  onDownload,
}: Props) {
  if (attachments.length === 0) return null;

  return (
    <section className="mail-attachments" aria-label="Attachments">
      {attachments.map((attachment) => (
        <button
          key={attachment.id}
          type="button"
          className="mail-attachment"
          onClick={() => onDownload(attachment)}
          disabled={downloadingId === attachment.id}
        >
          <Paperclip size={16} />
          <span>
            <strong>{attachment.filename}</strong>
            <small>{formatSize(attachment.size)}</small>
          </span>
          <Download size={16} />
        </button>
      ))}
    </section>
  );
}

function formatSize(value: number | null) {
  if (!value) return "Size unavailable";
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
