import type { SupabaseClient } from "@supabase/supabase-js";
import { hasMailboxRole } from "./auth.js";
import { HttpError } from "./httpError.js";
import type {
  AuthContext,
  MailAccountPrivate,
  MailAccountSafe,
  MailboxAccessRole,
} from "./types.js";
import type { MailAccountSummary } from "./mailApiTypes.js";
import type { MailAccessSummary } from "./dto.js";

const safeAccountColumns = [
  "id",
  "email_address",
  "display_name",
  "description",
  "imap_host",
  "imap_port",
  "imap_secure",
  "smtp_host",
  "smtp_port",
  "smtp_secure",
  "username",
  "from_name",
  "reply_to_address",
  "max_attachment_mb",
  "is_active",
  "created_by",
  "created_at",
  "updated_at",
].join(",");

const privateAccountColumns = `${safeAccountColumns},credential_ciphertext,credential_iv,credential_auth_tag,credential_key_version`;

export type AuthorizedMailbox = {
  account: MailAccountPrivate;
  role: MailboxAccessRole | "admin";
};

export class MailAuthorizationService {
  constructor(private readonly admin: SupabaseClient) {}

  async getAccessSummary(auth: AuthContext): Promise<MailAccessSummary> {
    if (auth.platformRole === "admin") {
      const { count, error } = await this.admin
        .from("mail_accounts")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true);

      if (error) {
        throw new HttpError(500, "INTERNAL_ERROR", "Unable to load mail access.");
      }

      return {
        authenticated: true,
        platformAdmin: true,
        hasMailAccess: (count ?? 0) > 0,
        mailboxCount: count ?? 0,
      };
    }

    const { count, error } = await this.admin
      .from("mail_account_members")
      .select("mail_account_id, mail_accounts!inner(id)", {
        count: "exact",
        head: true,
      })
      .eq("user_id", auth.userId)
      .eq("mail_accounts.is_active", true);

    if (error) {
      throw new HttpError(500, "INTERNAL_ERROR", "Unable to load mail access.");
    }

    return {
      authenticated: true,
      platformAdmin: false,
      hasMailAccess: (count ?? 0) > 0,
      mailboxCount: count ?? 0,
    };
  }

  async listAccessibleAccounts(auth: AuthContext): Promise<MailAccountSummary[]> {
    if (auth.platformRole === "admin") {
      const { data, error } = await this.admin
        .from("mail_accounts")
        .select(safeAccountColumns)
        .eq("is_active", true)
        .order("email_address", { ascending: true });

      if (error) {
        throw new HttpError(500, "INTERNAL_ERROR", "Unable to load mailboxes.");
      }

      return (data ?? []).map((account) =>
        toAccountSummary(account as unknown as MailAccountSafe, "admin")
      );
    }

    const { data, error } = await this.admin
      .from("mail_account_members")
      .select(`access_role, mail_accounts!inner(${safeAccountColumns})`)
      .eq("user_id", auth.userId)
      .eq("mail_accounts.is_active", true);

    if (error) {
      throw new HttpError(500, "INTERNAL_ERROR", "Unable to load mailboxes.");
    }

    const rows = (data ?? []) as unknown as Array<{
      access_role: MailboxAccessRole;
      mail_accounts: MailAccountSafe;
    }>;

    return rows.map((row) =>
      toAccountSummary(
        row.mail_accounts,
        row.access_role
      )
    );
  }

  async requireMailboxRole(
    auth: AuthContext,
    mailAccountId: string,
    requiredRole: MailboxAccessRole,
    options: { requireActive?: boolean } = { requireActive: true }
  ): Promise<AuthorizedMailbox> {
    const account = await this.getPrivateAccount(mailAccountId);

    if (options.requireActive !== false && !account.is_active) {
      throw new HttpError(403, "MAILBOX_INACTIVE", "Mailbox is inactive.");
    }

    if (auth.platformRole === "admin") {
      return { account, role: "admin" };
    }

    const { data, error } = await this.admin
      .from("mail_account_members")
      .select("access_role")
      .eq("mail_account_id", mailAccountId)
      .eq("user_id", auth.userId)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, "INTERNAL_ERROR", "Unable to verify mailbox access.");
    }

    if (!data || !hasMailboxRole(data.access_role, requiredRole)) {
      throw new HttpError(403, "ACCESS_DENIED", "Mailbox access is denied.");
    }

    return { account, role: data.access_role };
  }

  async getIdentityForSend(mailAccountId: string, identityId?: string) {
    if (!identityId) return null;

    const { data, error } = await this.admin
      .from("mail_identities")
      .select("id,mail_account_id,email_address,display_name,reply_to_address,is_active")
      .eq("id", identityId)
      .eq("mail_account_id", mailAccountId)
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, "INTERNAL_ERROR", "Unable to verify sender identity.");
    }

    if (!data) {
      throw new HttpError(403, "ACCESS_DENIED", "Sender identity is not allowed.");
    }

    return data as unknown as {
      id: string;
      email_address: string;
      display_name: string | null;
      reply_to_address: string | null;
    };
  }

  private async getPrivateAccount(mailAccountId: string) {
    const { data, error } = await this.admin
      .from("mail_accounts")
      .select(privateAccountColumns)
      .eq("id", mailAccountId)
      .maybeSingle();

    if (error || !data) {
      throw new HttpError(404, "MAILBOX_NOT_FOUND", "Mail account was not found.");
    }

    return data as unknown as MailAccountPrivate;
  }
}

function toAccountSummary(
  account: MailAccountSafe,
  currentUserRole: MailboxAccessRole | "admin"
): MailAccountSummary {
  return {
    id: account.id,
    emailAddress: account.email_address,
    displayName: account.display_name,
    description: account.description,
    fromName: account.from_name,
    replyToAddress: account.reply_to_address,
    maxAttachmentMb: account.max_attachment_mb,
    currentUserRole,
    isActive: account.is_active,
    connectionStatus: "unknown",
  };
}
