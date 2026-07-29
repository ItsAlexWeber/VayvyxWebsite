import { describe, expect, it, vi } from "vitest";
import {
  AesGcmMailCredentialService,
  parseCredentialMasterKey,
} from "../src/credentialCrypto.js";

const mailboxId = "00000000-0000-4000-8000-000000000010";
const otherMailboxId = "00000000-0000-4000-8000-000000000011";

describe("mail credential encryption", () => {
  it("requires a base64-encoded 32-byte master key", () => {
    const encoded = Buffer.alloc(32, 7).toString("base64");

    expect(parseCredentialMasterKey(encoded)).toEqual(Buffer.alloc(32, 7));
    expect(() => parseCredentialMasterKey(undefined)).toThrow(
      "Mail credential encryption is not configured."
    );
    expect(() => parseCredentialMasterKey(Buffer.alloc(16).toString("base64"))).toThrow(
      "Mail credential encryption key is invalid."
    );
    expect(() => parseCredentialMasterKey("not-base64")).toThrow(
      "Mail credential encryption key is invalid."
    );
  });

  it("round-trips mailbox passwords without stable ciphertext", () => {
    const service = new AesGcmMailCredentialService(Buffer.alloc(32, 1));

    const first = service.encryptMailboxCredential(mailboxId, "mailbox password");
    const second = service.encryptMailboxCredential(mailboxId, "mailbox password");

    expect(first.credential_iv).not.toBe(second.credential_iv);
    expect(first.credential_ciphertext).not.toBe(second.credential_ciphertext);
    expect(service.decryptMailboxCredential(mailboxId, first)).toBe("mailbox password");
  });

  it("binds ciphertext to the mailbox id and rejects tampering", () => {
    const service = new AesGcmMailCredentialService(Buffer.alloc(32, 1));
    const encrypted = service.encryptMailboxCredential(mailboxId, "mailbox password");

    expect(() => service.decryptMailboxCredential(otherMailboxId, encrypted)).toThrow(
      "Mailbox credentials could not be decrypted."
    );

    expect(() =>
      service.decryptMailboxCredential(mailboxId, {
        ...encrypted,
        credential_auth_tag: Buffer.alloc(16, 9).toString("base64"),
      })
    ).toThrow("Mailbox credentials could not be decrypted.");

    expect(() =>
      service.decryptMailboxCredential(mailboxId, {
        ...encrypted,
        credential_ciphertext: "not-base64",
      })
    ).toThrow("Mailbox credentials could not be decrypted.");
  });

  it("rejects credentials encrypted with another master key", () => {
    const writer = new AesGcmMailCredentialService(Buffer.alloc(32, 1));
    const reader = new AesGcmMailCredentialService(Buffer.alloc(32, 2));
    const encrypted = writer.encryptMailboxCredential(mailboxId, "mailbox password");

    expect(() => reader.decryptMailboxCredential(mailboxId, encrypted)).toThrow(
      "Mailbox credentials could not be decrypted."
    );
  });

  it("does not log plaintext passwords on decrypt failure", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const service = new AesGcmMailCredentialService(Buffer.alloc(32, 1));
    const encrypted = service.encryptMailboxCredential(mailboxId, "very secret password");

    expect(() =>
      service.decryptMailboxCredential(mailboxId, {
        ...encrypted,
        credential_key_version: 2,
      })
    ).toThrow("Mailbox credentials could not be decrypted.");

    const logs = [...errorSpy.mock.calls, ...warnSpy.mock.calls].flat().join(" ");
    expect(logs).not.toContain("very secret password");
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
