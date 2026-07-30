import { describe, expect, it, vi } from "vitest";
import { AuthEmailService } from "../src/authEmailService.js";
import type { AuthContext } from "../src/types.js";

describe("custom authentication email delivery", () => {
  it("generates recovery links server-side and sends one branded email through support SMTP", async () => {
    const fake = createAuthEmailHarness();
    const service = new AuthEmailService(fake.admin as never, fake.templateService as never, fake.smtpFactory as never);

    await service.sendPublicPasswordReset("PERSON@VAYVYX.COM", "https://vayvyx.com/reset-password");

    expect(fake.generatedLinks).toEqual([
      {
        type: "recovery",
        email: "person@vayvyx.com",
        redirectTo: "https://vayvyx.com/reset-password",
      },
    ]);
    expect(fake.sentMessages).toHaveLength(1);
    expect(fake.sentMessages[0]).toMatchObject({
      from: '"Vayvyx Support" <support@vayvyx.com>',
      to: "person@vayvyx.com",
    });
    expect(JSON.stringify(fake.deliveryRows)).not.toContain("action_link");
    expect(JSON.stringify(fake.deliveryRows)).not.toContain("token_hash");
  });

  it("prevents duplicate sends during the auth-email cooldown", async () => {
    const fake = createAuthEmailHarness({
      deliveryRows: [
        {
          id: "recent",
          email_type: "auth_password_reset",
          target_email_hash:
            "7e08b2d70a42087d69f80ec49c232a7943dc6e7750bd1bc95004eaeb151d708c",
          created_at: new Date().toISOString(),
        },
      ],
    });
    const service = new AuthEmailService(fake.admin as never, fake.templateService as never, fake.smtpFactory as never);

    await service.sendPublicPasswordReset("person@vayvyx.com", "https://vayvyx.com/reset-password");

    expect(fake.sentMessages).toHaveLength(0);
  });

  it("does not undo password changes when notification delivery fails", async () => {
    const fake = createAuthEmailHarness({ failSmtp: true });
    const service = new AuthEmailService(fake.admin as never, fake.templateService as never, fake.smtpFactory as never);

    await expect(
      service.sendPasswordChangedNotification(authContext())
    ).resolves.toEqual({ ok: true });
    expect(fake.deliveryRows.some((row) => row.status === "failed")).toBe(true);
  });
});

function createAuthEmailHarness(options: {
  deliveryRows?: Array<Record<string, unknown>>;
  failSmtp?: boolean;
} = {}) {
  const supportAccount = {
    id: "support-mailbox",
    email_address: "support@vayvyx.com",
    display_name: "Support",
    description: null,
    imap_host: "imap.example.com",
    imap_port: 993,
    imap_secure: true,
    smtp_host: "smtp.example.com",
    smtp_port: 465,
    smtp_secure: true,
    username: "support@vayvyx.com",
    from_name: "Vayvyx Support",
    reply_to_address: null,
    max_attachment_mb: 25,
    is_active: true,
    created_by: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    credential_ciphertext: "cipher",
    credential_iv: "iv",
    credential_auth_tag: "tag",
    credential_key_version: 1,
  };
  const deliveryRows = [...(options.deliveryRows ?? [])];
  const generatedLinks: Array<{ type: string; email: string; redirectTo?: string }> = [];
  const sentMessages: Array<Record<string, unknown>> = [];

  const admin = {
    auth: {
      admin: {
        listUsers: vi.fn(async () => ({
          data: {
            users: [
              {
                id: "person-user",
                email: "person@vayvyx.com",
                user_metadata: { full_name: "Person User" },
              },
            ],
          },
          error: null,
        })),
        generateLink: vi.fn(async (input: {
          type: string;
          email: string;
          options?: { redirectTo?: string };
        }) => {
          generatedLinks.push({
            type: input.type,
            email: input.email,
            redirectTo: input.options?.redirectTo,
          });
          return {
            data: {
              user: { id: "person-user", email: input.email },
              properties: {
                action_link: `https://project.supabase.co/auth/v1/verify?type=${input.type}&token_hash=secret`,
              },
            },
            error: null,
          };
        }),
      },
    },
    from(table: string) {
      if (table === "mail_accounts") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: supportAccount, error: null }),
              }),
            }),
          }),
        };
      }

      if (table === "auth_email_delivery_log") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                gte: () => ({
                  limit: async () => ({ data: deliveryRows, error: null }),
                }),
              }),
            }),
          }),
          insert: async (row: Record<string, unknown>) => {
            deliveryRows.push(row);
            return { data: row, error: null };
          },
        };
      }

      if (table === "profiles") {
        return {
          update: () => ({
            eq: async () => ({ data: null, error: null }),
          }),
        };
      }

      return {
        insert: async () => ({ data: null, error: null }),
      };
    },
  };

  const templateService = {
    renderSystemTemplateForSend: vi.fn(async (_key: string, variables: Record<string, string>) => ({
      templateId: "template-id",
      subject: "Vayvyx authentication",
      htmlContent: `<a href="${variables.action_url}">${variables.action_label || "Notification"}</a>`,
      plainTextContent: variables.action_url || "Password changed",
      unresolvedVariables: [],
      inlineAssets: [],
    })),
  };

  const smtpFactory = {
    createSmtpTransport: vi.fn(async () => ({
      sendMail: vi.fn(async (message: Record<string, unknown>) => {
        if (options.failSmtp) throw new Error("smtp failed action_link=secret");
        sentMessages.push(message);
        return { messageId: "provider-message" };
      }),
      close: vi.fn(),
    })),
  };

  return {
    admin,
    templateService,
    smtpFactory,
    generatedLinks,
    sentMessages,
    deliveryRows,
  };
}

function authContext(): AuthContext {
  return {
    user: {
      id: "person-user",
      email: "person@vayvyx.com",
      user_metadata: { full_name: "Person User" },
    } as never,
    userId: "person-user",
    email: "person@vayvyx.com",
    platformRole: "user",
    accessType: "beta",
    accountStatus: "active",
    setupCompletedAt: "2026-07-01T00:00:00.000Z",
    mustSetPassword: false,
    accessExpiresAt: null,
  };
}
