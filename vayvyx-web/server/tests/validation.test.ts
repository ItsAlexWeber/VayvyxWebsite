import { describe, expect, it } from "vitest";
import {
  createMailAccountSchema,
  rotateCredentialsSchema,
} from "../src/validation.js";

describe("mail admin validation", () => {
  it("normalizes mailbox email addresses and keeps MXRoute defaults configurable", () => {
    const parsed = createMailAccountSchema.parse({
      emailAddress: "Support@VAYVYX.com",
      displayName: "Support",
      username: "support@vayvyx.com",
      password: "temporary test password",
      imapHost: "sunfire.mxrouting.net",
      imapPort: 993,
      imapSecure: true,
      smtpHost: "sunfire.mxrouting.net",
      smtpPort: 465,
      smtpSecure: true,
      maxAttachmentMb: 25,
      initialMembers: [],
    });

    expect(parsed.emailAddress).toBe("support@vayvyx.com");
    expect(parsed.imapHost).toBe("sunfire.mxrouting.net");
    expect(parsed.smtpHost).toBe("sunfire.mxrouting.net");
  });

  it("rejects invalid ports and invalid member roles", () => {
    expect(() =>
      createMailAccountSchema.parse({
        emailAddress: "support@vayvyx.com",
        displayName: "Support",
        username: "support@vayvyx.com",
        password: "temporary test password",
        imapHost: "sunfire.mxrouting.net",
        imapPort: 70000,
        imapSecure: true,
        smtpHost: "sunfire.mxrouting.net",
        smtpPort: 465,
        smtpSecure: true,
        maxAttachmentMb: 25,
        initialMembers: [
          {
            userId: "00000000-0000-4000-8000-000000000001",
            accessRole: "administrator",
          },
        ],
      })
    ).toThrow();
  });

  it("requires a replacement password for credential rotation", () => {
    expect(() => rotateCredentialsSchema.parse({ password: "" })).toThrow();
  });
});
