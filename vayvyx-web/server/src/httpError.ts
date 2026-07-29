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
