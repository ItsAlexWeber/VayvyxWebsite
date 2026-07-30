import type { MailboxAccessRole } from "./mail.ts";

export type PlatformRole = "user" | "admin";
export type AccessType = "beta" | "licensed" | "mail_only" | "none";
export type AccountStatus =
  | "invited"
  | "setup_incomplete"
  | "active"
  | "disabled"
  | "expired"
  | "auth_issue"
  | "profile_missing"
  | "auth_missing";

export type InvitationStatus =
  | "not_invited"
  | "invited"
  | "setup_incomplete"
  | "complete";

export type AccessMailboxAssignment = {
  id: string;
  mailAccountId: string;
  displayName: string;
  emailAddress: string;
  accessRole: MailboxAccessRole;
  isActive: boolean;
};

export type AccessPersonSummary = {
  id: string;
  email: string | null;
  fullName: string | null;
  status: AccountStatus;
  statusLabel: string;
  platformRole: PlatformRole;
  accessType: AccessType;
  invitationStatus: InvitationStatus;
  setupCompletedAt: string | null;
  accessExpiresAt: string | null;
  lastSignInAt: string | null;
  createdAt: string | null;
  assignedMailboxes: AccessMailboxAssignment[];
  diagnostics: string[];
  profileMissing: boolean;
  authMissing: boolean;
};

export type AccessAuditEvent = {
  id: string;
  actorUserId: string | null;
  targetUserId: string | null;
  action: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type AccessPersonDetail = AccessPersonSummary & {
  adminNotes: string | null;
  audit: AccessAuditEvent[];
};

export type AccessMailboxOption = {
  id: string;
  emailAddress: string;
  displayName: string;
  isActive: boolean;
};

export type InvitePersonInput = {
  email: string;
  fullName: string;
  platformRole: PlatformRole;
  accessType: AccessType;
  accessExpiresAt: string | null;
  mailboxAssignments: Array<{
    mailAccountId: string;
    accessRole: MailboxAccessRole;
  }>;
  adminNotes: string | null;
};
