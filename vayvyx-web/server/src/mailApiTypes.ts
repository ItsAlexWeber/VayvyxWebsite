import type { MailApiErrorCode } from "./httpError.js";
import type { MailboxAccessRole } from "./types.js";

export type MailAccountSummary = {
  id: string;
  emailAddress: string;
  displayName: string;
  description: string | null;
  fromName: string | null;
  replyToAddress: string | null;
  maxAttachmentMb: number;
  currentUserRole: MailboxAccessRole | "admin";
  isActive: boolean;
  connectionStatus?: "unknown" | "available" | "unavailable";
};

export type MailFolderSpecialUse =
  | "inbox"
  | "sent"
  | "drafts"
  | "archive"
  | "trash"
  | "junk"
  | "custom";

export type MailFolder = {
  path: string;
  displayName: string;
  delimiter: string;
  specialUse: MailFolderSpecialUse;
  originalSpecialUse: string | null;
  totalCount: number | null;
  unreadCount: number | null;
  selectable: boolean;
  subscribed: boolean | null;
};

export type MailAddress = {
  name: string | null;
  address: string;
};

export type MailAttachmentMetadata = {
  id: string;
  filename: string;
  contentType: string;
  size: number | null;
  disposition: "attachment" | "inline";
};

export type MailMessageSummary = {
  mailAccountId: string;
  folder: string;
  uid: number;
  messageId: string | null;
  subject: string;
  senderName: string | null;
  senderAddress: string | null;
  recipients: MailAddress[];
  receivedAt: string | null;
  sentAt: string | null;
  unread: boolean;
  flagged: boolean;
  hasAttachments: boolean;
  attachmentCount: number | null;
  preview: string;
  inReplyTo: string | null;
  references: string[];
};

export type MailMessageDetail = MailMessageSummary & {
  htmlBody: string | null;
  textBody: string;
  from: MailAddress[];
  replyTo: MailAddress[];
  to: MailAddress[];
  cc: MailAddress[];
  hasRemoteImages: boolean;
  attachments: MailAttachmentMetadata[];
};

export type UnifiedMessageSummary = MailMessageSummary & {
  sourceMailboxDisplayName: string;
  sourceEmailAddress: string;
};

export type UnifiedMailboxFailure = {
  mailAccountId: string;
  status: "unavailable";
};

export type SendMessageRequest = {
  mode: "compose" | "reply" | "replyAll" | "forward";
  identityId?: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  textBody: string;
  sanitizedHtmlBody?: string;
  originalFolder?: string;
  originalUid?: number;
  inReplyTo?: string;
  references?: string[];
};

export type SendMessageResult = {
  status: "sent";
  messageId: string | null;
  sentFolderWarning?: string;
};

export type MailApiError = {
  error: {
    code: MailApiErrorCode;
    message: string;
    correlationId?: string;
  };
};
