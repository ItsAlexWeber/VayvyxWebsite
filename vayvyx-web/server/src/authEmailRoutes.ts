import { Router } from "express";
import { z } from "zod";
import type { AuthEmailService } from "./authEmailService.js";
import { requireAuthContext } from "./auth.js";

const forgotPasswordSchema = z.object({
  email: z.string().trim().email().max(320).toLowerCase(),
});

const genericForgotPasswordResponse = {
  ok: true,
  message:
    "If an account exists for that email address, a password-reset link has been sent.",
};

export function createPublicAuthEmailRoutes(service: AuthEmailService) {
  const router = Router();

  router.post("/api/auth/forgot-password", async (request, response, next) => {
    try {
      const input = forgotPasswordSchema.parse(request.body ?? {});
      await service.sendPublicPasswordReset(
        input.email,
        resetRedirectForRequest(request),
        request.ip
      );
      response.json(genericForgotPasswordResponse);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export function createAuthenticatedAuthEmailRoutes(service: AuthEmailService) {
  const router = Router();

  router.post("/api/auth/password-changed", async (request, response, next) => {
    try {
      const auth = requireAuthContext(request);
      response.json(await service.sendPasswordChangedNotification(auth, request.ip));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function resetRedirectForRequest(request: { hostname: string }) {
  return request.hostname === "www.vayvyx.com"
    ? "https://www.vayvyx.com/reset-password"
    : "https://vayvyx.com/reset-password";
}
