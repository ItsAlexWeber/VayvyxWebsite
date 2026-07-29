import type {
  MailAccountMember,
  MailAccountSafe,
  MailboxAccessRole,
} from "./types.js";

export type MailAccountAdminSummary = {
  id: string;
  emailAddress: string;
  displayName: string;
  description: string | null;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  username: string;
  fromName: string | null;
  replyToAddress: string | null;
  maxAttachmentMb: number;
  isActive: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  members?: MailAccountMemberSummary[];
};

export type MailAccountMemberSummary = {
  id: string;
  mailAccountId: string;
  userId: string;
  accessRole: MailboxAccessRole;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MailAdminUserSearchResult = {
  id: string;
  email: string;
  displayName: string | null;
};

export type MailAccessSummary = {
  authenticated: true;
  platformAdmin: boolean;
  hasMailAccess: boolean;
  mailboxCount: number;
};

export function toAdminAccountDto(
  account: MailAccountSafe & { mail_account_members?: MailAccountMember[] }
): MailAccountAdminSummary {
  return {
    id: account.id,
    emailAddress: account.email_address,
    displayName: account.display_name,
    description: account.description,
    imapHost: account.imap_host,
    imapPort: account.imap_port,
    imapSecure: account.imap_secure,
    smtpHost: account.smtp_host,
    smtpPort: account.smtp_port,
    smtpSecure: account.smtp_secure,
    username: account.username,
    fromName: account.from_name,
    replyToAddress: account.reply_to_address,
    maxAttachmentMb: account.max_attachment_mb,
    isActive: account.is_active,
    createdBy: account.created_by,
    createdAt: account.created_at,
    updatedAt: account.updated_at,
    members: account.mail_account_members?.map(toMemberDto),
  };
}

export function toMemberDto(member: MailAccountMember): MailAccountMemberSummary {
  return {
    id: member.id,
    mailAccountId: member.mail_account_id,
    userId: member.user_id,
    accessRole: member.access_role,
    createdBy: member.created_by,
    createdAt: member.created_at,
    updatedAt: member.updated_at,
  };
}
