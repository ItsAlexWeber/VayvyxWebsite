import { Router } from "express";
import multer from "multer";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pLimit from "p-limit";
import type { MailAdminService } from "./mailAdminService.js";
import type { MailConnectionManager } from "./mailConnectionManager.js";
import type { MailAuthorizationService } from "./mailAuthorizationService.js";
import type { MailProvider } from "./mailProvider.js";
import type { MailTemplateService } from "./mailTemplateService.js";
import { HttpError } from "./httpError.js";
import { requireAuthContext } from "./auth.js";
import {
  addMemberSchema,
  createMailAccountSchema,
  memberParamSchema,
  rotateCredentialsSchema,
  testMessageSchema,
  updateMailAccountSchema,
  updateMemberSchema,
  userSearchQuerySchema,
  uuidParamSchema,
} from "./validation.js";
import {
  attachmentParamSchema,
  flagMutationSchema,
  folderQuerySchema,
  messageListQuerySchema,
  moveMutationSchema,
  readMutationSchema,
  sendJsonSchema,
  uidParamSchema,
  unifiedQuerySchema,
} from "./mailValidation.js";
import {
  createTemplateSchema,
  duplicateTemplateSchema,
  importTemplateFieldsSchema,
  renderTemplateSchema,
  sendTemplateTestSchema,
  templateAssetParamSchema,
  templateIdParamSchema,
  templateListQuerySchema,
  updateTemplateSchema,
  validateTemplateVariablesSchema,
} from "./mailTemplateValidation.js";
import type { AuditLogger } from "./audit.js";
import { sanitizeEmailHtml } from "./mailSanitizer.js";
import type { MailAccountPrivate } from "./types.js";
import type { MailAddress, SendMessageRequest } from "./mailApiTypes.js";

type RoutesDeps = {
  mailAdminService: MailAdminService;
  mailAuthorizationService: MailAuthorizationService;
  connectionManager: MailConnectionManager;
  mailProvider: MailProvider;
  templateService?: MailTemplateService;
  audit: AuditLogger;
};

export function createRoutes(deps: RoutesDeps) {
  const router = Router();
  const upload = multer({
    dest: mkdtempSync(join(tmpdir(), "vayvyx-mail-")),
    limits: {
      files: 20,
      fileSize: 100 * 1024 * 1024,
      fields: 40,
    },
  });
  const templateUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
      files: 1,
      fileSize: 10 * 1024 * 1024,
      fields: 20,
    },
  });

  router.get("/api/mail/accounts", async (request, response, next) => {
    try {
      const auth = requireAuthContext(request);
      response.json(await deps.mailAuthorizationService.listAccessibleAccounts(auth));
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/mail/access", async (request, response, next) => {
    try {
      const auth = requireAuthContext(request);
      response.json(await deps.mailAuthorizationService.getAccessSummary(auth));
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/mail/unified/messages", async (request, response, next) => {
    try {
      const auth = requireAuthContext(request);
      const query = unifiedQuerySchema.parse(request.query);
      const accounts = await deps.mailAuthorizationService.listAccessibleAccounts(auth);
      const limitedAccounts = accounts.slice(0, 20);
      const perMailboxLimit = Math.min(25, Math.max(5, Math.ceil(query.limit / Math.max(1, limitedAccounts.length))));
      const limit = pLimit(3);
      const results = await Promise.allSettled(
        limitedAccounts.map((account) =>
          limit(async () => {
            const authorized = await deps.mailAuthorizationService.requireMailboxRole(
              auth,
              account.id,
              "viewer"
            );
            const page = await deps.mailProvider.listMessages(authorized.account, {
              folder: "INBOX",
              limit: perMailboxLimit,
              search: query.search,
              unreadOnly: query.unreadOnly,
              flaggedOnly: query.flaggedOnly,
              sortDirection: "desc",
            });
            return page.messages.map((message) => ({
              ...message,
              sourceMailboxDisplayName: account.displayName,
              sourceEmailAddress: account.emailAddress,
            }));
          })
        )
      );
      const messages = results
        .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
        .sort((a, b) =>
          (b.receivedAt ?? b.sentAt ?? "").localeCompare(a.receivedAt ?? a.sentAt ?? "")
        )
        .slice(0, query.limit);
      const failures = results
        .map((result, index) =>
          result.status === "rejected"
            ? { mailAccountId: limitedAccounts[index]?.id ?? "unknown", status: "unavailable" as const }
            : null
        )
        .filter((item): item is { mailAccountId: string; status: "unavailable" } => Boolean(item));

      response.json({ messages, failures, nextCursor: null });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/mail/accounts/:mailAccountId/folders", async (request, response, next) => {
    try {
      const auth = requireAuthContext(request);
      const params = uuidParamSchema.parse(request.params);
      const { account } = await deps.mailAuthorizationService.requireMailboxRole(
        auth,
        params.mailAccountId,
        "viewer"
      );
      response.json(await deps.mailProvider.listFolders(account));
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/mail/accounts/:mailAccountId/messages", async (request, response, next) => {
    try {
      const auth = requireAuthContext(request);
      const params = uuidParamSchema.parse(request.params);
      const query = messageListQuerySchema.parse(request.query);
      const { account } = await deps.mailAuthorizationService.requireMailboxRole(
        auth,
        params.mailAccountId,
        "viewer"
      );
      response.json(await deps.mailProvider.listMessages(account, query));
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/mail/accounts/:mailAccountId/messages/:uid", async (request, response, next) => {
    try {
      const auth = requireAuthContext(request);
      const params = uidParamSchema.parse(request.params);
      const query = folderQuerySchema.parse(request.query);
      const { account } = await deps.mailAuthorizationService.requireMailboxRole(
        auth,
        params.mailAccountId,
        "viewer"
      );
      response.json(await deps.mailProvider.getMessage(account, query.folder, params.uid));
    } catch (error) {
      next(error);
    }
  });

  router.get(
    "/api/mail/accounts/:mailAccountId/messages/:uid/attachments/:attachmentId",
    async (request, response, next) => {
      try {
        const auth = requireAuthContext(request);
        const params = attachmentParamSchema.parse(request.params);
        const query = folderQuerySchema.parse(request.query);
        const { account } = await deps.mailAuthorizationService.requireMailboxRole(
          auth,
          params.mailAccountId,
          "viewer"
        );
        const attachment = await deps.mailProvider.getAttachment(
          account,
          query.folder,
          params.uid,
          params.attachmentId
        );
        if (attachment.size && attachment.size > account.max_attachment_mb * 1024 * 1024) {
          throw new HttpError(413, "ATTACHMENT_TOO_LARGE", "Attachment is too large.");
        }
        response.setHeader("Content-Type", attachment.contentType);
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader(
          "Content-Disposition",
          `attachment; filename="${attachment.filename.replace(/"/g, "_")}"`
        );
        await deps.audit.record({
          actorUserId: auth.userId,
          mailAccountId: account.id,
          action: "attachment_downloaded",
          targetType: "mail_attachment",
          targetIdentifier: params.attachmentId,
          metadata: { uid: params.uid, folder: query.folder },
          ipAddress: request.ip,
        });
        if (Buffer.isBuffer(attachment.content)) response.end(attachment.content);
        else attachment.content.pipe(response);
      } catch (error) {
        next(error);
      }
    }
  );

  router.patch("/api/mail/accounts/:mailAccountId/messages/:uid/read", async (request, response, next) => {
    try {
      const auth = requireAuthContext(request);
      const params = uidParamSchema.parse(request.params);
      const input = readMutationSchema.parse(request.body);
      const { account } = await deps.mailAuthorizationService.requireMailboxRole(
        auth,
        params.mailAccountId,
        "sender"
      );
      response.json(await deps.mailProvider.setRead(account, input.folder, params.uid, input.read));
    } catch (error) {
      next(error);
    }
  });

  router.patch("/api/mail/accounts/:mailAccountId/messages/:uid/flag", async (request, response, next) => {
    try {
      const auth = requireAuthContext(request);
      const params = uidParamSchema.parse(request.params);
      const input = flagMutationSchema.parse(request.body);
      const { account } = await deps.mailAuthorizationService.requireMailboxRole(
        auth,
        params.mailAccountId,
        "sender"
      );
      response.json(await deps.mailProvider.setFlagged(account, input.folder, params.uid, input.flagged));
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/mail/accounts/:mailAccountId/messages/:uid/archive", async (request, response, next) => {
    try {
      const auth = requireAuthContext(request);
      const params = uidParamSchema.parse(request.params);
      const query = folderQuerySchema.parse(request.body);
      const { account } = await deps.mailAuthorizationService.requireMailboxRole(
        auth,
        params.mailAccountId,
        "manager"
      );
      const archive = await resolveSpecialFolder(deps.mailProvider, account, "archive");
      const result = await deps.mailProvider.moveMessage(account, query.folder, params.uid, archive);
      await deps.audit.record({
        actorUserId: auth.userId,
        mailAccountId: account.id,
        action: "message_moved",
        targetType: "mail_message",
        targetIdentifier: String(params.uid),
        metadata: { action: "archive", sourceFolder: query.folder, destinationFolder: archive },
        ipAddress: request.ip,
      });
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/mail/accounts/:mailAccountId/messages/:uid/trash", async (request, response, next) => {
    try {
      const auth = requireAuthContext(request);
      const params = uidParamSchema.parse(request.params);
      const query = folderQuerySchema.parse(request.body);
      const { account } = await deps.mailAuthorizationService.requireMailboxRole(
        auth,
        params.mailAccountId,
        "manager"
      );
      const trash = await resolveSpecialFolder(deps.mailProvider, account, "trash");
      const result = await deps.mailProvider.moveMessage(account, query.folder, params.uid, trash);
      await deps.audit.record({
        actorUserId: auth.userId,
        mailAccountId: account.id,
        action: "message_trashed",
        targetType: "mail_message",
        targetIdentifier: String(params.uid),
        metadata: { sourceFolder: query.folder, destinationFolder: trash },
        ipAddress: request.ip,
      });
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/mail/accounts/:mailAccountId/messages/:uid/move", async (request, response, next) => {
    try {
      const auth = requireAuthContext(request);
      const params = uidParamSchema.parse(request.params);
      const input = moveMutationSchema.parse(request.body);
      const { account } = await deps.mailAuthorizationService.requireMailboxRole(
        auth,
        params.mailAccountId,
        "manager"
      );
      const result = await deps.mailProvider.moveMessage(
        account,
        input.sourceFolder,
        params.uid,
        input.destinationFolder
      );
      await deps.audit.record({
        actorUserId: auth.userId,
        mailAccountId: account.id,
        action: "message_moved",
        targetType: "mail_message",
        targetIdentifier: String(params.uid),
        metadata: { sourceFolder: input.sourceFolder, destinationFolder: input.destinationFolder },
        ipAddress: request.ip,
      });
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/mail/templates", async (request, response, next) => {
    try {
      const auth = requireAuthContext(request);
      const query = templateListQuerySchema.parse(request.query);
      response.json(await requireTemplateService(deps).listTemplates(auth, query));
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/mail/templates/:templateId", async (request, response, next) => {
    try {
      const auth = requireAuthContext(request);
      const params = templateIdParamSchema.parse(request.params);
      response.json(await requireTemplateService(deps).getTemplate(auth, params.templateId));
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/mail/templates", async (request, response, next) => {
    try {
      const auth = requireAuthContext(request);
      const input = createTemplateSchema.parse(request.body ?? {});
      response.status(201).json(
        await requireTemplateService(deps).createTemplate(auth, input, request.ip)
      );
    } catch (error) {
      next(error);
    }
  });

  router.patch("/api/mail/templates/:templateId", async (request, response, next) => {
    try {
      const auth = requireAuthContext(request);
      const params = templateIdParamSchema.parse(request.params);
      const input = updateTemplateSchema.parse(request.body ?? {});
      response.json(
        await requireTemplateService(deps).updateTemplate(auth, params.templateId, input, request.ip)
      );
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/mail/templates/:templateId/duplicate", async (request, response, next) => {
    try {
      const auth = requireAuthContext(request);
      const params = templateIdParamSchema.parse(request.params);
      const input = duplicateTemplateSchema.parse(request.body ?? {});
      response.status(201).json(
        await requireTemplateService(deps).duplicateTemplate(auth, params.templateId, input, request.ip)
      );
    } catch (error) {
      next(error);
    }
  });

  router.delete("/api/mail/templates/:templateId", async (request, response, next) => {
    try {
      const auth = requireAuthContext(request);
      const params = templateIdParamSchema.parse(request.params);
      response.json(await requireTemplateService(deps).deactivateTemplate(auth, params.templateId, request.ip));
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/api/mail/templates/import",
    templateUpload.single("template"),
    async (request, response, next) => {
      try {
        const auth = requireAuthContext(request);
        const input = importTemplateFieldsSchema.parse(request.body ?? {});
        response.status(201).json(
          await requireTemplateService(deps).importTemplate(
            auth,
            input,
            request.file,
            request.ip
          )
        );
      } catch (error) {
        next(error);
      }
    }
  );

  router.get("/api/mail/templates/:templateId/export", async (request, response, next) => {
    try {
      const auth = requireAuthContext(request);
      const params = templateIdParamSchema.parse(request.params);
      const exported = await requireTemplateService(deps).exportTemplate(auth, params.templateId, request.ip);
      response.setHeader("Content-Type", "application/json");
      response.setHeader(
        "Content-Disposition",
        `attachment; filename="${exported.filename.replace(/"/g, "_")}"`
      );
      response.json(exported);
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/api/mail/templates/:templateId/assets",
    templateUpload.single("asset"),
    async (request, response, next) => {
      try {
        const auth = requireAuthContext(request);
        const params = templateIdParamSchema.parse(request.params);
        if (!request.file) {
          throw new HttpError(400, "INVALID_REQUEST", "Template asset file is required.");
        }
        response.status(201).json(
          await requireTemplateService(deps).uploadAsset(auth, params.templateId, request.file, request.ip)
        );
      } catch (error) {
        next(error);
      }
    }
  );

  router.delete("/api/mail/templates/:templateId/assets/:assetId", async (request, response, next) => {
    try {
      const auth = requireAuthContext(request);
      const params = templateAssetParamSchema.parse(request.params);
      response.json(
        await requireTemplateService(deps).removeAsset(auth, params.templateId, params.assetId, request.ip)
      );
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/mail/templates/:templateId/render-preview", async (request, response, next) => {
    try {
      const auth = requireAuthContext(request);
      const params = templateIdParamSchema.parse(request.params);
      const input = renderTemplateSchema.parse(request.body ?? {});
      response.json(
        await requireTemplateService(deps).renderTemplate(auth, params.templateId, input.variables, {
          allowUnresolved: true,
        })
      );
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/mail/templates/validate-variables", async (request, response, next) => {
    try {
      const input = validateTemplateVariablesSchema.parse(request.body ?? {});
      response.json(
        requireTemplateService(deps).validateVariables(
          input.subjectTemplate,
          input.htmlContent,
          input.plainTextContent,
          input.variables,
          input.allowUnresolved
        )
      );
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/mail/templates/:templateId/test-send", async (request, response, next) => {
    try {
      const auth = requireAuthContext(request);
      const params = templateIdParamSchema.parse(request.params);
      const input = sendTemplateTestSchema.parse(request.body ?? {});
      const requiredRole = input.to === auth.email?.toLowerCase() ? "sender" : "manager";
      const { account } = await deps.mailAuthorizationService.requireMailboxRole(
        auth,
        input.mailAccountId,
        requiredRole
      );
      const rendered = await requireTemplateService(deps).renderTemplateForSend(
        auth,
        params.templateId,
        input.variables,
        request.ip
      );
      const result = await deps.mailProvider
        .sendMessage(
          account,
          {
            mode: "compose",
            to: [input.to],
            cc: [],
            bcc: [],
            subject: rendered.subject || "Template test",
            textBody: rendered.plainTextContent,
            sanitizedHtmlBody: rendered.htmlContent,
            inlineTemplateAssets: rendered.inlineAssets,
            references: [],
          },
          []
        )
        .catch((error: unknown) => {
          throw new HttpError(502, "TEST_SEND_FAILED", "Template test could not be sent.", error);
        });
      await deps.audit.record({
        actorUserId: auth.userId,
        mailAccountId: account.id,
        action: "template_test_sent",
        targetType: "mail_template",
        targetIdentifier: params.templateId,
        metadata: { messageId: result.messageId, assetCount: rendered.inlineAssets.length },
        ipAddress: request.ip,
      });
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/mail/accounts/:mailAccountId/send", upload.array("attachments", 20), async (request, response, next) => {
    const files = (request.files ?? []) as Express.Multer.File[];
    try {
      const auth = requireAuthContext(request);
      const params = uuidParamSchema.parse(request.params);
      const rawBody = typeof request.body.payload === "string" ? JSON.parse(request.body.payload) : request.body;
      const input = sendJsonSchema.parse(rawBody);
      const { account } = await deps.mailAuthorizationService.requireMailboxRole(
        auth,
        params.mailAccountId,
        "sender"
      );
      await deps.mailAuthorizationService.getIdentityForSend(account.id, input.identityId);
      const sanitizedHtmlBody = input.sanitizedHtmlBody
        ? sanitizeEmailHtml(input.sanitizedHtmlBody).html
        : undefined;
      const renderedTemplate = input.templateId
        ? await requireTemplateService(deps).renderTemplateForSend(
            auth,
            input.templateId,
            input.templateVariables,
            request.ip
          )
        : null;
      const sendInput = await deriveSendInput(deps.mailProvider, account, {
        ...input,
        subject: renderedTemplate?.subject || input.subject,
        textBody: renderedTemplate?.plainTextContent ?? input.textBody,
        sanitizedHtmlBody: renderedTemplate?.htmlContent ?? sanitizedHtmlBody ?? undefined,
        inlineTemplateAssets: renderedTemplate?.inlineAssets,
      });
      const totalAttachmentBytes = files.reduce((sum, file) => sum + file.size, 0);
      if (totalAttachmentBytes > account.max_attachment_mb * 1024 * 1024) {
        throw new HttpError(413, "ATTACHMENT_TOO_LARGE", "Attachments exceed mailbox limit.");
      }
      const result = await deps.mailProvider.sendMessage(
        account,
        sendInput,
        files
      );
      await deps.audit.record({
        actorUserId: auth.userId,
        mailAccountId: account.id,
        action: "message_sent",
        targetType: "mail_message",
        targetIdentifier: result.messageId,
        metadata: { recipientCount: sendInput.to.length + sendInput.cc.length + sendInput.bcc.length, mode: sendInput.mode },
        ipAddress: request.ip,
      });
      response.json(result);
    } catch (error) {
      next(error);
    } finally {
      for (const file of files) {
        rmSync(file.path, { force: true });
      }
    }
  });

  router.get("/api/mail/admin/accounts", async (request, response, next) => {
    try {
      const auth = requireAuthContext(request);
      response.json(await deps.mailAdminService.listAdminAccounts(auth));
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/mail/admin/users/search", async (request, response, next) => {
    try {
      const auth = requireAuthContext(request);
      const query = userSearchQuerySchema.parse(request.query);
      response.json(await deps.mailAdminService.searchUsers(auth, query.q));
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/mail/admin/accounts", async (request, response, next) => {
    try {
      const auth = requireAuthContext(request);
      const input = createMailAccountSchema.parse(request.body);
      const account = await deps.mailAdminService.createAccount(
        auth,
        input,
        request.ip
      );
      response.status(201).json(account);
    } catch (error) {
      next(error);
    }
  });

  router.patch(
    "/api/mail/admin/accounts/:mailAccountId",
    async (request, response, next) => {
      try {
        const auth = requireAuthContext(request);
        const params = uuidParamSchema.parse(request.params);
        const input = updateMailAccountSchema.parse(request.body);
        const account = await deps.mailAdminService.updateAccount(
          auth,
          params.mailAccountId,
          input,
          request.ip
        );
        response.json(account);
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/api/mail/admin/accounts/:mailAccountId/credentials",
    async (request, response, next) => {
      try {
        const auth = requireAuthContext(request);
        const params = uuidParamSchema.parse(request.params);
        const input = rotateCredentialsSchema.parse(request.body);
        const result = await deps.mailAdminService.rotateCredentials(
          auth,
          params.mailAccountId,
          input.password,
          request.ip
        );
        await deps.connectionManager.closeMailbox(params.mailAccountId);
        response.json(result);
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/api/mail/admin/accounts/:mailAccountId/test-imap",
    async (request, response, next) => {
      try {
        const auth = requireAuthContext(request);
        const params = uuidParamSchema.parse(request.params);
        await deps.mailAdminService.requireMailboxAdmin(
          auth,
          params.mailAccountId
        );
        const account = await deps.mailAdminService.getPrivateAccount(
          params.mailAccountId
        );
        response.json(await deps.connectionManager.testImap(account));
        await deps.audit.record({
          actorUserId: auth.userId,
          mailAccountId: params.mailAccountId,
          action: "imap_connection_tested",
          targetType: "mail_account",
          targetIdentifier: account.email_address,
          ipAddress: request.ip,
        });
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/api/mail/admin/accounts/:mailAccountId/test-smtp",
    async (request, response, next) => {
      try {
        testMessageSchema.parse(request.body ?? {});
        const auth = requireAuthContext(request);
        const params = uuidParamSchema.parse(request.params);
        await deps.mailAdminService.requireMailboxAdmin(
          auth,
          params.mailAccountId
        );
        const account = await deps.mailAdminService.getPrivateAccount(
          params.mailAccountId
        );
        response.json(await deps.connectionManager.testSmtp(account));
        await deps.audit.record({
          actorUserId: auth.userId,
          mailAccountId: params.mailAccountId,
          action: "smtp_connection_tested",
          targetType: "mail_account",
          targetIdentifier: account.email_address,
          ipAddress: request.ip,
        });
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/api/mail/admin/accounts/:mailAccountId/members",
    async (request, response, next) => {
      try {
        const auth = requireAuthContext(request);
        const params = uuidParamSchema.parse(request.params);
        const input = addMemberSchema.parse(request.body);
        response
          .status(201)
          .json(
            await deps.mailAdminService.addMember(
              auth,
              params.mailAccountId,
              input,
              request.ip
            )
          );
      } catch (error) {
        next(error);
      }
    }
  );

  router.patch(
    "/api/mail/admin/accounts/:mailAccountId/members/:userId",
    async (request, response, next) => {
      try {
        const auth = requireAuthContext(request);
        const params = memberParamSchema.parse(request.params);
        const input = updateMemberSchema.parse(request.body);
        response.json(
          await deps.mailAdminService.updateMember(
            auth,
            params.mailAccountId,
            params.userId,
            input.accessRole,
            request.ip
          )
        );
      } catch (error) {
        next(error);
      }
    }
  );

  router.delete(
    "/api/mail/admin/accounts/:mailAccountId/members/:userId",
    async (request, response, next) => {
      try {
        const auth = requireAuthContext(request);
        const params = memberParamSchema.parse(request.params);
        response.json(
          await deps.mailAdminService.removeMember(
            auth,
            params.mailAccountId,
            params.userId,
            request.ip
          )
        );
      } catch (error) {
        next(error);
      }
    }
  );

  router.use((_request, _response, next) => {
    next(new HttpError(404, "INVALID_REQUEST", "Route not found."));
  });

  return router;
}

function requireTemplateService(deps: RoutesDeps) {
  if (!deps.templateService) {
    throw new HttpError(500, "INTERNAL_ERROR", "Mail templates are not configured.");
  }

  return deps.templateService;
}

async function deriveSendInput(
  provider: MailProvider,
  account: MailAccountPrivate,
  input: SendMessageRequest
): Promise<SendMessageRequest> {
  if (
    (input.mode !== "reply" && input.mode !== "replyAll") ||
    !input.originalFolder ||
    !input.originalUid
  ) {
    return input;
  }

  const original = await provider.getMessage(
    account,
    input.originalFolder,
    input.originalUid
  );
  const selfAddresses = new Set(
    [
      account.email_address,
      account.reply_to_address,
      original.senderAddress === account.email_address ? original.senderAddress : null,
    ]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.toLowerCase())
  );
  const primary = original.replyTo.length > 0 ? original.replyTo : original.from;
  const to =
    input.to.length > 0
      ? input.to
      : uniqueAddresses(primary, selfAddresses).map((item) => item.address);
  const cc =
    input.mode === "replyAll" && input.cc.length === 0
      ? uniqueAddresses([...original.to, ...original.cc], new Set([...selfAddresses, ...to.map((item) => item.toLowerCase())])).map(
          (item) => item.address
        )
      : input.cc;

  return {
    ...input,
    to,
    cc,
    inReplyTo: input.inReplyTo ?? original.messageId ?? undefined,
    references:
      (input.references ?? []).length > 0
        ? input.references
        : [...original.references, original.messageId].filter(
            (value): value is string => Boolean(value)
          ),
  };
}

function uniqueAddresses(addresses: MailAddress[], excluded: Set<string>) {
  const seen = new Set<string>();
  const result: MailAddress[] = [];

  for (const address of addresses) {
    const lower = address.address.toLowerCase();
    if (excluded.has(lower) || seen.has(lower)) continue;
    seen.add(lower);
    result.push(address);
  }

  return result;
}

async function resolveSpecialFolder(
  provider: MailProvider,
  account: MailAccountPrivate,
  specialUse: "archive" | "trash"
) {
  const folders = await provider.listFolders(account);
  const match = folders.find((folder) => folder.specialUse === specialUse);

  if (!match) {
    throw new HttpError(
      404,
      "FOLDER_NOT_FOUND",
      `Mailbox does not expose a ${specialUse} folder.`
    );
  }

  return match.path;
}
