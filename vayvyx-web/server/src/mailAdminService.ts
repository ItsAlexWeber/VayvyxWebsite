import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { HttpError } from "./httpError.js";
import type { AuditLogger } from "./audit.js";
import { hasMailboxRole } from "./auth.js";
import type {
  AuthContext,
  MailAccountPrivate,
  MailAccountMember,
  MailAccountSafe,
  MailboxAccessRole,
} from "./types.js";
import type { MailCredentialService } from "./credentialCrypto.js";
import { toAdminAccountDto, toMemberDto } from "./dto.js";
import type { MailAdminUserSearchResult } from "./dto.js";
import type {
  addMemberSchema,
  createMailAccountSchema,
  updateMailAccountSchema,
} from "./validation.js";
import type { z } from "zod";

type CreateMailAccountInput = z.infer<typeof createMailAccountSchema>;
type UpdateMailAccountInput = z.infer<typeof updateMailAccountSchema>;
type AddMemberInput = z.infer<typeof addMemberSchema>;

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

export class MailAdminService {
  constructor(
    private readonly admin: SupabaseClient,
    private readonly credentialService: MailCredentialService,
    private readonly audit: AuditLogger
  ) {}

  async listAdminAccounts(auth: AuthContext) {
    if (auth.platformRole !== "admin") {
      throw new HttpError(403, "ACCESS_DENIED", "Platform administrator access is required.");
    }

    const { data, error } = await this.admin
      .from("mail_accounts")
      .select(
        `${safeAccountColumns}, mail_account_members(id,user_id,access_role,created_at,updated_at)`
      )
      .order("email_address", { ascending: true });

    if (error) {
      throw new HttpError(500, "INTERNAL_ERROR", "Unable to load mail accounts.");
    }

    return (data ?? []).map((account) =>
      toAdminAccountDto(account as unknown as MailAccountSafe & {
        mail_account_members?: MailAccountMember[];
      })
    );
  }

  async searchUsers(
    auth: AuthContext,
    query: string
  ): Promise<MailAdminUserSearchResult[]> {
    if (auth.platformRole !== "admin") {
      throw new HttpError(
        403,
        "ACCESS_DENIED",
        "Platform administrator access is required."
      );
    }

    const { data, error } = await this.admin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });

    if (error) {
      throw new HttpError(500, "INTERNAL_ERROR", "Unable to search users.");
    }

    const lower = query.toLowerCase();

    return data.users
      .filter((user) => user.email?.toLowerCase().includes(lower))
      .slice(0, 20)
      .map((user) => ({
        id: user.id,
        email: user.email ?? "",
        displayName:
          typeof user.user_metadata?.display_name === "string"
            ? user.user_metadata.display_name
            : null,
      }));
  }

  async createAccount(
    auth: AuthContext,
    input: CreateMailAccountInput,
    ipAddress?: string | null
  ) {
    if (auth.platformRole !== "admin") {
      throw new HttpError(403, "ACCESS_DENIED", "Only platform admins may create mailboxes.");
    }

    const mailAccountId = randomUUID();
    const encryptedCredential =
      this.credentialService.encryptMailboxCredential(
        mailAccountId,
        input.password
      );

    let createdAccount: MailAccountSafe | null = null;

    try {
      const { data: account, error } = await this.admin
        .from("mail_accounts")
        .insert({
          email_address: input.emailAddress,
          id: mailAccountId,
          display_name: input.displayName,
          description: input.description,
          imap_host: input.imapHost,
          imap_port: input.imapPort,
          imap_secure: input.imapSecure,
          smtp_host: input.smtpHost,
          smtp_port: input.smtpPort,
          smtp_secure: input.smtpSecure,
          username: input.username,
          ...encryptedCredential,
          from_name: input.fromName,
          reply_to_address: input.replyToAddress,
          max_attachment_mb: input.maxAttachmentMb,
          is_active: input.isActive ?? true,
          created_by: auth.userId,
        })
        .select(safeAccountColumns)
        .single();

      if (error || !account) {
        throw new HttpError(400, "INVALID_REQUEST", "Unable to create mail account.", error);
      }

      createdAccount = account as unknown as MailAccountSafe;

      const { error: identityError } = await this.admin
        .from("mail_identities")
        .insert({
          mail_account_id: createdAccount.id,
          email_address: createdAccount.email_address,
          display_name: createdAccount.from_name ?? createdAccount.display_name,
          reply_to_address: createdAccount.reply_to_address,
          is_default: true,
          is_active: true,
        });

      if (identityError) {
        throw new HttpError(
          400,
          "INVALID_REQUEST",
          "Mailbox default identity could not be created.",
          identityError
        );
      }

      const membershipRows =
        input.initialMembers.length > 0
          ? input.initialMembers
          : [{ userId: auth.userId, accessRole: "owner" as const }];

      const rows = membershipRows.map((member) => ({
        mail_account_id: createdAccount!.id,
        user_id: member.userId,
        access_role: member.accessRole,
        created_by: auth.userId,
      }));

      const { error: memberError } = await this.admin
        .from("mail_account_members")
        .insert(rows);

      if (memberError) {
        throw new HttpError(
          400,
          "INVALID_REQUEST",
          "Mailbox members could not be assigned.",
          memberError
        );
      }
    } catch (error) {
      if (createdAccount) {
        await this.admin
          .from("mail_accounts")
          .delete()
          .eq("id", createdAccount.id);
      }

      throw error;
    }

    await this.audit.record({
      actorUserId: auth.userId,
      mailAccountId: createdAccount.id,
      action: "mailbox_created",
      targetType: "mail_account",
      targetIdentifier: createdAccount.email_address,
      metadata: {
        initialMemberCount:
          input.initialMembers.length > 0 ? input.initialMembers.length : 1,
        defaultIdentityCreated: true,
      },
      ipAddress,
    });

    return toAdminAccountDto(createdAccount);
  }

  async updateAccount(
    auth: AuthContext,
    mailAccountId: string,
    input: UpdateMailAccountInput,
    ipAddress?: string | null
  ) {
    await this.requireMailboxAdmin(auth, mailAccountId);

    const previous = await this.getPrivateAccount(mailAccountId);
    const patch = mapAccountPatch(input);

    const { data: account, error } = await this.admin
      .from("mail_accounts")
      .update(patch)
      .eq("id", mailAccountId)
      .select(safeAccountColumns)
      .single();

    if (error || !account) {
      throw new HttpError(400, "INVALID_REQUEST", "Unable to update mail account.", error);
    }

    const updatedAccount = account as unknown as MailAccountSafe;

    if (previous.is_active && updatedAccount.is_active === false) {
      await this.audit.record({
        actorUserId: auth.userId,
        mailAccountId,
        action: "mailbox_deactivated",
        targetType: "mail_account",
        targetIdentifier: updatedAccount.email_address,
        ipAddress,
      });
    } else if (!previous.is_active && updatedAccount.is_active === true) {
      await this.audit.record({
        actorUserId: auth.userId,
        mailAccountId,
        action: "mailbox_activated",
        targetType: "mail_account",
        targetIdentifier: updatedAccount.email_address,
        ipAddress,
      });
    }

    await this.audit.record({
      actorUserId: auth.userId,
      mailAccountId,
      action: "mailbox_updated",
      targetType: "mail_account",
      targetIdentifier: updatedAccount.email_address,
      metadata: { fields: Object.keys(patch) },
      ipAddress,
    });

    return toAdminAccountDto(updatedAccount);
  }

  async rotateCredentials(
    auth: AuthContext,
    mailAccountId: string,
    password: string,
    ipAddress?: string | null
  ) {
    await this.requireMailboxAdmin(auth, mailAccountId);
    const account = await this.getPrivateAccount(mailAccountId);
    const encryptedCredential =
      this.credentialService.encryptMailboxCredential(mailAccountId, password);

    const { error } = await this.admin
      .from("mail_accounts")
      .update(encryptedCredential)
      .eq("id", mailAccountId);

    if (error) {
      throw new HttpError(
        400,
        "INVALID_REQUEST",
        "Unable to rotate mailbox credentials.",
        error
      );
    }

    await this.audit.record({
      actorUserId: auth.userId,
      mailAccountId,
      action: "credentials_rotated",
      targetType: "mail_account",
      targetIdentifier: account.email_address,
      ipAddress,
    });

    return { ok: true };
  }

  async addMember(
    auth: AuthContext,
    mailAccountId: string,
    input: AddMemberInput,
    ipAddress?: string | null
  ) {
    await this.requireMailboxAdmin(auth, mailAccountId);

    const { data, error } = await this.admin
      .from("mail_account_members")
      .insert({
        mail_account_id: mailAccountId,
        user_id: input.userId,
        access_role: input.accessRole,
        created_by: auth.userId,
      })
      .select("id,mail_account_id,user_id,access_role,created_by,created_at,updated_at")
      .single();

    if (error || !data) {
      throw new HttpError(400, "INVALID_REQUEST", "Unable to add mailbox member.", error);
    }

    await this.audit.record({
      actorUserId: auth.userId,
      mailAccountId,
      action: "member_added",
      targetType: "mail_account_member",
      targetIdentifier: input.userId,
      metadata: { accessRole: input.accessRole },
      ipAddress,
    });

    return toMemberDto(data as unknown as MailAccountMember);
  }

  async updateMember(
    auth: AuthContext,
    mailAccountId: string,
    userId: string,
    accessRole: MailboxAccessRole,
    ipAddress?: string | null
  ) {
    await this.requireMailboxAdmin(auth, mailAccountId);

    const { data: existing } = await this.admin
      .from("mail_account_members")
      .select("access_role")
      .eq("mail_account_id", mailAccountId)
      .eq("user_id", userId)
      .maybeSingle();

    await this.assertFinalOwnerPreserved(mailAccountId, userId, accessRole);

    const { data, error } = await this.admin
      .from("mail_account_members")
      .update({ access_role: accessRole })
      .eq("mail_account_id", mailAccountId)
      .eq("user_id", userId)
      .select("id,mail_account_id,user_id,access_role,created_by,created_at,updated_at")
      .single();

    if (error || !data) {
      throw new HttpError(400, "INVALID_REQUEST", "Unable to update mailbox member.", error);
    }

    await this.audit.record({
      actorUserId: auth.userId,
      mailAccountId,
      action: "member_role_changed",
      targetType: "mail_account_member",
      targetIdentifier: userId,
      metadata: { previousRole: existing?.access_role ?? null, accessRole },
      ipAddress,
    });

    return toMemberDto(data as unknown as MailAccountMember);
  }

  async removeMember(
    auth: AuthContext,
    mailAccountId: string,
    userId: string,
    ipAddress?: string | null
  ) {
    await this.requireMailboxAdmin(auth, mailAccountId);
    await this.assertFinalOwnerPreserved(mailAccountId, userId, null);

    const { error } = await this.admin
      .from("mail_account_members")
      .delete()
      .eq("mail_account_id", mailAccountId)
      .eq("user_id", userId);

    if (error) {
      throw new HttpError(400, "INVALID_REQUEST", "Unable to remove mailbox member.", error);
    }

    await this.audit.record({
      actorUserId: auth.userId,
      mailAccountId,
      action: "member_removed",
      targetType: "mail_account_member",
      targetIdentifier: userId,
      ipAddress,
    });

    return { ok: true };
  }

  async getPrivateAccount(mailAccountId: string): Promise<MailAccountPrivate> {
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

  async requireMailboxAdmin(auth: AuthContext, mailAccountId: string) {
    if (auth.platformRole === "admin") {
      return;
    }

    const { data, error } = await this.admin
      .from("mail_account_members")
      .select("access_role")
      .eq("mail_account_id", mailAccountId)
      .eq("user_id", auth.userId)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, "INTERNAL_ERROR", "Unable to verify mailbox permissions.");
    }

    if (!data || !hasMailboxRole(data.access_role, "owner")) {
      throw new HttpError(403, "ACCESS_DENIED", "Mailbox owner access is required.");
    }
  }

  private async assertFinalOwnerPreserved(
    mailAccountId: string,
    userId: string,
    nextRole: MailboxAccessRole | null
  ) {
    const { data, error } = await this.admin
      .from("mail_account_members")
      .select("user_id,access_role")
      .eq("mail_account_id", mailAccountId)
      .eq("access_role", "owner");

    if (error) {
      throw new HttpError(500, "INTERNAL_ERROR", "Unable to verify mailbox owners.");
    }

    const owners = data ?? [];
    const isRemovingFinalOwner =
      owners.length === 1 &&
      owners[0]?.user_id === userId &&
      nextRole !== "owner";

    if (isRemovingFinalOwner) {
      throw new HttpError(400, "ACCESS_DENIED", "A mailbox must retain at least one owner.");
    }
  }
}

function mapAccountPatch(input: UpdateMailAccountInput) {
  const patch: Record<string, unknown> = {};
  const fieldMap = {
    emailAddress: "email_address",
    displayName: "display_name",
    description: "description",
    username: "username",
    imapHost: "imap_host",
    imapPort: "imap_port",
    imapSecure: "imap_secure",
    smtpHost: "smtp_host",
    smtpPort: "smtp_port",
    smtpSecure: "smtp_secure",
    fromName: "from_name",
    replyToAddress: "reply_to_address",
    maxAttachmentMb: "max_attachment_mb",
    isActive: "is_active",
  } as const;

  for (const [inputKey, column] of Object.entries(fieldMap)) {
    const value = input[inputKey as keyof UpdateMailAccountInput];
    if (value !== undefined) {
      patch[column] = value;
    }
  }

  return patch;
}
