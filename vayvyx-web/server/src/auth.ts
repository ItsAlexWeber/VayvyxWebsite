/* eslint-disable @typescript-eslint/no-namespace */
import type { Request, Response, NextFunction } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./httpError.js";
import type {
  AppSupabaseClients,
  AuthContext,
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
  const { data, error } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
        throw new HttpError(500, "INTERNAL_ERROR", "Unable to load platform role.");
  }

  return data?.role === "admin" ? "admin" : "user";
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

      const platformRole = await getPlatformRole(clients.admin, data.user.id);

      request.auth = {
        user: data.user,
        userId: data.user.id,
        email: data.user.email ?? null,
        platformRole,
      };

      next();
    } catch (error) {
      next(error);
    }
  };
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
