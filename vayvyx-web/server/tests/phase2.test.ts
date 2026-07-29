import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { isHttpError } from "../src/httpError.js";
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
  credential_ciphertext: Buffer.from("ciphertext").toString("base64"),
  credential_iv: Buffer.alloc(12, 1).toString("base64"),
  credential_auth_tag: Buffer.alloc(16, 2).toString("base64"),
  credential_key_version: 1,
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

  it("awaits ImapFlow folder arrays before mapping folders", async () => {
    const calls: string[] = [];
    const provider = new ImapSmtpMailProvider({
      withImapClient: async (_account, operation) =>
        operation({
          list: async () => {
            calls.push("list");
            return [
              {
                path: "INBOX",
                name: "Inbox",
                delimiter: "/",
                specialUse: "\\Inbox",
                flags: [],
                subscribed: true,
              },
              {
                path: "Archive",
                name: "Archive",
                delimiter: "/",
                specialUse: "\\Archive",
                flags: [],
                subscribed: false,
              },
              {
                path: "Disabled",
                name: "Disabled",
                delimiter: "/",
                flags: ["\\Noselect"],
              },
            ];
          },
          status: async (path: string) => {
            calls.push(`status:${path}`);
            return path === "INBOX"
              ? { messages: 3, unseen: 2 }
              : { messages: 0, unseen: 0 };
          },
        }),
      createSmtpTransport: async () => ({}) as never,
    });

    const folders = await provider.listFolders(account);

    expect(calls).toEqual([
      "list",
      "status:INBOX",
      "status:Archive",
      "status:Disabled",
    ]);
    expect(folders).toEqual([
      {
        path: "INBOX",
        displayName: "Inbox",
        delimiter: "/",
        specialUse: "inbox",
        originalSpecialUse: "\\Inbox",
        totalCount: 3,
        unreadCount: 2,
        selectable: true,
        subscribed: true,
      },
      {
        path: "Archive",
        displayName: "Archive",
        delimiter: "/",
        specialUse: "archive",
        originalSpecialUse: "\\Archive",
        totalCount: 0,
        unreadCount: 0,
        selectable: true,
        subscribed: false,
      },
      {
        path: "Disabled",
        displayName: "Disabled",
        delimiter: "/",
        specialUse: "custom",
        originalSpecialUse: null,
        totalCount: 0,
        unreadCount: 0,
        selectable: false,
        subscribed: null,
      },
    ]);
  });

  it("returns an empty folder array from an empty ImapFlow list result", async () => {
    const provider = new ImapSmtpMailProvider({
      withImapClient: async (_account, operation) =>
        operation({
          list: async () => [],
          status: async () => {
            throw new Error("status should not be called");
          },
        }),
      createSmtpTransport: async () => ({}) as never,
    });

    await expect(provider.listFolders(account)).resolves.toEqual([]);
  });

  it("sanitizes failed folder list calls as mailbox unavailable", async () => {
    const provider = new ImapSmtpMailProvider({
      withImapClient: async (_account, operation) =>
        operation({
          list: async () => {
            throw new Error("raw IMAP list failure");
          },
          status: async () => ({ messages: 0, unseen: 0 }),
        }),
      createSmtpTransport: async () => ({}) as never,
    });

    await expect(provider.listFolders(account)).rejects.toMatchObject({
      status: 502,
      code: "MAILBOX_UNAVAILABLE",
      message: "Mailbox folders are temporarily unavailable.",
    });
  });

  it("lists one existing INBOX message without accidental filters", async () => {
    const searchCalls: unknown[] = [];
    const fetchAllCalls: unknown[] = [];
    const provider = messageProvider({
      exists: 1,
      searchCalls,
      fetchAllCalls,
      messages: [messageFixture({ seq: 1, uid: 101 })],
    });

    const page = await provider.listMessages(account, defaultMessageInput());

    expect(searchCalls).toEqual([]);
    expect(fetchAllCalls).toEqual([
      {
        range: "1:1",
        options: undefined,
      },
    ]);
    expect(page.messages).toHaveLength(1);
    expect(page.messages[0]?.uid).toBe(101);
  });

  it("fetches sequence 1 and returns stable UID 25", async () => {
    const fetchAllCalls: unknown[] = [];
    const provider = messageProvider({
      exists: 1,
      fetchAllCalls,
      messages: [messageFixture({ seq: 1, uid: 25 })],
    });

    const page = await provider.listMessages(account, defaultMessageInput());

    expect(fetchAllCalls).toEqual([{ range: "1:1", options: undefined }]);
    expect(page.messages.map((message) => message.uid)).toEqual([25]);
  });

  it("uses newest sequence range for a larger mailbox page", async () => {
    const fetchAllCalls: unknown[] = [];
    const provider = messageProvider({
      exists: 12,
      fetchAllCalls,
      messages: Array.from({ length: 12 }, (_item, index) =>
        messageFixture({ seq: index + 1, uid: index + 101 })
      ),
    });

    const page = await provider.listMessages(account, {
      ...defaultMessageInput(),
      limit: 5,
    });

    expect(fetchAllCalls).toEqual([{ range: "8:12", options: undefined }]);
    expect(page.messages.map((message) => message.uid)).toEqual([
      112,
      111,
      110,
      109,
      108,
    ]);
  });

  it("logs safe message-list diagnostics without message content", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const provider = messageProvider({
      exists: 1,
      messages: [messageFixture({ seq: 1, uid: 101 })],
    });

    await provider.listMessages(account, defaultMessageInput());

    expect(infoSpy).toHaveBeenCalledWith("Vayvyx Mail message listing", {
      correlationId: expect.any(String),
      mailAccountId: account.id,
      folderPath: "INBOX",
      exists: 1,
      requestMode: "sequence-range",
      sequenceRange: "1:1",
      searchCount: null,
      requestedCount: 1,
      fetchedCount: 1,
      parsedUnreadOnly: false,
      parsedFlaggedOnly: false,
      normalizedSearchLength: 0,
    });
    expect(JSON.stringify(infoSpy.mock.calls)).not.toContain("Message 101");
    expect(JSON.stringify(infoSpy.mock.calls)).not.toContain("sender@example.com");
    infoSpy.mockRestore();
  });

  it("lists multiple messages newest first by UID", async () => {
    const provider = messageProvider({
      exists: 3,
      messages: [
        messageFixture({ seq: 1, uid: 7 }),
        messageFixture({ seq: 2, uid: 9 }),
        messageFixture({ seq: 3, uid: 12 }),
      ],
    });

    const page = await provider.listMessages(account, {
      ...defaultMessageInput(),
      limit: 3,
    });

    expect(page.messages.map((message) => message.uid)).toEqual([12, 9, 7]);
  });

  it("includes messages older than one day", async () => {
    const oldDate = new Date("2026-07-20T12:00:00.000Z");
    const provider = messageProvider({
      exists: 1,
      messages: [messageFixture({ seq: 1, uid: 42, date: oldDate })],
    });

    const page = await provider.listMessages(account, defaultMessageInput());

    expect(page.messages[0]?.uid).toBe(42);
    expect(page.messages[0]?.receivedAt).toBe(oldDate.toISOString());
  });

  it("uses UID search and fetch for unread filters", async () => {
    const searchCalls: unknown[] = [];
    const fetchAllCalls: unknown[] = [];
    const provider = messageProvider({
      exists: 5,
      searchCalls,
      fetchAllCalls,
      searchResult: [103, 105],
      messages: [
        messageFixture({ seq: 3, uid: 103, flags: [] }),
        messageFixture({ seq: 5, uid: 105, flags: [] }),
      ],
    });

    const page = await provider.listMessages(account, {
      ...defaultMessageInput(),
      unreadOnly: true,
    });

    expect(searchCalls).toEqual([{ query: { seen: false }, options: { uid: true } }]);
    expect(fetchAllCalls).toEqual([{ range: [105, 103], options: { uid: true } }]);
    expect(page.messages.map((message) => message.uid)).toEqual([105, 103]);
    expect(page.messages.every((message) => message.unread)).toBe(true);
  });

  it("uses UID search and fetch for flagged filters", async () => {
    const searchCalls: unknown[] = [];
    const fetchAllCalls: unknown[] = [];
    const provider = messageProvider({
      exists: 5,
      searchCalls,
      fetchAllCalls,
      searchResult: [201],
      messages: [messageFixture({ seq: 2, uid: 201, flags: new Set(["\\Flagged"]) })],
    });

    const page = await provider.listMessages(account, {
      ...defaultMessageInput(),
      flaggedOnly: true,
    });

    expect(searchCalls).toEqual([{ query: { flagged: true }, options: { uid: true } }]);
    expect(fetchAllCalls).toEqual([{ range: [201], options: { uid: true } }]);
    expect(page.messages[0]?.uid).toBe(201);
    expect(page.messages[0]?.flagged).toBe(true);
  });

  it("uses filtered search for non-empty search text", async () => {
    const searchCalls: unknown[] = [];
    const fetchAllCalls: unknown[] = [];
    const provider = messageProvider({
      exists: 5,
      searchCalls,
      fetchAllCalls,
      searchResult: [301],
      messages: [messageFixture({ seq: 3, uid: 301 })],
    });

    const page = await provider.listMessages(account, {
      ...defaultMessageInput(),
      search: " invoice ",
    });

    expect(searchCalls).toEqual([
      {
        query: { or: [{ subject: "invoice" }, { body: "invoice" }] },
        options: { uid: true },
      },
    ]);
    expect(fetchAllCalls).toEqual([{ range: [301], options: { uid: true } }]);
    expect(page.messages[0]?.uid).toBe(301);
  });

  it("returns an empty page for an empty folder", async () => {
    const searchCalls: unknown[] = [];
    const fetchAllCalls: unknown[] = [];
    const provider = messageProvider({
      exists: 0,
      searchCalls,
      fetchAllCalls,
      messages: [],
    });

    const page = await provider.listMessages(account, defaultMessageInput());

    expect(page).toEqual({ messages: [], nextCursor: null });
    expect(searchCalls).toEqual([]);
    expect(fetchAllCalls).toEqual([]);
  });

  it("returns a typed error when message retrieval fails", async () => {
    const provider = messageProvider({
      exists: 1,
      fetchError: new Error("raw fetch failure"),
      messages: [],
    });

    await expect(provider.listMessages(account, defaultMessageInput())).rejects.toMatchObject({
      status: 502,
      code: "MAILBOX_UNAVAILABLE",
      message: "Mailbox messages are temporarily unavailable.",
    });
  });

  it("throws a sanitized fetch failure when UID matches fetch no messages", async () => {
    const provider = messageProvider({
      exists: 1,
      fetchedMessages: [],
      messages: [messageFixture({ seq: 1, uid: 25 })],
    });

    await expect(provider.listMessages(account, defaultMessageInput())).rejects.toMatchObject({
      status: 502,
      code: "MAIL_FETCH_FAILED",
      message: "Mailbox messages could not be fetched.",
    });
  });

  it("uses UID mode for message actions", async () => {
    const calls: unknown[] = [];
    const provider = new ImapSmtpMailProvider({
      withImapClient: async (_account, operation) =>
        operation({
          mailboxOpen: async () => ({}),
          fetchOne: async (
            uid: number,
            _query: Record<string, unknown>,
            options: Record<string, unknown>
          ) => {
            calls.push({ method: "fetchOne", uid, options });
            return {
              ...messageFixture({ seq: 1, uid }),
              source: Buffer.from(
                [
                  "From: Sender <sender@example.com>",
                  "To: support@vayvyx.com",
                  "Subject: Attachment",
                  "MIME-Version: 1.0",
                  'Content-Type: multipart/mixed; boundary="vayvyx"',
                  "",
                  "--vayvyx",
                  "Content-Type: text/plain",
                  "",
                  "Hello",
                  "--vayvyx",
                  'Content-Type: text/plain; name="a.txt"',
                  'Content-Disposition: attachment; filename="a.txt"',
                  "Content-Transfer-Encoding: base64",
                  "",
                  "dGVzdA==",
                  "--vayvyx--",
                ].join("\r\n")
              ),
            };
          },
          download: async (
            uid: number,
            part: string,
            options: Record<string, unknown>
          ) => {
            calls.push({ method: "download", uid, part, options });
            return {
              content: Buffer.from("test"),
              meta: { contentType: "text/plain" },
            };
          },
          messageFlagsAdd: async (
            uid: number,
            flags: string[],
            options: Record<string, unknown>
          ) => {
            calls.push({ method: "messageFlagsAdd", uid, flags, options });
          },
          messageFlagsRemove: async (
            uid: number,
            flags: string[],
            options: Record<string, unknown>
          ) => {
            calls.push({ method: "messageFlagsRemove", uid, flags, options });
          },
          messageMove: async (
            uid: number,
            destination: string,
            options: Record<string, unknown>
          ) => {
            calls.push({ method: "messageMove", uid, destination, options });
          },
        }),
      createSmtpTransport: async () => ({}) as never,
    });

    await provider.getMessage(account, "INBOX", 25);
    await provider.getAttachment(account, "INBOX", 25, "1");
    await provider.setRead(account, "INBOX", 25, true);
    await provider.setRead(account, "INBOX", 25, false);
    await provider.setFlagged(account, "INBOX", 25, true);
    await provider.setFlagged(account, "INBOX", 25, false);
    await provider.moveMessage(account, "INBOX", 25, "Archive");

    expect(calls).toEqual(
      expect.arrayContaining([
        { method: "fetchOne", uid: 25, options: { uid: true } },
        { method: "download", uid: 25, part: "1", options: { uid: true } },
        { method: "messageFlagsAdd", uid: 25, flags: ["\\Seen"], options: { uid: true } },
        { method: "messageFlagsRemove", uid: 25, flags: ["\\Seen"], options: { uid: true } },
        { method: "messageFlagsAdd", uid: 25, flags: ["\\Flagged"], options: { uid: true } },
        { method: "messageFlagsRemove", uid: 25, flags: ["\\Flagged"], options: { uid: true } },
        { method: "messageMove", uid: 25, destination: "Archive", options: { uid: true } },
      ])
    );
  });

  it("releases mailbox locks after failed message retrieval", async () => {
    const events: string[] = [];
    const provider = new ImapSmtpMailProvider({
      withImapClient: async (_account, operation) => {
        events.push("lock");
        try {
          return await operation({
            getMailboxLock: async () => ({
              release: () => {
                events.push("release");
              },
            }),
            mailbox: { exists: 1 },
            fetchAll: async () => {
              throw new Error("raw fetch failure");
            },
          });
        } finally {
          events.push("outer finally");
        }
      },
      createSmtpTransport: async () => ({}) as never,
    });

    await expect(provider.listMessages(account, defaultMessageInput())).rejects.toMatchObject({
      code: "MAILBOX_UNAVAILABLE",
    });
    expect(events).toEqual(["lock", "release", "outer finally"]);
  });
});

describe("Phase 2 routes", () => {
  it("returns accessible accounts without credentials", async () => {
    const response = await request(createPhase2App("viewer"))
      .get("/api/mail/accounts")
      .expect(200);

    expect(response.body[0].emailAddress).toBe("support@vayvyx.com");
    expect(JSON.stringify(response.body)).not.toContain("credential_secret_id");
    expect(JSON.stringify(response.body)).not.toContain("credential_ciphertext");
    expect(JSON.stringify(response.body)).not.toContain("credential_auth_tag");
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

  it("lists messages when explicit false filter query strings are supplied", async () => {
    const searchCalls: unknown[] = [];
    const fetchAllCalls: unknown[] = [];
    const app = createMessageListRouteApp(
      messageProvider({
        exists: 1,
        searchCalls,
        fetchAllCalls,
        messages: [messageFixture({ seq: 1, uid: 25 })],
      })
    );

    const response = await request(app)
      .get(
        `/api/mail/accounts/${account.id}/messages?folder=INBOX&limit=50&unreadOnly=false&flaggedOnly=false&sortDirection=desc`
      )
      .expect(200);

    expect(response.body.messages.map((message: { uid: number }) => message.uid)).toEqual([25]);
    expect(searchCalls).toEqual([]);
    expect(fetchAllCalls).toEqual([{ range: "1:1", options: undefined }]);
  });

  it("returns HTTP 400 for invalid boolean query strings", async () => {
    const app = createMessageListRouteApp({
      listMessages: async () => {
        throw new Error("provider should not be called");
      },
    });

    const response = await request(app)
      .get(`/api/mail/accounts/${account.id}/messages?folder=INBOX&unreadOnly=yes`)
      .expect(400);

    expect(response.body.error.code).toBe("INVALID_REQUEST");
  });

  it("does not expose raw IMAP folder-list failures to the browser", async () => {
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
          requireMailboxRole: async () => ({ account, role: "viewer" }),
        },
        connectionManager: {},
        mailProvider: new ImapSmtpMailProvider({
          withImapClient: async (_account, operation) =>
            operation({
              list: async () => {
                throw new Error("raw IMAP list failure");
              },
              status: async () => ({ messages: 0, unseen: 0 }),
            }),
          createSmtpTransport: async () => {
            throw new Error("SMTP should not be used for folder listing");
          },
        }),
        audit: { record: async () => undefined },
      } as never)
    );
    app.use(
      (
        error: unknown,
        _request: express.Request,
        response: express.Response,
        _next: express.NextFunction
      ) => {
        void _next;
        if (isHttpError(error)) {
          response.status(error.status).json({
            error: { code: error.code, message: error.message },
          });
          return;
        }
        response.status(500).json({
          error: {
            code: "INTERNAL_ERROR",
            message: "Internal server error.",
          },
        });
      }
    );

    const response = await request(app)
      .get(`/api/mail/accounts/${account.id}/folders`)
      .expect(502);

    expect(response.body.error.code).toBe("MAILBOX_UNAVAILABLE");
    expect(response.body.error.message).toBe(
      "Mailbox folders are temporarily unavailable."
    );
    expect(JSON.stringify(response.body)).not.toContain("raw IMAP list failure");
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

function createMessageListRouteApp(mailProvider: unknown) {
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
        requireMailboxRole: async () => ({ account, role: "viewer" }),
      },
      connectionManager: {},
      mailProvider,
      audit: { record: async () => undefined },
    } as never)
  );
  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction
    ) => {
      void _next;
      if (error instanceof ZodError) {
        response.status(400).json({ error: { code: "INVALID_REQUEST" } });
        return;
      }
      if (isHttpError(error)) {
        response.status(error.status).json({
          error: { code: error.code, message: error.message },
        });
        return;
      }
      response.status(500).json({ error: { code: "INTERNAL_ERROR" } });
    }
  );
  return app;
}

function defaultMessageInput() {
  return {
    folder: "INBOX",
    limit: 50,
    unreadOnly: false,
    flaggedOnly: false,
    sortDirection: "desc" as const,
  };
}

function messageProvider(options: {
  exists: number;
  messages: Array<Record<string, unknown>>;
  searchResult?: number[] | false;
  fetchedMessages?: Array<Record<string, unknown>>;
  searchCalls?: unknown[];
  fetchAllCalls?: unknown[];
  fetchError?: Error;
}) {
  return new ImapSmtpMailProvider({
    withImapClient: async (_account, operation) =>
      operation({
        getMailboxLock: async (path: string) => {
          expect(path).toBe("INBOX");
          return {
            release: () => undefined,
          };
        },
        mailbox: { exists: options.exists },
        search: async (
          query: Record<string, unknown>,
          searchOptions?: { uid?: boolean }
        ) => {
          options.searchCalls?.push({ query, options: searchOptions });
          return options.searchResult ?? options.messages.map((message) => Number(message.uid));
        },
        fetchAll: async (
          range: string | number[],
          _query: Record<string, unknown>,
          fetchOptions?: { uid?: boolean }
        ) => {
          options.fetchAllCalls?.push({ range, options: fetchOptions });
          if (options.fetchError) throw options.fetchError;
          return options.fetchedMessages ?? selectFetchedMessages(options.messages, range);
        },
      }),
    createSmtpTransport: async () => ({}) as never,
  });
}

function selectFetchedMessages(
  messages: Array<Record<string, unknown>>,
  range: string | number[]
) {
  if (typeof range === "string") {
    const [start, end] = range.split(":").map((value) => Number(value));
    return messages.filter((message) => {
      const seq = Number(message.seq);
      return seq >= start && seq <= end;
    });
  }

  const allowed = new Set(range);
  return messages.filter((message) => allowed.has(Number(message.uid)));
}

function messageFixture(input: {
  seq: number;
  uid: number;
  date?: Date;
  flags?: string[] | Set<string>;
}) {
  return {
    seq: input.seq,
    uid: input.uid,
    envelope: {
      date:
        input.date ??
        new Date(Date.UTC(2026, 6, 28, 12, input.seq, 0, 0)),
      subject: `Message ${input.uid}`,
      messageId: `<${input.uid}@vayvyx.test>`,
      from: [{ name: "Sender", address: "sender@example.com" }],
      to: [{ name: null, address: "support@vayvyx.com" }],
    },
    flags: input.flags ?? ["\\Seen"],
    bodyStructure: {},
    source: Buffer.from(`Preview ${input.uid}`),
  };
}
