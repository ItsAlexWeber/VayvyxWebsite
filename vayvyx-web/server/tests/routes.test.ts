import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { createRoutes } from "../src/routes.js";

const auth = {
  user: { id: "00000000-0000-4000-8000-000000000001" },
  userId: "00000000-0000-4000-8000-000000000001",
  email: "admin@vayvyx.com",
  platformRole: "admin",
};

function createTestApp() {
  const closedMailboxes: string[] = [];
  const createInputs: Array<Record<string, unknown>> = [];
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    request.auth = auth as never;
    next();
  });
  app.use(
    createRoutes({
      mailAdminService: {
        createAccount: async (_auth: unknown, input: Record<string, unknown>) => {
          createInputs.push(input);
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
            from_name: null,
            reply_to_address: null,
            max_attachment_mb: 25,
            is_active: true,
            created_by: auth.userId,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
        },
        rotateCredentials: async () => ({ ok: true }),
      },
      connectionManager: {
        closeMailbox: async (mailAccountId: string) => {
          closedMailboxes.push(mailAccountId);
        },
      },
      audit: {},
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
      response.status(500).json({ error: { code: "INTERNAL_ERROR" } });
    }
  );
  return { app, closedMailboxes, createInputs };
}

describe("mail admin routes", () => {
  it("accepts a create password but never returns credentials or encryption fields", async () => {
    const { app } = createTestApp();
    const response = await request(app)
      .post("/api/mail/admin/accounts")
      .send({
        emailAddress: "support@vayvyx.com",
        displayName: "Support",
        username: "support@vayvyx.com",
        password: "mailbox password",
        imapHost: "sunfire.mxrouting.net",
        imapPort: 993,
        imapSecure: true,
        smtpHost: "sunfire.mxrouting.net",
        smtpPort: 465,
        smtpSecure: true,
        maxAttachmentMb: 25,
        initialMembers: [],
      })
      .expect(201);

    expect(JSON.stringify(response.body)).not.toContain("mailbox password");
    expect(response.body).not.toHaveProperty("credential_secret_id");
    expect(response.body).not.toHaveProperty("credential_ciphertext");
    expect(response.body).not.toHaveProperty("credential_iv");
    expect(response.body).not.toHaveProperty("credential_auth_tag");
    expect(response.body).not.toHaveProperty("credential_key_version");
  });

  it("rejects short user directory searches", async () => {
    const { app } = createTestApp();
    await request(app)
      .get("/api/mail/admin/users/search?q=a")
      .expect(400);
  });

  it("creates a mailbox when optional description and reply-to fields are blank", async () => {
    const { app, createInputs } = createTestApp();

    await request(app)
      .post("/api/mail/admin/accounts")
      .send({
        emailAddress: "support@vayvyx.com",
        displayName: "Support",
        description: "   ",
        username: "support@vayvyx.com",
        password: "mailbox password",
        imapHost: "sunfire.mxrouting.net",
        imapPort: 993,
        imapSecure: true,
        smtpHost: "sunfire.mxrouting.net",
        smtpPort: 465,
        smtpSecure: true,
        replyToAddress: "",
        maxAttachmentMb: 25,
        initialMembers: [],
      })
      .expect(201);

    expect(createInputs[0]?.description).toBeNull();
    expect(createInputs[0]?.replyToAddress).toBeNull();
  });

  it("invalidates cached mailbox connections after credential rotation", async () => {
    const { app, closedMailboxes } = createTestApp();
    const mailAccountId = "00000000-0000-4000-8000-000000000010";

    await request(app)
      .post(`/api/mail/admin/accounts/${mailAccountId}/credentials`)
      .send({ password: "replacement mailbox password" })
      .expect(200);

    expect(closedMailboxes).toEqual([mailAccountId]);
  });
});
