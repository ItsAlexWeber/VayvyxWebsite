import { readFileSync } from "node:fs";
import { join } from "node:path";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { HttpError } from "../src/httpError.js";
import { ImapSmtpMailProvider } from "../src/mailProvider.js";
import {
  collectImageSources,
  importZipTemplatePackage,
} from "../src/mailTemplateImport.js";
import { canEditTemplate, canReadTemplate } from "../src/mailTemplatePermissions.js";
import {
  builtInTemplateVariables,
  escapeHtml,
  renderTemplateContent,
  sanitizeEmailTemplateHtml,
  unresolvedTemplateVariables,
} from "../src/mailTemplateSanitizer.js";

const pngBytes = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

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
  it("removes scripts, forms, handlers, and unsafe URLs while preserving email tables and safe inline CSS", () => {
    const result = sanitizeEmailTemplateHtml(`
      <table style="border-collapse:collapse;width:600px"><tbody><tr>
        <td style="padding:12px;color:#123456" onclick="x()">
          <a href="javascript:alert(1)">Bad</a>
          <form><input value="x"></form>
          <script>alert(1)</script>
          <p>Hello {{first_name}}</p>
        </td>
      </tr></tbody></table>
    `);

    expect(result.html).toContain("<table");
    expect(result.html).toContain("border-collapse:collapse");
    expect(result.html).toContain("padding:12px");
    expect(result.html).not.toContain("onclick");
    expect(result.html).not.toContain("javascript:");
    expect(result.html).not.toContain("<form");
    expect(result.html).not.toContain("<script");
    expect(result.variables).toEqual(["first_name"]);
  });

  it("rewrites approved local package images to cid references and rejects remote tracking pixels", () => {
    const assetMap = new Map([["images/logo.png", "logo@vayvyx-template"]]);
    const result = sanitizeEmailTemplateHtml(
      '<img src="images/logo.png" alt="Logo"><img src="https://tracker.example/pixel.gif" width="1" height="1">',
      { assetCidBySource: assetMap }
    );

    expect(result.html).toContain('src="cid:logo@vayvyx-template"');
    expect(result.html).not.toContain("tracker.example");
  });

  it("detects variables, escapes HTML values, and blocks unresolved variables", () => {
    const variables = { ...builtInTemplateVariables(), first_name: "<Alex>" };

    expect(escapeHtml("<Alex>")).toBe("&lt;Alex&gt;");
    expect(renderTemplateContent("Hi {{first_name}}", variables, { html: true })).toBe("Hi &lt;Alex&gt;");
    expect(
      unresolvedTemplateVariables(["{{first_name}} {{beta_link}}"], variables)
    ).toEqual(["beta_link"]);
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
