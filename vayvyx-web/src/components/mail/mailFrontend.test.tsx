/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MailComposeModal } from "./mailComposeModal.tsx";
import { MailAccountSwitcher } from "./mailAccountSwitcher.tsx";
import { MailFolderSidebar } from "./mailFolderSidebar.tsx";
import { MailMessageList } from "./mailMessageList.tsx";
import { MailMessageViewer } from "./mailMessageViewer.tsx";
import { MailNavigationRail } from "./mailNavigationRail.tsx";
import {
  mailNavigationCollapsedStorageKey,
  readMailNavigationCollapsedPreference,
  writeMailNavigationCollapsedPreference,
} from "./mailNavigationPreference.ts";
import { MailToolbar } from "./mailToolbar.tsx";
import { buildEmailSrcDoc, prepareEmailHtml } from "./safeEmailHtml.ts";
import type {
  MailAccountSummary,
  MailFolder,
  MailMessageDetail,
  MailMessageSummary,
  SendMessageRequest,
} from "../../types/mail.ts";

const mockMailApi = vi.hoisted(() => ({
  getTemplates: vi.fn(),
  getTemplate: vi.fn(),
  renderTemplatePreview: vi.fn(),
  createTemplate: vi.fn(),
  updateTemplate: vi.fn(),
  duplicateTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
  exportTemplate: vi.fn(),
  uploadTemplateAsset: vi.fn(),
  importTemplate: vi.fn(),
}));

vi.mock("../../lib/mailApi.ts", () => ({
  mailApi: mockMailApi,
}));

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

const betaTemplateSummary = {
  id: "00000000-0000-4000-8000-000000000101",
  name: "Beta Access Ready",
  description: "Private beta access details",
  subjectTemplate: "Your Vayvyx Private Beta Access Is Ready",
  scope: "personal" as const,
  defaultMailAccountId: "mailbox-1",
  previewMetadata: null,
  createdBy: "user-1",
  updatedAt: "2026-07-28T12:00:00.000Z",
  createdAt: "2026-07-28T12:00:00.000Z",
  isActive: true,
};

const betaTemplateHtml = `<!doctype html><html><head><style>@media only screen and (max-width:640px){.container{width:100%}}</style></head><body><table class="container"><tbody><tr><td>Your Vayvyx access is ready.</td></tr><tr><td>Hello {{first_name}}</td></tr><tr><td>YOUR LOGIN INFORMATION {{login_email}} {{temporary_password}}</td></tr><tr><td><a href="{{login_url}}">How to access your account</a> {{login_url}}</td></tr><tr><td>GETTING STARTED</td></tr><tr><td>FORGOT OR NEED TO RESET YOUR PASSWORD? <a href="{{password_reset_url}}">{{password_reset_url}}</a></td></tr><tr><td>PRIVATE &amp; CONFIDENTIAL</td></tr><tr><td>Welcome to the beta</td></tr><tr><td>CONSTRUCTION INTELLIGENCE</td></tr></tbody></table></body></html>`;

const betaTemplateText = `Your Vayvyx access is ready.
Hello {{first_name}}
YOUR LOGIN INFORMATION {{login_email}} {{temporary_password}}
How to access your account {{login_url}}
GETTING STARTED
FORGOT OR NEED TO RESET YOUR PASSWORD? {{password_reset_url}}
PRIVATE & CONFIDENTIAL
Welcome to the beta
CONSTRUCTION INTELLIGENCE`;

const betaTemplateDetail = {
  ...betaTemplateSummary,
  htmlContent: betaTemplateHtml,
  plainTextContent: betaTemplateText,
  variables: [
    "access_type",
    "first_name",
    "login_email",
    "login_url",
    "password_reset_url",
    "temporary_password",
  ],
  assets: [],
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
  vi.restoreAllMocks();
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

  it("shows the full compose button in the expanded navigation pane", () => {
    const onCompose = vi.fn();
    render(
      <MailAccountSwitcher
        accounts={[{ ...account, currentUserRole: "admin" }]}
        selectedId="mailbox-1"
        isUnified={false}
        canCompose
        onCompose={onCompose}
        onSelectUnified={vi.fn()}
        onSelectAccount={vi.fn()}
      />
    );

    expect(screen.queryByText("admin")).toBeNull();
    expect(screen.queryByText("Mail settings")).toBeNull();
    expect(screen.getAllByText("Compose")).toHaveLength(1);
    fireEvent.click(screen.getByText("Compose"));
    expect(onCompose).toHaveBeenCalledTimes(1);
  });

  it("renders rail navigation actions with authorized settings visibility", () => {
    const { rerender } = render(
      <MailNavigationRail
        canManage={false}
        canCompose={false}
        isMailNavigationCollapsed={false}
        onCompose={vi.fn()}
        onToggleMailNavigation={vi.fn()}
        onHome={vi.fn()}
        onAccount={vi.fn()}
        onSettings={vi.fn()}
      />
    );

    expect(screen.getByLabelText("Mail")).toBeTruthy();
    expect(screen.getByLabelText("Home")).toBeTruthy();
    expect(screen.getByLabelText("Account")).toBeTruthy();
    expect(screen.queryByLabelText("Mail settings")).toBeNull();

    rerender(
      <MailNavigationRail
        canManage
        canCompose={false}
        isMailNavigationCollapsed={false}
        onCompose={vi.fn()}
        onToggleMailNavigation={vi.fn()}
        onHome={vi.fn()}
        onAccount={vi.fn()}
        onSettings={vi.fn()}
      />
    );
    expect(screen.getByLabelText("Mail settings")).toBeTruthy();
  });

  it("shows the rail compose icon while navigation is collapsed", () => {
    const onCompose = vi.fn();
    render(
      <MailNavigationRail
        canManage={false}
        canCompose
        isMailNavigationCollapsed
        onCompose={onCompose}
        onToggleMailNavigation={vi.fn()}
        onHome={vi.fn()}
        onAccount={vi.fn()}
        onSettings={vi.fn()}
      />
    );

    const compose = screen.getByLabelText("Compose new email");
    expect(compose.getAttribute("title")).toBe("New email");
    fireEvent.click(compose);
    expect(onCompose).toHaveBeenCalledTimes(1);
  });

  it("opens the same compose flow from pane and rail entry points", () => {
    const onCompose = vi.fn();
    render(
      <>
        <MailAccountSwitcher
          accounts={[{ ...account, currentUserRole: "sender" }]}
          selectedId="mailbox-1"
          isUnified={false}
          canCompose
          onCompose={onCompose}
          onSelectUnified={vi.fn()}
          onSelectAccount={vi.fn()}
        />
        <MailNavigationRail
          canManage={false}
          canCompose
          isMailNavigationCollapsed
          onCompose={onCompose}
          onToggleMailNavigation={vi.fn()}
          onHome={vi.fn()}
          onAccount={vi.fn()}
          onSettings={vi.fn()}
        />
      </>
    );

    fireEvent.click(screen.getByText("Compose"));
    fireEvent.click(screen.getByLabelText("Compose new email"));
    expect(onCompose).toHaveBeenCalledTimes(2);
  });

  it("keeps the navigation toggle visible and reversible after collapse", () => {
    render(<MailRailHarness initialCollapsed />);

    const expand = screen.getByLabelText("Expand mail navigation");
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(expand);

    const collapse = screen.getByLabelText("Collapse mail navigation");
    expect(collapse.getAttribute("aria-expanded")).toBe("true");
  });

  it("supports keyboard activation for permanent rail actions", () => {
    const onCompose = vi.fn();
    render(
      <MailNavigationRail
        canManage={false}
        canCompose
        isMailNavigationCollapsed
        onCompose={onCompose}
        onToggleMailNavigation={vi.fn()}
        onHome={vi.fn()}
        onAccount={vi.fn()}
        onSettings={vi.fn()}
      />
    );

    const compose = screen.getByLabelText("Compose new email");
    compose.focus();
    fireEvent.keyDown(compose, { key: " " });
    expect(onCompose).toHaveBeenCalledTimes(1);

    cleanup();
    render(<MailRailHarness initialCollapsed={false} />);
    const collapse = screen.getByLabelText("Collapse mail navigation");
    collapse.focus();
    fireEvent.keyDown(collapse, { key: "Enter" });
    expect(screen.getByLabelText("Expand mail navigation")).toBeTruthy();
  });

  it("defaults malformed persisted navigation state to expanded", () => {
    window.localStorage.setItem(mailNavigationCollapsedStorageKey, "not-a-boolean");
    expect(readMailNavigationCollapsedPreference()).toBe(false);

    writeMailNavigationCollapsedPreference(true);
    expect(readMailNavigationCollapsedPreference()).toBe(true);
    writeMailNavigationCollapsedPreference(false);
    expect(readMailNavigationCollapsedPreference()).toBe(false);
  });

  it("renders compact toolbar filters as selected only when active", () => {
    const onCompose = vi.fn();
    render(
      <MailToolbar
        title="Inbox"
        search=""
        unreadOnly
        flaggedOnly={false}
        canCompose
        onSearch={vi.fn()}
        onUnreadOnly={vi.fn()}
        onFlaggedOnly={vi.fn()}
        onCompose={onCompose}
        onRefresh={vi.fn()}
      />
    );

    expect(screen.getByTitle("Unread only").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTitle("Flagged only").getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByLabelText("Compose new email"));
    expect(onCompose).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Message options")).toBeTruthy();
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
    expect(screen.getByText("Templates")).toBeTruthy();
  });

  it("uses one rich message body workspace for normal compose sends", async () => {
    const onSend = vi.fn().mockResolvedValue({ status: "sent", messageId: "<sent@test>" });
    render(
      <MailComposeModal
        account={{ ...account, currentUserRole: "sender" }}
        mode="compose"
        originalMessage={null}
        onClose={vi.fn()}
        onSend={onSend}
      />
    );

    expect(document.querySelector('textarea[aria-label="Message body"]')).toBeNull();
    const editor = screen.getByLabelText("Message body");
    editor.innerHTML = "<p>Hello <strong>team</strong></p>";
    fireEvent.input(editor);
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "person@example.com" } });
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Hello" } });
    fireEvent.click(screen.getByText("Send"));

    await waitFor(() => expect(onSend).toHaveBeenCalled());
    const [input] = onSend.mock.calls[0] as [SendMessageRequest, File[]];
    expect(input.textBody).toBe("Hello team");
    expect(input.sanitizedHtmlBody).toContain("<strong>team</strong>");
  });

  it("opens template fields with defaults and blocks blank placeholder use", async () => {
    const onSend = vi.fn().mockResolvedValue({ status: "sent", messageId: "<sent@test>" });
    mockMailApi.getTemplates.mockResolvedValue([betaTemplateSummary]);
    mockMailApi.getTemplate.mockResolvedValue(betaTemplateDetail);
    mockMailApi.renderTemplatePreview.mockImplementation(
      async (_templateId: string, variables: Record<string, string>) => ({
        subject: "Your Vayvyx Private Beta Access Is Ready",
        htmlContent: populateBetaTemplate(betaTemplateHtml, variables),
        plainTextContent: populateBetaTemplate(betaTemplateText, variables),
        unresolvedVariables: [],
      })
    );

    render(
      <MailComposeModal
        account={{ ...account, currentUserRole: "sender" }}
        mode="compose"
        originalMessage={null}
        onClose={vi.fn()}
        onSend={onSend}
      />
    );

    fireEvent.change(screen.getByLabelText("To"), { target: { value: "Alex Beta <alex@example.com>" } });
    fireEvent.click(screen.getByText("Templates"));

    expect(await screen.findByText("Beta Access Ready")).toBeTruthy();
    expect(screen.getByLabelText("Login email")).toHaveProperty("value", "alex@example.com");
    expect(screen.getByLabelText("Login URL")).toHaveProperty("value", "https://vayvyx.com/login");
    expect(screen.getByLabelText("Password-reset URL")).toHaveProperty("value", "https://vayvyx.com/reset-password");
    expect(screen.getByText(/Complete required template fields/)).toBeTruthy();

    fireEvent.click(screen.getByText("Use template"));
    expect(screen.getByText("Complete the missing variables before using this template.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Alex" } });
    fireEvent.change(screen.getByLabelText("Access type"), { target: { value: "Private beta" } });
    fireEvent.change(screen.getByLabelText("Login email"), { target: { value: "alex@example.com" } });
    fireEvent.change(screen.getByLabelText("Temporary password"), { target: { value: "temporary-password" } });
    await waitFor(() => expect(screen.queryByText(/Complete required template fields/)).toBeNull());
    fireEvent.click(screen.getByText("Use template"));

    await waitFor(() => expect(screen.getByText(/Template:/)).toBeTruthy());
    expect(screen.getByLabelText("Subject")).toHaveProperty("value", "Your Vayvyx Private Beta Access Is Ready");
    expect(document.querySelector('textarea[aria-label="Message body"]')).toBeNull();
    expect(screen.getByTitle("Rendered email body")).toBeTruthy();
    const srcDoc = screen.getByTitle("Rendered email body").getAttribute("srcdoc") ?? "";
    expect(srcDoc).toContain("<!doctype html>");
    expect(srcDoc).toContain("GETTING STARTED");
    expect(srcDoc).toContain("FORGOT OR NEED TO RESET YOUR PASSWORD?");
    expect(srcDoc).toContain("PRIVATE &amp; CONFIDENTIAL");
    expect(srcDoc).toContain("CONSTRUCTION INTELLIGENCE");
    expect(srcDoc).not.toContain(betaTemplateText);

    fireEvent.click(screen.getByText("Save Draft"));
    await waitFor(() => expect(screen.getByText("Draft saved.")).toBeTruthy());
    cleanup();

    render(
      <MailComposeModal
        account={{ ...account, currentUserRole: "sender" }}
        mode="compose"
        originalMessage={null}
        onClose={vi.fn()}
        onSend={onSend}
      />
    );
    const restoredSrcDoc = screen.getByTitle("Rendered email body").getAttribute("srcdoc") ?? "";
    expect(restoredSrcDoc).toBe(srcDoc);
  });

  it("saves and restores compose draft content", async () => {
    render(
      <MailComposeModal
        account={{ ...account, currentUserRole: "sender" }}
        mode="compose"
        originalMessage={null}
        onClose={vi.fn()}
        onSend={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("To"), { target: { value: "draft@example.com" } });
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Saved subject" } });
    const editor = screen.getByLabelText("Message body");
    editor.innerHTML = "<p>Saved body</p>";
    fireEvent.input(editor);
    fireEvent.click(screen.getByText("Save Draft"));

    await waitFor(() => expect(screen.getByText("Draft saved.")).toBeTruthy());
    cleanup();

    render(
      <MailComposeModal
        account={{ ...account, currentUserRole: "sender" }}
        mode="compose"
        originalMessage={null}
        onClose={vi.fn()}
        onSend={vi.fn()}
      />
    );

    expect(screen.getByLabelText("To")).toHaveProperty("value", "draft@example.com");
    expect(screen.getByLabelText("Subject")).toHaveProperty("value", "Saved subject");
    expect(screen.getByLabelText("Message body").textContent).toContain("Saved body");
  });
});

function MailRailHarness({ initialCollapsed }: { initialCollapsed: boolean }) {
  const [isCollapsed, setIsCollapsed] = useState(initialCollapsed);

  return (
    <MailNavigationRail
      canManage={false}
      canCompose
      isMailNavigationCollapsed={isCollapsed}
      onCompose={vi.fn()}
      onToggleMailNavigation={() => setIsCollapsed((current) => !current)}
      onHome={vi.fn()}
      onAccount={vi.fn()}
      onSettings={vi.fn()}
    />
  );
}

function populateBetaTemplate(value: string, variables: Record<string, string>) {
  return value.replace(/{{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*}}/g, (_token, key: string) => variables[key] ?? "");
}
