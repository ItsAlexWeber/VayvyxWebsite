import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
import type { Transporter } from "nodemailer";
import { HttpError, isHttpError } from "./httpError.js";
import type { MailTemplateService } from "./mailTemplateService.js";
import type { AuthContext, MailAccountPrivate, AccessType } from "./types.js";
import {
  authEmailActionLabels,
  type AuthEmailTemplateKey,
} from "./authEmailTemplates.js";
import { sanitizeAttachmentFilename } from "./filename.js";

type SmtpTransportFactory = {
  createSmtpTransport(account: MailAccountPrivate): Promise<Transporter>;
};

type AuthEmailFailureCategory =
  | "cooldown"
  | "template_unavailable"
  | "action_link_failed"
  | "sender_unavailable"
  | "smtp_failed"
  | "user_not_found"
  | "invalid_action_url"
  | "unknown";

type AuthEmailSendInput = {
  templateKey: AuthEmailTemplateKey;
  to: string;
  targetUserId: string | null;
  actorUserId: string | null;
  fullName: string | null;
  accessType?: AccessType | null;
  accessExpiresAt?: string | null;
  actionUrl?: string | null;
  changedAt?: Date;
  ipAddress?: string | null;
};

const supportEmail = "support@vayvyx.com";
const supportSenderName = "Vayvyx Support";
const cooldownMs = 60_000;

const privateAccountColumns = [
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
  "credential_ciphertext",
  "credential_iv",
  "credential_auth_tag",
  "credential_key_version",
].join(",");

export class AuthEmailService {
  constructor(
    private readonly admin: SupabaseClient,
    private readonly templateService: MailTemplateService,
    private readonly smtpFactory: SmtpTransportFactory
  ) {}

  async generateInviteActionLink(input: {
    email: string;
    fullName: string;
    redirectTo: string;
  }) {
    const { data, error } = await this.admin.auth.admin.generateLink({
      type: "invite",
      email: input.email,
      options: {
        redirectTo: input.redirectTo,
        data: {
          full_name: input.fullName,
          vayvyx_invited: true,
        },
      },
    });

    if (error || !data?.user || !data.properties?.action_link) {
      throw new HttpError(400, "INVITATION_FAILED", "Invitation link could not be generated.");
    }

    const actionUrl = data.properties.action_link;
    if (!isSupabaseActionUrl(actionUrl)) {
      throw new HttpError(400, "INVALID_REQUEST", "Invitation action link was invalid.");
    }

    return {
      user: data.user,
      actionUrl,
    };
  }

  async sendWelcomeInvitation(input: Omit<AuthEmailSendInput, "templateKey">) {
    return this.sendAuthEmail({
      ...input,
      templateKey: "auth_welcome_invite",
    });
  }

  async sendSetupReminder(input: Omit<AuthEmailSendInput, "templateKey">) {
    return this.sendAuthEmail({
      ...input,
      templateKey: "auth_setup_reminder",
    });
  }

  async sendPasswordReset(input: {
    actorUserId: string | null;
    targetUserId: string | null;
    email: string;
    fullName: string | null;
    redirectTo: string;
    ipAddress?: string | null;
  }) {
    const actionUrl = await this.generateRecoveryActionLink(input.email, input.redirectTo);
    return this.sendAuthEmail({
      templateKey: "auth_password_reset",
      to: input.email,
      targetUserId: input.targetUserId,
      actorUserId: input.actorUserId,
      fullName: input.fullName,
      actionUrl,
      ipAddress: input.ipAddress,
    });
  }

  async sendPublicPasswordReset(email: string, redirectTo: string, ipAddress?: string | null) {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.findAuthUserByEmail(normalizedEmail).catch(() => null);
    if (!user) {
      await this.recordDelivery({
        emailType: "auth_password_reset",
        targetUserId: null,
        targetEmailHash: hashEmail(normalizedEmail),
        senderMailAccountId: null,
        status: "failed",
        failureCategory: "user_not_found",
        actorUserId: null,
      });
      return { ok: true };
    }

    try {
      await this.sendPasswordReset({
        actorUserId: null,
        targetUserId: user.id,
        email: normalizedEmail,
        fullName: readFullName(user),
        redirectTo,
        ipAddress,
      });
    } catch {
      // Public recovery responses must not disclose whether or why delivery failed.
    }

    return { ok: true };
  }

  async sendPasswordChangedNotification(auth: AuthContext, ipAddress?: string | null) {
    if (!auth.email) {
      return { ok: true };
    }

    try {
      await this.sendAuthEmail({
        templateKey: "auth_password_changed",
        to: auth.email,
        targetUserId: auth.userId,
        actorUserId: auth.userId,
        fullName: readFullName(auth.user),
        actionUrl: null,
        changedAt: new Date(),
        ipAddress,
      });
    } catch (error) {
      console.error("Password changed notification could not be sent", {
        targetUserId: auth.userId,
        category: isHttpError(error) ? error.code : "INTERNAL_ERROR",
      });
    }

    return { ok: true };
  }

  async sendTemplateTest(
    auth: AuthContext,
    templateKey: AuthEmailTemplateKey,
    to: string,
    ipAddress?: string | null
  ) {
    const result = await this.sendAuthEmail({
      templateKey,
      to,
      targetUserId: auth.userId,
      actorUserId: auth.userId,
      fullName: readFullName(auth.user) ?? "Vayvyx Admin",
      accessType: auth.accessType,
      actionUrl:
        templateKey === "auth_password_changed"
          ? null
          : "https://vayvyx.com/auth/v1/verify?preview=true",
      changedAt: new Date(),
      ipAddress,
    });

    return result;
  }

  private async generateRecoveryActionLink(email: string, redirectTo: string) {
    const { data, error } = await this.admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: {
        redirectTo,
      },
    });

    if (error || !data?.properties?.action_link) {
      throw new HttpError(400, "RESET_EMAIL_FAILED", "Password reset link could not be generated.");
    }

    const actionUrl = data.properties.action_link;
    if (!isSupabaseActionUrl(actionUrl)) {
      throw new HttpError(400, "INVALID_REQUEST", "Password reset action link was invalid.");
    }

    return actionUrl;
  }

  private async sendAuthEmail(input: AuthEmailSendInput) {
    const normalizedEmail = input.to.trim().toLowerCase();
    const targetEmailHash = hashEmail(normalizedEmail);
    await this.assertCooldown(input.templateKey, targetEmailHash);

    if (input.actionUrl && !isSupabaseActionUrl(input.actionUrl)) {
      await this.recordDelivery({
        emailType: input.templateKey,
        targetUserId: input.targetUserId,
        targetEmailHash,
        senderMailAccountId: null,
        status: "failed",
        failureCategory: "invalid_action_url",
        actorUserId: input.actorUserId,
      });
      throw new HttpError(400, "INVALID_REQUEST", "Authentication action link was invalid.");
    }

    const senderAccount = await this.getSupportSender();
    const variables = authTemplateVariables(input, normalizedEmail);

    let rendered;
    try {
      rendered = await this.templateService.renderSystemTemplateForSend(
        input.templateKey,
        variables
      );
    } catch (error) {
      await this.recordDelivery({
        emailType: input.templateKey,
        targetUserId: input.targetUserId,
        targetEmailHash,
        senderMailAccountId: senderAccount.id,
        status: "failed",
        failureCategory: "template_unavailable",
        actorUserId: input.actorUserId,
      });
      throw error;
    }

    const transporter = await this.smtpFactory.createSmtpTransport(senderAccount);
    const correlationId = randomUUID();

    try {
      const sent = await transporter.sendMail({
        from: `"${supportSenderName}" <${supportEmail}>`,
        replyTo: supportEmail,
        to: normalizedEmail,
        subject: rendered.subject,
        text: rendered.plainTextContent,
        html: rendered.htmlContent,
        attachments: rendered.inlineAssets.map((asset) => ({
          filename: sanitizeAttachmentFilename(asset.filename),
          content: Buffer.from(asset.contentBase64, "base64"),
          contentType: asset.contentType,
          cid: asset.cid,
          contentDisposition: "inline" as const,
        })),
      });

      await this.recordDelivery({
        emailType: input.templateKey,
        targetUserId: input.targetUserId,
        targetEmailHash,
        senderMailAccountId: senderAccount.id,
        status: "sent",
        providerMessageId: typeof sent.messageId === "string" ? sent.messageId : null,
        actorUserId: input.actorUserId,
        correlationId,
      });
      await this.recordAccessAuditForEmail(input, "sent", correlationId);

      return {
        ok: true as const,
        messageId: typeof sent.messageId === "string" ? sent.messageId : null,
      };
    } catch (error) {
      await this.recordDelivery({
        emailType: input.templateKey,
        targetUserId: input.targetUserId,
        targetEmailHash,
        senderMailAccountId: senderAccount.id,
        status: "failed",
        failureCategory: "smtp_failed",
        actorUserId: input.actorUserId,
        correlationId,
      });
      await this.recordAccessAuditForEmail(input, "failed", correlationId);
      throw new HttpError(502, "AUTH_EMAIL_SEND_FAILED", "Authentication email could not be sent.", error);
    } finally {
      transporter.close();
    }
  }

  private async assertCooldown(
    templateKey: AuthEmailTemplateKey,
    targetEmailHash: string
  ) {
    const cutoff = new Date(Date.now() - cooldownMs).toISOString();
    const { data, error } = await this.admin
      .from("auth_email_delivery_log")
      .select("id")
      .eq("target_email_hash", targetEmailHash)
      .eq("email_type", templateKey)
      .gte("created_at", cutoff)
      .limit(1);

    if (error) {
      return;
    }

    if ((data ?? []).length > 0) {
      await this.recordDelivery({
        emailType: templateKey,
        targetUserId: null,
        targetEmailHash,
        senderMailAccountId: null,
        status: "failed",
        failureCategory: "cooldown",
        actorUserId: null,
      });
      throw new HttpError(429, "RATE_LIMITED", "Wait before sending another authentication email.");
    }
  }

  private async getSupportSender() {
    const { data, error } = await this.admin
      .from("mail_accounts")
      .select(privateAccountColumns)
      .eq("email_address", supportEmail)
      .eq("is_active", true)
      .maybeSingle();

    if (error || !data) {
      throw new HttpError(500, "AUTH_EMAIL_SENDER_UNAVAILABLE", "The support sender mailbox is unavailable.");
    }

    return data as unknown as MailAccountPrivate;
  }

  private async findAuthUserByEmail(email: string) {
    const lower = email.toLowerCase();
    for (let page = 1; page <= 10; page += 1) {
      const { data, error } = await this.admin.auth.admin.listUsers({
        page,
        perPage: 1000,
      });
      if (error) return null;
      const match = data.users.find((user) => user.email?.toLowerCase() === lower);
      if (match) return match;
      if (data.users.length < 1000) break;
    }
    return null;
  }

  private async recordDelivery(input: {
    emailType: AuthEmailTemplateKey;
    targetUserId: string | null;
    targetEmailHash: string;
    senderMailAccountId: string | null;
    status: "sent" | "failed";
    providerMessageId?: string | null;
    failureCategory?: AuthEmailFailureCategory | null;
    actorUserId: string | null;
    correlationId?: string;
  }) {
    await this.admin.from("auth_email_delivery_log").insert({
      email_type: input.emailType,
      target_user_id: input.targetUserId,
      target_email_hash: input.targetEmailHash,
      sender_mail_account_id: input.senderMailAccountId,
      status: input.status,
      provider_message_id: input.providerMessageId ?? null,
      sent_at: input.status === "sent" ? new Date().toISOString() : null,
      failure_category: input.failureCategory ?? null,
      actor_user_id: input.actorUserId,
      correlation_id: input.correlationId ?? randomUUID(),
    });

    if (input.targetUserId) {
      const patch: Record<string, unknown> = {
        last_auth_email_status: input.status,
      };
      if (input.status === "sent" && input.emailType === "auth_welcome_invite") {
        patch.invitation_sent_at = new Date().toISOString();
      }
      if (input.status === "sent" && input.emailType === "auth_setup_reminder") {
        patch.setup_reminder_sent_at = new Date().toISOString();
      }
      if (input.status === "sent" && input.emailType === "auth_password_reset") {
        patch.password_reset_requested_at = new Date().toISOString();
      }
      await this.admin.from("profiles").update(patch).eq("id", input.targetUserId);
    }
  }

  private async recordAccessAuditForEmail(
    input: AuthEmailSendInput,
    status: "sent" | "failed",
    correlationId: string
  ) {
    if (!input.targetUserId) return;
    const action =
      status === "failed"
        ? "auth_email_send_failed"
        : accessAuditActionForTemplate(input.templateKey);
    if (!action) return;

    await this.admin.from("access_audit_log").insert({
      actor_user_id: input.actorUserId,
      target_user_id: input.targetUserId,
      action,
      metadata: {
        emailType: input.templateKey,
        correlationId,
      },
      ip_address: input.ipAddress ?? null,
    });
  }
}

function authTemplateVariables(input: AuthEmailSendInput, email: string) {
  const fullName = input.fullName?.trim() || email;
  const firstName = fullName.split(/\s+/)[0] || email.split("@")[0] || "there";
  return {
    first_name: firstName,
    full_name: fullName,
    email,
    action_url: input.actionUrl ?? "",
    action_label: authEmailActionLabels[input.templateKey],
    support_email: supportEmail,
    company_name: "Vayvyx",
    current_year: String(new Date().getFullYear()),
    access_type: formatAccessType(input.accessType),
    expiration_notice:
      input.templateKey === "auth_password_changed"
        ? formatHumanDate(input.changedAt ?? new Date())
        : expirationNotice(input.accessExpiresAt),
  };
}

function accessAuditActionForTemplate(templateKey: AuthEmailTemplateKey) {
  const actions: Partial<Record<AuthEmailTemplateKey, string>> = {
    auth_welcome_invite: "welcome_invitation_sent",
    auth_setup_reminder: "setup_reminder_sent",
    auth_password_reset: "password_reset_sent",
    auth_password_changed: "password_changed_notification_sent",
  };
  return actions[templateKey] ?? null;
}

function expirationNotice(value: string | null | undefined) {
  if (!value) return "For security, this link expires automatically.";
  return `Access is scheduled to expire on ${formatHumanDate(new Date(value))}. The setup link also expires automatically.`;
}

function formatAccessType(value: AccessType | null | undefined) {
  const labels: Record<AccessType, string> = {
    beta: "Private beta",
    licensed: "Licensed",
    mail_only: "Mail only",
    none: "No app access",
  };
  return value ? labels[value] : "Private beta";
}

function formatHumanDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(value);
}

function hashEmail(email: string) {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

function isSupabaseActionUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.pathname.includes("/auth/v1/verify");
  } catch {
    return false;
  }
}

function readFullName(user: User) {
  const value = user.user_metadata?.full_name ?? user.user_metadata?.display_name;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
