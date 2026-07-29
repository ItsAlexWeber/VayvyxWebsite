import type { SupabaseClient, User } from "@supabase/supabase-js";

export const platformRoles = ["user", "admin"] as const;
export type PlatformRole = (typeof platformRoles)[number];

export const mailboxAccessRoles = ["viewer", "sender", "manager", "owner"] as const;
export type MailboxAccessRole = (typeof mailboxAccessRoles)[number];

export type AuthContext = {
  user: User;
  userId: string;
  email: string | null;
  platformRole: PlatformRole;
};

export type MailAccountSafe = {
  id: string;
  email_address: string;
  display_name: string;
  description: string | null;
  imap_host: string;
  imap_port: number;
  imap_secure: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  username: string;
  from_name: string | null;
  reply_to_address: string | null;
  max_attachment_mb: number;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type MailAccountPrivate = MailAccountSafe & {
  credential_secret_id: string;
};

export type MailAccountMember = {
  id: string;
  mail_account_id: string;
  user_id: string;
  access_role: MailboxAccessRole;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AppSupabaseClients = {
  createUserClient(accessToken: string): SupabaseClient;
  admin: SupabaseClient;
};

export type AuditAction =
  | "mailbox_created"
  | "mailbox_updated"
  | "mailbox_activated"
  | "mailbox_deactivated"
  | "credentials_rotated"
  | "member_added"
  | "member_removed"
  | "member_role_changed"
  | "imap_connection_tested"
  | "smtp_connection_tested"
  | "message_sent"
  | "message_moved"
  | "message_trashed"
  | "attachment_downloaded";
