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
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    request.auth = auth as never;
    next();
  });
  app.use(
    createRoutes({
      mailAdminService: {
        createAccount: async () => ({
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
        }),
      },
      connectionManager: {},
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
  return app;
}

describe("mail admin routes", () => {
  it("accepts a create password but never returns credentials or Vault ids", async () => {
    const response = await request(createTestApp())
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
  });

  it("rejects short user directory searches", async () => {
    await request(createTestApp())
      .get("/api/mail/admin/users/search?q=a")
      .expect(400);
  });
});
