export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: MailApiErrorCode,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

export type MailApiErrorCode =
  | "AUTH_REQUIRED"
  | "ACCESS_DENIED"
  | "ACCESS_DISABLED"
  | "ACCESS_EXPIRED"
  | "SETUP_INCOMPLETE"
  | "CONFIRMATION_REQUIRED"
  | "FINAL_ADMIN_REQUIRED"
  | "SELF_DISABLE_BLOCKED"
  | "FINAL_MAILBOX_OWNER_REQUIRED"
  | "DUPLICATE_MEMBERSHIP"
  | "INVITATION_FAILED"
  | "AUTH_EMAIL_SEND_FAILED"
  | "AUTH_EMAIL_SENDER_UNAVAILABLE"
  | "RESET_EMAIL_FAILED"
  | "USER_NOT_FOUND"
  | "PROFILE_NOT_FOUND"
  | "EMAIL_UNAVAILABLE"
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

export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError;
}
