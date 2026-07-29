/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MailMessageViewer } from "./mailMessageViewer.tsx";
import { MailComposeModal } from "./mailComposeModal.tsx";
import type { MailAccountSummary, MailMessageDetail } from "../../types/mail.ts";

const account: MailAccountSummary = {
  id: "mailbox-1",
  emailAddress: "support@vayvyx.com",
  displayName: "Support",
  description: null,
  fromName: null,
  replyToAddress: null,
  maxAttachmentMb: 25,
  currentUserRole: "viewer",
  isActive: true,
};

const message: MailMessageDetail = {
  mailAccountId: "mailbox-1",
  folder: "INBOX",
  uid: 7,
  messageId: "<message@vayvyx.test>",
  subject: "Project update",
  senderName: "Client",
  senderAddress: "client@example.com",
  recipients: [],
  receivedAt: "2026-07-28T12:00:00.000Z",
  sentAt: null,
  unread: true,
  flagged: false,
  hasAttachments: true,
  attachmentCount: 1,
  preview: "Hello",
  inReplyTo: null,
  references: [],
  htmlBody: '<p>Hello <a href="https://example.com" target="_blank" rel="noopener noreferrer">link</a></p>',
  textBody: "Hello",
  from: [{ name: "Client", address: "client@example.com" }],
  replyTo: [{ name: "Client", address: "reply@example.com" }],
  to: [{ name: null, address: "support@vayvyx.com" }],
  cc: [{ name: null, address: "alex@example.com" }],
  hasRemoteImages: true,
  attachments: [
    {
      id: "1",
      filename: "plan.pdf",
      contentType: "application/pdf",
      size: 1024,
      disposition: "attachment",
    },
  ],
};

describe("mail frontend components", () => {
  it("renders backend-sanitized HTML boundary and remote-image notice", () => {
    render(
      <MailMessageViewer
        account={account}
        message={message}
        loading={false}
        downloadingId={null}
        onDownload={vi.fn()}
        onReply={vi.fn()}
        onToggleRead={vi.fn()}
        onToggleFlag={vi.fn()}
        onArchive={vi.fn()}
        onTrash={vi.fn()}
        onMove={vi.fn()}
      />
    );

    expect(screen.getByText("Remote images are blocked.")).toBeTruthy();
    expect(screen.getByText("Project update")).toBeTruthy();
    expect(screen.queryByText("Archive")).toBeNull();
  });

  it("shows sender controls for sender role", () => {
    render(
      <MailMessageViewer
        account={{ ...account, currentUserRole: "sender" }}
        message={message}
        loading={false}
        downloadingId={null}
        onDownload={vi.fn()}
        onReply={vi.fn()}
        onToggleRead={vi.fn()}
        onToggleFlag={vi.fn()}
        onArchive={vi.fn()}
        onTrash={vi.fn()}
        onMove={vi.fn()}
      />
    );

    expect(screen.getByText("Mark read")).toBeTruthy();
    expect(screen.queryByLabelText("Archive")).toBeNull();
  });

  it("prefills reply-all recipients without the current mailbox", () => {
    render(
      <MailComposeModal
        account={{ ...account, currentUserRole: "sender" }}
        mode="replyAll"
        originalMessage={message}
        onClose={vi.fn()}
        onSend={vi.fn()}
      />
    );

    expect(screen.getByLabelText("To")).toHaveProperty("value", "reply@example.com");
    expect(screen.getByLabelText("Cc")).toHaveProperty("value", "alex@example.com");
  });
});
