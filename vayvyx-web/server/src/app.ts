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
  AesGcmMailCredentialService,
  type MailCredentialService,
} from "./credentialCrypto.js";
import { mailRateLimitKey } from "./rateLimitKey.js";

export type CreateAppOptions = {
  clients: AppSupabaseClients;
  credentialService?: MailCredentialService;
  mailCredentialMasterKey?: Buffer;
  connectionManagerOptions: MailConnectionManagerOptions;
};

export function createApp(options: CreateAppOptions) {
  const app = express();
  if (!options.credentialService && !options.mailCredentialMasterKey) {
    throw new Error("Mail credential encryption is not configured.");
  }
  const credentialService =
    options.credentialService ??
    new AesGcmMailCredentialService(options.mailCredentialMasterKey as Buffer);
  const audit = new AuditLogger(options.clients.admin);
  const mailAdminService = new MailAdminService(
    options.clients.admin,
    credentialService,
    audit
  );
  const mailAuthorizationService = new MailAuthorizationService(
    options.clients.admin
  );
  const connectionManager = new MailConnectionManager(
    credentialService,
    options.connectionManagerOptions
  );
  const mailProvider = new ImapSmtpMailProvider(connectionManager);

  app.disable("x-powered-by");
  app.disable("etag");
  app.use(helmet());
  app.use(express.json({ limit: "1mb" }));
  app.get("/api/mail/health", (_request, response) => {
    response.json({ status: "ok" });
  });
  app.use(requireAuthenticated(options.clients));
  app.use((_request, response, next) => {
    response.setHeader(
      "Cache-Control",
      "private, no-store, no-cache, must-revalidate"
    );
    response.setHeader("Pragma", "no-cache");
    response.setHeader("Expires", "0");
    response.setHeader("Vary", "Authorization");
    next();
  });
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 180,
      keyGenerator: mailRateLimitKey,
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
