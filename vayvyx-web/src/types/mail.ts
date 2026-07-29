export type MailboxAccessRole = "viewer" | "sender" | "manager" | "owner";

export type MailApiErrorCode =
  | "AUTH_REQUIRED"
  | "ACCESS_DENIED"
  | "MAILBOX_NOT_FOUND"
  | "MAILBOX_INACTIVE"
  | "FOLDER_NOT_FOUND"
  | "MESSAGE_NOT_FOUND"
  | "INVALID_REQUEST"
  | "ATTACHMENT_TOO_LARGE"
  | "RATE_LIMITED"
  | "MAILBOX_UNAVAILABLE"
  | "MAIL_FETCH_FAILED"
  | "SEND_FAILED"
  | "PARTIAL_SUCCESS"
  | "UNSUPPORTED_FILE_TYPE"
  | "MALFORMED_HTML"
  | "UNSAFE_HTML_REMOVED"
  | "ARCHIVE_TOO_LARGE"
  | "MALFORMED_ARCHIVE"
  | "MISSING_PRIMARY_HTML"
  | "UNSAFE_ARCHIVE_PATH"
  | "UNSUPPORTED_ASSET"
  | "ASSET_TOO_LARGE"
  | "UNRESOLVED_VARIABLES"
  | "UNAUTHORIZED_SCOPE"
  | "TEMPLATE_NOT_FOUND"
  | "TEST_SEND_FAILED"
  | "INTERNAL_ERROR";

export type MailApiError = {
  error: {
    code: MailApiErrorCode;
    message: string;
    correlationId?: string;
  };
};

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

export type MailAccessSummary = {
  authenticated: true;
  platformAdmin: boolean;
  hasMailAccess: boolean;
  mailboxCount: number;
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

export type MailTemplateScope = "personal" | "company" | "system";

export type MailTemplateAssetSummary = {
  id: string;
  filename: string;
  contentType: string;
  byteSize: number;
  cid: string;
  createdAt: string;
};

export type MailTemplateSummary = {
  id: string;
  name: string;
  description: string | null;
  subjectTemplate: string | null;
  scope: MailTemplateScope;
  defaultMailAccountId: string | null;
  previewMetadata: Record<string, unknown> | null;
  createdBy: string;
  updatedAt: string;
  createdAt: string;
  isActive: boolean;
};

export type MailTemplateDetail = MailTemplateSummary & {
  htmlContent: string;
  plainTextContent: string | null;
  variables: string[];
  assets: MailTemplateAssetSummary[];
};

export type MailTemplateRendered = {
  subject: string;
  htmlContent: string;
  plainTextContent: string;
  unresolvedVariables: string[];
};

export type MailTemplateExport = {
  filename: string;
  template: MailTemplateDetail;
  assets: Array<MailTemplateAssetSummary & { contentBase64: string }>;
};

export type SendMessageRequest = {
  mode: "compose" | "reply" | "replyAll" | "forward";
  identityId?: string;
  templateId?: string;
  templateVariables?: Record<string, string>;
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

export type MailListResponse = {
  messages: MailMessageSummary[];
  nextCursor: number | null;
};

export type UnifiedInboxResponse = {
  messages: UnifiedMessageSummary[];
  failures: UnifiedMailboxFailure[];
  nextCursor: string | null;
};
