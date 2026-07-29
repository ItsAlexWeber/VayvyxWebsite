import { supabase } from "./supabaseClient.ts";
import type {
  MailAccountAdminSummary,
  MailAccountSummary,
  MailAccessSummary,
  MailAdminUserSearchResult,
  MailApiError,
  MailFolder,
  MailListResponse,
  MailMessageDetail,
  SendMessageRequest,
  SendMessageResult,
  UnifiedInboxResponse,
  MailboxAccessRole,
} from "../types/mail.ts";

export class MailApiRequestError extends Error {
  readonly status: number;
  readonly code: MailApiError["error"]["code"];

  constructor(
    status: number,
    code: MailApiError["error"]["code"],
    message: string
  ) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let authRequiredHandler: (() => void) | null = null;
const inFlight = new Map<string, Promise<unknown>>();

export function setMailApiAuthRequiredHandler(handler: (() => void) | null) {
  authRequiredHandler = handler;
}

async function getAccessToken() {
  if (!supabase) {
    throw new MailApiRequestError(
      401,
      "AUTH_REQUIRED",
      "Supabase is not connected."
    );
  }

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new MailApiRequestError(401, "AUTH_REQUIRED", "Sign in required.");
  }

  return token;
}

async function requestJson<T>(
  path: string,
  options: RequestInit & { dedupeKey?: string } = {}
): Promise<T> {
  const key = options.dedupeKey;
  if (key && inFlight.has(key)) {
    return inFlight.get(key) as Promise<T>;
  }

  const task = doRequestJson<T>(path, options).finally(() => {
    if (key) inFlight.delete(key);
  });

  if (key) inFlight.set(key, task);
  return task;
}

async function doRequestJson<T>(path: string, options: RequestInit) {
  const token = await getAccessToken();
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${token}`);

  if (!(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    ...options,
    headers,
  });

  if (response.status === 204) {
    return null as T;
  }

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : null;

  if (!response.ok) {
    const error = parseMailApiError(response.status, payload);
    if (error.code === "AUTH_REQUIRED") {
      await supabase?.auth.signOut();
      authRequiredHandler?.();
    }
    throw error;
  }

  return payload as T;
}

function parseMailApiError(status: number, payload: unknown) {
  const maybeError = payload as Partial<MailApiError> | null;
  const code = maybeError?.error?.code ?? "INTERNAL_ERROR";
  const message = maybeError?.error?.message ?? "Something went wrong.";
  return new MailApiRequestError(status, code, message);
}

function query(params: Record<string, string | number | boolean | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const value = search.toString();
  return value ? `?${value}` : "";
}

export const mailApi = {
  getAccounts(signal?: AbortSignal) {
    return requestJson<MailAccountSummary[]>("/api/mail/accounts", {
      signal,
      dedupeKey: "accounts",
    });
  },

  getAccess(signal?: AbortSignal) {
    return requestJson<MailAccessSummary>("/api/mail/access", {
      signal,
      dedupeKey: "access",
    });
  },

  getUnifiedMessages(
    params: {
      limit?: number;
      cursor?: string;
      search?: string;
      unreadOnly?: boolean;
      flaggedOnly?: boolean;
    },
    signal?: AbortSignal
  ) {
    return requestJson<UnifiedInboxResponse>(
      `/api/mail/unified/messages${query(params)}`,
      { signal }
    );
  },

  getFolders(mailAccountId: string, signal?: AbortSignal) {
    return requestJson<MailFolder[]>(
      `/api/mail/accounts/${mailAccountId}/folders`,
      { signal, dedupeKey: `folders:${mailAccountId}` }
    );
  },

  getMessages(
    mailAccountId: string,
    params: {
      folder: string;
      limit?: number;
      cursor?: number;
      search?: string;
      unreadOnly?: boolean;
      flaggedOnly?: boolean;
      sortDirection?: "asc" | "desc";
    },
    signal?: AbortSignal
  ) {
    return requestJson<MailListResponse>(
      `/api/mail/accounts/${mailAccountId}/messages${query(params)}`,
      { signal }
    );
  },

  getMessage(
    mailAccountId: string,
    folder: string,
    uid: number,
    signal?: AbortSignal
  ) {
    return requestJson<MailMessageDetail>(
      `/api/mail/accounts/${mailAccountId}/messages/${uid}${query({ folder })}`,
      { signal }
    );
  },

  setRead(mailAccountId: string, folder: string, uid: number, read: boolean) {
    return requestJson<{ uid: number; read: boolean }>(
      `/api/mail/accounts/${mailAccountId}/messages/${uid}/read`,
      { method: "PATCH", body: JSON.stringify({ folder, read }) }
    );
  },

  setFlagged(mailAccountId: string, folder: string, uid: number, flagged: boolean) {
    return requestJson<{ uid: number; flagged: boolean }>(
      `/api/mail/accounts/${mailAccountId}/messages/${uid}/flag`,
      { method: "PATCH", body: JSON.stringify({ folder, flagged }) }
    );
  },

  archive(mailAccountId: string, folder: string, uid: number) {
    return requestJson<{ uid: number; sourceFolder: string; destinationFolder: string }>(
      `/api/mail/accounts/${mailAccountId}/messages/${uid}/archive`,
      { method: "POST", body: JSON.stringify({ folder }) }
    );
  },

  trash(mailAccountId: string, folder: string, uid: number) {
    return requestJson<{ uid: number; sourceFolder: string; destinationFolder: string }>(
      `/api/mail/accounts/${mailAccountId}/messages/${uid}/trash`,
      { method: "POST", body: JSON.stringify({ folder }) }
    );
  },

  move(mailAccountId: string, uid: number, sourceFolder: string, destinationFolder: string) {
    return requestJson<{ uid: number; sourceFolder: string; destinationFolder: string }>(
      `/api/mail/accounts/${mailAccountId}/messages/${uid}/move`,
      { method: "POST", body: JSON.stringify({ sourceFolder, destinationFolder }) }
    );
  },

  send(mailAccountId: string, input: SendMessageRequest, attachments: File[]) {
    const body =
      attachments.length > 0
        ? createMultipartBody(input, attachments)
        : JSON.stringify(input);

    return requestJson<SendMessageResult>(
      `/api/mail/accounts/${mailAccountId}/send`,
      { method: "POST", body }
    );
  },

  async downloadAttachment(
    mailAccountId: string,
    folder: string,
    uid: number,
    attachmentId: string
  ) {
    const token = await getAccessToken();
    const response = await fetch(
      `/api/mail/accounts/${mailAccountId}/messages/${uid}/attachments/${attachmentId}${query({ folder })}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw parseMailApiError(response.status, payload);
    }

    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") ?? "";
    const filename =
      disposition.match(/filename="([^"]+)"/)?.[1] ?? "attachment";
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  },

  getAdminAccounts(signal?: AbortSignal) {
    return requestJson<MailAccountAdminSummary[]>("/api/mail/admin/accounts", {
      signal,
      dedupeKey: "admin-accounts",
    });
  },

  createAdminAccount(input: Record<string, unknown>) {
    return requestJson<MailAccountAdminSummary>("/api/mail/admin/accounts", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  updateAdminAccount(mailAccountId: string, input: Record<string, unknown>) {
    return requestJson<MailAccountAdminSummary>(
      `/api/mail/admin/accounts/${mailAccountId}`,
      { method: "PATCH", body: JSON.stringify(input) }
    );
  },

  rotateCredentials(mailAccountId: string, password: string) {
    return requestJson<{ ok: true }>(
      `/api/mail/admin/accounts/${mailAccountId}/credentials`,
      { method: "POST", body: JSON.stringify({ password }) }
    );
  },

  testImap(mailAccountId: string) {
    return requestJson<{ ok: true }>(
      `/api/mail/admin/accounts/${mailAccountId}/test-imap`,
      { method: "POST", body: JSON.stringify({}) }
    );
  },

  testSmtp(mailAccountId: string) {
    return requestJson<{ ok: true }>(
      `/api/mail/admin/accounts/${mailAccountId}/test-smtp`,
      { method: "POST", body: JSON.stringify({}) }
    );
  },

  addMember(mailAccountId: string, userId: string, accessRole: MailboxAccessRole) {
    return requestJson(
      `/api/mail/admin/accounts/${mailAccountId}/members`,
      { method: "POST", body: JSON.stringify({ userId, accessRole }) }
    );
  },

  updateMember(mailAccountId: string, userId: string, accessRole: MailboxAccessRole) {
    return requestJson(
      `/api/mail/admin/accounts/${mailAccountId}/members/${userId}`,
      { method: "PATCH", body: JSON.stringify({ accessRole }) }
    );
  },

  removeMember(mailAccountId: string, userId: string) {
    return requestJson(
      `/api/mail/admin/accounts/${mailAccountId}/members/${userId}`,
      { method: "DELETE" }
    );
  },

  searchUsers(q: string, signal?: AbortSignal) {
    return requestJson<MailAdminUserSearchResult[]>(
      `/api/mail/admin/users/search${query({ q })}`,
      { signal }
    );
  },
};

function createMultipartBody(input: SendMessageRequest, attachments: File[]) {
  const body = new FormData();
  body.set("payload", JSON.stringify(input));
  for (const attachment of attachments) {
    body.append("attachments", attachment);
  }
  return body;
}
