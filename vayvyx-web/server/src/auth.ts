/* eslint-disable @typescript-eslint/no-namespace */
import type { Request, Response, NextFunction } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./httpError.js";
import type {
  AppSupabaseClients,
  AuthContext,
  AccountStatus,
  AccessType,
  MailboxAccessRole,
  PlatformRole,
} from "./types.js";

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

const roleRank: Record<MailboxAccessRole, number> = {
  viewer: 1,
  sender: 2,
  manager: 3,
  owner: 4,
};

export function hasMailboxRole(
  actual: MailboxAccessRole,
  required: MailboxAccessRole
) {
  return roleRank[actual] >= roleRank[required];
}

export async function getPlatformRole(
  admin: SupabaseClient,
  userId: string
): Promise<PlatformRole> {
  return (await getAuthProfile(admin, userId)).platformRole;
}

export function requireAuthenticated(clients: AppSupabaseClients) {
  return async (request: Request, _response: Response, next: NextFunction) => {
    try {
      const authorization = request.header("authorization");
      const match = authorization?.match(/^Bearer\s+(.+)$/i);

      if (!match) {
        throw new HttpError(401, "AUTH_REQUIRED", "Missing bearer token.");
      }

      const userClient = clients.createUserClient(match[1]);
      const { data, error } = await userClient.auth.getUser(match[1]);

      if (error || !data.user) {
        throw new HttpError(401, "AUTH_REQUIRED", "Invalid bearer token.");
      }

      const profile = await getAuthProfile(clients.admin, data.user.id);

      request.auth = {
        user: data.user,
        userId: data.user.id,
        email: data.user.email ?? null,
        platformRole: profile.platformRole,
        accessType: profile.accessType,
        accountStatus: profile.accountStatus,
        setupCompletedAt: profile.setupCompletedAt,
        accessExpiresAt: profile.accessExpiresAt,
      };

      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireActiveAccount(
  request: Request,
  _response: Response,
  next: NextFunction
) {
  try {
    const auth = requireAuthContext(request);

    if (auth.accountStatus === "profile_missing") {
      throw new HttpError(403, "ACCESS_DENIED", "Account profile is required.");
    }

    if (auth.accountStatus === "disabled") {
      throw new HttpError(
        403,
        "ACCESS_DISABLED",
        "Account access is disabled. Contact Vayvyx support."
      );
    }

    if (
      auth.accessExpiresAt &&
      Number.isFinite(Date.parse(auth.accessExpiresAt)) &&
      Date.parse(auth.accessExpiresAt) <= Date.now()
    ) {
      throw new HttpError(
        403,
        "ACCESS_EXPIRED",
        "Account access has expired. Contact Vayvyx support."
      );
    }

    if (auth.accountStatus === "invited" || auth.accountStatus === "setup_incomplete") {
      throw new HttpError(
        403,
        "SETUP_INCOMPLETE",
        "Account setup is incomplete."
      );
    }

    next();
  } catch (error) {
    next(error);
  }
}

export function requireAuthContext(request: Request): AuthContext {
  if (!request.auth) {
    throw new HttpError(401, "AUTH_REQUIRED", "Authentication is required.");
  }

  return request.auth;
}

export function requirePlatformAdmin(auth: AuthContext) {
  if (auth.platformRole !== "admin") {
    throw new HttpError(403, "ACCESS_DENIED", "Platform administrator access is required.");
  }
}

async function getAuthProfile(admin: SupabaseClient, userId: string): Promise<{
  platformRole: PlatformRole;
  accessType: AccessType;
  accountStatus: AccountStatus | "profile_missing";
  setupCompletedAt: string | null;
  accessExpiresAt: string | null;
}> {
  const { data, error } = await admin
    .from("profiles")
    .select("role,access_type,account_status,setup_completed_at,access_expires_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "INTERNAL_ERROR", "Unable to load account access.");
  }

  if (!data) {
    return {
      platformRole: "user",
      accessType: "none",
      accountStatus: "profile_missing",
      setupCompletedAt: null,
      accessExpiresAt: null,
    };
  }

  return {
    platformRole: data.role === "admin" ? "admin" : "user",
    accessType: isAccessType(data.access_type) ? data.access_type : "beta",
    accountStatus: isAccountStatus(data.account_status)
      ? data.account_status
      : "active",
    setupCompletedAt:
      typeof data.setup_completed_at === "string"
        ? data.setup_completed_at
        : null,
    accessExpiresAt:
      typeof data.access_expires_at === "string"
        ? data.access_expires_at
        : null,
  };
}

function isAccessType(value: unknown): value is AccessType {
  return (
    value === "beta" ||
    value === "licensed" ||
    value === "mail_only" ||
    value === "none"
  );
}

function isAccountStatus(value: unknown): value is AccountStatus {
  return (
    value === "invited" ||
    value === "setup_incomplete" ||
    value === "active" ||
    value === "disabled"
  );
}
