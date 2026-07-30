export const authEmailTemplateKeys = [
  "auth_welcome_invite",
  "auth_password_reset",
  "auth_setup_reminder",
  "auth_password_changed",
  "auth_confirm_signup",
] as const;

export type AuthEmailTemplateKey = (typeof authEmailTemplateKeys)[number];

export const authEmailActionLabels: Record<AuthEmailTemplateKey, string> = {
  auth_welcome_invite: "Complete account setup",
  auth_password_reset: "Reset your password",
  auth_setup_reminder: "Complete account setup",
  auth_password_changed: "",
  auth_confirm_signup: "Confirm email",
};

export const authEmailTemplateNames: Record<AuthEmailTemplateKey, string> = {
  auth_welcome_invite: "Welcome invitation",
  auth_password_reset: "Password reset",
  auth_setup_reminder: "Setup reminder",
  auth_password_changed: "Password changed",
  auth_confirm_signup: "Future confirmation email",
};

export function isAuthEmailTemplateKey(value: string | null | undefined): value is AuthEmailTemplateKey {
  return authEmailTemplateKeys.includes(value as AuthEmailTemplateKey);
}
