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
  | "INTERNAL_ERROR";

export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError;
}
