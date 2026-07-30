import { supabase } from "./supabaseClient.ts";
import { MailApiRequestError } from "./mailApi.ts";
import type {
  AccessMailboxAssignment,
  AccessMailboxOption,
  AccessPersonDetail,
  AccessPersonSummary,
  AccessType,
  AccountStatus,
  InvitePersonInput,
  PlatformRole,
} from "../types/access.ts";
import type { MailboxAccessRole } from "../types/mail.ts";

async function getAccessToken() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new MailApiRequestError(401, "AUTH_REQUIRED", "Sign in required.");
  }

  return token;
}

async function requestJson<T>(path: string, options: RequestInit = {}) {
  const token = await getAccessToken();
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (!(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    ...options,
    headers,
    cache: "no-store",
  });
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : null;

  if (!response.ok) {
    const errorPayload = payload as
      | { error?: { code?: string; message?: string } }
      | null;
    throw new MailApiRequestError(
      response.status,
      (errorPayload?.error?.code ?? "INTERNAL_ERROR") as never,
      errorPayload?.error?.message ?? "Something went wrong."
    );
  }

  return payload as T;
}

function query(params: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value && value !== "all") search.set(key, value);
  }
  const value = search.toString();
  return value ? `?${value}` : "";
}

export const accessApi = {
  listPeople(params: {
    search?: string;
    status?: AccountStatus | "all";
    platformRole?: PlatformRole | "all";
    accessType?: AccessType | "all";
  }) {
    return requestJson<AccessPersonSummary[]>(
      `/api/access/people${query(params)}`
    );
  },

  getPerson(userId: string) {
    return requestJson<AccessPersonDetail>(`/api/access/people/${userId}`);
  },

  invitePerson(input: InvitePersonInput) {
    return requestJson<{ result: string; person: AccessPersonDetail }>(
      "/api/access/invite",
      {
        method: "POST",
        body: JSON.stringify(input),
      }
    );
  },

  completeInvite(fullName: string) {
    return requestJson<{ ok: true }>("/api/access/invite/complete", {
      method: "POST",
      body: JSON.stringify({ fullName }),
    });
  },

  updatePerson(
    userId: string,
    input: Partial<{
      fullName: string;
      platformRole: PlatformRole;
      accessType: AccessType;
      accessExpiresAt: string | null;
      adminNotes: string | null;
      confirmAdminDemotion: boolean;
    }>
  ) {
    return requestJson<AccessPersonDetail>(`/api/access/people/${userId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },

  sendPasswordReset(userId: string) {
    return requestJson<{ ok: true }>(
      `/api/access/people/${userId}/reset-password`,
      { method: "POST", body: JSON.stringify({}) }
    );
  },

  resendInvite(userId: string) {
    return requestJson<{ result: string; person: AccessPersonDetail }>(
      `/api/access/people/${userId}/resend-invite`,
      { method: "POST", body: JSON.stringify({}) }
    );
  },

  sendSetupReminder(userId: string) {
    return requestJson<{ ok: true }>(
      `/api/access/people/${userId}/setup-reminder`,
      { method: "POST", body: JSON.stringify({}) }
    );
  },

  disablePerson(userId: string) {
    return requestJson<AccessPersonDetail>(`/api/access/people/${userId}/disable`, {
      method: "POST",
      body: JSON.stringify({ confirmDisable: true }),
    });
  },

  reactivatePerson(userId: string) {
    return requestJson<AccessPersonDetail>(
      `/api/access/people/${userId}/reactivate`,
      { method: "POST", body: JSON.stringify({}) }
    );
  },

  repairProfile(userId: string) {
    return requestJson<AccessPersonDetail>(
      `/api/access/people/${userId}/repair-profile`,
      { method: "POST", body: JSON.stringify({}) }
    );
  },

  listMailboxes() {
    return requestJson<AccessMailboxOption[]>("/api/access/mailboxes");
  },

  addMailbox(userId: string, mailAccountId: string, accessRole: MailboxAccessRole) {
    return requestJson<AccessMailboxAssignment[]>(
      `/api/access/people/${userId}/mailboxes`,
      {
        method: "POST",
        body: JSON.stringify({ mailAccountId, accessRole }),
      }
    );
  },

  updateMailbox(userId: string, mailAccountId: string, accessRole: MailboxAccessRole) {
    return requestJson<AccessMailboxAssignment[]>(
      `/api/access/people/${userId}/mailboxes/${mailAccountId}`,
      {
        method: "PATCH",
        body: JSON.stringify({ accessRole }),
      }
    );
  },

  removeMailbox(userId: string, mailAccountId: string) {
    return requestJson<AccessMailboxAssignment[]>(
      `/api/access/people/${userId}/mailboxes/${mailAccountId}`,
      { method: "DELETE" }
    );
  },
};
