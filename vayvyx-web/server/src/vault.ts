import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./httpError.js";

export interface MailCredentialVault {
  createMailboxSecret(input: {
    mailAccountId?: string;
    emailAddress: string;
    password: string;
  }): Promise<string>;
  rotateMailboxSecret(input: {
    secretId: string;
    emailAddress: string;
    password: string;
  }): Promise<void>;
  readMailboxSecret(secretId: string): Promise<string>;
  deleteMailboxSecret(secretId: string): Promise<void>;
}

export class SupabaseVaultMailCredentialVault implements MailCredentialVault {
  constructor(private readonly admin: SupabaseClient) {}

  async createMailboxSecret(input: {
    mailAccountId?: string;
    emailAddress: string;
    password: string;
  }) {
    const secretName = `mail:${input.emailAddress}:${crypto.randomUUID()}`;
    const { data, error } = await this.admin.rpc(
      "mail_vault_create_secret",
      {
        p_secret: input.password,
        p_name: secretName,
        p_description: `Vayvyx Mail credential for ${input.emailAddress}`,
      }
    );

    if (error || typeof data !== "string") {
      throw new HttpError(
        502,
        "MAILBOX_UNAVAILABLE",
        "Unable to store mailbox credentials in Supabase Vault."
      );
    }

    return data;
  }

  async rotateMailboxSecret(input: {
    secretId: string;
    emailAddress: string;
    password: string;
  }) {
    const { error } = await this.admin.rpc("mail_vault_update_secret", {
      p_secret_id: input.secretId,
      p_secret: input.password,
      p_name: `mail:${input.emailAddress}:${input.secretId}`,
      p_description: `Rotated Vayvyx Mail credential for ${input.emailAddress}`,
    });

    if (error) {
      throw new HttpError(
        502,
        "MAILBOX_UNAVAILABLE",
        "Unable to rotate mailbox credentials in Supabase Vault."
      );
    }
  }

  async readMailboxSecret(secretId: string) {
    const { data, error } = await this.admin.rpc("mail_vault_read_secret", {
      p_secret_id: secretId,
    });

    if (error || typeof data !== "string" || !data) {
      throw new HttpError(
        502,
        "MAILBOX_UNAVAILABLE",
        "Unable to read mailbox credentials from Vault."
      );
    }

    return data;
  }

  async deleteMailboxSecret(secretId: string) {
    const { error } = await this.admin.rpc("mail_vault_delete_secret", {
      p_secret_id: secretId,
    });

    if (error) {
      console.error("Unable to delete compensated mailbox Vault secret.");
    }
  }
}
