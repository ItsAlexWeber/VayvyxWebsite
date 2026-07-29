import { readFileSync } from "node:fs";
import { join } from "node:path";
import { zipSync } from "fflate";
import nodemailer from "nodemailer";
import { describe, expect, it } from "vitest";
import { HttpError } from "../src/httpError.js";
import { ImapSmtpMailProvider } from "../src/mailProvider.js";
import { MailTemplateService } from "../src/mailTemplateService.js";
import {
  collectImageSources,
  importZipTemplatePackage,
} from "../src/mailTemplateImport.js";
import { canEditTemplate, canReadTemplate } from "../src/mailTemplatePermissions.js";
import {
  builtInTemplateVariables,
  escapeHtml,
  htmlToPlainText,
  renderTemplateContent,
  sanitizeEmailTemplateHtml,
  unresolvedTemplateVariables,
} from "../src/mailTemplateSanitizer.js";

const pngBytes = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

const requiredBetaMarkers = [
  "Your Vayvyx access is ready.",
  "YOUR LOGIN INFORMATION",
  "GETTING STARTED",
  "How to access your account",
  "FORGOT OR NEED TO RESET YOUR PASSWORD?",
  "PRIVATE &amp; CONFIDENTIAL",
  "Welcome to the beta",
  "CONSTRUCTION INTELLIGENCE",
];

const completeBetaHtml = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @media only screen and (max-width: 640px) {
      .container { width: 100% !important; }
    }
  </style>
</head>
<body style="margin:0;background-color:#eef3f8">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eef3f8">
    <tr>
      <td align="center">
        <table class="container" role="presentation" width="640" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-collapse:collapse">
          <tr><td style="padding:32px;background-color:#101827;color:#ffffff"><h1>Your Vayvyx access is ready.</h1></td></tr>
          <tr><td style="padding:24px">Hi {{first_name}}, welcome.</td></tr>
          <tr><td style="padding:24px"><strong>Access:</strong> {{access_type}}</td></tr>
          <tr>
            <td style="padding:24px">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #d8dee9">
                <tr><td style="padding:12px;font-weight:bold">YOUR LOGIN INFORMATION</td></tr>
                <tr><td style="padding:12px">Login email: {{login_email}}</td></tr>
                <tr><td style="padding:12px">Temporary password: {{temporary_password}}</td></tr>
              </table>
            </td>
          </tr>
          <tr><td style="padding:24px"><a href="{{login_url}}" style="background-color:#101827;color:#ffffff;padding:12px 18px;text-decoration:none">How to access your account</a><p>{{login_url}}</p></td></tr>
          <tr><td style="padding:24px"><h2>GETTING STARTED</h2><p>Open your account and explore active workspaces.</p></td></tr>
          <tr><td style="padding:24px"><h2>FORGOT OR NEED TO RESET YOUR PASSWORD?</h2><p><a href="{{password_reset_url}}">{{password_reset_url}}</a></p></td></tr>
          <tr><td style="padding:24px"><strong>PRIVATE &amp; CONFIDENTIAL</strong><p>This invitation is for your organization only.</p></td></tr>
          <tr><td style="padding:24px">Welcome to the beta. Contact support@vayvyx.com for help.</td></tr>
          <tr><td style="padding:20px;text-align:center;color:#5b6575">CONSTRUCTION INTELLIGENCE</td></tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

const completeBetaText = `Your Vayvyx access is ready.
Hi {{first_name}}.
Access: {{access_type}}
YOUR LOGIN INFORMATION
Login email: {{login_email}}
Temporary password: {{temporary_password}}
How to access your account: {{login_url}}
GETTING STARTED
FORGOT OR NEED TO RESET YOUR PASSWORD?: {{password_reset_url}}
PRIVATE & CONFIDENTIAL
Welcome to the beta.
CONSTRUCTION INTELLIGENCE`;

const completeVariables = {
  first_name: "Alex",
  access_type: "Private beta",
  login_email: "alex@example.com",
  temporary_password: "safe temporary value",
  login_url: "https://vayvyx.com/login",
  password_reset_url: "https://vayvyx.com/reset-password",
};

const authContext = {
  user: { id: "00000000-0000-4000-8000-000000000001" },
  userId: "00000000-0000-4000-8000-000000000001",
  email: "person@vayvyx.com",
  platformRole: "user" as const,
};

const mailAccount = {
  id: "mailbox",
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
  credential_ciphertext: "x",
  credential_iv: "x",
  credential_auth_tag: "x",
  credential_key_version: 1,
  from_name: null,
  reply_to_address: null,
  max_attachment_mb: 25,
  is_active: true,
  created_by: "user",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe("mail template permissions", () => {
  const personal = {
    scope: "personal" as const,
    created_by: "owner",
    default_mail_account_id: null,
    is_active: true,
  };
  const company = {
    scope: "company" as const,
    created_by: "owner",
    default_mail_account_id: "mailbox",
    is_active: true,
  };
  const system = {
    scope: "system" as const,
    created_by: "system",
    default_mail_account_id: null,
    is_active: true,
  };

  it("isolates personal templates to the creator", () => {
    expect(canReadTemplate({ userId: "owner", platformRole: "user", mailboxRole: null }, personal)).toBe(true);
    expect(canReadTemplate({ userId: "other", platformRole: "admin", mailboxRole: "admin" }, personal)).toBe(false);
  });

  it("allows company templates to mailbox viewers and edits to managers", () => {
    expect(canReadTemplate({ userId: "viewer", platformRole: "user", mailboxRole: "viewer" }, company)).toBe(true);
    expect(canEditTemplate({ userId: "viewer", platformRole: "user", mailboxRole: "viewer" }, company)).toBe(false);
    expect(canEditTemplate({ userId: "manager", platformRole: "user", mailboxRole: "manager" }, company)).toBe(true);
  });

  it("allows platform admins to manage company templates but keeps system templates read-only", () => {
    expect(canReadTemplate({ userId: "admin", platformRole: "admin", mailboxRole: null }, company)).toBe(true);
    expect(canEditTemplate({ userId: "admin", platformRole: "admin", mailboxRole: null }, company)).toBe(true);
    expect(canReadTemplate({ userId: "admin", platformRole: "admin", mailboxRole: null }, system)).toBe(true);
    expect(canEditTemplate({ userId: "admin", platformRole: "admin", mailboxRole: null }, system)).toBe(false);
  });
});

describe("mail template sanitization and variables", () => {
  it("rejects scripts, forms, handlers, and unsafe URLs before canonical storage", () => {
    expect(() =>
      sanitizeEmailTemplateHtml('<table><tr><td onclick="x()">Bad</td></tr></table>')
    ).toThrow(HttpError);
    expect(() =>
      sanitizeEmailTemplateHtml('<a href="javascript:alert(1)">Bad</a>')
    ).toThrow(HttpError);
    expect(() =>
      sanitizeEmailTemplateHtml("<form><input></form>")
    ).toThrow(HttpError);
  });

  it("preserves complete HTML documents, head styles, markers, and nested tables", () => {
    const result = sanitizeEmailTemplateHtml(`
      ${completeBetaHtml}
    `);

    expect(result.html).toContain("<!doctype html>");
    expect(result.html).toContain("<head>");
    expect(result.html).toContain("<style>");
    expect(result.html).toContain("@media only screen");
    expect(result.html).toContain("<table");
    expect(result.html).toContain("GETTING STARTED");
    expect(result.html).toContain("FORGOT OR NEED TO RESET YOUR PASSWORD?");
    expect(result.html).toContain("CONSTRUCTION INTELLIGENCE");
    expect(result.html.indexOf("GETTING STARTED")).toBeGreaterThan(result.html.indexOf("YOUR LOGIN INFORMATION"));
    expect(result.variables).toContain("first_name");
  });

  it("rewrites approved local package images to cid references and rejects remote tracking pixels", () => {
    const assetMap = new Map([["images/logo.png", "logo@vayvyx-template"]]);
    const result = sanitizeEmailTemplateHtml(
      '<img src="images/logo.png" alt="Logo">',
      { assetCidBySource: assetMap }
    );

    expect(result.html).toContain('src="cid:logo@vayvyx-template"');
    expect(() =>
      sanitizeEmailTemplateHtml('<img src="https://tracker.example/pixel.gif" width="1" height="1">')
    ).toThrow(HttpError);
  });

  it("detects variables, escapes HTML values, and blocks unresolved variables", () => {
    const variables = { ...builtInTemplateVariables(), first_name: "<Alex>" };

    expect(escapeHtml("<Alex>")).toBe("&lt;Alex&gt;");
    expect(renderTemplateContent("Hi {{first_name}}", variables, { html: true })).toBe("Hi &lt;Alex&gt;");
    expect(renderTemplateContent("{{missing}}", variables, { html: true })).toBe("{{missing}}");
    expect(
      unresolvedTemplateVariables(["{{first_name}} {{beta_link}}"], variables)
    ).toEqual(["beta_link"]);
  });

  it("populates placeholders globally without flattening HTML or appending the text fallback", () => {
    const rendered = renderTemplateContent(completeBetaHtml, {
      first_name: "Alex <Beta>",
      access_type: "Private & Field",
      login_email: "alex@example.com",
      temporary_password: 'p&<>"',
      login_url: "https://vayvyx.com/login?next=beta&source=email",
      password_reset_url: "https://vayvyx.com/reset-password",
    }, { html: true });

    for (const marker of requiredBetaMarkers) {
      expect(rendered).toContain(marker);
    }
    expect(rendered).toContain("Alex &lt;Beta&gt;");
    expect(rendered).toContain("Private &amp; Field");
    expect(rendered).toContain("p&amp;&lt;&gt;&quot;");
    expect(rendered).toContain('href="https://vayvyx.com/login?next=beta&amp;source=email"');
    expect(rendered).not.toContain(completeBetaText);
  });

  it("derives a readable plain-text fallback from rendered template HTML", () => {
    expect(
      htmlToPlainText('<table><tr><td style="padding:12px">Hello</td></tr></table><p>Open <a href="https://vayvyx.com/login">Vayvyx</a></p>')
    ).toBe("Hello\nOpen Vayvyx");
  });
});

describe("mail template storage and MIME integrity", () => {
  it("stores and retrieves complete canonical HTML separately from the plain-text fallback", async () => {
    const { service, rows } = createTemplateServiceHarness();
    const created = await service.createTemplate(authContext, {
      name: "vayvyx-beta-access-ready",
      description: null,
      subjectTemplate: "Your Vayvyx Private Beta Access Is Ready",
      htmlContent: completeBetaHtml,
      plainTextContent: completeBetaText,
      scope: "personal",
      defaultMailAccountId: null,
    });
    const retrieved = await service.getTemplate(authContext, created.id);

    expect(rows[0].html_content).toBe(completeBetaHtml);
    expect(retrieved.htmlContent).toBe(completeBetaHtml);
    expect(retrieved.plainTextContent).toBe(completeBetaText);
    expect(retrieved.htmlContent).not.toContain(completeBetaText);
  });

  it("blocks unresolved placeholders and unsafe URL variables before send rendering", async () => {
    const { service } = createTemplateServiceHarness();
    const created = await service.createTemplate(authContext, {
      name: "vayvyx-beta-access-ready",
      description: null,
      subjectTemplate: "Your Vayvyx Private Beta Access Is Ready",
      htmlContent: completeBetaHtml,
      plainTextContent: completeBetaText,
      scope: "personal",
      defaultMailAccountId: null,
    });

    await expect(
      service.renderTemplateForSend(authContext, created.id, {
        ...completeVariables,
        temporary_password: "",
      })
    ).rejects.toMatchObject({ code: "UNRESOLVED_VARIABLES" });

    await expect(
      service.renderTemplateForSend(authContext, created.id, {
        ...completeVariables,
        login_url: "http://vayvyx.com/login",
      })
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("builds multipart/alternative source with complete HTML and separate text", async () => {
    let rawMessage = "";
    const streamTransporter = nodemailer.createTransport({
      streamTransport: true,
      buffer: true,
    });
    const provider = new ImapSmtpMailProvider({
      withImapClient: async () => {
        throw new Error("not used");
      },
      createSmtpTransport: async () => ({
        sendMail: async (input: Parameters<typeof streamTransporter.sendMail>[0]) => {
          const result = await streamTransporter.sendMail(input);
          rawMessage = Buffer.isBuffer(result.message)
            ? result.message.toString("utf8")
            : String(result.message);
          return result;
        },
      } as never),
    });

    await provider.sendMessage(
      mailAccount,
      {
        mode: "compose",
        to: ["person@example.com"],
        cc: [],
        bcc: [],
        subject: "Template",
        textBody: renderTemplateContent(completeBetaText, completeVariables, { html: false }),
        sanitizedHtmlBody: renderTemplateContent(completeBetaHtml, completeVariables, { html: true }),
        references: [],
      },
      []
    );

    const readableRaw = normalizeQuotedPrintableSource(rawMessage);
    expect(readableRaw).toContain("Content-Type: multipart/alternative;");
    expect(readableRaw).toContain("Content-Type: text/plain;");
    expect(readableRaw).toContain("Content-Type: text/html;");
    expect(readableRaw).toContain("GETTING STARTED");
    expect(readableRaw).toContain("FORGOT OR NEED TO RESET YOUR PASSWORD?");
    expect(readableRaw).toContain("PRIVATE &amp; CONFIDENTIAL");
    expect(readableRaw).toContain("CONSTRUCTION INTELLIGENCE");
    expect(readableRaw).not.toContain(`${completeVariables.login_email}\r\n${completeBetaHtml}`);
  });
});

describe("mail template imports and CID assets", () => {
  it("imports a ZIP package with a primary HTML file, plain text, and relative image asset", () => {
    const archive = Buffer.from(zipSync({
      "index.html": Buffer.from('<table><tr><td><img src="images/logo.png"></td></tr></table>'),
      "index.txt": Buffer.from("Hello"),
      "images/logo.png": pngBytes,
    }));

    const imported = importZipTemplatePackage({
      originalname: "template.zip",
      buffer: archive,
    });

    expect(imported.html).toContain("images/logo.png");
    expect(imported.plainText).toBe("Hello");
    expect(imported.assets).toHaveLength(1);
    expect(imported.assets[0]).toMatchObject({
      filename: "logo.png",
      contentType: "image/png",
    });
    expect(imported.assets[0].cid).toMatch(/@vayvyx-template$/);
  });

  it("rejects traversal, executable files, unsupported assets, and unsupported package types", () => {
    expect(() =>
      importZipTemplatePackage({
        originalname: "bad.zip",
        buffer: Buffer.from(zipSync({ "../index.html": Buffer.from("<p>x</p>") })),
      })
    ).toThrow(HttpError);

    expect(() =>
      importZipTemplatePackage({
        originalname: "bad.zip",
        buffer: Buffer.from(zipSync({ "index.html": Buffer.from("<p>x</p>"), "run.exe": Buffer.from("x") })),
      })
    ).toThrow(HttpError);

    expect(() =>
      importZipTemplatePackage({
        originalname: "bad.zip",
        buffer: Buffer.from(zipSync({ "index.html": Buffer.from('<img src="logo.svg">'), "logo.svg": Buffer.from("<svg />") })),
      })
    ).toThrow(HttpError);
  });

  it("collects relative image sources without storing asset bytes in browser storage", () => {
    expect(collectImageSources('<img src="./a.png"><img src="images/b.webp">')).toEqual([
      "./a.png",
      "images/b.webp",
    ]);
  });

  it("sends template assets as inline CID attachments", async () => {
    let capturedAttachments: unknown[] = [];
    const provider = new ImapSmtpMailProvider({
      withImapClient: async () => {
        throw new Error("not used");
      },
      createSmtpTransport: async () => ({
        sendMail: async (input: { attachments?: unknown[] }) => {
          capturedAttachments = input.attachments ?? [];
          return { messageId: "<sent@vayvyx.test>" };
        },
      } as never),
    });

    await provider.sendMessage(
      {
        id: "mailbox",
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
        credential_ciphertext: "x",
        credential_iv: "x",
        credential_auth_tag: "x",
        credential_key_version: 1,
        from_name: null,
        reply_to_address: null,
        max_attachment_mb: 25,
        is_active: true,
        created_by: "user",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        mode: "compose",
        to: ["person@example.com"],
        cc: [],
        bcc: [],
        subject: "Template",
        textBody: "Template",
        sanitizedHtmlBody: '<img src="cid:logo@vayvyx-template">',
        references: [],
        inlineTemplateAssets: [
          {
            cid: "logo@vayvyx-template",
            filename: "logo.png",
            contentType: "image/png",
            contentBase64: pngBytes.toString("base64"),
          },
        ],
      },
      []
    );

    expect(capturedAttachments).toEqual([
      expect.objectContaining({
        cid: "logo@vayvyx-template",
        contentType: "image/png",
        contentDisposition: "inline",
      }),
    ]);
  });
});

describe("mail template migration", () => {
  const migration = readFileSync(
    join(process.cwd(), "supabase/migrations/202607290001_mail_templates.sql"),
    "utf8"
  );

  it("creates RLS-protected template and asset tables without granting asset bytes to browser users", () => {
    expect(migration).toContain("create table if not exists public.mail_templates");
    expect(migration).toContain("create table if not exists public.mail_template_assets");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("can_read_mail_template");
    expect(migration).toContain("can_edit_mail_template");
    expect(migration).not.toMatch(/grant select \([^)]*content_base64/is);
  });
});

function createTemplateServiceHarness() {
  const rows: Array<Record<string, unknown>> = [];
  const assets: Array<Record<string, unknown>> = [];

  const admin = {
    from(table: string) {
      const filters: Array<{ column: string; value: unknown }> = [];
      let inserted: Record<string, unknown> | null = null;

      const builder = {
        insert(value: Record<string, unknown>) {
          const now = new Date().toISOString();
          inserted = {
            id: `00000000-0000-4000-8000-${String(rows.length + 1).padStart(12, "0")}`,
            updated_at: now,
            created_at: now,
            ...value,
          };
          if (table === "mail_templates") rows.push(inserted);
          return builder;
        },
        select() {
          return builder;
        },
        eq(column: string, value: unknown) {
          filters.push({ column, value });
          return builder;
        },
        single() {
          return Promise.resolve({ data: inserted, error: null });
        },
        maybeSingle() {
          return Promise.resolve({
            data: rows.find((row) => filters.every((filter) => row[filter.column] === filter.value)) ?? null,
            error: null,
          });
        },
        order() {
          return Promise.resolve({
            data: assets.filter((row) => filters.every((filter) => row[filter.column] === filter.value)),
            error: null,
          });
        },
      };

      return builder;
    },
  };

  return {
    rows,
    service: new MailTemplateService(
      admin as never,
      { record: async () => undefined }
    ),
  };
}

function normalizeQuotedPrintableSource(value: string) {
  return value
    .replace(/=\r?\n/g, "")
    .replace(/=3D/g, "=");
}
