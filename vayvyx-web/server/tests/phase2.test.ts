import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { sanitizeAttachmentFilename } from "../src/filename.js";
import { normalizeSpecialUse } from "../src/mailProvider.js";
import { ImapSmtpMailProvider } from "../src/mailProvider.js";
import { sanitizeEmailHtml } from "../src/mailSanitizer.js";
import { sendJsonSchema } from "../src/mailValidation.js";
import { createRoutes } from "../src/routes.js";

const account = {
  id: "00000000-0000-4000-8000-000000000010",
  email_address: "support@vayvyx.com",
  display_name: "Support",
  description: null,
  imap_host: "sunfire.mxrouting.net",
  imap_port: 993,
  imap_secure: true,
  smtp_host: "sunfire.mxrouting.net",
  smtp_port: 465,
  smtp_secure: true,
  username: "support@vayvyx.com",
  credential_secret_id: "00000000-0000-4000-8000-000000000099",
  from_name: null,
  reply_to_address: null,
  max_attachment_mb: 25,
  is_active: true,
  created_by: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const auth = {
  user: { id: "00000000-0000-4000-8000-000000000001" },
  userId: "00000000-0000-4000-8000-000000000001",
  email: "person@vayvyx.com",
  platformRole: "user",
};

function createPhase2App(role = "viewer", overrides: Record<string, unknown> = {}) {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    request.auth = auth as never;
    next();
  });
  app.use(
    createRoutes({
      mailAdminService: {},
      mailAuthorizationService: {
        listAccessibleAccounts: async () => [
          {
            id: account.id,
            emailAddress: account.email_address,
            displayName: account.display_name,
            description: null,
            fromName: null,
            replyToAddress: null,
            maxAttachmentMb: 25,
            currentUserRole: role,
            isActive: true,
            connectionStatus: "unknown",
          },
        ],
        requireMailboxRole: async (_auth: unknown, mailAccountId: string, requiredRole: string) => {
          if (mailAccountId !== account.id) {
            throw Object.assign(new Error("Mailbox access is denied."), {
              status: 403,
              code: "ACCESS_DENIED",
            });
          }
          const rank: Record<string, number> = { viewer: 1, sender: 2, manager: 3, owner: 4 };
          if (rank[role] < rank[requiredRole]) {
            throw Object.assign(new Error("Mailbox access is denied."), {
              status: 403,
              code: "ACCESS_DENIED",
            });
          }
          if (overrides.inactive) {
            throw Object.assign(new Error("Mailbox is inactive."), {
              status: 403,
              code: "MAILBOX_INACTIVE",
            });
          }
          return { account, role };
        },
        getIdentityForSend: async (_mailAccountId: string, identityId?: string) => {
          if (identityId === "00000000-0000-4000-8000-000000000066") {
            throw Object.assign(new Error("Sender identity is not allowed."), {
              status: 403,
              code: "ACCESS_DENIED",
            });
          }
          return null;
        },
      },
      connectionManager: {},
      mailProvider: {
        listFolders: async () => [
          {
            path: "INBOX",
            displayName: "Inbox",
            delimiter: "/",
            specialUse: "inbox",
            originalSpecialUse: "\\Inbox",
            totalCount: 1,
            unreadCount: 1,
            selectable: true,
            subscribed: true,
          },
          {
            path: "Archive",
            displayName: "Archive",
            delimiter: "/",
            specialUse: "archive",
            originalSpecialUse: "\\Archive",
            totalCount: null,
            unreadCount: null,
            selectable: true,
            subscribed: true,
          },
          {
            path: "Trash",
            displayName: "Trash",
            delimiter: "/",
            specialUse: "trash",
            originalSpecialUse: "\\Trash",
            totalCount: null,
            unreadCount: null,
            selectable: true,
            subscribed: true,
          },
        ],
        listMessages: async () => ({
          messages: [
            {
              mailAccountId: account.id,
              folder: "INBOX",
              uid: 1,
              messageId: "<message@vayvyx.test>",
              subject: "Hello",
              senderName: "Sender",
              senderAddress: "sender@example.com",
              recipients: [],
              receivedAt: "2026-07-28T12:00:00.000Z",
              sentAt: null,
              unread: true,
              flagged: false,
              hasAttachments: false,
              attachmentCount: 0,
              preview: "Hello",
              inReplyTo: null,
              references: [],
            },
          ],
          nextCursor: null,
        }),
        getMessage: async () => ({
          mailAccountId: account.id,
          folder: "INBOX",
          uid: 1,
          messageId: "<message@vayvyx.test>",
          subject: "Hello",
          senderName: "Sender",
          senderAddress: "sender@example.com",
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
          htmlBody: "<p>Hello</p>",
          textBody: "Hello",
          from: [{ name: "Sender", address: "sender@example.com" }],
          replyTo: [{ name: "Reply", address: "reply@example.com" }],
          to: [{ name: null, address: "support@vayvyx.com" }],
          cc: [{ name: null, address: "teammate@example.com" }],
          hasRemoteImages: false,
          attachments: [],
        }),
        getAttachment: async () => ({
          filename: "report.pdf",
          contentType: "application/pdf",
          size: 4,
          content: Buffer.from("test"),
        }),
        setRead: async (_account: unknown, _folder: string, uid: number, read: boolean) => ({ uid, read }),
        setFlagged: async (_account: unknown, _folder: string, uid: number, flagged: boolean) => ({ uid, flagged }),
        moveMessage: async (_account: unknown, sourceFolder: string, uid: number, destinationFolder: string) => ({
          uid,
          sourceFolder,
          destinationFolder,
        }),
        sendMessage: async (_account: unknown, input: unknown) => {
          if (typeof overrides.captureSend === "function") {
            overrides.captureSend(input);
          }
          return { status: "sent", messageId: "<sent@vayvyx.test>" };
        },
      },
      audit: {
        record: async () => undefined,
      },
    } as never)
  );
  return app;
}

describe("Phase 2 safety helpers", () => {
  it("maps special-use folders without English path assumptions", () => {
    expect(normalizeSpecialUse("\\Sent")).toBe("sent");
    expect(normalizeSpecialUse("\\Junk")).toBe("junk");
    expect(normalizeSpecialUse("Projects")).toBe("custom");
  });

  it("sanitizes hostile email HTML and blocks remote images", () => {
    const result = sanitizeEmailHtml(
      '<img src="https://tracker.example/p.gif"><a href="javascript:alert(1)" onclick="x()">x</a><script>alert(1)</script>'
    );
    expect(result.hasRemoteImages).toBe(true);
    expect(result.html).not.toContain("script");
    expect(result.html).not.toContain("javascript:");
    expect(result.html).toContain('rel="noopener noreferrer"');
    expect(result.html).toContain("[remote image blocked]");
  });

  it("sanitizes attachment filenames", () => {
    expect(sanitizeAttachmentFilename("../../secret.txt")).toBe("_._secret.txt");
    expect(sanitizeAttachmentFilename("")).toBe("attachment");
  });

  it("rejects CRLF header injection", () => {
    expect(() =>
      sendJsonSchema.parse({
        to: ["person@example.com"],
        subject: "Hi\r\nBcc: attacker@example.com",
        textBody: "Hello",
      })
    ).toThrow();
  });

  it("uses the mailbox sender name and address when identityId is omitted", async () => {
    const sent: Record<string, unknown>[] = [];
    const provider = new ImapSmtpMailProvider({
      withImapClient: async () => {
        throw new Error("IMAP should not be used for direct send.");
      },
      createSmtpTransport: async () =>
        ({
          sendMail: async (input: Record<string, unknown>) => {
            sent.push(input);
            return { messageId: "<sent@vayvyx.test>" };
          },
        }) as never,
    });

    await provider.sendMessage(
      { ...account, from_name: "Vayvyx Support" },
      {
        mode: "compose",
        to: ["person@example.com"],
        cc: [],
        bcc: [],
        subject: "Hello",
        textBody: "Hello",
        references: [],
      },
      []
    );

    expect(sent[0]?.from).toBe('"Vayvyx Support" <support@vayvyx.com>');
  });
});

describe("Phase 2 routes", () => {
  it("returns accessible accounts without credentials", async () => {
    const response = await request(createPhase2App("viewer"))
      .get("/api/mail/accounts")
      .expect(200);

    expect(response.body[0].emailAddress).toBe("support@vayvyx.com");
    expect(JSON.stringify(response.body)).not.toContain("credential_secret_id");
    expect(JSON.stringify(response.body)).not.toContain("username");
  });

  it("allows viewers to list folders and denies them read mutation", async () => {
    await request(createPhase2App("viewer"))
      .get(`/api/mail/accounts/${account.id}/folders`)
      .expect(200);

    await request(createPhase2App("viewer"))
      .patch(`/api/mail/accounts/${account.id}/messages/1/read`)
      .send({ folder: "INBOX", read: true })
      .expect(403);
  });

  it("allows senders to read and flag but denies archive", async () => {
    await request(createPhase2App("sender"))
      .patch(`/api/mail/accounts/${account.id}/messages/1/flag`)
      .send({ folder: "INBOX", flagged: true })
      .expect(200);

    await request(createPhase2App("sender"))
      .post(`/api/mail/accounts/${account.id}/messages/1/archive`)
      .send({ folder: "INBOX" })
      .expect(403);
  });

  it("allows managers to archive, trash, and move", async () => {
    await request(createPhase2App("manager"))
      .post(`/api/mail/accounts/${account.id}/messages/1/archive`)
      .send({ folder: "INBOX" })
      .expect(200);

    await request(createPhase2App("manager"))
      .post(`/api/mail/accounts/${account.id}/messages/1/trash`)
      .send({ folder: "INBOX" })
      .expect(200);

    await request(createPhase2App("manager"))
      .post(`/api/mail/accounts/${account.id}/messages/1/move`)
      .send({ sourceFolder: "INBOX", destinationFolder: "Projects" })
      .expect(200);
  });

  it("denies inactive mailboxes before provider calls", async () => {
    await request(createPhase2App("owner", { inactive: true }))
      .get(`/api/mail/accounts/${account.id}/messages?folder=INBOX`)
      .expect(403);
  });

  it("handles unified inbox partial failures safely", async () => {
    const response = await request(createPhase2App("viewer"))
      .get("/api/mail/unified/messages")
      .expect(200);

    expect(response.body.messages[0].sourceEmailAddress).toBe("support@vayvyx.com");
    expect(response.body.failures).toEqual([]);
  });

  it("derives reply-all recipients and excludes the mailbox address", async () => {
    let captured: { to: string[]; cc: string[] } | null = null;
    await request(
      createPhase2App("sender", {
        captureSend: (input: { to: string[]; cc: string[] }) => {
          captured = input;
        },
      })
    )
      .post(`/api/mail/accounts/${account.id}/send`)
      .send({
        mode: "replyAll",
        to: [],
        cc: [],
        bcc: [],
        subject: "Re: Hello",
        textBody: "Thanks",
        originalFolder: "INBOX",
        originalUid: 1,
      })
      .expect(200);

    expect(captured?.to).toEqual(["reply@example.com"]);
    expect(captured?.cc).toEqual(["teammate@example.com"]);
  });

  it("denies a selected identity from another mailbox", async () => {
    await request(createPhase2App("sender"))
      .post(`/api/mail/accounts/${account.id}/send`)
      .send({
        mode: "compose",
        identityId: "00000000-0000-4000-8000-000000000066",
        to: ["person@example.com"],
        cc: [],
        bcc: [],
        subject: "Hello",
        textBody: "Hello",
      })
      .expect(403);
  });
});
