import { supabase } from "./supabaseClient.ts";

const genericForgotPasswordMessage =
  "If an account exists for that email address, a password-reset link has been sent.";

export const authEmailApi = {
  async requestPasswordReset(email: string) {
    const response = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
      cache: "no-store",
    });

    if (!response.ok && response.status !== 429) {
      throw new Error("Password reset is temporarily unavailable. Try again shortly.");
    }

    return {
      ok: true as const,
      message: genericForgotPasswordMessage,
    };
  },

  async notifyPasswordChanged() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return { ok: true as const };

    await fetch("/api/auth/password-changed", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
      cache: "no-store",
    }).catch(() => undefined);

    return { ok: true as const };
  },
};
