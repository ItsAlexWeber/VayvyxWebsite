import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { ZodError } from "zod";
import type { AppSupabaseClients } from "./types.js";
import { isHttpError } from "./httpError.js";
import { requireAuthenticated } from "./auth.js";
import { createRoutes } from "./routes.js";
import { AuditLogger } from "./audit.js";
import {
  MailConnectionManager,
  type MailConnectionManagerOptions,
} from "./mailConnectionManager.js";
import { MailAdminService } from "./mailAdminService.js";
import { MailAuthorizationService } from "./mailAuthorizationService.js";
import { ImapSmtpMailProvider } from "./mailProvider.js";
import {
  SupabaseVaultMailCredentialVault,
  type MailCredentialVault,
} from "./vault.js";

export type CreateAppOptions = {
  clients: AppSupabaseClients;
  vault?: MailCredentialVault;
  connectionManagerOptions: MailConnectionManagerOptions;
};

export function createApp(options: CreateAppOptions) {
  const app = express();
  const vault =
    options.vault ?? new SupabaseVaultMailCredentialVault(options.clients.admin);
  const audit = new AuditLogger(options.clients.admin);
  const mailAdminService = new MailAdminService(
    options.clients.admin,
    vault,
    audit
  );
  const mailAuthorizationService = new MailAuthorizationService(
    options.clients.admin
  );
  const connectionManager = new MailConnectionManager(
    vault,
    options.connectionManagerOptions
  );
  const mailProvider = new ImapSmtpMailProvider(connectionManager);

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(express.json({ limit: "1mb" }));
  app.get("/api/mail/health", (_request, response) => {
    response.json({ status: "ok" });
  });
  app.use(requireAuthenticated(options.clients));
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 180,
      keyGenerator: (request) => request.auth?.userId ?? request.ip ?? "unknown",
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests.",
        },
      },
    })
  );
  app.use(
    createRoutes({
      mailAdminService,
      mailAuthorizationService,
      connectionManager,
      mailProvider,
      audit,
    })
  );

  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction
    ) => {
      void _next;

      if (error instanceof ZodError) {
        response.status(400).json({
          error: {
            code: "INVALID_REQUEST",
            message: "Validation failed.",
          },
          issues: error.issues.map((issue) => ({
            path: issue.path,
            message: issue.message,
          })),
        });
        return;
      }

      if (isHttpError(error)) {
        response.status(error.status).json({
          error: {
            code: error.code,
            message: error.message,
          },
        });
        return;
      }

      console.error("Unhandled Vayvyx Mail error", error);
      response.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: "Internal server error.",
        },
      });
    }
  );

  return { app, connectionManager };
}
