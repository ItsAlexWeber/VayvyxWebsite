import { Router } from "express";
import { requireAuthContext } from "./auth.js";
import type { AccessManagementService } from "./accessManagementService.js";
import {
  accessMailboxParamSchema,
  accessUserParamSchema,
  completeInviteSchema,
  disablePersonSchema,
  invitePersonSchema,
  mailboxAssignmentSchema,
  peopleListQuerySchema,
  updateMailboxAssignmentSchema,
  updatePersonSchema,
} from "./accessValidation.js";

export function createInviteSetupRoutes(service: AccessManagementService) {
  const router = Router();

  router.post("/api/access/invite/complete", async (request, response, next) => {
    try {
      const auth = requireAuthContext(request);
      const input = completeInviteSchema.parse(request.body ?? {});
      response.json(await service.completeInvite(auth, input.fullName, request.ip));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export function createAccessAdminRoutes(service: AccessManagementService) {
  const router = Router();

  router.get("/api/access/people", async (request, response, next) => {
    try {
      const auth = requireAuthContext(request);
      const query = peopleListQuerySchema.parse(request.query);
      response.json(await service.listPeople(auth, query));
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/access/invite", async (request, response, next) => {
    try {
      const auth = requireAuthContext(request);
      const input = invitePersonSchema.parse(request.body ?? {});
      response.status(201).json(
        await service.invitePerson(
          auth,
          input,
          inviteRedirectForRequest(request),
          request.ip
        )
      );
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/access/mailboxes", async (request, response, next) => {
    try {
      const auth = requireAuthContext(request);
      response.json(await service.listMailboxPicker(auth));
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/access/people/:userId", async (request, response, next) => {
    try {
      const auth = requireAuthContext(request);
      const params = accessUserParamSchema.parse(request.params);
      response.json(await service.getPerson(auth, params.userId));
    } catch (error) {
      next(error);
    }
  });

  router.patch("/api/access/people/:userId", async (request, response, next) => {
    try {
      const auth = requireAuthContext(request);
      const params = accessUserParamSchema.parse(request.params);
      const input = updatePersonSchema.parse(request.body ?? {});
      response.json(await service.updatePerson(auth, params.userId, input, request.ip));
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/api/access/people/:userId/reset-password",
    async (request, response, next) => {
      try {
        const auth = requireAuthContext(request);
        const params = accessUserParamSchema.parse(request.params);
        response.json(
          await service.sendPasswordReset(
            auth,
            params.userId,
            resetRedirectForRequest(request),
            request.ip
          )
        );
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/api/access/people/:userId/resend-invite",
    async (request, response, next) => {
      try {
        const auth = requireAuthContext(request);
        const params = accessUserParamSchema.parse(request.params);
        response.json(
          await service.resendInvite(
            auth,
            params.userId,
            inviteRedirectForRequest(request),
            request.ip
          )
        );
      } catch (error) {
        next(error);
      }
    }
  );

  router.post("/api/access/people/:userId/disable", async (request, response, next) => {
    try {
      const auth = requireAuthContext(request);
      const params = accessUserParamSchema.parse(request.params);
      disablePersonSchema.parse(request.body ?? {});
      response.json(await service.disablePerson(auth, params.userId, request.ip));
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/access/people/:userId/reactivate", async (request, response, next) => {
    try {
      const auth = requireAuthContext(request);
      const params = accessUserParamSchema.parse(request.params);
      response.json(await service.reactivatePerson(auth, params.userId, request.ip));
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/access/people/:userId/repair-profile", async (request, response, next) => {
    try {
      const auth = requireAuthContext(request);
      const params = accessUserParamSchema.parse(request.params);
      response.json(await service.repairProfile(auth, params.userId, request.ip));
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/access/people/:userId/mailboxes", async (request, response, next) => {
    try {
      const auth = requireAuthContext(request);
      const params = accessUserParamSchema.parse(request.params);
      response.json(await service.listMailboxAssignments(auth, params.userId));
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/access/people/:userId/mailboxes", async (request, response, next) => {
    try {
      const auth = requireAuthContext(request);
      const params = accessUserParamSchema.parse(request.params);
      const input = mailboxAssignmentSchema.parse(request.body ?? {});
      response.status(201).json(
        await service.addMailboxAssignment(
          auth,
          params.userId,
          input.mailAccountId,
          input.accessRole,
          request.ip
        )
      );
    } catch (error) {
      next(error);
    }
  });

  router.patch(
    "/api/access/people/:userId/mailboxes/:mailAccountId",
    async (request, response, next) => {
      try {
        const auth = requireAuthContext(request);
        const params = accessMailboxParamSchema.parse(request.params);
        const input = updateMailboxAssignmentSchema.parse(request.body ?? {});
        response.json(
          await service.updateMailboxAssignment(
            auth,
            params.userId,
            params.mailAccountId,
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
    "/api/access/people/:userId/mailboxes/:mailAccountId",
    async (request, response, next) => {
      try {
        const auth = requireAuthContext(request);
        const params = accessMailboxParamSchema.parse(request.params);
        response.json(
          await service.removeMailboxAssignment(
            auth,
            params.userId,
            params.mailAccountId,
            request.ip
          )
        );
      } catch (error) {
        next(error);
      }
    }
  );

  router.get("/api/access/people/:userId/audit", async (request, response, next) => {
    try {
      const auth = requireAuthContext(request);
      const params = accessUserParamSchema.parse(request.params);
      response.json(await service.listAuditEvents(auth, params.userId));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function inviteRedirectForRequest(request: { hostname: string }) {
  return request.hostname === "www.vayvyx.com"
    ? "https://www.vayvyx.com/accept-invite"
    : "https://vayvyx.com/accept-invite";
}

function resetRedirectForRequest(request: { hostname: string }) {
  return request.hostname === "www.vayvyx.com"
    ? "https://www.vayvyx.com/reset-password"
    : "https://vayvyx.com/reset-password";
}
