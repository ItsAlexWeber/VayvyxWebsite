/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MailComposeModal } from "./mailComposeModal.tsx";
import { MailAccountSwitcher } from "./mailAccountSwitcher.tsx";
import { MailFolderSidebar } from "./mailFolderSidebar.tsx";
import { MailMessageList } from "./mailMessageList.tsx";
import { MailMessageViewer } from "./mailMessageViewer.tsx";
import { buildEmailSrcDoc, prepareEmailHtml } from "./safeEmailHtml.ts";
import type {
  MailAccountSummary,
  MailFolder,
  MailMessageDetail,
  MailMessageSummary,
} from "../../types/mail.ts";

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
  htmlBody:
    '<p>Hello <a href="https://example.com" target="_blank" rel="noopener noreferrer">link</a></p><span data-vayvyx-remote-image="true" data-vayvyx-remote-src="https://tracker.example/pixel.png" data-vayvyx-alt="Brand logo">Brand logo</span><span data-vayvyx-remote-image="true" data-vayvyx-remote-src="https://tracker.example/decorative.png"></span>[remote image blocked]',
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

const secondMessage: MailMessageDetail = {
  ...message,
  uid: 8,
  subject: "Second project update",
  htmlBody:
    '<p>Second</p><span data-vayvyx-remote-image="true" data-vayvyx-remote-src="https://tracker.example/second.png" data-vayvyx-alt="Second logo">Second logo</span>',
};

const summary: MailMessageSummary = {
  mailAccountId: "mailbox-1",
  folder: "INBOX",
  uid: 25,
  messageId: "<summary@vayvyx.test>",
  subject: "Summary",
  senderName: "Client",
  senderAddress: "client@example.com",
  recipients: [],
  receivedAt: "2026-07-28T12:00:00.000Z",
  sentAt: null,
  unread: true,
  flagged: true,
  hasAttachments: true,
  attachmentCount: 1,
  preview: "A compact preview",
  inReplyTo: null,
  references: [],
};

afterEach(() => {
  cleanup();
});

describe("mail frontend components", () => {
  it("renders an isolated backend-sanitized HTML boundary and one remote-image notice", () => {
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
        onClose={vi.fn()}
      />
    );

    expect(screen.getAllByText("Remote images are blocked for your privacy.")).toHaveLength(1);
    expect(screen.getByText("Project update")).toBeTruthy();
    expect(screen.queryByLabelText("Archive")).toBeNull();
    const frame = screen.getByTitle("Email message body");
    const srcDoc = frame.getAttribute("srcdoc") ?? "";
    expect(srcDoc).toContain("Brand logo");
    expect(srcDoc).not.toContain("[remote image blocked]");
    expect(srcDoc).not.toContain('src="https://tracker.example/pixel.png"');
    expect(frame.getAttribute("sandbox")).toBe("allow-popups allow-popups-to-escape-sandbox");
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
        onClose={vi.fn()}
      />
    );

    expect(screen.getByLabelText("Mark read")).toBeTruthy();
    expect(screen.queryByLabelText("Archive")).toBeNull();
  });

  it("loads remote images only for the currently selected message", () => {
    const props = {
      account: { ...account, currentUserRole: "sender" as const },
      loading: false,
      downloadingId: null,
      onDownload: vi.fn(),
      onReply: vi.fn(),
      onToggleRead: vi.fn(),
      onToggleFlag: vi.fn(),
      onArchive: vi.fn(),
      onTrash: vi.fn(),
      onMove: vi.fn(),
      onClose: vi.fn(),
    };
    const { rerender } = render(<MailMessageViewer {...props} message={message} />);

    fireEvent.click(screen.getByText("Load images"));
    expect(screen.getByTitle("Email message body").getAttribute("srcdoc")).toContain(
      'src="https://tracker.example/pixel.png"'
    );

    rerender(<MailMessageViewer {...props} message={secondMessage} />);
    expect(screen.getAllByText("Remote images are blocked for your privacy.")).toHaveLength(1);
    expect(screen.getByTitle("Email message body").getAttribute("srcdoc")).not.toContain(
      'src="https://tracker.example/second.png"'
    );
  });

  it("keeps sanitization active after remote images are loaded", () => {
    const prepared = prepareEmailHtml(
      '<script>alert(1)</script><form><input value="x"></form><object data="x"></object><a href="javascript:alert(1)">bad</a><span data-vayvyx-remote-image="true" data-vayvyx-remote-src="javascript:alert(1)" data-vayvyx-alt="bad">bad</span><span data-vayvyx-remote-image="true" data-vayvyx-remote-src="https://safe.example/image.png" data-vayvyx-alt="Safe image">Safe image</span>',
      true
    );

    expect(prepared).not.toContain("<script");
    expect(prepared).not.toContain("<form");
    expect(prepared).not.toContain("<object");
    expect(prepared).not.toContain("javascript:");
    expect(prepared).toContain('href="#"');
    expect(prepared).toContain('src="https://safe.example/image.png"');
  });

  it("contains message body CSS for long links, images, tables, and preformatted text", () => {
    const srcDoc = buildEmailSrcDoc(
      '<p><a href="https://example.com/very/long/link">link</a></p><table><tbody><tr><td>wide</td></tr></tbody></table><pre>plain</pre>',
      false
    );

    expect(srcDoc).toContain("overflow-wrap:anywhere");
    expect(srcDoc).toContain("img { max-width:100% !important; height:auto !important; }");
    expect(srcDoc).toContain("table { max-width:100% !important;");
    expect(srcDoc).toContain("pre { white-space:pre-wrap; overflow-wrap:anywhere; }");
  });

  it("renders compact message list states without hiding failures as empty folders", () => {
    const onSelect = vi.fn();
    const { container, rerender } = render(
      <MailMessageList
        messages={[]}
        selectedUid={null}
        selectedMailAccountId={null}
        loading
        emptyText="No messages to show."
        onSelect={onSelect}
      />
    );

    expect(container.querySelectorAll(".mail-message-skeleton")).toHaveLength(6);

    rerender(
      <MailMessageList
        messages={[]}
        selectedUid={null}
        selectedMailAccountId={null}
        loading={false}
        error="Mailbox unavailable."
        emptyText="No messages to show."
        onSelect={onSelect}
      />
    );
    expect(screen.getByText("Messages unavailable")).toBeTruthy();
    expect(screen.queryByText("No messages to show.")).toBeNull();

    rerender(
      <MailMessageList
        messages={[]}
        selectedUid={null}
        selectedMailAccountId={null}
        loading={false}
        emptyText="No messages match this search."
        onSelect={onSelect}
      />
    );
    expect(screen.getByText("No messages match this search.")).toBeTruthy();
  });

  it("supports keyboard selection in compact message rows", () => {
    const onSelect = vi.fn();
    render(
      <MailMessageList
        messages={[summary, { ...summary, uid: 26, subject: "Next summary" }]}
        selectedUid={25}
        selectedMailAccountId="mailbox-1"
        loading={false}
        emptyText="No messages to show."
        onSelect={onSelect}
      />
    );

    fireEvent.keyDown(screen.getByLabelText(/Client, Summary/), { key: "ArrowDown" });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ uid: 26 }));
  });

  it("keeps mailbox navigation compact and settings admin-only", () => {
    const { rerender } = render(
      <MailAccountSwitcher
        accounts={[{ ...account, currentUserRole: "admin" }]}
        selectedId="mailbox-1"
        isUnified={false}
        canCompose
        onCompose={vi.fn()}
        onSelectUnified={vi.fn()}
        onSelectAccount={vi.fn()}
      />
    );

    expect(screen.queryByText("admin")).toBeNull();
    expect(screen.queryByText("Mail settings")).toBeNull();

    rerender(
      <MailAccountSwitcher
        accounts={[{ ...account, currentUserRole: "admin" }]}
        selectedId="mailbox-1"
        isUnified={false}
        canCompose
        onCompose={vi.fn()}
        onSelectUnified={vi.fn()}
        onSelectAccount={vi.fn()}
        onSettings={vi.fn()}
      />
    );
    expect(screen.getByText("Mail settings")).toBeTruthy();
  });

  it("keeps folder paths internal while exposing friendly labels and counts", () => {
    const folder: MailFolder = {
      path: "INBOX/2026",
      displayName: "2026",
      delimiter: "/",
      specialUse: "custom",
      originalSpecialUse: null,
      totalCount: 9,
      unreadCount: 2,
      selectable: true,
      subscribed: true,
    };
    render(
      <MailFolderSidebar
        folders={[folder]}
        selectedFolder="INBOX/2026"
        onSelect={vi.fn()}
      />
    );

    expect(screen.getByLabelText("2026, 2 unread")).toBeTruthy();
    expect(screen.queryByText("INBOX/2026")).toBeNull();
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
