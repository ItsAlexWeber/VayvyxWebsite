import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { HttpError } from "./httpError.js";

export type EncryptedMailboxCredential = {
  credential_ciphertext: string;
  credential_iv: string;
  credential_auth_tag: string;
  credential_key_version: number;
};

export type MailCredentialService = {
  encryptMailboxCredential(
    mailAccountId: string,
    plaintextPassword: string
  ): EncryptedMailboxCredential;
  decryptMailboxCredential(
    mailAccountId: string,
    encrypted: EncryptedMailboxCredential
  ): string;
};

export function parseCredentialMasterKey(value: string | undefined): Buffer {
  if (!value) {
    throw new Error("Mail credential encryption is not configured.");
  }

  let key: Buffer;
  try {
    key = Buffer.from(value, "base64");
  } catch {
    throw new Error("Mail credential encryption key is invalid.");
  }

  if (key.length !== 32 || key.toString("base64") !== value.trim()) {
    key.fill(0);
    throw new Error("Mail credential encryption key is invalid.");
  }

  return key;
}

export class AesGcmMailCredentialService implements MailCredentialService {
  constructor(private readonly masterKey: Buffer) {}

  encryptMailboxCredential(
    mailAccountId: string,
    plaintextPassword: string
  ): EncryptedMailboxCredential {
    const key = Buffer.from(this.masterKey);
    const plaintext = Buffer.from(plaintextPassword, "utf8");
    const iv = randomBytes(12);

    try {
      const cipher = createCipheriv("aes-256-gcm", key, iv, {
        authTagLength: 16,
      });
      cipher.setAAD(aad(mailAccountId, 1));
      const ciphertext = Buffer.concat([
        cipher.update(plaintext),
        cipher.final(),
      ]);
      const authTag = cipher.getAuthTag();

      return {
        credential_ciphertext: ciphertext.toString("base64"),
        credential_iv: iv.toString("base64"),
        credential_auth_tag: authTag.toString("base64"),
        credential_key_version: 1,
      };
    } finally {
      key.fill(0);
      plaintext.fill(0);
      iv.fill(0);
    }
  }

  decryptMailboxCredential(
    mailAccountId: string,
    encrypted: EncryptedMailboxCredential
  ): string {
    const key = Buffer.from(this.masterKey);
    let ciphertext: Buffer | null = null;
    let iv: Buffer | null = null;
    let authTag: Buffer | null = null;
    let plaintext: Buffer | null = null;

    try {
      ciphertext = decodeBase64(encrypted.credential_ciphertext);
      iv = decodeBase64(encrypted.credential_iv);
      authTag = decodeBase64(encrypted.credential_auth_tag);

      if (
        iv.length !== 12 ||
        authTag.length !== 16 ||
        encrypted.credential_key_version !== 1
      ) {
        throw new Error("Invalid encrypted credential record.");
      }

      const decipher = createDecipheriv("aes-256-gcm", key, iv, {
        authTagLength: 16,
      });
      decipher.setAAD(aad(mailAccountId, encrypted.credential_key_version));
      decipher.setAuthTag(authTag);
      plaintext = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);

      return plaintext.toString("utf8");
    } catch {
      throw new HttpError(
        502,
        "MAILBOX_UNAVAILABLE",
        "Mailbox credentials could not be decrypted."
      );
    } finally {
      key.fill(0);
      ciphertext?.fill(0);
      iv?.fill(0);
      authTag?.fill(0);
      plaintext?.fill(0);
    }
  }
}

function aad(mailAccountId: string, version: number) {
  return Buffer.from(`vayvyx-mail:${mailAccountId}:v${version}`, "utf8");
}

function decodeBase64(value: string) {
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value.trim()) {
    decoded.fill(0);
    throw new Error("Malformed base64.");
  }
  return decoded;
}
