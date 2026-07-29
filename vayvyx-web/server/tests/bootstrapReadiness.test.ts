import { describe, expect, it } from "vitest";
import { MailAuthorizationService } from "../src/mailAuthorizationService.js";
import { MailAdminService } from "../src/mailAdminService.js";

const adminAuth = {
  user: { id: "00000000-0000-4000-8000-000000000001" },
  userId: "00000000-0000-4000-8000-000000000001",
  email: "admin@example.com",
  platformRole: "admin",
} as never;

const userAuth = {
  ...adminAuth,
  platformRole: "user",
} as never;

describe("zero-mailbox access bootstrap", () => {
  it("allows platform admin metadata with zero mailboxes", async () => {
    const service = new MailAuthorizationService(countingAdmin(0));
    await expect(service.getAccessSummary(adminAuth)).resolves.toEqual({
      authenticated: true,
      platformAdmin: true,
      hasMailAccess: false,
      mailboxCount: 0,
    });
  });

  it("reports normal users with zero mailboxes as no access", async () => {
    const service = new MailAuthorizationService(countingAdmin(0));
    await expect(service.getAccessSummary(userAuth)).resolves.toEqual({
      authenticated: true,
      platformAdmin: false,
      hasMailAccess: false,
      mailboxCount: 0,
    });
  });

  it("reports assigned users with mail access", async () => {
    const service = new MailAuthorizationService(countingAdmin(1));
    await expect(service.getAccessSummary(userAuth)).resolves.toMatchObject({
      platformAdmin: false,
      hasMailAccess: true,
      mailboxCount: 1,
    });
  });

  it("reports platform admins with configured mailboxes as both admin and mail access", async () => {
    const service = new MailAuthorizationService(countingAdmin(2));
    await expect(service.getAccessSummary(adminAuth)).resolves.toMatchObject({
      platformAdmin: true,
      hasMailAccess: true,
      mailboxCount: 2,
    });
  });
});

describe("mailbox creation readiness", () => {
  it("creates a default identity and owner membership for a new mailbox", async () => {
    const inserts: Array<{ table: string; row: unknown }> = [];
    const service = new MailAdminService(
      creationAdmin({ inserts }),
      vaultRecorder(),
      { record: async () => undefined } as never
    );

    await service.createAccount(adminAuth, createInput(), "127.0.0.1");

    expect(inserts.some((item) => item.table === "mail_identities")).toBe(true);
    expect(JSON.stringify(inserts)).toContain('"is_default":true');
    expect(JSON.stringify(inserts)).toContain('"access_role":"owner"');
  });

  it("compensates Vault and account rows when default identity creation fails", async () => {
    const deleted: string[] = [];
    const vaultDeleted: string[] = [];
    const service = new MailAdminService(
      creationAdmin({ failIdentity: true, deleted }),
      vaultRecorder(vaultDeleted),
      { record: async () => undefined } as never
    );

    await expect(
      service.createAccount(adminAuth, createInput(), "127.0.0.1")
    ).rejects.toThrow("Mailbox default identity could not be created.");

    expect(deleted).toContain("mail_accounts");
    expect(vaultDeleted).toContain("00000000-0000-4000-8000-000000000099");
  });
});

function countingAdmin(count: number) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () =>
          table === "mail_accounts"
            ? Promise.resolve({ count, error: null })
            : {
                eq: async () => ({ count, error: null }),
              },
      }),
    }),
  } as never;
}

function creationAdmin(options: {
  inserts?: Array<{ table: string; row: unknown }>;
  failIdentity?: boolean;
  deleted?: string[];
}) {
  return {
    from: (table: string) => ({
      insert: (row: unknown) => {
        options.inserts?.push({ table, row });
        if (table === "mail_accounts") {
          return {
            select: () => ({
              single: async () => ({
                data: accountRow(),
                error: null,
              }),
            }),
          };
        }
        return Promise.resolve({
          data: null,
          error: options.failIdentity && table === "mail_identities" ? new Error("identity failed") : null,
        });
      },
      delete: () => ({
        eq: async () => {
          options.deleted?.push(table);
          return { error: null };
        },
      }),
    }),
  } as never;
}

function vaultRecorder(deleted: string[] = []) {
  return {
    createMailboxSecret: async () => "00000000-0000-4000-8000-000000000099",
    rotateMailboxSecret: async () => undefined,
    readMailboxSecret: async () => "secret",
    deleteMailboxSecret: async (secretId: string) => {
      deleted.push(secretId);
    },
  };
}

function accountRow() {
  return {
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
    from_name: "Vayvyx Support",
    reply_to_address: null,
    max_attachment_mb: 25,
    is_active: true,
    created_by: "00000000-0000-4000-8000-000000000001",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function createInput() {
  return {
    emailAddress: "support@vayvyx.com",
    displayName: "Support",
    description: null,
    username: "support@vayvyx.com",
    password: "test password",
    imapHost: "sunfire.mxrouting.net",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "sunfire.mxrouting.net",
    smtpPort: 465,
    smtpSecure: true,
    fromName: "Vayvyx Support",
    replyToAddress: null,
    maxAttachmentMb: 25,
    initialMembers: [],
  };
}
